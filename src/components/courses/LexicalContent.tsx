import Link from 'next/link'
import type { ReactNode } from 'react'

import { sanitizeCmsUrl } from '../../lib/safe-url'
import type { Product } from '../../payload-types'

/**
 * Minimális Lexical richText → React renderer a kurzus longDescription-höz.
 * TODO(W2-értékelés): konszolidáció az 5B-hullám src/components/lexical/
 * rendererével (RichText komponens) — amint az véglegesen elérhető a mainen,
 * EZT a helyi renderert ki kell váltani rá (az 5B renderert módosítani tilos;
 * addig is ez a minimális, csak-olvasásos megvalósítás szolgálja a
 * kurzus-oldalt). A csere egyetlen import-hivatkozás a [slug]/page.tsx-ben.
 */

type LexicalDoc = NonNullable<Product['longDescription']>

interface LexicalNode {
  type: string
  version?: number
  tag?: string
  format?: number | string
  children?: LexicalNode[]
  text?: string
  fields?: { url?: string; newTab?: boolean }
  [key: string]: unknown
}

/** Lexical text formátum-bitmaszk (a Lexical specifikáció szerint). */
const TEXT_FORMAT = {
  bold: 1,
  italic: 2,
  strikethrough: 4,
  underline: 8,
  code: 16,
} as const

function renderFormattedText(node: LexicalNode, key: string): ReactNode {
  const text = typeof node.text === 'string' ? node.text : ''
  const format = typeof node.format === 'number' ? node.format : 0
  let content: ReactNode = text
  if (format & TEXT_FORMAT.code) content = <code>{content}</code>
  if (format & TEXT_FORMAT.bold) content = <strong>{content}</strong>
  if (format & TEXT_FORMAT.italic) content = <em>{content}</em>
  if (format & TEXT_FORMAT.underline) content = <u>{content}</u>
  if (format & TEXT_FORMAT.strikethrough) content = <s>{content}</s>
  return <span key={key}>{content}</span>
}

function renderChildren(node: LexicalNode, keyPrefix: string): ReactNode[] {
  return (node.children ?? []).map((child, index) => renderNode(child, `${keyPrefix}-${index}`))
}

function renderNode(node: LexicalNode, key: string): ReactNode {
  switch (node.type) {
    case 'text':
      return renderFormattedText(node, key)
    case 'linebreak':
      return <br key={key} />
    case 'paragraph': {
      const children = renderChildren(node, key)
      // Üres bekezdés ne renderelődjön (üres <p> csak térköz-hibaforrás).
      if (children.length === 0) {
        return null
      }
      return <p key={key}>{children}</p>
    }
    case 'heading': {
      // A kurzus-oldal címe a dokumentum h1-je; a tartalmi h1 h2-ként jelenik meg.
      const tag = node.tag === 'h1' ? 'h2' : node.tag
      const Tag = tag === 'h2' || tag === 'h3' || tag === 'h4' ? tag : 'h2'
      return <Tag key={key}>{renderChildren(node, key)}</Tag>
    }
    case 'list': {
      const Tag = node.tag === 'ol' ? 'ol' : 'ul'
      return <Tag key={key}>{renderChildren(node, key)}</Tag>
    }
    case 'listitem':
      return <li key={key}>{renderChildren(node, key)}</li>
    case 'quote':
      return <blockquote key={key}>{renderChildren(node, key)}</blockquote>
    case 'link': {
      // A közös CMS-URL-szűrő (src/lib/safe-url.ts). A korábbi helyi
      // `safeHref` prefix-mintája átengedte a protokoll-relatív `//idegen.host`
      // és a `/\idegen.host` alakot — mindkettő IDEGEN eredetre visz —,
      // valamint a vezérlőkarakteres trükköket; a közös szűrő ezeket zárja.
      const href = sanitizeCmsUrl(node.fields?.url)
      const children = renderChildren(node, key)
      if (!href) {
        return <span key={key}>{children}</span>
      }
      if (/^https?:\/\//i.test(href)) {
        const newTab = node.fields?.newTab === true
        return (
          <a
            key={key}
            href={href}
            {...(newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
          >
            {children}
          </a>
        )
      }
      return (
        <Link key={key} href={href}>
          {children}
        </Link>
      )
    }
    default:
      // Ismeretlen csomópont: a gyerekek mentsék, ami menthető.
      if (Array.isArray(node.children) && node.children.length > 0) {
        return <span key={key}>{renderChildren(node, key)}</span>
      }
      return null
  }
}

export interface LexicalContentProps {
  content: LexicalDoc | null | undefined
  className?: string
}

export function LexicalContent({ content, className }: LexicalContentProps) {
  const rootChildren = content?.root?.children
  if (!Array.isArray(rootChildren) || rootChildren.length === 0) {
    return null
  }
  return (
    <div className={['kc-richtext', className ?? ''].filter(Boolean).join(' ')}>
      {rootChildren.map((node, index) => renderNode(node as LexicalNode, `n${index}`))}
    </div>
  )
}
