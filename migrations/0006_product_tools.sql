ALTER TABLE monitors ADD COLUMN environment TEXT NOT NULL DEFAULT 'unassigned' CHECK(environment IN ('production','staging','development','unassigned'));
CREATE UNIQUE INDEX IF NOT EXISTS idx_monitors_workspace_id ON monitors(workspace_id,id);
CREATE TABLE deployments (
 id TEXT PRIMARY KEY,
 workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 version TEXT NOT NULL,
 environment TEXT NOT NULL,
 source TEXT NOT NULL,
 url TEXT,
 idempotency_key TEXT,
 request_json TEXT NOT NULL,
 created_by TEXT NOT NULL,
 created_at TEXT NOT NULL,
 UNIQUE(workspace_id,idempotency_key),
 UNIQUE(workspace_id,id)
);
CREATE INDEX idx_deployments_workspace_time ON deployments(workspace_id,created_at DESC,id);
CREATE INDEX idx_deployments_retention ON deployments(created_at,id);
CREATE TABLE deployment_monitors (
 workspace_id TEXT NOT NULL,
 deployment_id TEXT NOT NULL,
 monitor_id TEXT NOT NULL,
 PRIMARY KEY(deployment_id,monitor_id),
 FOREIGN KEY(workspace_id,deployment_id) REFERENCES deployments(workspace_id,id) ON DELETE CASCADE,
 FOREIGN KEY(workspace_id,monitor_id) REFERENCES monitors(workspace_id,id) ON DELETE CASCADE
);
CREATE INDEX idx_deployment_monitor ON deployment_monitors(workspace_id,monitor_id,deployment_id);
CREATE TABLE incident_postmortems (
 incident_id TEXT PRIMARY KEY,
 workspace_id TEXT NOT NULL,
 impact TEXT NOT NULL DEFAULT '',
 root_cause TEXT NOT NULL DEFAULT '',
 resolution TEXT NOT NULL DEFAULT '',
 preventive_actions TEXT NOT NULL DEFAULT '',
 revision INTEGER NOT NULL DEFAULT 1,
 updated_by TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 FOREIGN KEY(workspace_id,incident_id) REFERENCES incidents(workspace_id,id) ON DELETE CASCADE
);
CREATE INDEX idx_postmortem_workspace ON incident_postmortems(workspace_id,incident_id);
