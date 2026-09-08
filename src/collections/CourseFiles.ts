import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'

import { APIError, type CollectionBeforeOperationHook, type CollectionConfig } from 'payload'

import { courseFileReadAccess } from '../access/courseFileRead'
import { readCourseId } from '../access/courseContentRead'
import { privateResponseHeaders } from '../access/privateResponse'
import { hasStaffOrOwnerRole } from '../access/roles'
import { resolveMediaStaticDir } from '../lib/media-dir'
import { Media } from './Media'

const immutableFields = [
  'filename',
  'mimeType',
  'filesize',
  'width',
  'height',
  'sizes',
  'focalX',
  'focalY',
  'transferKey',
] as const

function courseId(value: unknown): number | null {
  return readCourseId(
    typeof value === 'object' && value !== null && 'id' in value ? value.id : value,
  )
}

/**
 * beforeValidate már késő: a pinned Payload update előtte törli a régi
 * uploadot. Ezért a fájlcsere a legelső operation hookban áll meg.
 */
export const protectCourseFileUpdate: CollectionBeforeOperationHook = async ({
  args,
  operation,
  req,
}) => {
  if (operation !== 'update') return args
  if (
    req.file ||
    req.query?.uploadEdits ||
    ('overwriteExistingFiles' in args && args.overwriteExistingFiles)
  ) {
    throw new APIError(
      'A fájl nem cserélhető ki. Tölts fel új fájlt, és válaszd ki a kurzus piszkozatában.',
      400,
    )
  }
  if (!('data' in args) || typeof args.data !== 'object' || args.data === null) return args
  const data = args.data as Record<string, unknown>
  const supplied = [...immutableFields, 'course'].filter((field) => Object.hasOwn(data, field))
  if (supplied.length === 0) return args
  const id = 'id' in args ? readCourseId(args.id) : null
  if (id === null) throw new APIError('A fájl tulajdonságai tömegesen nem módosíthatók.', 400)
  const original = await req.payload.findByID({
    collection: 'course-files',
    id,
    depth: 0,
    overrideAccess: true,
    req,
  })
  for (const field of supplied) {
    const incoming = data[field]
    const current = original[field as keyof typeof original]
    const changed =
      field === 'course'
        ? courseId(incoming) !== courseId(current)
        : !isDeepStrictEqual(incoming, current)
    if (changed)
      throw new APIError(
        'A kurzus és a feltöltött fájl adatai nem módosíthatók. Tölts fel új fájlt.',
        400,
      )
  }
  return args
}

export const CourseFiles: CollectionConfig = {
  slug: 'course-files',
  labels: { singular: 'Védett kurzusfájl', plural: 'Védett kurzusfájlok' },
  admin: {
    useAsTitle: 'alt',
    group: 'Tartalom',
    defaultColumns: ['alt', 'course', 'filename'],
    description:
      'Csak a kijelölt kurzus jogosult vevői tölthetik le, miután a leckéhez csatolt fájlt publikáltad. Cseréhez tölts fel új fájlt.',
  },
  access: {
    read: courseFileReadAccess,
    create: ({ req }) => hasStaffOrOwnerRole(req.user),
    update: ({ req }) => hasStaffOrOwnerRole(req.user),
    delete: ({ req }) => hasStaffOrOwnerRole(req.user),
  },
  hooks: { beforeOperation: [protectCourseFileUpdate] },
  fields: [
    { name: 'alt', type: 'text', required: true, label: 'Képleírás' },
    {
      name: 'course',
      type: 'relationship',
      relationTo: 'products',
      required: true,
      index: true,
      label: 'Kurzus',
      admin: { description: 'A fájl ehhez a kurzushoz tartozik; feltöltés után nem módosítható.' },
    },
    { name: 'transferKey', type: 'text', unique: true, admin: { hidden: true } },
  ],
  upload: {
    ...(Media.upload as Exclude<CollectionConfig['upload'], boolean | undefined>),
    staticDir: path.join(resolveMediaStaticDir() ?? path.resolve('media'), '_course_files'),
    crop: false,
    focalPoint: false,
    modifyResponseHeaders: ({ headers }) => privateResponseHeaders(headers),
  },
}
