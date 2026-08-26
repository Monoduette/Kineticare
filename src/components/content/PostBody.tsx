import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react'

import { renderLexicalContent } from '../lexical/serialize'
import { headingsOf } from './post-outline'

/**
 * PostBody — a cikk törzse, HORGONYOZOTT címsorokkal.
 */
export interface PostBodyProps {
  /** A cikk Lexical-tartalma (`post.content`). */
  content: unknown
  /** A törzs-doboz osztálya (a nyomtatási forrás-szabály ezen fog, lásd post-view.css). */
  className?: string
}

/** Azok az elemek, amelyek horgonyt kaphatnak (a serializer h1-et nem rendel). */
const HEADING_TAGS: ReadonlySet<string> = new Set(['h2', 'h3', 'h4', 'h5', 'h6'])

interface DecoratableProps {
  children?: ReactNode
  id?: string
}

/**
 * A renderelt fa bejárása: a címsor-elemek sorrendben megkapják a horgonyt.
 *
 * A `cursor` szándékosan mutálható objektum: a bejárás mélységi, és a
 * sorszámot minden ágnak ugyanaz a számláló adja (ez a dokumentum-sorrend).
 */
function withHeadingIds(
  node: ReactNode,
  ids: readonly string[],
  cursor: { next: number },
): ReactNode {
  if (Array.isArray(node)) {
    return node.map((child: ReactNode) => withHeadingIds(child, ids, cursor))
  }
  if (!isValidElement<DecoratableProps>(node)) {
    return node
  }
  const element: ReactElement<DecoratableProps> = node
  if (typeof element.type === 'string' && HEADING_TAGS.has(element.type)) {
    const id = ids[cursor.next]
    cursor.next += 1
    // Már meglévő id-t nem írunk felül: ha egyszer a szerializáló is ad
    // horgonyt (A-csomag), az övé az elsőbbség, és nem keletkezik két igazság.
    return typeof element.props.id === 'string' || id === undefined
      ? element
      : cloneElement(element, { id })
  }
  const { children } = element.props
  if (children === undefined) {
    return element
  }
  return cloneElement(element, undefined, withHeadingIds(children, ids, cursor))
}

export function PostBody({ content, className }: PostBodyProps) {
  const rendered = renderLexicalContent(content)
  if (rendered === null) {
    return null
  }
  const ids = headingsOf(content).map((heading) => heading.id)
  const classes = ['kc-richtext', className ?? ''].filter(Boolean).join(' ')
  return <div className={classes}>{withHeadingIds(rendered, ids, { next: 0 })}</div>
}
