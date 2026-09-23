import type { Metadata } from 'next'

import { NotFoundView } from '@/components/error/NotFoundView'
import { getContactEmail } from '@/lib/contact-email-server'
import { getTudastarLathato } from '@/lib/tudastar-lathatosag'

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

/**
 * Aszinkron szerver-komponens (a Next dokumentációja szerint a not-found.js
 * adatot kérhet le: https://nextjs.org/docs/app/api-reference/file-conventions/not-found#data-fetching).
 * A Tudástár-kapcsoló állapotát kérdezi, hogy rejtett /blog menüpontnál a
 * hibaoldal se javasolja a Tudástárt. A lekérdezés gyorsítótárazott, és a
 * határ a lap RSC-adatában minden oldalon benne van, ezért ez a döntés a
 * nem hibás lapok HTML-jéből is kiveszi a rejtett Tudástár linkjét.
 */
export default async function NotFound() {
  // A kapcsolati e-mail a lábléccel közös, kérésenként egyszer futó feloldás
  // (src/lib/contact-email-server.ts); hibánál a kódtartalék, kivétel nélkül.
  const [tudastarLathato, kapcsolatiEmail] = await Promise.all([
    getTudastarLathato(),
    getContactEmail(),
  ])
  return <NotFoundView kapcsolatiEmail={kapcsolatiEmail} tudastarLathato={tudastarLathato} />
}
