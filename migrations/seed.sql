INSERT OR IGNORE INTO monitors (id, name, url, method, public, tags)
VALUES
  ('demo_ok', 'Portfolio Site', 'https://example.com', 'GET', 1, '["demo"]'),
  ('demo_fail', 'Demo Failure', 'https://example.com/not-found', 'GET', 1, '["demo"]');
