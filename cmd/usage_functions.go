package cmd

import (
	"context"
	"fmt"

	"github.com/Azure/azure-sdk-for-go/sdk/azidentity"
	"github.com/Azure/azure-sdk-for-go/sdk/resourcemanager/appservice/armappservice/v2"
)

// BuildFunctionsUsageTips returns optimization tips and estimated saving for a Function App.
func BuildFunctionsUsageTips(planType, state string, httpsOnly, alwaysOn, remoteDebugging bool, minTLSVersion string, totalCost float64) (tips []string, saving float64) {
	switch planType {
	case "S1", "S2", "S3", "P1v2", "P2v2", "P3v2", "P1v3", "P2v3", "P3v3":
		if totalCost > 30 {
			saving += totalCost * 0.50
			tips = append(tips, fmt.Sprintf("Functions on dedicated %s plan — switch to Consumption or Flex Consumption for event-driven workloads to save ~50%%", planType))
		}
	}
	switch planType {
	case "EP1", "EP2", "EP3":
		if totalCost > 50 {
			saving += totalCost * 0.35
			tips = append(tips, fmt.Sprintf("Elastic Premium %s plan — verify always-ready instance count; reduce pre-warmed instances to lower idle cost by ~35%%", planType))
		}
	}
	if (planType == "Y1" || planType == "unknown") && alwaysOn {
		tips = append(tips, "Always On is enabled on a Consumption/unknown plan — this has no effect on Consumption and wastes billing; disable it")
	}
	if state == "Stopped" {
		saving += totalCost
		tips = append(tips, "Function app is stopped — still consuming plan capacity on dedicated/premium plans; remove if unused")
	}
	if !httpsOnly {
		tips = append(tips, "HTTPS-only is not enforced — enable to prevent plain HTTP requests to function endpoints")
	}
	if minTLSVersion == "1.0" || minTLSVersion == "1.1" {
		tips = append(tips, fmt.Sprintf("Minimum TLS version is %s — upgrade to TLS 1.2 for security compliance", minTLSVersion))
	}
	if remoteDebugging {
		tips = append(tips, "Remote debugging is enabled — disable immediately in production; this is a significant security risk")
	}
	if planType == "Y1" && totalCost > 20 {
		tips = append(tips, fmt.Sprintf("High Consumption plan cost ($%.2f) — review function execution frequency and duration; optimize cold start time to reduce billing", totalCost))
	}
	if totalCost == 0 {
		tips = append(tips, "Zero cost — function app has no executions in this period; verify it is still needed or delete to free plan capacity")
	}
	if (planType == "EP1" || planType == "EP2" || planType == "EP3") && totalCost < 5 {
		saving += totalCost
		tips = append(tips, fmt.Sprintf("Premium plan %s with near-zero activity — switch to Consumption plan to pay only for actual executions", planType))
	}
	return
}

func runFunctionsUsage(ctx context.Context, subID string, cred *azidentity.DefaultAzureCredential, resourceID, name, rg string, days int) (*UsageReport, error) {
	appsClient, err := armappservice.NewWebAppsClient(subID, cred, nil)
	if err != nil {
		return nil, fmt.Errorf("creating web apps client: %w", err)
	}

	app, err := appsClient.Get(ctx, rg, name, nil)
	if err != nil {
		return nil, fmt.Errorf("getting function app: %w", err)
	}

	meterMap, totalCost, currency, err := queryMeterCosts(ctx, subID, cred, resourceID, days)
	if err != nil {
		return nil, fmt.Errorf("querying meter costs: %w", err)
	}

	var meters []MeterCost
	for meterName, cost := range meterMap {
		meters = append(meters, MeterCost{Name: meterName, Cost: cost, Currency: currency})
	}
	sortMetersByCost(meters)

	// App properties
	state := ""
	planID := ""
	planName := ""
	httpsOnly := false
	minTLSVersion := ""
	remoteDebugging := false
	alwaysOn := false

	if app.Properties != nil {
		if app.Properties.State != nil {
			state = *app.Properties.State
		}
		if app.Properties.ServerFarmID != nil {
			planID = *app.Properties.ServerFarmID
			planName = lastSegment(planID)
		}
		if app.Properties.HTTPSOnly != nil {
			httpsOnly = *app.Properties.HTTPSOnly
		}
		if app.Properties.SiteConfig != nil {
			if app.Properties.SiteConfig.MinTLSVersion != nil {
				minTLSVersion = string(*app.Properties.SiteConfig.MinTLSVersion)
			}
			// FtpState not available in this SDK version
			if app.Properties.SiteConfig.RemoteDebuggingEnabled != nil {
				remoteDebugging = *app.Properties.SiteConfig.RemoteDebuggingEnabled
			}
			if app.Properties.SiteConfig.AlwaysOn != nil {
				alwaysOn = *app.Properties.SiteConfig.AlwaysOn
			}
		}
	}

	// Get plan type
	planType := "unknown"
	if planName != "" {
		plansClient, err := armappservice.NewPlansClient(subID, cred, nil)
		if err == nil {
			planRG := extractResourceGroup(planID)
			if planRG == "" {
				planRG = rg
			}
			plan, err := plansClient.Get(ctx, planRG, planName, nil)
			if err == nil && plan.SKU != nil && plan.SKU.Name != nil {
				planType = string(*plan.SKU.Name)
			}
		}
	}

	var tips []string
	totalSaving := 0.0

	// Rule 1 — Dedicated plan (should use consumption)
	switch planType {
	case "S1", "S2", "S3", "P1v2", "P2v2", "P3v2", "P1v3", "P2v3", "P3v3":
		if totalCost > 30 {
			saving := totalCost * 0.50
			totalSaving += saving
			tips = append(tips, fmt.Sprintf("Functions on dedicated %s plan — switch to Consumption or Flex Consumption for event-driven workloads to save ~50%%", planType))
		}
	}

	// Rule 2 — Premium plan, check pre-warmed instances
	switch planType {
	case "EP1", "EP2", "EP3":
		if totalCost > 50 {
			saving := totalCost * 0.35
			totalSaving += saving
			tips = append(tips, fmt.Sprintf("Elastic Premium %s plan — verify always-ready instance count; reduce pre-warmed instances to lower idle cost by ~35%%", planType))
		}
	}

	// Rule 3 — Always-on enabled on consumption (wastes money)
	if (planType == "Y1" || planType == "unknown") && alwaysOn {
		tips = append(tips, "Always On is enabled on a Consumption/unknown plan — this has no effect on Consumption and wastes billing; disable it")
	}

	// Rule 4 — App stopped
	if state == "Stopped" {
		tips = append(tips, "Function app is stopped — still consuming plan capacity on dedicated/premium plans; remove if unused")
		totalSaving += totalCost
	}

	// Rule 5 — HTTPS not enforced
	if !httpsOnly {
		tips = append(tips, "HTTPS-only is not enforced — enable to prevent plain HTTP requests to function endpoints")
	}

	// Rule 6 — Old TLS version
	if minTLSVersion == "1.0" || minTLSVersion == "1.1" {
		tips = append(tips, fmt.Sprintf("Minimum TLS version is %s — upgrade to TLS 1.2 for security compliance", minTLSVersion))
	}

	// Rule 8 — Remote debugging on
	if remoteDebugging {
		tips = append(tips, "Remote debugging is enabled — disable immediately in production; this is a significant security risk")
	}

	// Rule 9 — High execution cost on consumption
	if planType == "Y1" && totalCost > 20 {
		tips = append(tips, fmt.Sprintf("High Consumption plan cost ($%.2f) — review function execution frequency and duration; optimize cold start time to reduce billing", totalCost))
	}

	// Rule 10 — Zero cost (idle function)
	if totalCost == 0 {
		tips = append(tips, "Zero cost — function app has no executions in this period; verify it is still needed or delete to free plan capacity")
	}

	// Rule 11 — Premium plan but no traffic (EP idle)
	if (planType == "EP1" || planType == "EP2" || planType == "EP3") && totalCost < 5 {
		saving := totalCost
		totalSaving += saving
		tips = append(tips, fmt.Sprintf("Premium plan %s with near-zero activity — switch to Consumption plan to pay only for actual executions", planType))
	}

	tip := ""
	if len(tips) > 0 {
		tip = tips[0]
		if len(tips) > 1 {
			tip += fmt.Sprintf(" (+%d more findings)", len(tips)-1)
		}
	}

	subResources := []UsageSubResource{
		{
			Name:     name,
			Cost:     totalCost,
			Currency: currency,
			Severity: costSeverity(totalCost),
			Details: map[string]string{
				"state":        state,
				"plan":         planName,
				"plan_type":    planType,
				"https_only":   fmt.Sprintf("%v", httpsOnly),
				"always_on":    fmt.Sprintf("%v", alwaysOn),
				"remote_debug": fmt.Sprintf("%v", remoteDebugging),
			"min_tls":      minTLSVersion,
			},
			Tip:           tip,
			MonthlySaving: totalSaving,
		},
	}

	topRec := ""
	if len(tips) > 0 {
		topRec = tips[0]
	}

	utilMetrics := queryResourceMetrics(ctx, subID, cred, resourceID, []string{"FunctionExecutionCount"}, days, "Count")
	execsPerDay := utilMetrics["FunctionExecutionCount"]
	wasteScore, wasteReason := calcWasteScore(totalCost, -1, execsPerDay)

	return &UsageReport{
		ResourceName:      name,
		ResourceType:      "microsoft.web/sites",
		ResourceGroup:     rg,
		Period:            periodString(days),
		Days:              days,
		TotalCost:         totalCost,
		Currency:          currency,
		Severity:          costSeverity(totalCost),
		Meters:            meters,
		SubResources:      subResources,
		TotalSaving:       totalSaving,
		TopRecommendation: topRec,
		Utilization:       map[string]float64{"Executions/day": execsPerDay},
		WasteScore:        wasteScore,
		WasteReason:       wasteReason,
	}, nil
}
