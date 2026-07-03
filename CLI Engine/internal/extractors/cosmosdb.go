package extractors

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/Azure/azure-sdk-for-go/sdk/azcore"
	"github.com/Azure/azure-sdk-for-go/sdk/resourcemanager/cosmos/armcosmos/v3"
)

// CosmosDBData holds the clean extracted data for all Cosmos DB accounts.
type CosmosDBData struct {
	TotalAccounts int               `json:"total_accounts"`
	Accounts      []json.RawMessage `json:"accounts"`
}

// ExtractCosmosDB fetches all Cosmos DB accounts and returns clean JSON.
func ExtractCosmosDB(ctx context.Context, subID string, cred azcore.TokenCredential) (*CosmosDBData, error) {
	client, err := armcosmos.NewDatabaseAccountsClient(subID, cred, nil)
	if err != nil {
		return nil, fmt.Errorf("creating cosmosdb client: %w", err)
	}

	var accounts []*armcosmos.DatabaseAccountGetResults
	pager := client.NewListPager(nil)
	for pager.More() {
		page, err := pager.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("listing cosmosdb accounts: %w", err)
		}
		accounts = append(accounts, page.Value...)
	}

	clean, err := CleanResources(accounts)
	if err != nil {
		return nil, fmt.Errorf("cleaning cosmosdb accounts: %w", err)
	}

	return &CosmosDBData{
		TotalAccounts: len(accounts),
		Accounts:      clean,
	}, nil
}
