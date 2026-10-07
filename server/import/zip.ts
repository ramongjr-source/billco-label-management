import yauzl from 'yauzl'
import { WorkbookImportError } from './errors.js'

export const MAX_WORKBOOK_BYTES = 5 * 1024 * 1024
export const MAX_EXPANDED_BYTES = 20 * 1024 * 1024
export const MAX_ZIP_ENTRIES = 1000

/** Validate actual expanded bytes before ExcelJS allocates workbook models. Nothing is extracted. */
export async function validateWorkbookArchive(buffer: Buffer): Promise<void> {
  if (buffer.length > MAX_WORKBOOK_BYTES) {
    throw new WorkbookImportError('The workbook exceeds the 5 MiB upload limit.')
  }

  await new Promise<void>((resolve, reject) => {
    let archive: yauzl.ZipFile | undefined
    let finished = false
    let entries = 0
    let declaredBytes = 0
    let actualBytes = 0
    const names = new Set<string>()
    const fail = (message: string) => {
      if (finished) return
      finished = true
      archive?.close()
      reject(new WorkbookImportError(message))
    }

    yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
      if (error || !zip) {
        fail('The file is not a valid .xlsx workbook archive.')
        return
      }
      archive = zip
      if (zip.entryCount > MAX_ZIP_ENTRIES) {
        fail('The workbook contains more than 1000 archive entries.')
        return
      }
      zip.on('error', () => fail('The workbook archive is corrupt or cannot be read.'))
      zip.on('end', () => {
        if (finished) return
        if (!names.has('[Content_Types].xml') || !names.has('xl/workbook.xml')) {
          fail('The file is not a valid .xlsx workbook.')
          return
        }
        finished = true
        resolve()
      })
      zip.on('entry', (entry: yauzl.Entry) => {
        if (finished) return
        entries += 1
        declaredBytes += entry.uncompressedSize
        if (entries > MAX_ZIP_ENTRIES || declaredBytes > MAX_EXPANDED_BYTES) {
          fail('The workbook exceeds the archive entry or 20 MiB expanded-size limit.')
          return
        }
        if ((entry.generalPurposeBitFlag & 1) !== 0) {
          fail('Encrypted workbooks are not supported.')
          return
        }
        if (((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000) {
          fail('Workbook archives containing symbolic links are not supported.')
          return
        }
        if (entry.fileName.toLowerCase().endsWith('vbaproject.bin')) {
          fail('Macro-enabled workbooks are not supported; upload an .xlsx file.')
          return
        }
        names.add(entry.fileName)
        zip.openReadStream(entry, (streamError, stream) => {
          if (finished) {
            stream?.destroy()
            return
          }
          if (streamError || !stream) {
            fail('The workbook archive is corrupt or cannot be read.')
            return
          }
          const contentTypes: Buffer[] = []
          stream.on('data', (chunk: Buffer) => {
            actualBytes += chunk.length
            if (actualBytes > MAX_EXPANDED_BYTES) {
              stream.destroy()
              fail('The workbook exceeds the 20 MiB expanded-size limit.')
              return
            }
            if (entry.fileName === '[Content_Types].xml') contentTypes.push(chunk)
          })
          stream.on('error', () => fail('The workbook archive is corrupt or cannot be read.'))
          stream.on('end', () => {
            if (finished) return
            if (/macroEnabled|vbaProject/i.test(Buffer.concat(contentTypes).toString('utf8'))) {
              fail('Macro-enabled workbooks are not supported; upload an .xlsx file.')
              return
            }
            zip.readEntry()
          })
        })
      })
      zip.readEntry()
    })
  })
}
