ALTER TABLE printers ADD COLUMN port INTEGER NOT NULL DEFAULT 9100 CHECK (port BETWEEN 1 AND 65535);
ALTER TABLE printers ADD COLUMN connection_timeout_ms INTEGER NOT NULL DEFAULT 3000 CHECK (connection_timeout_ms BETWEEN 100 AND 30000);
ALTER TABLE printers ADD COLUMN connection_status TEXT NOT NULL DEFAULT 'unknown' CHECK (connection_status IN ('unknown', 'online', 'offline'));
ALTER TABLE printers ADD COLUMN last_connection_test_at TEXT;
ALTER TABLE printers ADD COLUMN last_successful_connection_at TEXT;
-- Incremented on endpoint edits and before a manual test. Old asynchronous results
-- remain in history but cannot overwrite the latest target/test's status.
ALTER TABLE printers ADD COLUMN connection_generation INTEGER NOT NULL DEFAULT 0;

CREATE TABLE printer_connection_history (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  printer_id TEXT NOT NULL REFERENCES printers(id),
  printer_name TEXT NOT NULL,
  ip_address TEXT NOT NULL,
  port INTEGER NOT NULL CHECK (port BETWEEN 1 AND 65535),
  connection_timeout_ms INTEGER NOT NULL CHECK (connection_timeout_ms BETWEEN 100 AND 30000),
  result TEXT NOT NULL CHECK (result IN ('success', 'failure')),
  error_message TEXT,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX printer_connection_history_printer_sequence ON printer_connection_history (printer_id, sequence DESC);
