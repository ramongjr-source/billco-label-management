/** Matching key only: never use this value for storage or display. */
export function partNumberKey(partNumber: string): string {
  return partNumber.trim().toLowerCase()
}
