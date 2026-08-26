'use client'

import Link from 'next/link'
import { useEffect, useState, useTransition } from 'react'

import { Button } from '@/components/ui/Button'
import { Container } from '@/components/ui/Container'
import { Section } from '@/components/ui/Section'
import { CTA_PROGRESS_LABELS, ctaLabel } from '@/lib/cta-vocabulary'
import { logger } from '@/lib/logger'

/**
 * A `(frontend)` route-group hibahatára: váratlan (szerver- vagy
 * legyen. A hibaüzenetet magát NEM írjuk ki a felületre.
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const [isPending, startTransition] = useTransition()
  const [retried, setRetried] = useState(false)

  useEffect(() => {
    logger.error('Frontend render-hiba', {
      message: error.message,
      digest: error.digest,
    })
  }, [error])

  const handleRetry = (): void => {
    setRetried(true)
    startTransition(() => {
      reset()
    })
  }

  return (
    <Section>
      <Container className="kc-error-page" size="narrow">
        {/* Felvezető sor nincs: a GOV.UK minta tiltja a hibakódot („500"), egy
            „Hiba" felvezető pedig a címsort ismételné meg. */}
        <h1 className="kc-error-page__title">Elnézést, valami elromlott</h1>
        {/* Nincs benne ígéret, amit nem tudunk betartani (pl. a rendelés
            sorsáról): a felirat csak igazat mondhat (termektervezes skill 2.). */}
        <p className="kc-error-page__text">
          Az oldal betöltése most nem sikerült. Próbáld meg újra, vagy térj vissza rá kicsit később.
        </p>
        <div className="kc-error-page__actions">
          {/* §3.2 #17: a művelet újraindítása a látogató vállalása (P-1a → E/1);
              a folyamatban-felirat a ZÁRT L-1 lista `Betöltés…` eleme. Korábban
              itt „Próbáld újra" + „Újratöltés folyamatban…" állt — egyik sem
              volt a szótárban, és a felület három alakot használt ugyanerre a
              cselekvésre (WCAG 2.2 · 3.2.4). */}
          <Button disabled={isPending} onClick={handleRetry}>
            {isPending ? CTA_PROGRESS_LABELS.loading : ctaLabel('retry')}
          </Button>
          <Button href="/" variant="secondary">
            Vissza a kezdőlapra
          </Button>
        </div>
        {/* A letiltott gomb mellett mindig áll magyarázat, miért nem használható
            (docs/ui-sztenderdek.md gombállapot-tábla). Az `aria-live` miatt a
            képernyőolvasó is megkapja az állapotváltást. */}
        <p aria-live="polite" className="kc-error-page__contact">
          {isPending
            ? 'Betöltjük az oldalt újra, ez néhány másodperc.'
            : retried
              ? 'Ha másodszorra sem sikerül, írj nekünk, és megnézzük, mi történt.'
              : null}
        </p>
        <p className="kc-error-page__contact">
          Ha a hiba ismétlődik, írj a <Link href="/kapcsolat">kapcsolati oldalon</Link>, és
          megkeressük a megoldást.
        </p>
      </Container>
    </Section>
  )
}
