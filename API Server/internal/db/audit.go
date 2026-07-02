package db

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// AuditRow is the lightweight audit record returned in list views.
type AuditRow struct {
	ID               string          `json:"id"`
	CreatedAt        time.Time       `json:"created_at"`
	SubscriptionID   string          `json:"subscription_id"`
	SubscriptionName string          `json:"subscription_name"`
	TriggerType      string          `json:"trigger_type"`
	Status           string          `json:"status"`
	ErrorMessage     string          `json:"error_message,omitempty"`
	ResourceCounts   json.RawMessage `json:"resource_counts"`
	HasAnalysis      bool            `json:"has_analysis"`
}

// AuditDetail is the full audit record including raw_data and claude_analysis.
type AuditDetail struct {
	AuditRow
	RawData        json.RawMessage `json:"raw_data"`
	ClaudeAnalysis json.RawMessage `json:"claude_analysis,omitempty"`
}

// ListAudits returns all audits ordered by newest first (no raw_data — lightweight).
func ListAudits(ctx context.Context, pool *pgxpool.Pool) ([]AuditRow, error) {
	rows, err := pool.Query(ctx, `
		SELECT
			id::text,
			created_at,
			subscription_id,
			COALESCE(subscription_name, ''),
			trigger_type,
			status,
			COALESCE(error_message, ''),
			COALESCE(resource_counts, '{}'::jsonb),
			claude_analysis IS NOT NULL AS has_analysis
		FROM audits
		ORDER BY created_at DESC
	`)
	if err != nil {
		return nil, fmt.Errorf("listing audits: %w", err)
	}
	defer rows.Close()

	var audits []AuditRow
	for rows.Next() {
		var a AuditRow
		var counts []byte
		if err := rows.Scan(
			&a.ID, &a.CreatedAt, &a.SubscriptionID, &a.SubscriptionName,
			&a.TriggerType, &a.Status, &a.ErrorMessage, &counts, &a.HasAnalysis,
		); err != nil {
			return nil, fmt.Errorf("scanning audit row: %w", err)
		}
		a.ResourceCounts = json.RawMessage(counts)
		audits = append(audits, a)
	}
	return audits, nil
}

// GetAudit returns a single audit's full detail including raw_data.
func GetAudit(ctx context.Context, pool *pgxpool.Pool, auditID string) (*AuditDetail, error) {
	var a AuditDetail
	var counts, rawData, claudeAnalysis []byte
	err := pool.QueryRow(ctx, `
		SELECT
			id::text,
			created_at,
			subscription_id,
			COALESCE(subscription_name, ''),
			trigger_type,
			status,
			COALESCE(error_message, ''),
			COALESCE(resource_counts, '{}'::jsonb),
			claude_analysis IS NOT NULL,
			COALESCE(raw_data, '{}'::jsonb),
			claude_analysis
		FROM audits
		WHERE id = $1
	`, auditID).Scan(
		&a.ID, &a.CreatedAt, &a.SubscriptionID, &a.SubscriptionName,
		&a.TriggerType, &a.Status, &a.ErrorMessage, &counts,
		&a.HasAnalysis, &rawData, &claudeAnalysis,
	)
	if err != nil {
		return nil, fmt.Errorf("getting audit: %w", err)
	}
	a.ResourceCounts = json.RawMessage(counts)
	a.RawData = json.RawMessage(rawData)
	if claudeAnalysis != nil {
		a.ClaudeAnalysis = json.RawMessage(claudeAnalysis)
	}
	return &a, nil
}

// SaveClaudeAnalysis stores Claude's analysis response for an audit.
// Returns the updated audit's has_analysis flag.
func SaveClaudeAnalysis(ctx context.Context, pool *pgxpool.Pool, auditID string, analysis json.RawMessage) error {
	tag, err := pool.Exec(ctx, `
		UPDATE audits SET claude_analysis = $2 WHERE id = $1
	`, auditID, []byte(analysis))
	if err != nil {
		return fmt.Errorf("saving claude analysis: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("audit %s not found", auditID)
	}
	return nil
}
