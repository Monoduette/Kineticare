import type { Metadata } from 'next'

import { NotFoundView } from '@/components/error/NotFoundView'

/**
 * A `(frontend)` route-group „nem található" határa: ide fut minden SAJÁT
 * route-unk `notFound()` hívása (`/[slug]`, `/kurzusok/[slug]`, `/blog/[slug]`,
 * `/blog/kategoria/[slug]`). A fejlécet és a láblécet a `(frontend)` layout
 * adja, ezért itt csak a törzs áll.
 * is): a `notFound()` által kiváltott 404 KEZDŐ HTML-je a szerveren üres
 * marad — a Next `<html id="__next_error__">` vázat küld, és a tényleges
 */
export const metadata: Metadata = {
  // A látható szövegben nincs „404" (GOV.UK: a szakzsargon kerülendő), a
  // böngészőfülön viszont a rövid, azonosító cím a hasznos (WCAG 2.2 · 2.4.2
  // Page Titled): https://www.w3.org/WAI/WCAG22/Understanding/page-titled.html
  title: 'Ez az oldal nem található',
}

export default function NotFound() {
  return <NotFoundView />
}
