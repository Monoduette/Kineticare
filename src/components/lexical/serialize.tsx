import Image from 'next/image'
import Link from 'next/link'
import { createElement, Fragment, type ReactNode } from 'react'

import { courseHref } from '../../lib/course-url'
import { sanitizeCmsUrl } from '../../lib/safe-url'
import {
  isPrivateCourseFileUrl,
  mediaAlt,
  mediaDimensions,
  pickMediaUrl,
  type MediaLike,
} from '../content/media-url'
import { TEXT_FORMAT, type LexicalContent, type LexicalNode, type VideoEmbed } from './types'

/**
 * Lexical → React renderer (storefront).
 * Ismeretlen csomópont-típus (pl. jövőbeli custom block): NEM hasal el —
 */

// ---------------------------------------------------------------------------
// Segédek
// ---------------------------------------------------------------------------

function warnUnknownNode(node: LexicalNode): void {
  if (process.env.NODE_ENV !== 'production') {
    // Fejlesztői figyelmeztetés — production-ben néma fallback.
    console.warn(`[lexical] Ismeretlen csomópont-típus: "${node.type}" — fallback render.`)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function childrenOf(node: LexicalNode): LexicalNode[] {
  return Array.isArray(node.children) ? node.children : []
}

/** A bekezdés "jelentős" gyermekei (üres szöveg/sortörés nem számít). */
function significantChildren(node: LexicalNode): LexicalNode[] {
  return childrenOf(node).filter((child) => {
    if (child.type === 'linebreak') return false
    if (child.type === 'text') {
      return typeof child.text === 'string' && child.text.trim().length > 0
    }
    return true
  })
}

// ---------------------------------------------------------------------------
// Link- és videó-felismerés
// ---------------------------------------------------------------------------

interface LinkFields {
  url: string
  newTab: boolean
  /** Belső (Payload-dokumentumra mutató) link célja, ha feloldható. */
  internalHref: string | null
}

/** Belső link href-feloldása a menü URL-konvencióval (lásd src/lib/menu-tree.ts). */
function resolveInternalHref(doc: unknown): string | null {
  if (!isRecord(doc) || typeof doc.value !== 'object' || doc.value === null) {
    return null
  }
  const relationTo = typeof doc.relationTo === 'string' ? doc.relationTo : null
  const value = doc.value as Record<string, unknown>
  const slug = typeof value.slug === 'string' ? value.slug : null
  switch (relationTo) {
    case 'pages':
      return slug ? `/${slug}` : null
    case 'posts':
      return slug ? `/blog/${slug}` : null
    case 'products':
      // A kurzus kanonikus címe a slug; slug nélküli (régi) terméknél az
      // id-alapú út marad, amit a kurzus-route átirányít.
      return typeof value.id === 'number' ? courseHref({ id: value.id, slug }) : null
    default:
      return null
  }
}

/**
 * Egy link-csomópont feloldott célja (allowlist-szűrt külső URL vagy belső
 * dokumentum-út). Exportált, hogy a szerkezet-felismerő megjelenítők (WP58
 * rendelői árlista) UGYANAZZAL a szabállyal oldják fel a CMS-linket, mint a
 * folyószöveg — külön, elcsúszó másolat nélkül.
 */
export function linkFields(node: LexicalNode): LinkFields | null {
  const fields = isRecord(node.fields) ? node.fields : null
  if (!fields) return null
  const linkType = fields.linkType
  // A KÜLSŐ (szerkesztő által szabadon gépelt) webcím allowlist-szűrésen megy
  // át: tiltott sémánál üres marad, és a link a szövegét renderelő, href
  // nélküli ágra esik (a „hiányos link-cél" graceful mintája). A BELSŐ link
  // rendszer-generált — a `resolveInternalHref` fix előtagjai miatt sémát nem
  // vihet be —, ezért az változatlanul megy tovább.
  const url = sanitizeCmsUrl(fields.url) ?? ''
  const internalHref = linkType === 'internal' ? resolveInternalHref(fields.doc) : null
  if (!url && !internalHref) return null
  return {
    url: internalHref ?? url,
    newTab: fields.newTab === true,
    internalHref,
  }
}

/**
 * Publikus videó-előzetes felismerése. Csak nyilvános YouTube/Vimeo URL
 * ágyazható be — a kurzusvideók (stream-tokenes, W3) ide NEM kerülhetnek;
 * minden más URL sima link marad.
 */
export function detectVideoEmbed(url: string): VideoEmbed | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  const host = parsed.hostname.replace(/^www\./, '').toLowerCase()

  if (host === 'youtu.be') {
    const id = parsed.pathname.slice(1).split('/')[0]
    return id
      ? { provider: 'youtube', embedUrl: `https://www.youtube-nocookie.com/embed/${id}` }
      : null
  }
  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
    if (parsed.pathname === '/watch') {
      const id = parsed.searchParams.get('v')
      return id
        ? { provider: 'youtube', embedUrl: `https://www.youtube-nocookie.com/embed/${id}` }
        : null
    }
    const embedMatch = parsed.pathname.match(/^\/embed\/([^/?#]+)/)
    if (embedMatch) {
      return {
        provider: 'youtube',
        embedUrl: `https://www.youtube-nocookie.com/embed/${embedMatch[1]}`,
      }
    }
    const shortsMatch = parsed.pathname.match(/^\/shorts\/([^/?#]+)/)
    if (shortsMatch) {
      return {
        provider: 'youtube',
        embedUrl: `https://www.youtube-nocookie.com/embed/${shortsMatch[1]}`,
      }
    }
    return null
  }
  if (host === 'vimeo.com') {
    const id = parsed.pathname.split('/').filter(Boolean)[0]
    return id && /^\d+$/.test(id)
      ? { provider: 'vimeo', embedUrl: `https://player.vimeo.com/video/${id}` }
      : null
  }
  return null
}

// ---------------------------------------------------------------------------
// Csomópont-renderelők
// ---------------------------------------------------------------------------

function renderText(node: LexicalNode, key: string): ReactNode {
  const text = typeof node.text === 'string' ? node.text : ''
  const format = typeof node.format === 'number' ? node.format : 0

  let content: ReactNode = text
  if (format & TEXT_FORMAT.code) content = createElement('code', null, content)
  if (format & TEXT_FORMAT.bold) content = createElement('strong', null, content)
  if (format & TEXT_FORMAT.italic) content = createElement('em', null, content)
  if (format & TEXT_FORMAT.strikethrough) content = createElement('s', null, content)
  if (format & TEXT_FORMAT.underline) content = createElement('u', null, content)
  if (format & TEXT_FORMAT.subscript) content = createElement('sub', null, content)
  if (format & TEXT_FORMAT.superscript) content = createElement('sup', null, content)

  return createElement(Fragment, { key }, content)
}

function renderChildren(node: LexicalNode, keyPrefix: string): ReactNode[] {
  return childrenOf(node).map((child, index) => renderNode(child, `${keyPrefix}-${index}`))
}

function renderLink(node: LexicalNode, key: string): ReactNode {
  const fields = linkFields(node)
  if (!fields) {
    // Hiányos link-cél: a szövegét rendereljük link nélkül (graceful).
    warnUnknownNode({ ...node, type: 'link(hianyzo-cel)' })
    return createElement(Fragment, { key }, renderChildren(node, key))
  }
  const children = renderChildren(node, key)
  if (fields.internalHref) {
    return createElement(Link, { key, href: fields.internalHref }, children)
  }
  const external = /^https?:\/\//i.test(fields.url)
  return createElement(
    'a',
    {
      key,
      href: fields.url,
      ...(external && fields.newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {}),
    },
    children,
  )
}

/** CTA: önálló bekezdésben álló link gombként (a storefront elsődleges akcióstílusa). */
function renderCta(linkNode: LexicalNode, key: string): ReactNode {
  const fields = linkFields(linkNode)
  if (!fields) return renderLink(linkNode, key)
  const label = renderChildren(linkNode, key)
  return createElement(
    'p',
    { key, className: 'kc-richtext__cta' },
    createElement(
      fields.internalHref ? Link : 'a',
      {
        className: 'kc-button kc-button--primary',
        href: fields.url,
        ...(fields.internalHref
          ? {}
          : /^https?:\/\//i.test(fields.url) && fields.newTab
            ? { target: '_blank', rel: 'noopener noreferrer' }
            : {}),
      },
      label,
    ),
  )
}

function renderVideoEmbed(embed: VideoEmbed, title: string, key: string): ReactNode {
  return createElement(
    'div',
    { key, className: 'kc-richtext__video' },
    createElement('iframe', {
      src: embed.embedUrl,
      title,
      loading: 'lazy',
      allow:
        'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture',
      allowFullScreen: true,
      referrerPolicy: 'strict-origin-when-cross-origin',
    }),
  )
}

function renderParagraph(node: LexicalNode, key: string): ReactNode {
  const significant = significantChildren(node)

  // CTA-felismerés: a bekezdés egyetlen jelentős eleme link.
  if (significant.length === 1 && significant[0].type === 'link') {
    const fields = linkFields(significant[0])
    if (fields) {
      const embed = detectVideoEmbed(fields.url)
      if (embed) {
        // Publikus videó-előzetes: a link szövege (vagy a szolgáltató neve) a cím.
        const labelText = extractPlainText(significant[0]).trim()
        return renderVideoEmbed(embed, labelText || 'Beágyazott videó', key)
      }
      return renderCta(significant[0], key)
    }
  }

  return createElement('p', { key }, renderChildren(node, key))
}

function renderHeading(node: LexicalNode, key: string): ReactNode {
  const tag = typeof node.tag === 'string' ? node.tag : 'h2'
  // SEO-higiénia: oldalanként egy h1 (a dokumentum-cím); a tartalmi h1 h2-re lágyul.
  const mapped = tag === 'h1' ? 'h2' : /^h[2-6]$/.test(tag) ? tag : 'h2'
  return createElement(mapped, { key }, renderChildren(node, key))
}

function renderList(node: LexicalNode, key: string): ReactNode {
  const listType = typeof node.listType === 'string' ? node.listType : 'bullet'
  const children = renderChildren(node, key)
  if (listType === 'number') {
    return createElement('ol', { key }, children)
  }
  if (listType === 'check') {
    // Gyakorlatlista: a check-lista a rehabilitációs gyakorlatsor megjelenítője.
    return createElement('ul', { key, className: 'kc-richtext__exercise-list' }, children)
  }
  return createElement('ul', { key }, children)
}

function renderListItem(node: LexicalNode, key: string): ReactNode {
  const isCheckItem = typeof node.checked === 'boolean'
  const className = isCheckItem
    ? `kc-richtext__exercise-item${node.checked ? ' kc-richtext__exercise-item--done' : ''}`
    : undefined
  return createElement('li', { key, className }, renderChildren(node, key))
}

function renderUpload(node: LexicalNode, key: string): ReactNode {
  const media = isRecord(node.value) ? (node.value as MediaLike) : null
  const src = media ? pickMediaUrl(media, 'md') : null
  if (!media || !src) {
    // Nem feloldott feltöltés (nincs populate-olva vagy nem kép): ne hasaljon el.
    warnUnknownNode({ ...node, type: 'upload(nem-feloldott)' })
    return null
  }

  const alt = mediaAlt(media)
  if (alt.length === 0) {
    // Az alt a Media collectionben kötelező — ha mégis hiányzik, az adathiba;
    // dekoratívként renderelünk és fejlesztői figyelmeztetést adunk.
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[lexical] Feltöltött kép alt-szöveg nélkül — dekoratívként renderelve.')
    }
  }

  const dimensions = mediaDimensions(media, 'md')
  const sizes = '(max-width: 720px) 100vw, 720px'
  const image = dimensions
    ? createElement(Image, {
        src,
        unoptimized: isPrivateCourseFileUrl(src),
        alt,
        width: dimensions.width,
        height: dimensions.height,
        sizes,
      })
    : // Intrinsic méret hiányában kitöltős render (a figure aránytartó).
      createElement(Image, {
        src,
        alt,
        fill: true,
        sizes,
        unoptimized: isPrivateCourseFileUrl(src),
      })

  return createElement('figure', { key, className: 'kc-richtext__figure' }, image)
}

// ---------------------------------------------------------------------------
// Fő bejáró
// ---------------------------------------------------------------------------

function renderNode(node: LexicalNode, key: string): ReactNode {
  switch (node.type) {
    case 'text':
      return renderText(node, key)
    case 'linebreak':
      return createElement('br', { key })
    case 'paragraph':
      return renderParagraph(node, key)
    case 'heading':
      return renderHeading(node, key)
    case 'list':
      return renderList(node, key)
    case 'listitem':
      return renderListItem(node, key)
    case 'quote':
      return createElement('blockquote', { key }, renderChildren(node, key))
    case 'horizontalrule':
      return createElement('hr', { key })
    case 'link':
      return renderLink(node, key)
    case 'upload':
      return renderUpload(node, key)
    case 'relationship':
    case 'block':
      // Dokumentum-hivatkozás / jövőbeli custom blokk: a storefront ezeket
      // szándékosan nem rendereli (a publikus felületen nem tartozik rájuk) —
      // fejlesztői módban figyelmeztetés, a beágyazott gyermekek megmaradnak.
      warnUnknownNode(node)
      return createElement(Fragment, { key }, renderChildren(node, key))
    default:
      warnUnknownNode(node)
      return createElement(Fragment, { key }, renderChildren(node, key))
  }
}

/** Egyszerű szöveg-kinyerés (videócím, olvasási idő — formázás nélkül). */
export function extractPlainText(node: LexicalNode): string {
  if (node.type === 'text') {
    return typeof node.text === 'string' ? node.text : ''
  }
  return childrenOf(node)
    .map((child) => extractPlainText(child))
    .join(' ')
}

/**
 * A teljes richText-tartalom renderelése. Hibás/üres bemenetre null
 * (a hívó oldal ekkor tartalom nélkül, de renderelve marad).
 */
export function renderLexicalContent(content: unknown): ReactNode {
  if (!isRecord(content) || !isRecord(content.root)) {
    return null
  }
  const root = content.root as unknown as LexicalNode
  return renderChildren(root, 'n')
}

export type { LexicalContent, LexicalNode }

/**
 * Van-e renderelhető tartalom a Lexical-dokumentumban (a RichText-blokkok
 * feltételes megjelenítéséhez, pl. HomeView CMS-szekció).
 */
export function hasLexicalContent(content: unknown): boolean {
  if (typeof content !== 'object' || content === null) return false
  const root = (content as { root?: unknown }).root
  if (typeof root !== 'object' || root === null) return false
  const children = (root as { children?: unknown }).children
  return Array.isArray(children) && children.length > 0
}
