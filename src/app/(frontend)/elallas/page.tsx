import type { Metadata } from 'next'
import Link from 'next/link'

import { Container } from '@/components/ui/Container'
import { Section } from '@/components/ui/Section'
import { getContactEmail } from '@/lib/contact-email-server'
import { buildStaticPageMetadata } from '@/lib/seo'
import {
  WITHDRAWAL_LINK_LABEL,
  WITHDRAWAL_ORDER_PARAM,
  WITHDRAWAL_PATH,
  WITHDRAWAL_SUBMIT_LABEL,
} from '@/lib/withdrawal/client'
import { WITHDRAWAL_ORDER_MAX_LENGTH } from '@/lib/withdrawal/validation'

import { WithdrawalForm } from './_components/WithdrawalForm'
import '../kapcsolat/kapcsolat.css'
import './elallas.css'

/**
 * /elallas: az elállási funkció (45/2014. Korm. rendelet 22. § (1a)–(1c),
 * hatályos 2026. 06. 19-től).
 *
 * A lap címe és a rá mutató linkek felirata a rendelet szövege („elállás a
 * szerződéstől”), a beküldő gombé „elállás megerősítése”. Bejelentkezés nélkül
 * is használható, a lábléc minden oldalról elérhetővé teszi (NKFH-tájékoztató,
 * 2026. 07. 17.: a funkció nem lehet elrejtve a menüpontok között). Az űrlap
 * stílusa a Kapcsolat űrlapé (kapcsolat.css), hogy a két nyilvános űrlap
 * ugyanúgy nézzen ki és viselkedjen (WCAG 2.2 SC 3.2.4).
 */
export const metadata: Metadata = buildStaticPageMetadata({
  title: WITHDRAWAL_LINK_LABEL,
  description:
    'Elállási nyilatkozat online: add meg a neved, a rendelésszámot és az e-mail-címed, és azonnal átvételi elismervényt küldünk.',
  path: WITHDRAWAL_PATH,
})

interface ElallasPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/** Az előtöltött rendelésszám: csak egyszerű, rövid szöveg (a mező maga is ezt engedi). */
function initialOrderReference(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value !== 'string') return ''
  const cleaned = value.replace(/[\u0000-\u001F\u007F]+/g, ' ').trim()
  return cleaned.length <= WITHDRAWAL_ORDER_MAX_LENGTH ? cleaned : ''
}

export default async function ElallasPage({ searchParams }: ElallasPageProps) {
  const params = await searchParams
  const supportEmail = await getContactEmail()
  const turnstileSiteKey = process.env.TURNSTILE_SITE_KEY ?? null

  return (
    <Section>
      <Container className="kc-withdrawal" size="narrow">
        <h1>{WITHDRAWAL_LINK_LABEL}</h1>
        <p className="kc-contact-intro">
          Ha el szeretnél állni a vásárlástól, itt megteheted. Add meg a neved, a rendelésszámot és
          az e-mail-címedet, majd kattints az „{WITHDRAWAL_SUBMIT_LABEL}” gombra. A nyilatkozatodról
          azonnal átvételi elismervényt küldünk e-mailben, a küldés napjával és időpontjával.
        </p>
        {/*
          Az ÁSZF LÉTEZŐ pontjára mutat, mint a pénztár (r-legal-7,
          CheckoutForm.tsx): az ÁSZF az elállási jog kizárását rögzíti
          („Elállási jog kizárása”), az elállás feltételeit nem tartalmazza
          (hibavadászat, W1).
        */}
        <p className="kc-contact-intro">
          Az elállási jog kizárásáról az{' '}
          <Link href="/aszf">Általános szerződési feltételekben</Link> olvashatsz, az „Elállási jog
          kizárása” pontban. Ha nem szeretnéd az űrlapot használni, e-mailben is elállhatsz:{' '}
          <a href={`mailto:${supportEmail}`}>{supportEmail}</a>
        </p>
        <WithdrawalForm
          initialOrderReference={initialOrderReference(params[WITHDRAWAL_ORDER_PARAM])}
          supportEmail={supportEmail}
          turnstileSiteKey={turnstileSiteKey}
        />
        <p className="kc-withdrawal-privacy">
          A megadott adatokat az elállás intézéséhez használjuk, az{' '}
          <Link href="/adatvedelem">Adatkezelési és adatvédelmi szabályzat</Link> szerint.
        </p>
      </Container>
    </Section>
  )
}
