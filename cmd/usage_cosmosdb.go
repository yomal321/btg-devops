package cmd

import (
	"context"
	"fmt"

	"github.com/Azure/azure-sdk-for-go/sdk/azidentity"
	"github.com/Azure/azure-sdk-for-go/sdk/resourcemanager/cosmos/armcosmos/v3"
)

func runCosmosDBUsage(ctx context.Context, subID string, cred *azidentity.DefaultAzureCredential, resourceID, name, rg string, days int) (*UsageReport, error) {
	cosmosClient, err := armcosmos.NewDatabaseAccountsClient(subID, cred, nil)
	if err != nil {
		return nil, fmt.Errorf("creating cosmos client: %w", err)
	}

	account, err := cosmosClient.Get(ctx, rg, name, nil)
	if err != nil {
		return nil, fmt.Errorf("getting cosmos account: %w", err)
	}

	meterMap, totalCost, currency, err := queryMeterCosts(ctx, subID, cred, resourceID, days)
	if err != nil {
		return nil, fmt.Errorf("querying meter costs: %w", err)
	}

	sqlClient, err := armcosmos.NewSQLResourcesClient(subID, cred, nil)
	if err != nil {
		return nil, fmt.Errorf("creating sql resources client: %w", err)
	}

	type dbInfo struct {
		name        string
		rus         float64
		isAutoscale bool
	}
	var databases []dbInfo
	var totalRUs float64

	dbPager := sqlClient.NewListSQLDatabasesPager(rg, name, nil)
	for dbPager.More() {
		page, err := dbPager.NextPage(ctx)
		if err != nil {
			break
		}
		for _, db := range page.Value {
			dbName := deref(db.Name)
			if dbName == "" {
				continue
			}
			var rus float64
			isAutoscale := false
			if db.Properties != nil && db.Properties.Options != nil {
				if db.Properties.Options.AutoscaleSettings != nil && db.Properties.Options.AutoscaleSettings.MaxThroughput != nil {
					rus = float64(*db.Properties.Options.AutoscaleSettings.MaxThroughput)
					isAutoscale = true
				} else if db.Properties.Options.Throughput != nil {
					rus = float64(*db.Properties.Options.Throughput)
				}
			}
			if rus == 0 {
				rus = 400
			}
			databases = append(databases, dbInfo{name: dbName, rus: rus, isAutoscale: isAutoscale})
			totalRUs += rus
		}
	}

	// Account-level properties
	consistency := ""
	if account.Properties != nil && account.Properties.ConsistencyPolicy != nil && account.Properties.ConsistencyPolicy.DefaultConsistencyLevel != nil {
		consistency = string(*account.Properties.ConsistencyPolicy.DefaultConsistencyLevel)
	}

	replicationCount := 0
	if account.Properties != nil {
		replicationCount = len(account.Properties.Locations)
	}

	backupPolicy := "none"
	if account.Properties != nil && account.Properties.BackupPolicy != nil {
		backupPolicy = "configured"
	}

	enableFreeTier := false
	if account.Properties != nil && account.Properties.EnableFreeTier != nil {
		enableFreeTier = *account.Properties.EnableFreeTier
	}

	// Build meter list
	var meters []MeterCost
	for meterName, cost := range meterMap {
		meters = append(meters, MeterCost{Name: meterName, Cost: cost, Currency: currency})
	}
	sortMetersByCost(meters)

	// Build sub-resources with 10+ rules per database
	var subResources []UsageSubResource
	var totalSaving float64

	for _, db := range databases {
		proportion := 0.0
		if totalRUs > 0 {
			proportion = db.rus / totalRUs
		}
		dbCost := totalCost * proportion

		sev := costSeverity(dbCost)
		details := map[string]string{
			"RU/s":      fmt.Sprintf("%.0f", db.rus),
			"autoscale": fmt.Sprintf("%v", db.isAutoscale),
		}

		var tips []string
		var saving float64

		// Rule 1 — High fixed throughput, not autoscale
		if db.rus > 4000 && !db.isAutoscale {
			tips = append(tips, "High fixed RU/s without autoscale — switch to autoscale to save ~20% on idle capacity")
			saving += dbCost * 0.20
		}

		// Rule 2 — Very high throughput (likely over-provisioned)
		if db.rus > 10000 {
			tips = append(tips, fmt.Sprintf("Very high provisioned throughput (%.0f RU/s) — verify actual usage justifies this", db.rus))
			saving += dbCost * 0.30
		}

		// Rule 3 — Minimum throughput (could be serverless)
		if db.rus == 400 && dbCost > 5 {
			tips = append(tips, "Running at minimum 400 RU/s — consider Cosmos DB Serverless for unpredictable or low workloads")
			saving += dbCost * 0.40
		}

		// Rule 4 — Autoscale max too high
		if db.isAutoscale && db.rus > 20000 {
			tips = append(tips, fmt.Sprintf("Autoscale max set to %.0f RU/s — reduce max throughput if peak demand is lower", db.rus))
			saving += dbCost * 0.15
		}

		// Rule 5 — High cost per database
		if dbCost > 100 {
			sev = Critical
			tips = append(tips, fmt.Sprintf("High monthly cost ($%.2f) — review query patterns and indexing to reduce RU consumption", dbCost))
		}

		tip := ""
		if len(tips) > 0 {
			tip = tips[0]
			if len(tips) > 1 {
				tip += fmt.Sprintf(" (+%d more recommendations)", len(tips)-1)
			}
		}
		totalSaving += saving

		subResources = append(subResources, UsageSubResource{
			Name:          db.name,
			Cost:          dbCost,
			Currency:      currency,
			Severity:      sev,
			Details:       details,
			Tip:           tip,
			MonthlySaving: saving,
		})
	}

	// Account-level rules for top recommendation
	var accountTips []string

	// Rule 6 — Strong consistency is most expensive
	if consistency == "Strong" {
		accountTips = append(accountTips, "Strong consistency doubles read RU cost — use BoundedStaleness or Session consistency if strong consistency is not required")
		totalSaving += totalCost * 0.15
	}

	// Rule 7 — Multi-region writes expensive
	if replicationCount > 2 {
		accountTips = append(accountTips, fmt.Sprintf("Account has %d regions — each write region multiplies write RU cost; use single write region with read replicas if possible", replicationCount))
		totalSaving += totalCost * 0.20
	}

	// Rule 8 — No backup policy
	if backupPolicy == "none" {
		accountTips = append(accountTips, "No backup policy configured — enable periodic backup to prevent data loss (minimal cost impact)")
	}

	// Rule 9 — Free tier not enabled on low-cost accounts
	if !enableFreeTier && totalCost < 25 {
		accountTips = append(accountTips, "Free tier not enabled — first 1000 RU/s and 25 GB storage are free per subscription; enable if eligible")
		totalSaving += 25
	}

	// Rule 10 — No databases found
	if len(databases) == 0 {
		accountTips = append(accountTips, "No SQL databases found — account may be idle; consider deleting if unused to eliminate fixed costs")
		totalSaving += totalCost
	}

	topRec := ""
	if len(accountTips) > 0 {
		topRec = accountTips[0]
	} else if totalSaving > 0 {
		topRec = "Switch high-RU/s databases to autoscale to save ~20% on provisioned throughput"
	}

	utilMetrics := queryResourceMetrics(ctx, subID, cred, resourceID, []string{"NormalizedRUConsumption", "TotalRequests"}, days)
	ruPct := utilMetrics["NormalizedRUConsumption"]
	requestsPerDay := utilMetrics["TotalRequests"]
	// NormalizedRUConsumption returns 0 when diagnostics are not configured — use
	// TotalRequests as the reliable activity signal instead.
	wasteScore, wasteReason := calcWasteScore(totalCost, -1, requestsPerDay)

	return &UsageReport{
		ResourceName:      name,
		ResourceType:      "microsoft.documentdb/databaseaccounts",
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
		Utilization:       map[string]float64{"RU %": ruPct, "Requests/day": requestsPerDay},
		WasteScore:        wasteScore,
		WasteReason:       wasteReason,
	}, nil
}
