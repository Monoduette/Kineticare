import type { Metadata } from 'next'

import { Container } from '@/components/ui/Container'
import { Section } from '@/components/ui/Section'
import { ThankYouView } from '@/components/checkout/ThankYouView'
import { buildPrivatePageMetadata } from '@/lib/seo'

import { scheduleThankYouPaymentStateCheck } from './payment-state-check'

/**
 * A lap címe NEM állíthat sikert: a Barion ugyanerre a URL-re küld sikeres,
 * elutasított és megszakított fizetést is, vendéget és belépett vevőt.
 * „Köszönjük a vásárlást" hamis állítás, amíg az állapot ismeretlen.
 *
 * Forrás: WCAG 2.2 · 2.4.2 Page Titled (a cím a lap témáját/célját írja le;
 * F25: a cím nem azonosítja a tartalmat)
 * https://www.w3.org/WAI/WCAG22/Understanding/page-titled.html ;
 * NN/g, Error Message Guidelines (pontosan írd le a helyzetet, ne állíts
 * hamis okot vagy sikert)
 * https://www.nngroup.com/articles/error-message-guidelines/ .
 */
// Bejelentkezés mögötti / tranzakciós lap: noindex meta + canonical
// (`src/lib/seo.ts` NOINDEX_ROBOTS — a robots.txt tiltás önmagában nem
// tartja ki az indexből; Google *Block Search indexing with noindex*).
export const metadata: Metadata = buildPrivatePageMetadata({
  title: 'A fizetésed állapota',
  description: 'A banki visszaigazolás után itt látod, mi a következő lépés.',
  path: '/fizetes/koszonom',
})

interface KoszonjukPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/**
 * A `?order=` érték tisztítása.
 *
 * MIÉRT VÁGUNK a '?' / '&' / '#' karakternél: a Barion a visszairányítás
 * URL-jéhez hozzáfűzi a saját `paymentId` paraméterét. Ha ezt a mi query
 * stringünk mellé nem '&'-tel, hanem '?'-lel fűzi hozzá, a böngésző EGYETLEN
 * paramétert lát: `order=KH-2026-000123?paymentId=<guid>`. A rendelésszám
 * alakja kötött (KH-<év>-<6 jegy>, lásd src/lib/order-number.ts), ilyen
 * karakter sosem szerepel benne — az első ilyen karakter utáni rész tehát
 * biztosan idegen, és levágva a státusz-poll a valódi rendelésszámmal indul.
 */
function normalizeOrderParam(raw: string): string | null {
  const trimmed = raw.split(/[?&#]/)[0]?.trim() ?? ''
  return trimmed.length > 0 ? trimmed : null
}

/**
 * /fizetes/koszonom — a Barion redirect célja (a T-021 redirectUrl-ja).
 */
export default async function KoszonjukPage({ searchParams }: KoszonjukPageProps) {
  const params = await searchParams

  const orderParam = params.order
  const orderNumber = typeof orderParam === 'string' ? normalizeOrderParam(orderParam) : null

  // Barion-tartalék: a visszatéréskor EGY PaymentState-ellenőrzés a rendelés
  // TÁROLT PaymentId-jére (a URL-es paymentId-ben nem bízunk), a válasz
  // elküldése UTÁN. A lap tartalma nem függ tőle; a részletek és a korlátok a
  // payment-state-check.ts fejkommentjében.
  if (orderNumber !== null) {
    scheduleThankYouPaymentStateCheck(orderNumber)
  }

  return (
    <Section>
      <Container size="narrow">
        <ThankYouView orderNumber={orderNumber} />
      </Container>
    </Section>
  )
}
