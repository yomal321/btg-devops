package extractors

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/Azure/azure-sdk-for-go/sdk/azcore"
	"github.com/Azure/azure-sdk-for-go/sdk/resourcemanager/keyvault/armkeyvault"
)

// KeyVaultData holds the clean extracted data for all key vaults.
type KeyVaultData struct {
	TotalVaults int               `json:"total_vaults"`
	Vaults      []json.RawMessage `json:"vaults"`
}

// ExtractKeyVault fetches all key vaults and returns clean JSON.
func ExtractKeyVault(ctx context.Context, subID string, cred azcore.TokenCredential) (*KeyVaultData, error) {
	client, err := armkeyvault.NewVaultsClient(subID, cred, nil)
	if err != nil {
		return nil, fmt.Errorf("creating keyvault client: %w", err)
	}

	var vaults []*armkeyvault.Vault
	pager := client.NewListBySubscriptionPager(nil)
	for pager.More() {
		page, err := pager.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("listing key vaults: %w", err)
		}
		vaults = append(vaults, page.Value...)
	}

	clean, err := CleanResources(vaults)
	if err != nil {
		return nil, fmt.Errorf("cleaning key vaults: %w", err)
	}

	return &KeyVaultData{
		TotalVaults: len(vaults),
		Vaults:      clean,
	}, nil
}
