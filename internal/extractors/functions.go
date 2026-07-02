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

	clean, err := CleanResources(apps)
	if err != nil {
		return nil, fmt.Errorf("cleaning function apps: %w", err)
	}

	return &FunctionsData{
		TotalFunctionApps: len(apps),
		FunctionApps:      clean,
	}, nil
}
