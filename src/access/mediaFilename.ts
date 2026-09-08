import type { Access } from 'payload'

/** A public upload gyökér alatti privát könyvtár nem címezhető basename-ként. */
export function isUploadBasename(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false
  let filename = value
  for (let round = 0; round < 5; round += 1) {
    if (/[/\\\u0000-\u001f\u007f]/.test(filename) || filename === '.' || filename === '..')
      return false
    if (!/%[0-9a-f]{2}/i.test(filename)) return true
    try {
      const decoded = decodeURIComponent(filename)
      if (decoded === filename) return true
      filename = decoded
    } catch {
      return false
    }
  }
  return false
}

export const publicMediaReadAccess: Access = ({ data, isReadingStaticFile }) =>
  !isReadingStaticFile || isUploadBasename(data?.filename)
