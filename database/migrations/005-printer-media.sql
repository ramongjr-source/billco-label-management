ALTER TABLE printers ADD COLUMN ip_address TEXT NOT NULL DEFAULT '' CHECK (length(ip_address) <= 45);
ALTER TABLE printers ADD COLUMN description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 512);
ALTER TABLE printers ADD COLUMN supported_media_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(supported_media_json) AND json_type(supported_media_json) = 'array');
ALTER TABLE printers ADD COLUMN current_media TEXT CHECK (current_media IS NULL OR length(trim(current_media)) BETWEEN 1 AND 80);
ALTER TABLE printers ADD COLUMN last_media_change_at TEXT;
ALTER TABLE printers ADD COLUMN last_media_change_user TEXT;
ALTER TABLE printers ADD COLUMN media_validation_enabled INTEGER NOT NULL DEFAULT 0 CHECK (media_validation_enabled IN (0, 1));

CREATE TABLE printer_media_changes (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  request_id TEXT NOT NULL UNIQUE,
  request_json TEXT NOT NULL CHECK (json_valid(request_json)),
  printer_id TEXT NOT NULL REFERENCES printers(id),
  printer_name TEXT NOT NULL,
  previous_media TEXT,
  new_media TEXT,
  user TEXT NOT NULL CHECK (length(trim(user)) BETWEEN 1 AND 80),
  created_at TEXT NOT NULL,
  result_json TEXT NOT NULL CHECK (json_valid(result_json))
) STRICT;
CREATE INDEX printer_media_changes_printer_sequence ON printer_media_changes (printer_id, sequence DESC);

-- These are configuration records only. Loaded stock is unknown until an operator records it.
-- No label-type ownership or network activity is implied by these defaults.
INSERT INTO printers (id, name, model, status, created_at, ip_address, description, supported_media_json, media_validation_enabled)
VALUES
 ('specialty-metals', 'Specialty Metals Printer', 'SATO CL4NX Plus', 'active', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), '192.168.1.190', 'Specialty metals label station', '["Aluminum","Stainless","Brass"]', 1),
 ('bulk', 'Bulk Printer', 'SATO CL4NX Plus', 'active', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), '192.168.1.191', 'Bulk label station', '["Black 3x5"]', 0),
 ('package', 'Package Printer', 'SATO CL4NX Plus', 'active', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), '192.168.1.192', 'Package label station', '["Black 3x2"]', 0),
 ('galvanized', 'Galvanized Printer', 'SATO CL4NX Plus', 'active', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), '192.168.1.193', 'Galvanized label station', '["Magenta"]', 0)
ON CONFLICT(id) DO NOTHING;
