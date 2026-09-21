'use client'

import { useState } from 'react'

import { ctaLabel } from '@/lib/cta-vocabulary'

import { FeedbackDialog } from './FeedbackDialog'

/**
 * FeedbackTrigger (WP65) — a hibajelzés BELÉPŐPONTJA.
 *
 * KÉT HELYEN ÁLL, ÉS MINDKETTŐ MÉRT DÖNTÉS.
 * 1. A LÁBLÉCBEN, a süti-beállítások gombja mellett. A GOV.UK szolgáltatási
 *    kézikönyve a lap ALJÁRA teszi a „Report a problem with this page"
 *    hivatkozást, mert a látogató ott keresi a segítséget, és mert a
 *    visszajelzés gyűjtése a felhasználói elégedettség mérésének alapja:
 *    https://www.gov.uk/service-manual/measuring-success/measuring-user-satisfaction
 *    https://github.com/alphagov/govuk-design-guide/blob/main/docs/components/feedback.md
 * 2. A HIBAOLDALON és a 404-en, mert a probléma ott jelentkezik. NN/g,
 *    *Improving the Dreaded 404*: a hibaoldal legyen konstruktív, adjon
 *    továbblépést, ne zsákutcát:
 *    https://www.nngroup.com/articles/improving-dreaded-404-error-message/
 *
 * A GOMB SÚLYA `link` (szótár §3.2 #44). A hibaoldalon és a 404-en már áll
 * egy elsődleges gomb (kurzuslista, illetve újrapróbálás); a GOV.UK *Button*
 * komponens kifejezetten tiltja a több elsődleges gombot egy lapon
 * („Avoid using multiple default buttons on a single page"):
 * https://design-system.service.gov.uk/components/button/
 *
 * A DIALÓGUS CSAK NYITÁSKOR KERÜL A DOM-BA. Ennek két haszna van: a lábléc
 * kiszolgálói renderje nem hízik meg egy rejtett űrlappal, és a 404-oldal
 * hivatkozás-leltára sem duplázódik (őr: `src/__tests__/hibaoldal.test.tsx`
 * „EGYETLEN cél sem szerepel kétszer").
 */
export function FeedbackTrigger() {
  const [nyitva, setNyitva] = useState(false)
  const [oldal, setOldal] = useState('')

  const nyit = (): void => {
    // A bejelentéshez CSAK az útvonal megy el: a lekérdezés-paraméterek
    // (jelszó-visszaállító jegy, kampány-címkék) sem a naplóban, sem az
    // analitikában nem kívánatosak (vö. src/lib/analytics/page-url.ts).
    setOldal(typeof window === 'undefined' ? '' : window.location.pathname)
    setNyitva(true)
  }

  return (
    <>
      <button className="kc-visszajelzes__nyito" onClick={nyit} type="button">
        {ctaLabel('feedback-open')}
      </button>
      {nyitva ? <FeedbackDialog onClose={() => setNyitva(false)} oldal={oldal} /> : null}
    </>
  )
}
