import type { Metadata } from 'next'
import Link from 'next/link'

import { ForgotPasswordForm } from '@/components/auth/ForgotPasswordForm'
import { Container } from '@/components/ui/Container'
import { Section } from '@/components/ui/Section'
import { ctaLabel } from '@/lib/cta-vocabulary'
import { buildPrivatePageMetadata } from '@/lib/seo'

/**
 * /belepes-atallas — az ÁTKÖLTÖZTETETT vevő egyetlen belépő útja.
 * amit ő NEM tett: az ő jelszava a régi rendszerben működött. A cím tehát nem
 * Auth-folyamat, access-szabály és kérés-korlát NEM módosult.
 */

// Bejelentkezés mögötti / tranzakciós lap: noindex meta + canonical
// (`src/lib/seo.ts` NOINDEX_ROBOTS — a robots.txt tiltás önmagában nem
// tartja ki az indexből; Google *Block Search indexing with noindex*).
export const metadata: Metadata = buildPrivatePageMetadata({
  title: 'Jelszó beállítása az új felületen',
  description:
    'A korábbi rendszer jelszava nem költözött át. Kérj beállító linket arra az e-mail-címre, amellyel a kurzust megvetted.',
  path: '/belepes-atallas',
})

/**
 * A kérés-korlát EMBERI nyelven. A két szám a `password-forgot-email` keretét
 * írja le (`src/lib/security/rate-limit.ts`: 3 kérés / 10 perc, a CÍMZETT
 * e-mail-címére kulcsolva). A számokat őr-teszt köti a szabályhoz, hogy a
 * keret átállításakor ne maradjon itt hazug mondat.
 * ötödik próbálkozás után a felhasználó ELAKAD, és nem tudja, miért. NN/g,
 * users informed about what is going on, through appropriate feedback within a
 */
export const ATALLAS_KERES_KORLAT_MONDAT =
  'Ugyanarra a címre 10 percen belül legfeljebb 3 levelet küldünk ki, ezért ha többször is kérted, várj néhány percet az újabb próbálkozással.'

/**
 * A migrációs terv 1. szakaszának 4. alapelve szó szerint megköveteli a
 * hozzáférés kimondását: „A megvásárolt kurzusaid átkerültek, újra fizetni NEM
 * kell." Ez a vevő legfőbb félelme, ezért nem sejtetjük, hanem kimondjuk, és a
 * lapon KÉTSZER szerepel: a beküldés előtt és a beküldés után is.
 */
export const ATALLAS_HOZZAFERES_MONDAT =
  'A megvásárolt kurzusaid megvannak, újra fizetned nem kell.'

export default function BelepesAtallasPage() {
  return (
    <Section>
      <Container size="narrow">
        <div className="kc-atallas">
          <h1>Állítsd be a jelszavad az új felületen</h1>

          {/* A „nem te hibáztál" kimondása NEM udvariaskodás. NN/g,
              Error-Message Guidelines: „Remember that when users make errors,
              it's not their fault. Errors highlight flaws in your design."
              https://www.nngroup.com/articles/errors-forms-design-guidelines/
              A jelenség maga is iparági alapeset: Auth0, Bulk User Import —
              „Users with passwords hashed by unsupported algorithms must reset
              their password when they log in for the first time after the bulk
              import."
              https://auth0.com/docs/manage-users/user-migration/bulk-user-imports */}
          <p className="kc-auth-lead">
            A Kineticare kurzusai új, saját felületre költöztek. A régi jelszavad ide nem jött át,
            mert a korábbi oldal külön rendszer volt, és a jelszavakat onnan nem vesszük át. Nem te
            hibáztál: mindenkinek új jelszót kell beállítania, aki eddig a régi oldalon vásárolt.
          </p>

          <p className="kc-atallas__notice">
            <strong>{ATALLAS_HOZZAFERES_MONDAT}</strong> Ugyanazzal az e-mail-címmel éred el őket,
            amellyel a régi oldalon vásároltál.
          </p>

          {/* EGY kért cselekvés a lapon: a lap alján álló két hivatkozás
              (segítség, visszaút) szöveglink, nem gomb — a vizuális
              elsődlegesség így egyedül a beküldő gombé marad. */}
          <ForgotPasswordForm
            emailHint="Azt a címet add meg, amellyel a régi oldalon vásároltál."
            successNote={ATALLAS_HOZZAFERES_MONDAT}
          />

          <h2>Mi történik, miután elküldted?</h2>
          <ol className="kc-atallas__steps">
            <li>Küldünk egy levelet a megadott címre.</li>
            <li>A levélben lévő linken beállítod a saját jelszavad.</li>
            <li>A jelszó után a kurzusaid megnyílnak, külön belépés nem kell.</li>
          </ol>

          <h2>Nem érkezett meg a levél?</h2>
          <p>
            Nézd meg a levélszemét mappát is, és keress rá a Kineticare szóra.{' '}
            {ATALLAS_KERES_KORLAT_MONDAT} Ha így sem találod, vagy nem emlékszel, melyik címmel
            vásároltál, szólj nekünk, és megkeressük a fiókodat.
          </p>

          {/* §3.2 #33 („Írj nekünk") és a #15 mintázata („Vissza a <hova>") —
              mindkettő a jóváhagyott szótárból, tehát a `/kapcsolat` és a
              `/belepes` célon nem keletkezik új felirat (WCAG 2.2 · 3.2.4). */}
          <div className="kc-auth-actions">
            <Link href="/kapcsolat">{ctaLabel('contact-open')}</Link>
            <Link href="/belepes">Vissza a belépéshez</Link>
          </div>
        </div>
      </Container>
    </Section>
  )
}
