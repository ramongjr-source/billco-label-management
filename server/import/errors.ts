export class WorkbookImportError extends Error {
  readonly sheetNames?: string[]

  constructor(message: string, sheetNames?: string[]) {
    super(message)
    this.name = 'WorkbookImportError'
    this.sheetNames = sheetNames
  }
}
