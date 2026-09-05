import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import type { Payload } from 'payload'
import type { Media } from '../payload-types'
import manifest from '../../public/media/team/manifest.json'
import pressManifest from '../../public/media/press/manifest.json'
import { auditLogStore, writeAuditLog } from './audit'

export const MEDIA_RECOVERY_ACTION = 'media.recovery.provenance.v1'
type Asset = { file: string; sha256: string }
type Receipt = {
  version: 1
  status: 'verified' | 'restoring'
  receiptKey: string
  mediaId: number
  filename: string
  sourcePublicDigest: string
  storedPublicDigest: string
  mediaSnapshot: string
  processingConfig: string
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

export function mediaRecoverySnapshot(doc: Media): string {
  const sizes = Object.fromEntries(
    Object.entries(doc.sizes ?? {}).flatMap(([name, size]) => {
      if (!size || !size.filename) return []
      return [
        [
          name,
          {
            filename: size.filename,
            width: size.width ?? null,
            height: size.height ?? null,
            filesize: size.filesize ?? null,
            mimeType: size.mimeType ?? null,
          },
        ],
      ]
    }),
  )
  return canonical({
    id: doc.id,
    filename: doc.filename ?? null,
    sizes,
    alt: doc.alt ?? null,
    focalX: doc.focalX ?? null,
    focalY: doc.focalY ?? null,
    updatedAt: doc.updatedAt,
    createdAt: doc.createdAt,
    width: doc.width ?? null,
    height: doc.height ?? null,
    filesize: doc.filesize ?? null,
    mimeType: doc.mimeType ?? null,
  })
}

function hold(): never {
  throw new Error(
    'A média eredetigazolása hiányzik vagy eltér; kézi ellenőrzés és igazolás szükséges.',
  )
}

export function managedMediaAssets() {
  const names = new Set<string>()
  return [
    ...manifest.assets.map((asset) => ({ ...asset, directory: 'team' })),
    ...pressManifest.assets.map((asset) => ({ ...asset, directory: 'press' })),
  ].map((asset) => {
    if (!/^[a-z0-9-]+\.(webp|png)$/.test(asset.file) || !/^[a-f0-9]{64}$/.test(asset.sha256))
      return hold()
    const filename = asset.file.replace(/\.[^.]+$/, '.webp')
    if (names.has(filename)) return hold()
    names.add(filename)
    return { ...asset, filename, source: path.resolve('public/media', asset.directory, asset.file) }
  })
}

function assetFor(doc: Media) {
  const asset = managedMediaAssets().find((item) => item.filename === doc.filename)
  if (!asset) return hold()
  return asset
}

export function mediaRecoveryProcessingConfig(payload: Payload): string {
  const upload = payload.collections.media.config.upload
  const validate = (value: unknown): void => {
    if (
      value === undefined ||
      value === null ||
      typeof value === 'string' ||
      typeof value === 'boolean'
    )
      return
    if (typeof value === 'number' && Number.isFinite(value)) return
    if (Array.isArray(value)) return value.forEach(validate)
    if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
      Object.values(value).forEach(validate)
      return
    }
    return hold()
  }
  const config = {
    version: 1,
    formatOptions: upload.formatOptions ?? null,
    resizeOptions: upload.resizeOptions ?? null,
    trimOptions: upload.trimOptions ?? null,
    constructorOptions: upload.constructorOptions ?? null,
    withMetadata: upload.withMetadata ?? false,
    focalPoint: upload.focalPoint ?? true,
    imageSizes: upload.imageSizes ?? [],
  }
  validate(config)
  return canonical(config)
}

const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

export async function verifyMediaRecoveryBytes(payload: Payload, doc: Media): Promise<string> {
  const asset = assetFor(doc)
  const upload = payload.collections.media.config.upload
  if (!upload.staticDir || upload.disableLocalStorage) return hold()
  const stored = digest(readFileSync(path.resolve(upload.staticDir, asset.filename)))
  await verifyKnownDigest(payload, asset, stored)
  return stored
}

async function verifyKnownDigest(payload: Payload, asset: Asset, stored: string): Promise<void> {
  mediaRecoveryProcessingConfig(payload)
  const upload = payload.collections.media.config.upload
  const sharp = payload.config.sharp
  if (
    !upload.staticDir?.trim() ||
    upload.disableLocalStorage ||
    !sharp ||
    !isDeepStrictEqual(upload.formatOptions, {
      format: 'webp',
      options: { quality: 80 },
    }) ||
    upload.resizeOptions ||
    upload.trimOptions ||
    upload.constructorOptions ||
    upload.withMetadata
  )
    return hold()
  const managed = managedMediaAssets().find(
    (item) => item.file === asset.file && item.sha256 === asset.sha256,
  )
  if (!managed) return hold()
  const source = readFileSync(managed.source)
  if (digest(source) !== asset.sha256) return hold()
  if (stored === asset.sha256) return
  const normalized = await sharp(source, { animated: true })
    .rotate()
    .webp({ quality: 80 })
    .toBuffer()
  if (stored !== digest(normalized)) return hold()
}

async function latest(payload: Payload, id: number) {
  const result = await payload.find({
    collection: 'audit-logs',
    where: {
      and: [
        { action: { equals: MEDIA_RECOVERY_ACTION } },
        { entityType: { equals: 'media' } },
        { entityId: { equals: String(id) } },
      ],
    },
    sort: '-id',
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  const row = result.docs[0]
  if (
    !row ||
    row.action !== MEDIA_RECOVERY_ACTION ||
    row.entityType !== 'media' ||
    row.entityId !== String(id)
  )
    return undefined
  return row.after
}

export async function requireMediaRecoveryReceipt(
  payload: Payload,
  doc: Media,
  asset: Asset,
): Promise<Receipt> {
  const value = await latest(payload, doc.id)
  return validateReceipt(payload, doc, asset, value)
}

async function validateReceipt(
  payload: Payload,
  doc: Media,
  asset: Asset,
  value: unknown,
): Promise<Receipt> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return hold()
  const receipt = value as Partial<Receipt>
  if (
    receipt.version !== 1 ||
    receipt.status !== 'verified' ||
    typeof receipt.receiptKey !== 'string' ||
    !receipt.receiptKey ||
    receipt.mediaId !== doc.id ||
    receipt.filename !== doc.filename ||
    receipt.filename !== assetFor(doc).filename ||
    receipt.sourcePublicDigest !== asset.sha256 ||
    typeof receipt.storedPublicDigest !== 'string' ||
    !/^[a-f0-9]{64}$/.test(receipt.storedPublicDigest) ||
    receipt.mediaSnapshot !== mediaRecoverySnapshot(doc) ||
    receipt.processingConfig !== mediaRecoveryProcessingConfig(payload)
  )
    return hold()
  await verifyKnownDigest(payload, asset, receipt.storedPublicDigest)
  return receipt as Receipt
}

export async function inspectMediaRecoveryReceipt(payload: Payload, doc: Media) {
  const receipt = await latest(payload, doc.id)
  try {
    const verified = await validateReceipt(payload, doc, assetFor(doc), receipt)
    const stored = await verifyMediaRecoveryBytes(payload, doc)
    return { receipt: receipt ?? null, valid: verified.storedPublicDigest === stored }
  } catch {
    return { receipt: receipt ?? null, valid: false }
  }
}

export async function planMediaRecoveryEnrollment(payload: Payload, doc: Media) {
  const storedPublicDigest = await verifyMediaRecoveryBytes(payload, doc)
  await assertFreshMediaRecovery(payload, doc)
  return {
    action: MEDIA_RECOVERY_ACTION,
    processingConfig: mediaRecoveryProcessingConfig(payload),
    mediaSnapshot: mediaRecoverySnapshot(doc),
    sourcePublicDigest: assetFor(doc).sha256,
    storedPublicDigest,
    previousReceipt: (await latest(payload, doc.id)) ?? null,
  }
}

async function append(payload: Payload, receipt: Receipt): Promise<void> {
  const ok = await writeAuditLog({
    store: auditLogStore(payload),
    action: MEDIA_RECOVERY_ACTION,
    entityType: 'media',
    entityId: receipt.mediaId,
    after: receipt,
  })
  if (!ok || canonical(await latest(payload, receipt.mediaId)) !== canonical(receipt)) return hold()
}

export async function assertFreshMediaRecovery(payload: Payload, doc: Media): Promise<void> {
  const fresh = await payload.findByID({
    collection: 'media',
    id: doc.id,
    depth: 0,
    overrideAccess: true,
  })
  if (mediaRecoverySnapshot(fresh) !== mediaRecoverySnapshot(doc)) return hold()
}

/** Explicit operator enrollment, or renewal using the actual update return value. */
export async function enrollMediaRecovery(payload: Payload, doc: Media): Promise<void> {
  const asset = assetFor(doc)
  const storedPublicDigest = await verifyMediaRecoveryBytes(payload, doc)
  await assertFreshMediaRecovery(payload, doc)
  // Recheck bytes after the asynchronous identity read.
  if ((await verifyMediaRecoveryBytes(payload, doc)) !== storedPublicDigest) return hold()
  await append(payload, {
    version: 1,
    status: 'verified',
    receiptKey: randomUUID(),
    mediaId: doc.id,
    filename: asset.filename,
    sourcePublicDigest: asset.sha256,
    storedPublicDigest,
    mediaSnapshot: mediaRecoverySnapshot(doc),
    processingConfig: mediaRecoveryProcessingConfig(payload),
  })
}

/** Pending is the latest receipt until verified renewal succeeds. Never fall back. */
export async function beginMediaRecovery(payload: Payload, doc: Media): Promise<void> {
  const receipt = await requireMediaRecoveryReceipt(payload, doc, assetFor(doc))
  await assertFreshMediaRecovery(payload, doc)
  await append(payload, { ...receipt, status: 'restoring', receiptKey: randomUUID() })
}
