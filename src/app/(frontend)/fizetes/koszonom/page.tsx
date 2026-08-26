import type { Metadata } from 'next'

import { Container } from '@/components/ui/Container'
import { Section } from '@/components/ui/Section'
import { ThankYouView } from '@/components/checkout/ThankYouView'

export const metadata: Metadata = {
  title: 'Köszönjük a vásárlást',
  description: 'A fizetésedet feldolgozzuk, hamarosan eléred a kurzust.',
}

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

  return (
    <Section>
      <Container size="narrow">
        <ThankYouView orderNumber={orderNumber} />
      </Container>
    </Section>
  )
}
