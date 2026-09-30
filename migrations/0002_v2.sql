PRAGMA foreign_keys = ON;

-- The first migration created the prototype tables. This migration adds the
-- tenant boundary and the v2 product tables without requiring a destructive
-- export/re-import for existing beta data.
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  clerk_org_id TEXT NOT NULL UNIQUE,
  owner_clerk_user_id TEXT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

INSERT OR IGNORE INTO workspaces (id, clerk_org_id, name, slug)
VALUES ('legacy', 'legacy', 'Pulseflare Legacy', 'legacy');

CREATE TABLE IF NOT EXISTS workspace_entitlements (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  plan TEXT NOT NULL DEFAULT 'beta',
  max_active_monitors INTEGER NOT NULL DEFAULT 5,
  min_interval_s INTEGER NOT NULL DEFAULT 300,
  max_status_pages INTEGER NOT NULL DEFAULT 1,
  max_integrations INTEGER NOT NULL DEFAULT 5,
  max_api_keys INTEGER NOT NULL DEFAULT 3,
  raw_retention_days INTEGER NOT NULL DEFAULT 7,
  hourly_retention_days INTEGER NOT NULL DEFAULT 90,
  ai_enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

INSERT OR IGNORE INTO workspace_entitlements (workspace_id) VALUES ('legacy');

-- SQLite cannot add a REFERENCES column with a non-null default to populated tables.
ALTER TABLE monitors ADD COLUMN workspace_id TEXT REFERENCES workspaces(id);
UPDATE monitors SET workspace_id = 'legacy' WHERE workspace_id IS NULL;
ALTER TABLE monitors ADD COLUMN monitor_type TEXT NOT NULL DEFAULT 'http';
ALTER TABLE monitors ADD COLUMN headers_ciphertext TEXT;
ALTER TABLE monitors ADD COLUMN headers_iv TEXT;
ALTER TABLE monitors ADD COLUMN headers_version INTEGER;
ALTER TABLE monitors ADD COLUMN request_body TEXT;
ALTER TABLE monitors ADD COLUMN expected_text TEXT;
ALTER TABLE monitors ADD COLUMN forbidden_text TEXT;
ALTER TABLE monitors ADD COLUMN json_path TEXT;
ALTER TABLE monitors ADD COLUMN latency_threshold_ms INTEGER;
ALTER TABLE monitors ADD COLUMN heartbeat_expected_s INTEGER;
ALTER TABLE monitors ADD COLUMN heartbeat_grace_s INTEGER;
ALTER TABLE monitors ADD COLUMN heartbeat_secret_hash TEXT;
ALTER TABLE monitors ADD COLUMN heartbeat_secret_prefix TEXT;
ALTER TABLE monitors ADD COLUMN heartbeat_last_at TEXT;
ALTER TABLE monitors ADD COLUMN last_checked_at TEXT;
ALTER TABLE monitors ADD COLUMN last_state TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE monitors ADD COLUMN last_check_id INTEGER;
ALTER TABLE monitors ADD COLUMN pending_down_until TEXT;
ALTER TABLE monitors ADD COLUMN consecutive_failures INTEGER NOT NULL DEFAULT 0;
ALTER TABLE monitors ADD COLUMN consecutive_latency_failures INTEGER NOT NULL DEFAULT 0;

-- SQLite cannot add a REFERENCES column with a non-null default to populated tables.
ALTER TABLE checks ADD COLUMN workspace_id TEXT REFERENCES workspaces(id);
UPDATE checks SET workspace_id = 'legacy' WHERE workspace_id IS NULL;
ALTER TABLE checks ADD COLUMN state TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE checks ADD COLUMN confirmation INTEGER NOT NULL DEFAULT 0;
ALTER TABLE checks ADD COLUMN cf_colo TEXT;

-- SQLite cannot add a REFERENCES column with a non-null default to populated tables.
ALTER TABLE incidents ADD COLUMN workspace_id TEXT REFERENCES workspaces(id);
UPDATE incidents SET workspace_id = 'legacy' WHERE workspace_id IS NULL;
ALTER TABLE incidents ADD COLUMN ai_probable_causes TEXT NOT NULL DEFAULT '[]';
ALTER TABLE incidents ADD COLUMN ai_recommended_actions TEXT NOT NULL DEFAULT '[]';
ALTER TABLE incidents ADD COLUMN ai_confidence REAL;

-- SQLite cannot add a REFERENCES column with a non-null default to populated tables.
ALTER TABLE anomalies ADD COLUMN workspace_id TEXT REFERENCES workspaces(id);
UPDATE anomalies SET workspace_id = 'legacy' WHERE workspace_id IS NULL;
-- SQLite cannot add a REFERENCES column with a non-null default to populated tables.
ALTER TABLE alert_log ADD COLUMN workspace_id TEXT REFERENCES workspaces(id);
UPDATE alert_log SET workspace_id = 'legacy' WHERE workspace_id IS NULL;
ALTER TABLE alert_log ADD COLUMN event_id TEXT;
ALTER TABLE alert_log ADD COLUMN integration_id TEXT;

CREATE TABLE IF NOT EXISTS incident_updates (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  actor_type TEXT NOT NULL DEFAULT 'user',
  actor_id TEXT,
  status TEXT,
  message TEXT NOT NULL,
  public INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS maintenance_windows (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  public INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS maintenance_window_monitors (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  maintenance_window_id TEXT NOT NULL REFERENCES maintenance_windows(id) ON DELETE CASCADE,
  monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  PRIMARY KEY (maintenance_window_id, monitor_id)
);

CREATE TABLE IF NOT EXISTS integrations (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('browser_push', 'discord', 'slack', 'telegram', 'webhook')),
  name TEXT NOT NULL,
  config_ciphertext TEXT,
  config_iv TEXT,
  config_version INTEGER,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS notification_rules (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  integration_id TEXT NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  event_types TEXT NOT NULL DEFAULT '["incident.opened","incident.resolved"]',
  monitor_ids TEXT NOT NULL DEFAULT '[]',
  minimum_severity INTEGER NOT NULL DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE (workspace_id, integration_id)
);

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,
  integration_id TEXT NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  response_code INTEGER,
  error_message TEXT,
  attempted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE (event_id, integration_id)
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  status_page_id TEXT,
  endpoint_hash TEXT NOT NULL,
  subscription_ciphertext TEXT NOT NULL,
  subscription_iv TEXT NOT NULL,
  subscription_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE (workspace_id, endpoint_hash)
);

CREATE TABLE IF NOT EXISTS status_pages (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT 'Pulseflare Status',
  description TEXT NOT NULL DEFAULT 'Current system status and recent incidents.',
  logo_url TEXT,
  brand_color TEXT NOT NULL DEFAULT '#0e9eb8',
  published INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE (workspace_id),
  UNIQUE (slug)
);

CREATE TABLE IF NOT EXISTS status_components (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  status_page_id TEXT NOT NULL REFERENCES status_pages(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS status_component_monitors (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  component_id TEXT NOT NULL REFERENCES status_components(id) ON DELETE CASCADE,
  monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  PRIMARY KEY (component_id, monitor_id)
);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  sha256_hash TEXT NOT NULL UNIQUE,
  scopes TEXT NOT NULL DEFAULT '["monitors:read"]',
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  expires_at TEXT,
  last_used_at TEXT,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  actor_clerk_user_id TEXT,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS processed_events (
  event_id TEXT NOT NULL,
  consumer TEXT NOT NULL,
  workspace_id TEXT,
  processed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  PRIMARY KEY (event_id, consumer)
);

CREATE TABLE IF NOT EXISTS monitor_rollups_hourly (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  bucket_start TEXT NOT NULL,
  checks INTEGER NOT NULL DEFAULT 0,
  successful_checks INTEGER NOT NULL DEFAULT 0,
  failed_checks INTEGER NOT NULL DEFAULT 0,
  avg_latency REAL NOT NULL DEFAULT 0,
  min_latency INTEGER NOT NULL DEFAULT 0,
  max_latency INTEGER NOT NULL DEFAULT 0,
  p95_latency INTEGER NOT NULL DEFAULT 0,
  uptime_percentage REAL NOT NULL DEFAULT 100,
  incident_minutes REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (workspace_id, monitor_id, bucket_start)
);

CREATE TABLE IF NOT EXISTS monitor_rollups_daily (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  bucket_start TEXT NOT NULL,
  checks INTEGER NOT NULL DEFAULT 0,
  successful_checks INTEGER NOT NULL DEFAULT 0,
  failed_checks INTEGER NOT NULL DEFAULT 0,
  avg_latency REAL NOT NULL DEFAULT 0,
  min_latency INTEGER NOT NULL DEFAULT 0,
  max_latency INTEGER NOT NULL DEFAULT 0,
  p95_latency INTEGER NOT NULL DEFAULT 0,
  uptime_percentage REAL NOT NULL DEFAULT 100,
  incident_minutes REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (workspace_id, monitor_id, bucket_start)
);

CREATE TABLE IF NOT EXISTS archive_manifests (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  cursor_checked_at TEXT,
  cursor_id INTEGER,
  rows_archived INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'running',
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS usage_daily (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  usage_date TEXT NOT NULL,
  checks_scheduled INTEGER NOT NULL DEFAULT 0,
  checks_completed INTEGER NOT NULL DEFAULT 0,
  queue_events INTEGER NOT NULL DEFAULT 0,
  ai_enrichments INTEGER NOT NULL DEFAULT 0,
  archives INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (workspace_id, usage_date)
);

INSERT OR IGNORE INTO status_pages (workspace_id, slug, title, description)
VALUES ('legacy', 'legacy', 'Pulseflare Status', 'Current system status and recent incidents.');

CREATE UNIQUE INDEX IF NOT EXISTS idx_monitors_workspace_id ON monitors(workspace_id, id);
CREATE INDEX IF NOT EXISTS idx_monitors_workspace_active ON monitors(workspace_id, active);
CREATE INDEX IF NOT EXISTS idx_checks_workspace_monitor_time ON checks(workspace_id, monitor_id, checked_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_workspace_status ON incidents(workspace_id, status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_anomalies_workspace_time ON anomalies(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_updates_workspace_incident_time ON incident_updates(workspace_id, incident_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_maintenance_workspace_time ON maintenance_windows(workspace_id, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS idx_audit_workspace_time ON audit_events(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rollups_workspace_monitor_time ON monitor_rollups_hourly(workspace_id, monitor_id, bucket_start DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_open_incident_per_monitor ON incidents(workspace_id, monitor_id) WHERE status IN ('open', 'acknowledged', 'investigating', 'identified', 'monitoring');
CREATE UNIQUE INDEX IF NOT EXISTS idx_alert_event_integration ON alert_log(event_id, integration_id) WHERE event_id IS NOT NULL AND integration_id IS NOT NULL;
-- Enforce required tenants after the nullable-column/backfill upgrade.
CREATE TRIGGER monitors_tenant_insert BEFORE INSERT ON monitors
WHEN NEW.workspace_id IS NULL
BEGIN SELECT RAISE(ABORT, 'Invalid monitor workspace'); END;

CREATE TRIGGER monitors_tenant_update BEFORE UPDATE ON monitors
WHEN NEW.workspace_id IS NULL
BEGIN SELECT RAISE(ABORT, 'Invalid monitor workspace'); END;

CREATE TRIGGER checks_tenant_insert BEFORE INSERT ON checks
WHEN NEW.workspace_id IS NULL OR NOT EXISTS (SELECT 1 FROM monitors m WHERE m.id = NEW.monitor_id AND m.workspace_id = NEW.workspace_id)
BEGIN SELECT RAISE(ABORT, 'Invalid monitor workspace'); END;

CREATE TRIGGER checks_tenant_update BEFORE UPDATE ON checks
WHEN NEW.workspace_id IS NULL OR NOT EXISTS (SELECT 1 FROM monitors m WHERE m.id = NEW.monitor_id AND m.workspace_id = NEW.workspace_id)
BEGIN SELECT RAISE(ABORT, 'Invalid monitor workspace'); END;

CREATE TRIGGER incidents_tenant_insert BEFORE INSERT ON incidents
WHEN NEW.workspace_id IS NULL OR NOT EXISTS (SELECT 1 FROM monitors m WHERE m.id = NEW.monitor_id AND m.workspace_id = NEW.workspace_id)
BEGIN SELECT RAISE(ABORT, 'Invalid monitor workspace'); END;

CREATE TRIGGER incidents_tenant_update BEFORE UPDATE ON incidents
WHEN NEW.workspace_id IS NULL OR NOT EXISTS (SELECT 1 FROM monitors m WHERE m.id = NEW.monitor_id AND m.workspace_id = NEW.workspace_id)
BEGIN SELECT RAISE(ABORT, 'Invalid monitor workspace'); END;

CREATE TRIGGER anomalies_tenant_insert BEFORE INSERT ON anomalies
WHEN NEW.workspace_id IS NULL OR NOT EXISTS (SELECT 1 FROM monitors m WHERE m.id = NEW.monitor_id AND m.workspace_id = NEW.workspace_id)
BEGIN SELECT RAISE(ABORT, 'Invalid monitor workspace'); END;

CREATE TRIGGER anomalies_tenant_update BEFORE UPDATE ON anomalies
WHEN NEW.workspace_id IS NULL OR NOT EXISTS (SELECT 1 FROM monitors m WHERE m.id = NEW.monitor_id AND m.workspace_id = NEW.workspace_id)
BEGIN SELECT RAISE(ABORT, 'Invalid monitor workspace'); END;

CREATE TRIGGER alert_log_tenant_insert BEFORE INSERT ON alert_log
WHEN NEW.workspace_id IS NULL OR NOT EXISTS (SELECT 1 FROM monitors m WHERE m.id = NEW.monitor_id AND m.workspace_id = NEW.workspace_id)
BEGIN SELECT RAISE(ABORT, 'Invalid monitor workspace'); END;

CREATE TRIGGER alert_log_tenant_update BEFORE UPDATE ON alert_log
WHEN NEW.workspace_id IS NULL OR NOT EXISTS (SELECT 1 FROM monitors m WHERE m.id = NEW.monitor_id AND m.workspace_id = NEW.workspace_id)
BEGIN SELECT RAISE(ABORT, 'Invalid monitor workspace'); END;

