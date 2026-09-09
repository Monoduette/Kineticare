import type { Payload } from 'payload'

import { hasStaffOrOwnerRole } from '../../access/roles'
import type { Product } from '../../payload-types'
import { previewTargetPath } from './preview-target'
import type { Curriculum } from '../curriculum/curriculum'

/** Legacy refs may equal a protected asset ID. Preview keys need no player identity. */
export function previewCurriculum(curriculum: Curriculum): Curriculum {
  const modules = curriculum.modules.map((module, moduleIndex) => ({
    ...module,
    id: `preview-module-${moduleIndex}`,
    lessons: module.lessons.map((lesson, lessonIndex) => ({
      ...lesson,
      ref: `preview-lesson-${moduleIndex}-${lessonIndex}`,
      streamAssetId: null,
      url: null,
      content: null,
      attachments: [],
    })),
  }))
  return { ...curriculum, modules, lessons: modules.flatMap((module) => module.lessons) }
}

/** A bypass cookie is a rendering preference, never an authorization credential. */
export async function loadProductPreview({
  payload,
  headers,
  slug,
}: {
  payload: Payload
  headers: Headers
  slug: string
}): Promise<Product | null> {
  if (previewTargetPath('products', slug) === null) return null
  const authHeaders = new Headers(headers)
  authHeaders.set('DisableAutologin', 'true')
  // Payload's JWT strategy rereads the user and validates the current session.
  const { user } = await payload.auth({ headers: authHeaders })
  if (!hasStaffOrOwnerRole(user)) return null
  const { docs } = await payload.find({
    collection: 'products',
    where: { slug: { equals: slug.trim() } },
    draft: true,
    depth: 2,
    limit: 1,
    overrideAccess: false,
    user,
  })
  return docs[0] ?? null
}
