import type { Product } from '../payload-types'

export type CourseDescriptionDocument = NonNullable<Product['longDescription']>
type Node = CourseDescriptionDocument['root']['children'][number]
export interface DescriptionSection {
  lead: Node[]
  groups: Node[][]
  columns: 1 | 2 | 3
}

/** Csak a gyökérszintű H2/H3 szerkezetet olvassa; szöveg alapján nem osztályoz. */
export function groupCourseDescription(content: CourseDescriptionDocument): DescriptionSection[] {
  const nodes = content.root.children
  const fallback = (): DescriptionSection[] => [{ lead: nodes, groups: [], columns: 1 }]
  if (nodes.some((node) => node.type === 'heading' && node.tag !== 'h2' && node.tag !== 'h3')) {
    return fallback()
  }
  const sections: DescriptionSection[] = []
  let current: DescriptionSection = { lead: [], groups: [], columns: 1 }
  let underH2 = false
  for (const node of nodes) {
    if (node.type === 'heading' && node.tag === 'h2') {
      if (current.lead.length > 0 || current.groups.length > 0) sections.push(current)
      current = { lead: [node], groups: [], columns: 1 }
      underH2 = true
    } else if (node.type === 'heading' && node.tag === 'h3') {
      if (!underH2) return fallback()
      current.groups.push([node])
    } else if (current.groups.length > 0) {
      current.groups[current.groups.length - 1].push(node)
    } else {
      current.lead.push(node)
    }
  }
  if (current.lead.length > 0 || current.groups.length > 0) sections.push(current)
  for (const section of sections) {
    if (section.groups.length > 0) {
      // Csak a teljes, leírást is tartalmazó 4 vagy 3 alcsoport kap rácsot.
      if (section.groups.some((group) => group.length < 2)) return fallback()
      section.columns = section.groups.length === 4 ? 2 : section.groups.length === 3 ? 3 : 1
    }
  }
  const intro = sections[0]
  if (
    intro &&
    intro.groups.length === 0 &&
    intro.lead.length === 3 &&
    intro.lead[0].type === 'paragraph' &&
    intro.lead[1].type === 'paragraph' &&
    intro.lead[2].type === 'list'
  ) {
    intro.groups = [[intro.lead[0]], intro.lead.slice(1)]
    intro.lead = []
    intro.columns = 2
  }
  return sections
}
