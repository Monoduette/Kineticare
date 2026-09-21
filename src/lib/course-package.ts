import type { Product } from '../payload-types'

export const COURSE_PACKAGE_ICONS = [
  'play',
  'video',
  'clock',
  'shield',
  'book',
  'file',
  'users',
] as const
export type CoursePackageIcon = (typeof COURSE_PACKAGE_ICONS)[number]
export interface CoursePackageData {
  heading: string
  items: { icon: CoursePackageIcon; title: string; description: string | null }[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Hibás blokkot nem veszünk ki a szövegből; ismeretlen ikonhoz fix könyvjel jár. */
export function parseCoursePackageNode(node: unknown): CoursePackageData | null {
  if (!isRecord(node) || node.type !== 'block' || !isRecord(node.fields)) return null
  const fields = node.fields
  if (fields.blockType !== 'coursePackage') return null
  if (typeof fields.heading !== 'string' || fields.heading.trim().length === 0) return null
  if (!Array.isArray(fields.items) || fields.items.length < 1 || fields.items.length > 12)
    return null
  const items: CoursePackageData['items'] = []
  for (const item of fields.items) {
    if (!isRecord(item) || typeof item.title !== 'string' || item.title.trim().length === 0)
      return null
    if (item.description != null && typeof item.description !== 'string') return null
    const icon = COURSE_PACKAGE_ICONS.find((known) => known === item.icon) ?? 'book'
    items.push({ icon, title: item.title, description: item.description ?? null })
  }
  return { heading: fields.heading, items }
}

/** Csak az első érvényes gyökérszintű blokk emelhető ki; minden más csomópont megmarad. */
export function extractCoursePackage(content: Product['longDescription']): {
  package: CoursePackageData | null
  body: Product['longDescription']
} {
  if (!content || !isRecord(content.root) || !Array.isArray(content.root.children)) {
    return { package: null, body: content }
  }
  for (const [index, node] of content.root.children.entries()) {
    const parsed = parseCoursePackageNode(node)
    if (parsed === null) continue
    return {
      package: parsed,
      body: {
        ...content,
        root: {
          ...content.root,
          children: content.root.children.filter((_, childIndex) => childIndex !== index),
        },
      },
    }
  }
  return { package: null, body: content }
}
