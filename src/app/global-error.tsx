/* eslint-disable @next/next/no-html-link-for-pages --
   Ebben a fájlban SZÁNDÉKOSAN nincs `next/link`. A `global-error` akkor fut,
   amikor maga a GYÖKÉR-LAYOUT dőlt el; ilyenkor a kliensoldali router
   állapotában nem bízhatunk, és a `next/link` kliens-navigációja ugyanabba a
   hibás fába vinne vissza. A sima `<a>` teljes lapújratöltést kér, ami a
   biztos kiút. A Next saját `global-error` példája sem használ routert:
   https://nextjs.org/docs/app/api-reference/file-conventions/error */
'use client'

import { useEffect } from 'react'

import { ctaLabel } from '@/lib/cta-vocabulary'
import { logger } from '@/lib/logger'

import './(frontend)/styles.css'

/**
 * GLOBÁLIS hibahatár — a legkülső háló.
 * A linkek itt SZÁNDÉKOSAN sima `<a>` elemek, nem `next/link`: ha a
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    logger.error('Gyökér-szintű render-hiba', {
      message: error.message,
      digest: error.digest,
    })
  }, [error])

  return (
    <html lang="hu">
      <body>
        <main className="kc-section" id="tartalom">
          <div className="kc-container kc-container--narrow kc-error-page">
            <h1 className="kc-error-page__title">Elnézést, valami elromlott</h1>
            <p className="kc-error-page__text">
              Az oldal betöltése most nem sikerült. Próbáld meg újra, vagy térj vissza rá kicsit
              később.
            </p>
            <div className="kc-error-page__actions">
              {/* §3.2 #17 — ugyanaz a cselekvés, ugyanaz a szó, mint a
                  `(frontend)/error.tsx`-en (WCAG 2.2 · 3.2.4). */}
              <button className="kc-button kc-button--primary" onClick={reset} type="button">
                {ctaLabel('retry')}
              </button>
              <a className="kc-button kc-button--secondary" href="/">
                Vissza a kezdőlapra
              </a>
            </div>
            <p className="kc-error-page__contact">
              Ha a hiba ismétlődik, írj a <a href="/kapcsolat">kapcsolati oldalon</a>, és
              megkeressük a megoldást.
            </p>
          </div>
        </main>
      </body>
    </html>
  )
}
