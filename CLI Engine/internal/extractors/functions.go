package extractors

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/Azure/azure-sdk-for-go/sdk/azcore"
	"github.com/Azure/azure-sdk-for-go/sdk/resourcemanager/appservice/armappservice/v2"
)

// FunctionsData holds the clean extracted data for all function apps.
type FunctionsData struct {
	TotalFunctionApps int               `json:"total_function_apps"`
	FunctionApps      []json.RawMessage `json:"function_apps"`
}

// ExtractFunctions fetches all function apps and returns clean JSON.
func ExtractFunctions(ctx context.Context, subID string, cred azcore.TokenCredential) (*FunctionsData, error) {
	client, err := armappservice.NewWebAppsClient(subID, cred, nil)
	if err != nil {
		return nil, fmt.Errorf("creating functions client: %w", err)
	}

	var apps []*armappservice.Site
	pager := client.NewListPager(nil)
	for pager.More() {
		page, err := pager.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("listing web apps: %w", err)
		}
		for _, app := range page.Value {
			if app.Kind != nil && strings.Contains(strings.ToLower(*app.Kind), "functionapp") {
				apps = append(apps, app)
			}
		}
	}

	// Per-app security enrichment (spec 11 §1) is merged into each cleaned
	// envelope rather than changing this extractor's output shape.
	cleanApps := make([]json.RawMessage, 0, len(apps))
	for _, app := range apps {
		clean, err := CleanResource(app)
		if err != nil {
			return nil, fmt.Errorf("cleaning function app %s: %w", derefStr(app.Name), err)
		}
		enrichment := SiteEnrichment{}
		if app.ID != nil && app.Name != nil {
			enrichment = EnrichSite(ctx, client, extractResourceGroup(*app.ID), *app.Name)
		}
		enriched, err := mergeIntoJSON(clean, map[string]any{
			"security_config":          enrichment.SecurityConfig,
			"security_config_error":    omitEmpty(enrichment.SecurityConfigError),
			"auth_config":              enrichment.AuthConfig,
			"auth_config_error":        omitEmpty(enrichment.AuthConfigError),
			"app_setting_names":        enrichment.AppSettingNames,
			"app_settings_error":       omitEmpty(enrichment.AppSettingsError),
			"keyvault_reference_count": enrichment.KeyVaultReferenceCount,
		})
		if err != nil {
			return nil, fmt.Errorf("enriching function app %s: %w", derefStr(app.Name), err)
		}
		cleanApps = append(cleanApps, enriched)
	}

	return &FunctionsData{
		TotalFunctionApps: len(apps),
		FunctionApps:      cleanApps,
	}, nil
}
