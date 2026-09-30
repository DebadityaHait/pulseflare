INSERT OR IGNORE INTO monitors (id, workspace_id, name, url, method, interval_s, public, tags)
VALUES
  ('demo_ok', 'legacy', 'Portfolio Site', 'https://example.com', 'GET', 300, 1, '["demo"]'),
  ('demo_fail', 'legacy', 'Demo Failure', 'https://example.com/not-found', 'GET', 300, 1, '["demo"]');
