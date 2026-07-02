package db

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Finding is one individual finding extracted from Claude's analysis.
type Finding struct {
	ID             string    `json:"id"`
	AuditID        string    `json:"audit_id"`
	Severity       string    `json:"severity"`
	ResourceType   string    `json:"resource_type"`
	ResourceName   string    `json:"resource_name"`
	Issue          string    `json:"issue"`
	Recommendation string    `json:"recommendation"`
	CreatedAt      time.Time `json:"created_at"`
}

// SaveFinding inserts one finding row linked to an audit.
func SaveFinding(ctx context.Context, pool *pgxpool.Pool, auditID string, f Finding) error {
	_, err := pool.Exec(ctx, `
		INSERT INTO findings (audit_id, severity, resource_type, resource_name, issue, recommendation)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, auditID, f.Severity, f.ResourceType, f.ResourceName, f.Issue, f.Recommendation)
	if err != nil {
		return fmt.Errorf("saving finding: %w", err)
	}
	return nil
}

// ListFindings returns all findings for a given audit ordered by severity.
func ListFindings(ctx context.Context, pool *pgxpool.Pool, auditID string) ([]Finding, error) {
	rows, err := pool.Query(ctx, `
		SELECT id::text, audit_id::text, severity, resource_type, resource_name, issue, recommendation, created_at
		FROM findings
		WHERE audit_id = $1
		ORDER BY
			CASE severity WHEN 'Critical' THEN 1 WHEN 'Warning' THEN 2 ELSE 3 END,
			created_at ASC
	`, auditID)
	if err != nil {
		return nil, fmt.Errorf("listing findings: %w", err)
	}
	defer rows.Close()

	var findings []Finding
	for rows.Next() {
		var f Finding
		if err := rows.Scan(&f.ID, &f.AuditID, &f.Severity, &f.ResourceType, &f.ResourceName, &f.Issue, &f.Recommendation, &f.CreatedAt); err != nil {
			return nil, fmt.Errorf("scanning finding: %w", err)
		}
		findings = append(findings, f)
	}
	return findings, nil
}
