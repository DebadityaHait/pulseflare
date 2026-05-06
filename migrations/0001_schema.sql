PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS monitors (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'GET',
  expected_status_min INTEGER NOT NULL DEFAULT 200,
  expected_status_max INTEGER NOT NULL DEFAULT 299,
  interval_s INTEGER NOT NULL DEFAULT 60,
  timeout_ms INTEGER NOT NULL DEFAULT 10000,
  active INTEGER NOT NULL DEFAULT 1,
  public INTEGER NOT NULL DEFAULT 1,
  tags TEXT NOT NULL DEFAULT '[]',
  notify_discord_webhook TEXT,
  notify_telegram_chat_id TEXT,
  notify_generic_webhook TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_monitors_active ON monitors(active);
CREATE INDEX IF NOT EXISTS idx_monitors_public ON monitors(public);

CREATE TABLE IF NOT EXISTS checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  status INTEGER NOT NULL,
  ok INTEGER NOT NULL,
  latency_ms INTEGER NOT NULL,
  region TEXT,
  error_code TEXT,
  error_msg TEXT,
  response_size_bytes INTEGER,
  checked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_checks_monitor_time ON checks(monitor_id, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_checks_monitor_ok_time ON checks(monitor_id, ok, checked_at DESC);

CREATE TABLE IF NOT EXISTS incidents (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'outage',
  status TEXT NOT NULL DEFAULT 'open',
  started_at TEXT NOT NULL,
  resolved_at TEXT,
  trigger_check_id INTEGER REFERENCES checks(id),
  recovery_check_id INTEGER REFERENCES checks(id),
  failing_status INTEGER,
  failing_error_code TEXT,
  ai_summary TEXT,
  ai_summary_status TEXT NOT NULL DEFAULT 'pending',
  ai_severity INTEGER,
  ai_severity_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_incidents_monitor_time ON incidents(monitor_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status);

CREATE TABLE IF NOT EXISTS anomalies (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  check_id INTEGER REFERENCES checks(id),
  latency_ms INTEGER NOT NULL,
  rolling_mean_ms REAL NOT NULL,
  rolling_stddev_ms REAL NOT NULL,
  z_score REAL NOT NULL,
  ai_explanation TEXT,
  ai_status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_anomalies_monitor_time ON anomalies(monitor_id, created_at DESC);

CREATE TABLE IF NOT EXISTS alert_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_id TEXT REFERENCES incidents(id) ON DELETE CASCADE,
  anomaly_id TEXT REFERENCES anomalies(id) ON DELETE CASCADE,
  monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  severity INTEGER NOT NULL,
  route_decision TEXT NOT NULL,
  routed INTEGER NOT NULL DEFAULT 1,
  delivery_status TEXT NOT NULL DEFAULT 'pending',
  delivery_error TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_alert_log_monitor_time ON alert_log(monitor_id, created_at DESC);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS public_status_config (
  id TEXT PRIMARY KEY DEFAULT 'default',
  page_title TEXT NOT NULL DEFAULT 'Pulseflare Status',
  page_description TEXT NOT NULL DEFAULT 'Current system status and recent incidents.',
  brand_color TEXT NOT NULL DEFAULT '#f6821f',
  show_history_days INTEGER NOT NULL DEFAULT 7,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

INSERT OR IGNORE INTO public_status_config (id) VALUES ('default');
