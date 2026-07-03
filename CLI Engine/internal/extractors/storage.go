package extractors

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/Azure/azure-sdk-for-go/sdk/azcore"
	"github.com/Azure/azure-sdk-for-go/sdk/resourcemanager/storage/armstorage"
)

// StorageData holds the clean extracted data for all storage accounts.
type StorageData struct {
	TotalAccounts int               `json:"total_accounts"`
	Accounts      []json.RawMessage `json:"accounts"`
}

// ExtractStorage fetches all storage accounts for the subscription and
// returns clean JSON with noise fields removed.
func ExtractStorage(ctx context.Context, subID string, cred azcore.TokenCredential) (*StorageData, error) {
	client, err := armstorage.NewAccountsClient(subID, cred, nil)
	if err != nil {
		return nil, fmt.Errorf("creating storage client: %w", err)
	}

	var accounts []*armstorage.Account
	pager := client.NewListPager(nil)
	for pager.More() {
		page, err := pager.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("listing storage accounts: %w", err)
		}
		accounts = append(accounts, page.Value...)
	}

	clean, err := CleanResources(accounts)
	if err != nil {
		return nil, fmt.Errorf("cleaning storage accounts: %w", err)
	}

	return &StorageData{
		TotalAccounts: len(accounts),
		Accounts:      clean,
	}, nil
}
