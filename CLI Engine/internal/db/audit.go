package db

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// CreateAuditParams holds the fields needed to open a new audit row.
type CreateAuditParams struct {
	SubscriptionID   string
	SubscriptionName string
	TriggerType      string  // "manual" | "scheduled"
	CreatedBy        *string // nil when triggered by scheduled cron (no user session)
}

// CreateAudit inserts a new audit row with status="running" and returns its UUID.
// Call CompleteAudit or FailAudit once data collection finishes.
func CreateAudit(ctx context.Context, pool *pgxpool.Pool, p CreateAuditParams) (string, error) {
	var id string
	err := pool.QueryRow(ctx, `
		INSERT INTO audits (subscription_id, subscription_name, trigger_type, created_by, status)
		VALUES ($1, $2, $3, $4, 'running')
		RETURNING id::text
	`, p.SubscriptionID, p.SubscriptionName, p.TriggerType, p.CreatedBy).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("creating audit: %w", err)
	}
	return id, nil
}

// CompleteAudit updates an audit row to status="completed" and saves the
// collected raw_data and resource_counts JSON blobs.
func CompleteAudit(ctx context.Context, pool *pgxpool.Pool, auditID string, rawData json.RawMessage, resourceCounts json.RawMessage) error {
	tag, err := pool.Exec(ctx, `
		UPDATE audits
		SET status = 'completed', raw_data = $2, resource_counts = $3
		WHERE id = $1
	`, auditID, []byte(rawData), []byte(resourceCounts))
	if err != nil {
		return fmt.Errorf("completing audit: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("audit %s not found", auditID)
	}
	return nil
}

// FailAudit updates an audit row to status="failed" and records the error message.
func FailAudit(ctx context.Context, pool *pgxpool.Pool, auditID string, errMsg string) error {
	tag, err := pool.Exec(ctx, `
		UPDATE audits
		SET status = 'failed', error_message = $2
		WHERE id = $1
	`, auditID, errMsg)
	if err != nil {
		return fmt.Errorf("failing audit: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("audit %s not found", auditID)
	}
	return nil
}
