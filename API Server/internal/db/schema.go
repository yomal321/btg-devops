package db

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

const schema = `
CREATE TABLE IF NOT EXISTS resources (
  id          SERIAL PRIMARY KEY,
  slug        TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  description TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_resources_slug ON resources(slug);
`

// ApplySchema creates the resources table if it does not exist.
// The other 5 tables are created by the CLI Engine on first collect run.
func ApplySchema(ctx context.Context, pool *pgxpool.Pool) error {
	if _, err := pool.Exec(ctx, schema); err != nil {
		return fmt.Errorf("applying schema: %w", err)
	}
	return nil
}
