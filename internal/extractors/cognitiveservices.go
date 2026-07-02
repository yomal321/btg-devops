package extractors

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/Azure/azure-sdk-for-go/sdk/azcore"
	"github.com/Azure/azure-sdk-for-go/sdk/resourcemanager/cognitiveservices/armcognitiveservices"
)

// CognitiveServicesData holds the clean extracted data for all cognitive services accounts.
type CognitiveServicesData struct {
	TotalAccounts int               `json:"total_accounts"`
	Accounts      []json.RawMessage `json:"accounts"`
}

// ExtractCognitiveServices fetches all cognitive services accounts and returns clean JSON.
func ExtractCognitiveServices(ctx context.Context, subID string, cred azcore.TokenCredential) (*CognitiveServicesData, error) {
	client, err := armcognitiveservices.NewAccountsClient(subID, cred, nil)
	if err != nil {
		return nil, fmt.Errorf("creating cognitive services client: %w", err)
	}

	var accounts []*armcognitiveservices.Account
	pager := client.NewListPager(nil)
	for pager.More() {
		page, err := pager.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("listing cognitive services accounts: %w", err)
		}
		accounts = append(accounts, page.Value...)
	}

	clean, err := CleanResources(accounts)
	if err != nil {
		return nil, fmt.Errorf("cleaning cognitive services accounts: %w", err)
	}

	return &CognitiveServicesData{
		TotalAccounts: len(accounts),
		Accounts:      clean,
	}, nil
}
