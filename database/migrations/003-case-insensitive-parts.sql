-- Preserve original spelling. Existing case-only duplicates require explicit
-- reconciliation; index creation fails and the migration transaction rolls back.
CREATE UNIQUE INDEX products_part_number_key ON products (part_number_key(part_number));
