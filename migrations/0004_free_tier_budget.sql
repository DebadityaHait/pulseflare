-- A project-wide safety margin below D1's account-wide free allowance.
-- Workers accumulate actual D1 meta costs here; REST/migration costs are separate.
CREATE TABLE platform_daily_budget (
  usage_date TEXT PRIMARY KEY,
  rows_read INTEGER NOT NULL DEFAULT 0,
  rows_written INTEGER NOT NULL DEFAULT 0
);

DROP TRIGGER monitors_capacity_insert;
DROP TRIGGER monitors_capacity_resume;
CREATE TRIGGER monitors_capacity_insert BEFORE INSERT ON monitors WHEN NEW.active=1 BEGIN
 SELECT RAISE(ABORT,'QUOTA_EXCEEDED') WHERE (SELECT COUNT(*) FROM monitors WHERE workspace_id=NEW.workspace_id AND active=1) >= COALESCE((SELECT max_active_monitors FROM workspace_entitlements WHERE workspace_id=NEW.workspace_id),5);
 SELECT RAISE(ABORT,'CAPACITY_REACHED') WHERE (SELECT COUNT(*) FROM monitors WHERE active=1)>=10;
END;
CREATE TRIGGER monitors_capacity_resume BEFORE UPDATE OF active ON monitors WHEN NEW.active=1 AND OLD.active=0 BEGIN
 SELECT RAISE(ABORT,'QUOTA_EXCEEDED') WHERE (SELECT COUNT(*) FROM monitors WHERE workspace_id=NEW.workspace_id AND active=1) >= COALESCE((SELECT max_active_monitors FROM workspace_entitlements WHERE workspace_id=NEW.workspace_id),5);
 SELECT RAISE(ABORT,'CAPACITY_REACHED') WHERE (SELECT COUNT(*) FROM monitors WHERE active=1)>=10;
END;
-- Pending dispatches must not scan the completed outbox backlog.
CREATE INDEX outbox_alert_pending ON event_outbox(created_at) WHERE alert_sent=0;
CREATE INDEX outbox_ai_pending ON event_outbox(created_at) WHERE ai_sent=0;
