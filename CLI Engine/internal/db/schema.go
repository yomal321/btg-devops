package db

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// schema is the full CREATE TABLE IF NOT EXISTS DDL for all 5 tables.
// Safe to run on every startup — idempotent.
const schema = `
CREATE TABLE IF NOT EXISTS users (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email                  TEXT UNIQUE NOT NULL,
  password_hash          TEXT NOT NULL,
  role                   TEXT NOT NULL CHECK (role IN ('admin', 'analyst', 'viewer')),
  is_active              BOOLEAN NOT NULL DEFAULT TRUE,
  created_by             UUID REFERENCES users(id),
  created_at             TIMESTAMPTZ DEFAULT NOW(),
  last_login             TIMESTAMPTZ,
  password_reset_token   TEXT,
  password_reset_expires TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS user_sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  ip_address  TEXT,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audits (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  created_by        UUID REFERENCES users(id),
  subscription_id   TEXT NOT NULL,
  subscription_name TEXT,
  trigger_type      TEXT NOT NULL CHECK (trigger_type IN ('manual', 'scheduled')),
  status            TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  error_message     TEXT,
  raw_data          JSONB,
  claude_analysis   JSONB,
  resource_counts   JSONB
);

-- cost_data and usage_data are stored as their own columns, not nested
-- inside raw_data, so a query that only needs cost/usage never has to
-- decompress+parse the (much larger) 12-resource-type raw_data blob.
ALTER TABLE audits ADD COLUMN IF NOT EXISTS cost_data  JSONB;
ALTER TABLE audits ADD COLUMN IF NOT EXISTS usage_data JSONB;

-- current_step is a lightweight, transient progress indicator for the
-- dashboard's live "Run Audit" view — e.g. "extracting acr (3/12)". Only
-- meaningful while status='running'; cleared once the audit completes/fails
-- so it never shows stale text on a finished audit.
ALTER TABLE audits ADD COLUMN IF NOT EXISTS current_step TEXT;

CREATE TABLE IF NOT EXISTS findings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id        UUID NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  severity        TEXT NOT NULL CHECK (severity IN ('Critical', 'Warning', 'Info')),
  resource_type   TEXT NOT NULL,
  resource_name   TEXT NOT NULL,
  issue           TEXT NOT NULL,
  recommendation  TEXT NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- scope records which Analyze scope produced this row (e.g. "storage",
-- "cost", "usage:storage", "all") — NOT the same as resource_type, which is
-- the LLM's own labeling of the affected resource and isn't reliable enough
-- to detect "these rows came from the same analysis run" on its own. Lets
-- re-analyzing a scope delete-and-replace just that scope's old findings
-- instead of accumulating duplicates on every re-run.
ALTER TABLE findings ADD COLUMN IF NOT EXISTS scope TEXT;

-- Findings lifecycle: status tracks open/resolved/dismissed (validated in
-- the dashboard API, not a DB CHECK, since ALTER..ADD CONSTRAINT isn't
-- idempotent); first_seen_at carries the date an issue was FIRST flagged
-- across successive audits (so a week-old unfixed problem shows "7 days
-- old", not "new" on every audit); resolved_at records when an issue
-- stopped appearing. category is the LLM's classification (Security, Cost
-- Waste, ...) — now persisted since it's part of the cross-audit match key.
ALTER TABLE findings ADD COLUMN IF NOT EXISTS category      TEXT;
ALTER TABLE findings ADD COLUMN IF NOT EXISTS status        TEXT NOT NULL DEFAULT 'open';
ALTER TABLE findings ADD COLUMN IF NOT EXISTS first_seen_at TIMESTAMPTZ;
ALTER TABLE findings ADD COLUMN IF NOT EXISTS resolved_at   TIMESTAMPTZ;
UPDATE findings SET first_seen_at = created_at WHERE first_seen_at IS NULL;

-- analysis_requests is the queue behind the MCP-server/Claude-Code-orchestrator
-- flow (spec 8): the dashboard writes a pending row instead of calling an LLM
-- API directly, a scheduled Claude Code agent claims it via the MCP server,
-- and writes the result back through the existing updateClaudeAnalysis() /
-- saveFindings() functions unchanged. scope matches findings.scope's values
-- (a resource type, "cost", "usage:<type>", or "all").
CREATE TABLE IF NOT EXISTS analysis_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id      UUID NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  scope         TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'failed')),
  error_message TEXT,
  requested_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id   UUID NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id),
  role       TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content    TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- chat_threads gives each audit multiple separate conversations (like a
-- normal AI chat app). Messages hang off a thread; the LLM only ever sees
-- one thread's history at a time.
CREATE TABLE IF NOT EXISTS chat_threads (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id   UUID NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  title      TEXT NOT NULL DEFAULT 'New chat',
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS thread_id UUID REFERENCES chat_threads(id) ON DELETE CASCADE;

-- Backfill (one-time, idempotent): messages created before threads existed
-- get grouped into one "Conversation 1" thread per audit.
INSERT INTO chat_threads (audit_id, title, created_by, created_at)
SELECT m.audit_id, 'Conversation 1',
       (ARRAY_AGG(m.user_id ORDER BY m.created_at))[1],
       MIN(m.created_at)
FROM chat_messages m
WHERE m.thread_id IS NULL
GROUP BY m.audit_id;

UPDATE chat_messages m
SET thread_id = t.id
FROM (
  SELECT DISTINCT ON (audit_id) id, audit_id
  FROM chat_threads
  ORDER BY audit_id, created_at ASC
) t
WHERE m.thread_id IS NULL AND t.audit_id = m.audit_id;

CREATE TABLE IF NOT EXISTS resources (
  id          SERIAL PRIMARY KEY,
  slug        TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  description TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT NOT NULL,
  subscription_id   TEXT UNIQUE NOT NULL,
  tenant_id         TEXT NOT NULL,
  client_id         TEXT NOT NULL,
  client_secret_enc TEXT NOT NULL,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_by        UUID REFERENCES users(id),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  last_audit_at     TIMESTAMPTZ
);

-- notification_role_settings drives who gets audit-failed alert emails: an
-- admin toggles which roles are "enabled", and the alert is sent to every
-- currently-active user in an enabled role — no per-person list to maintain
-- as users join/leave. Seeding admin=true preserves pre-existing behavior
-- (admins were the only recipients before this table existed) with zero
-- required configuration; ON CONFLICT DO NOTHING keeps the seed idempotent.
CREATE TABLE IF NOT EXISTS notification_role_settings (
  role       TEXT PRIMARY KEY CHECK (role IN ('admin', 'analyst', 'viewer')),
  enabled    BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO notification_role_settings (role, enabled) VALUES
  ('admin', TRUE), ('analyst', FALSE), ('viewer', FALSE)
ON CONFLICT (role) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_findings_audit_id            ON findings(audit_id);
CREATE INDEX IF NOT EXISTS idx_analysis_requests_status     ON analysis_requests(status);
CREATE INDEX IF NOT EXISTS idx_analysis_requests_audit_id   ON analysis_requests(audit_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_audit_id       ON chat_messages(audit_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_token_hash     ON user_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_audits_created_at            ON audits(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_resources_slug               ON resources(slug);
CREATE INDEX IF NOT EXISTS idx_subscriptions_subscription_id ON subscriptions(subscription_id);
`

// ApplySchema runs the full schema DDL against the database.
// All CREATE TABLE statements use IF NOT EXISTS — safe to call on every startup.
func ApplySchema(ctx context.Context, pool *pgxpool.Pool) error {
	if _, err := pool.Exec(ctx, schema); err != nil {
		return fmt.Errorf("applying schema: %w", err)
	}
	return nil
}
