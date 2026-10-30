/** Matching key only: never use this value for storage or display. */
export function partNumberKey(partNumber: string): string {
  return partNumber.trim().toLowerCase()
}

/** Match SQLite character limits; supplementary Unicode characters count once. */
export function isValidPartNumber(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
    && [...value.trim()].length <= 64 && !/[\u0000-\u001f\u007f]/.test(value)
}
