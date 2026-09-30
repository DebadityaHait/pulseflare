ALTER TABLE monitors ADD COLUMN heartbeat_deadline_at TEXT;
ALTER TABLE monitors ADD COLUMN check_lease_token TEXT;
ALTER TABLE monitors ADD COLUMN check_lease_until TEXT;
ALTER TABLE notification_deliveries ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE notification_deliveries ADD COLUMN lease_until TEXT;
ALTER TABLE notification_deliveries ADD COLUMN lease_token TEXT;
CREATE UNIQUE INDEX heartbeat_secret_unique ON monitors(heartbeat_secret_hash) WHERE heartbeat_secret_hash IS NOT NULL;
CREATE INDEX monitors_heartbeat_due ON monitors(active, monitor_type, heartbeat_deadline_at);
CREATE TABLE event_outbox (
  event_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  payload TEXT NOT NULL,
  alert_sent INTEGER NOT NULL DEFAULT 0,
  ai_sent INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX outbox_pending ON event_outbox(alert_sent, ai_sent);
-- Preserve the prototype's public monitor selection without exposing other tenants.
INSERT INTO status_components(id,workspace_id,status_page_id,name)
SELECT 'legacy-services','legacy',id,'Services' FROM status_pages WHERE workspace_id='legacy';
INSERT INTO status_component_monitors(workspace_id,component_id,monitor_id)
SELECT 'legacy','legacy-services',id FROM monitors WHERE workspace_id='legacy' AND public=1;
-- Backfill the last observation so an upgraded page does not show unknown health.
UPDATE monitors SET last_check_id=(SELECT id FROM checks WHERE monitor_id=monitors.id ORDER BY checked_at DESC,id DESC LIMIT 1);
UPDATE monitors SET last_checked_at=(SELECT checked_at FROM checks WHERE id=monitors.last_check_id),last_state=CASE WHEN active=0 THEN 'paused' WHEN last_check_id IS NULL THEN 'unknown' WHEN (SELECT ok FROM checks WHERE id=monitors.last_check_id)=1 THEN 'up' ELSE 'down' END;

CREATE TRIGGER integrations_capacity_insert BEFORE INSERT ON integrations BEGIN
 SELECT RAISE(ABORT,'QUOTA_EXCEEDED') WHERE (SELECT COUNT(*) FROM integrations WHERE workspace_id=NEW.workspace_id)>=COALESCE((SELECT max_integrations FROM workspace_entitlements WHERE workspace_id=NEW.workspace_id),5);
END;
CREATE TRIGGER api_keys_capacity_insert BEFORE INSERT ON api_keys WHEN NEW.revoked_at IS NULL BEGIN
 SELECT RAISE(ABORT,'QUOTA_EXCEEDED') WHERE (SELECT COUNT(*) FROM api_keys WHERE workspace_id=NEW.workspace_id AND revoked_at IS NULL)>=COALESCE((SELECT max_api_keys FROM workspace_entitlements WHERE workspace_id=NEW.workspace_id),3);
END;
UPDATE monitors SET heartbeat_deadline_at = strftime('%Y-%m-%dT%H:%M:%SZ', COALESCE(heartbeat_last_at, updated_at), '+' || (COALESCE(heartbeat_expected_s,86400)+COALESCE(heartbeat_grace_s,0)) || ' seconds') WHERE monitor_type='heartbeat' AND active=1;

-- Active quotas are also enforced inside SQLite so concurrent requests cannot oversubscribe.
CREATE TRIGGER monitors_capacity_insert BEFORE INSERT ON monitors WHEN NEW.active=1 BEGIN
 SELECT RAISE(ABORT,'QUOTA_EXCEEDED') WHERE (SELECT COUNT(*) FROM monitors WHERE workspace_id=NEW.workspace_id AND active=1) >= COALESCE((SELECT max_active_monitors FROM workspace_entitlements WHERE workspace_id=NEW.workspace_id),5);
 SELECT RAISE(ABORT,'CAPACITY_REACHED') WHERE (SELECT COUNT(*) FROM monitors WHERE active=1)>=100;
END;
CREATE TRIGGER monitors_capacity_resume BEFORE UPDATE OF active ON monitors WHEN NEW.active=1 AND OLD.active=0 BEGIN
 SELECT RAISE(ABORT,'QUOTA_EXCEEDED') WHERE (SELECT COUNT(*) FROM monitors WHERE workspace_id=NEW.workspace_id AND active=1) >= COALESCE((SELECT max_active_monitors FROM workspace_entitlements WHERE workspace_id=NEW.workspace_id),5);
 SELECT RAISE(ABORT,'CAPACITY_REACHED') WHERE (SELECT COUNT(*) FROM monitors WHERE active=1)>=100;
END;
