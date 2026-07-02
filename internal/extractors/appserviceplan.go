package extractors

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/Azure/azure-sdk-for-go/sdk/azcore"
	"github.com/Azure/azure-sdk-for-go/sdk/resourcemanager/appservice/armappservice/v2"
)

// AppServicePlanData holds the clean extracted data for all app service plans.
type AppServicePlanData struct {
	TotalPlans int               `json:"total_plans"`
	Plans      []json.RawMessage `json:"plans"`
}

// ExtractAppServicePlan fetches all app service plans and returns clean JSON.
func ExtractAppServicePlan(ctx context.Context, subID string, cred azcore.TokenCredential) (*AppServicePlanData, error) {
	client, err := armappservice.NewPlansClient(subID, cred, nil)
	if err != nil {
		return nil, fmt.Errorf("creating app service plan client: %w", err)
	}

	var plans []*armappservice.Plan
	pager := client.NewListPager(nil)
	for pager.More() {
		page, err := pager.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("listing app service plans: %w", err)
		}
		plans = append(plans, page.Value...)
	}

	clean, err := CleanResources(plans)
	if err != nil {
		return nil, fmt.Errorf("cleaning app service plans: %w", err)
	}

	return &AppServicePlanData{
		TotalPlans: len(plans),
		Plans:      clean,
	}, nil
}
