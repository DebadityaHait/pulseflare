CREATE UNIQUE INDEX IF NOT EXISTS idx_incidents_workspace_id ON incidents(workspace_id, id);

CREATE TABLE IF NOT EXISTS incident_chat_turns (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  incident_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  question TEXT NOT NULL CHECK(length(question) BETWEEN 1 AND 1000),
  answer TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','complete','failed')),
  sources_json TEXT NOT NULL DEFAULT '[]',
  model TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(workspace_id, incident_id) REFERENCES incidents(workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_chat_thread ON incident_chat_turns(workspace_id, incident_id, user_id, created_at DESC, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_pending ON incident_chat_turns(workspace_id, incident_id, user_id) WHERE status='pending';

CREATE TABLE IF NOT EXISTS chat_usage_daily (
  scope TEXT NOT NULL,
  usage_date TEXT NOT NULL,
  requests INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(scope, usage_date)
);

-- Reservation and quota increments happen in the same SQLite statement.
-- Failed/abandoned attempts still count: a model request may already have run.
CREATE TRIGGER IF NOT EXISTS chat_quota BEFORE INSERT ON incident_chat_turns
BEGIN
  SELECT CASE WHEN COALESCE((SELECT requests FROM chat_usage_daily WHERE scope='platform' AND usage_date=substr(NEW.created_at,1,10)),0)>=40
    OR COALESCE((SELECT requests FROM chat_usage_daily WHERE scope='workspace:'||NEW.workspace_id AND usage_date=substr(NEW.created_at,1,10)),0)>=20
    THEN RAISE(ABORT,'CHAT_DAILY_LIMIT') END;
  SELECT CASE WHEN (SELECT COUNT(*) FROM (SELECT id FROM incident_chat_turns WHERE workspace_id=NEW.workspace_id AND incident_id=NEW.incident_id AND user_id=NEW.user_id LIMIT 100))>=100
    THEN RAISE(ABORT,'CHAT_THREAD_LIMIT') END;
END;
CREATE TRIGGER IF NOT EXISTS chat_usage AFTER INSERT ON incident_chat_turns
BEGIN
  INSERT INTO chat_usage_daily(scope,usage_date,requests) VALUES('platform',substr(NEW.created_at,1,10),1)
    ON CONFLICT(scope,usage_date) DO UPDATE SET requests=requests+1;
  INSERT INTO chat_usage_daily(scope,usage_date,requests) VALUES('workspace:'||NEW.workspace_id,substr(NEW.created_at,1,10),1)
    ON CONFLICT(scope,usage_date) DO UPDATE SET requests=requests+1;
END;
