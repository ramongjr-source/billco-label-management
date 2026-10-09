-- Preserve existing records. Unknown bulk codes remain blank; never infer a
-- bulk barcode from an old product code or Part Number.
CREATE TABLE products_next (
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
  bulk_fixed_quantity INTEGER
    CHECK (bulk_fixed_quantity IS NULL OR (typeof(bulk_fixed_quantity) = 'integer' AND bulk_fixed_quantity BETWEEN 1 AND 999999)),
  package_fixed_quantity INTEGER
    CHECK (package_fixed_quantity IS NULL OR (typeof(package_fixed_quantity) = 'integer' AND package_fixed_quantity BETWEEN 1 AND 999999)),
  product_barcode TEXT NOT NULL
    CHECK (
      length(product_barcode) BETWEEN 0 AND 128
      AND (product_barcode = '' OR length(trim(product_barcode)) > 0)
      AND instr(product_barcode, char(0)) = 0
      AND product_barcode NOT GLOB '*[^ -~]*'
    ),
  bulk_barcode TEXT NOT NULL DEFAULT ''
    CHECK (length(bulk_barcode) <= 128
      AND (bulk_barcode = '' OR length(trim(bulk_barcode)) > 0)
      AND instr(bulk_barcode, char(0)) = 0
      AND bulk_barcode NOT GLOB '*[^ -~]*'),
  status TEXT NOT NULL CHECK (status IN ('active', 'inactive'))
) STRICT;

INSERT INTO products_next (part_number, description, bulk_fixed_quantity, package_fixed_quantity, product_barcode, bulk_barcode, status)
SELECT part_number, description, bulk_fixed_quantity, package_fixed_quantity, barcode_value, '', status FROM products;
DROP TABLE products;
ALTER TABLE products_next RENAME TO products;
