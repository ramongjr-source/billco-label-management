CREATE TABLE products (
  part_number TEXT PRIMARY KEY COLLATE BINARY NOT NULL
    CHECK (
      length(part_number) BETWEEN 1 AND 64
      -- Match JavaScript String.trim() used by the API and UI.
      AND part_number = trim(part_number, char(
        9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196,
        8197, 8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279
      ))
      AND instr(part_number, char(0)) = 0
      AND part_number NOT GLOB ('*[' || char(1) || '-' || char(31) || char(127) || ']*')
    ),
  description TEXT NOT NULL
    CHECK (
      length(description) BETWEEN 1 AND 512
      AND length(trim(description, char(
        9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196,
        8197, 8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279
      ))) > 0
      AND instr(description, char(0)) = 0
    ),
  bulk_fixed_quantity INTEGER NOT NULL
    CHECK (typeof(bulk_fixed_quantity) = 'integer' AND bulk_fixed_quantity BETWEEN 1 AND 999999),
  package_fixed_quantity INTEGER NOT NULL
    CHECK (typeof(package_fixed_quantity) = 'integer' AND package_fixed_quantity BETWEEN 1 AND 999999),
  barcode_value TEXT NOT NULL
    CHECK (
      length(barcode_value) BETWEEN 1 AND 128
      AND length(trim(barcode_value)) > 0
      AND instr(barcode_value, char(0)) = 0
      AND barcode_value NOT GLOB '*[^ -~]*'
    ),
  status TEXT NOT NULL CHECK (status IN ('active', 'inactive'))
) STRICT;
