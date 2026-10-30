CREATE TABLE printers (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  model TEXT NOT NULL CHECK (length(trim(model)) BETWEEN 1 AND 80),
  status TEXT NOT NULL CHECK (status IN ('active', 'inactive')),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE print_jobs (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  request_id TEXT NOT NULL UNIQUE,
  request_json TEXT NOT NULL CHECK (json_valid(request_json)),
  printer_id TEXT NOT NULL REFERENCES printers(id),
  status TEXT NOT NULL CHECK (status = 'recorded'),
  print_quantity INTEGER NOT NULL CHECK (print_quantity BETWEEN 1 AND 999999),
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE print_job_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL REFERENCES print_jobs(id),
  event TEXT NOT NULL CHECK (event = 'recorded'),
  created_at TEXT NOT NULL
) STRICT;
