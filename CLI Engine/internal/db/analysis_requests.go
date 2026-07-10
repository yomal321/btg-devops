package db

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// QueueAnalysisRequests inserts one pending analysis_requests row per scope
// in scopes. Called after a successful audit so the scheduled MCP-server
// analyzer (spec 8) picks up every resource type automatically — without
// this, analysis only ever happens if a human clicks "Analyze" in the
// dashboard, which defeats the point of a scheduled, unattended audit.
func QueueAnalysisRequests(ctx context.Context, pool *pgxpool.Pool, auditID string, scopes []string) error {
	for _, scope := range scopes {
		if _, err := pool.Exec(ctx, `
			INSERT INTO analysis_requests (audit_id, scope)
			VALUES ($1, $2)
		`, auditID, scope); err != nil {
			return fmt.Errorf("queuing analysis request for scope %q: %w", scope, err)
		}
	}
	return nil
}
