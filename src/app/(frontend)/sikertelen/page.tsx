import type { Metadata } from 'next'

import { Container } from '@/components/ui/Container'
import { Section } from '@/components/ui/Section'
import { Button } from '@/components/ui/Button'
import { ctaLabel } from '@/lib/cta-vocabulary'

export const metadata: Metadata = {
  title: 'A fizetés nem sikerült',
  description: 'A fizetésedet a bank elutasította vagy megszakította, de bármikor újrapróbálhatod.',
}

interface SikertelenPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/**
 * /sikertelen — a fizetés sikertelensége (a Barion elutasítás/megszakítás
 * utáni oldal, vagy a köszönőoldal `failed` ágának célja).
 */
export default async function SikertelenPage({ searchParams }: SikertelenPageProps) {
  const params = await searchParams
  const termek = typeof params.termek === 'string' ? params.termek : null

  return (
    <Section>
      <Container size="narrow">
        <div className="kc-thankyou kc-thankyou--failed">
          <h1>A fizetés nem sikerült</h1>
          <p>
            A fizetésedet a bank elutasította vagy megszakította. Semmi sem került levonásra,
            bármikor újrapróbálhatod.
          </p>
          <p>
            Ha többször is elutasított a bank, érdemes ellenőrizni a kártyaadataidat, vagy a
            bankodat felhívni. Ha segítségre van szükséged, írj nekünk.
          </p>
          <div className="kc-thankyou__actions">
            {/* §3.2 #17: a sor `patterned: false`, tehát a tárgy NEM cserélhető
                — a cél megnevezése („a fizetést") a hozzáférhető névbe való
                (WCAG 2.2 · 2.5.3), nem a látható feliratba. Itt egyetlen
                újrapróbálható dolog van, ezért rejtett kiegészítés sem kell. */}
            {termek ? (
              <Button href={`/penztar?termek=${encodeURIComponent(termek)}`}>
                {ctaLabel('retry')}
              </Button>
            ) : (
              <Button href="/kurzusok">{ctaLabel('back-to-courses')}</Button>
            )}
            <Button href="/kapcsolat" variant="secondary">
              {ctaLabel('contact-open')}
            </Button>
          </div>
        </div>
      </Container>
    </Section>
  )
}
