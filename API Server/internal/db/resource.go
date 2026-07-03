package db

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Resource represents one row in the resources registry table.
type Resource struct {
	ID          int    `json:"id"`
	Slug        string `json:"slug"`
	Name        string `json:"name"`
	Description string `json:"description"`
}

// resourceSeedData is the fixed list of all 12 Azure resource types.
var resourceSeedData = []Resource{
	{Slug: "storage", Name: "Storage Accounts", Description: "Azure Blob, File, Queue and Table storage accounts"},
	{Slug: "iam", Name: "IAM (RBAC)", Description: "Role assignments and custom role definitions across the subscription"},
	{Slug: "nsg", Name: "Network Security Groups", Description: "Inbound and outbound traffic rules for virtual networks"},
	{Slug: "acr", Name: "Container Registries", Description: "Azure Container Registry instances and their configurations"},
	{Slug: "cosmosdb", Name: "Cosmos DB", Description: "NoSQL and multi-model database accounts"},
	{Slug: "keyvault", Name: "Key Vaults", Description: "Secrets, keys and certificates stored in Azure Key Vault"},
	{Slug: "functions", Name: "Azure Functions", Description: "Serverless function app configurations and bindings"},
	{Slug: "appservice", Name: "App Services", Description: "Web app configurations with 30-day traffic metrics"},
	{Slug: "appserviceplan", Name: "App Service Plans", Description: "Hosting plans that define compute resources for web apps"},
	{Slug: "publicip", Name: "Public IP Addresses", Description: "Publicly exposed IP addresses assigned to Azure resources"},
	{Slug: "cognitiveservices", Name: "Cognitive Services", Description: "Azure AI and Cognitive Services account configurations"},
	{Slug: "resourcegroup", Name: "Resource Groups", Description: "Logical containers that group related Azure resources"},
}

// SeedResources inserts all 12 resource definitions if the table is empty.
// Safe to call on every startup — only runs when count is zero.
func SeedResources(ctx context.Context, pool *pgxpool.Pool) error {
	var count int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM resources`).Scan(&count); err != nil {
		return fmt.Errorf("checking resources count: %w", err)
	}
	if count > 0 {
		return nil
	}
	for _, r := range resourceSeedData {
		_, err := pool.Exec(ctx, `
			INSERT INTO resources (slug, name, description)
			VALUES ($1, $2, $3)
			ON CONFLICT (slug) DO NOTHING
		`, r.Slug, r.Name, r.Description)
		if err != nil {
			return fmt.Errorf("seeding resource %s: %w", r.Slug, err)
		}
	}
	return nil
}

// ListResources returns all resource type definitions.
func ListResources(ctx context.Context, pool *pgxpool.Pool) ([]Resource, error) {
	rows, err := pool.Query(ctx, `SELECT id, slug, name, description FROM resources ORDER BY id ASC`)
	if err != nil {
		return nil, fmt.Errorf("listing resources: %w", err)
	}
	defer rows.Close()

	var resources []Resource
	for rows.Next() {
		var r Resource
		if err := rows.Scan(&r.ID, &r.Slug, &r.Name, &r.Description); err != nil {
			return nil, fmt.Errorf("scanning resource: %w", err)
		}
		resources = append(resources, r)
	}
	return resources, nil
}

// GetResourceBySlug returns one resource definition by slug.
func GetResourceBySlug(ctx context.Context, pool *pgxpool.Pool, slug string) (*Resource, error) {
	var r Resource
	err := pool.QueryRow(ctx, `
		SELECT id, slug, name, description FROM resources WHERE slug = $1
	`, slug).Scan(&r.ID, &r.Slug, &r.Name, &r.Description)
	if err != nil {
		return nil, fmt.Errorf("resource %q not found", slug)
	}
	return &r, nil
}

// GetResourceByID returns one resource definition by id.
func GetResourceByID(ctx context.Context, pool *pgxpool.Pool, id int) (*Resource, error) {
	var r Resource
	err := pool.QueryRow(ctx, `
		SELECT id, slug, name, description FROM resources WHERE id = $1
	`, id).Scan(&r.ID, &r.Slug, &r.Name, &r.Description)
	if err != nil {
		return nil, fmt.Errorf("resource id %d not found", id)
	}
	return &r, nil
}

// GetAuditResource extracts one resource type's raw data from an audit's raw_data JSONB.
// Returns the JSON for that resource only — e.g. all storage accounts.
func GetAuditResource(ctx context.Context, pool *pgxpool.Pool, auditID, slug string) (json.RawMessage, error) {
	var data []byte
	err := pool.QueryRow(ctx, `
		SELECT raw_data -> $2
		FROM audits
		WHERE id = $1 AND raw_data IS NOT NULL
	`, auditID, slug).Scan(&data)
	if err != nil {
		return nil, fmt.Errorf("getting resource data: %w", err)
	}
	if data == nil {
		return nil, fmt.Errorf("no data for resource %q in this audit", slug)
	}
	return json.RawMessage(data), nil
}
