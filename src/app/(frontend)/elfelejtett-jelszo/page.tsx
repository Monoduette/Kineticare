import type { Metadata } from 'next'
import Link from 'next/link'

import { Container } from '@/components/ui/Container'
import { Section } from '@/components/ui/Section'
import { ForgotPasswordForm } from '@/components/auth/ForgotPasswordForm'
import { isMyCoursePlayerHref } from '@/lib/courses'
import { DEFAULT_AUTH_RETURN_URL, sanitizeReturnUrl, signInHref } from '@/lib/return-url'
import { buildPrivatePageMetadata } from '@/lib/seo'
import {
  MIGRATION_ACCOUNT_GUIDANCE,
  MIGRATION_COURSES_NOTE,
  MIGRATION_EXISTING_PASSWORD_NOTE,
} from '@/lib/migration-copy'

// Bejelentkezés mögötti / tranzakciós lap: noindex meta + canonical
// (`src/lib/seo.ts` NOINDEX_ROBOTS — a robots.txt tiltás önmagában nem
// tartja ki az indexből; Google *Block Search indexing with noindex*).
export const metadata: Metadata = buildPrivatePageMetadata({
  title: 'Elfelejtett jelszó',
  description: 'Kérj jelszó-visszaállító linket az e-mail-címedre.',
  path: '/elfelejtett-jelszo',
})

interface ElfelejtettJelszoPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/**
 * Beküldés utáni következő lépés, a kurzus-jogosultság előzetes ígérete nélkül.
 *
 * Forrás: GOV.UK, Don’t drop people off a journey
 * https://www.gov.uk/service-manual/design/user-centred-design ;
 * WCAG 2.2 · 3.3.3 Error Suggestion
 * https://www.w3.org/WAI/WCAG22/Understanding/error-suggestion.html
 */
export const FORGOT_PASSWORD_SUCCESS_NOTE =
  'A levélben kapott linken beállíthatod az új jelszavadat. Ezután továbbléphetsz a Kurzusaim oldalra.'

export const FORGOT_PASSWORD_SUCCESS_NOTE_PLAYER =
  'A levélben kapott linken beállíthatod az új jelszavadat. Ezután továbbléphetsz a kurzushoz.'

/**
 * A MÁSODIK bekezdés az ÁTKÖLTÖZTETETT vevő biztonsági hálója.
 * A systeme.io-ról áthozott vevő fő útja a `/belepes-atallas` lap (oda visz az
 * átállási levél). Aki a levelet nem kapta meg, elvesztette vagy nem hisz neki,
 * a MEGSZOKOTT úton érkezik: fejléc → Belépés → régi jelszó → „Hibás e-mail-cím
 * vagy jelszó." → „Elfelejtetted a jelszavad?". Erre a lapra tehát olyan ember
 * is beesik, aki NEM felejtette el a jelszavát.
 *
 * A `returnUrl` a belépő oldalról és a meglévő-fiók levelekből jön: a reset-levél
 * és a „Vissza a belépéshez" ugyanoda visz vissza (pénztár, kurzus, Kurzusaim).
 */
export default async function ElfelejtettJelszoPage({ searchParams }: ElfelejtettJelszoPageProps) {
  const params = await searchParams
  const returnUrl = sanitizeReturnUrl(params.returnUrl, DEFAULT_AUTH_RETURN_URL)

  return (
    <Section>
      <Container size="narrow">
        <h1>Elfelejtetted a jelszavad?</h1>
        <p className="kc-auth-lead">
          Add meg az e-mail-címedet, és küldünk egy jelszó-visszaállító linket. Ha a cím létezik a
          rendszerünkben, a link néhány percen belül megérkezik.
        </p>
        <p className="kc-auth-lead">
          {MIGRATION_ACCOUNT_GUIDANCE} {MIGRATION_EXISTING_PASSWORD_NOTE} {MIGRATION_COURSES_NOTE}
        </p>
        <ForgotPasswordForm
          returnUrl={returnUrl}
          successNote={
            isMyCoursePlayerHref(returnUrl)
              ? FORGOT_PASSWORD_SUCCESS_NOTE_PLAYER
              : FORGOT_PASSWORD_SUCCESS_NOTE
          }
        />
        {/* Önállóan álló link: a `.kc-auth-actions` sor adja a 44 px-es
            célfelületet. A korábbi `.kc-auth-alt` MONDATBA ágyazott linkeknek
            való, és itt 117,1 × 18 CSS px-es célt adott (mérve) — a WCAG 2.2 ·
            2.5.8 24 × 24-es küszöbe alatt, „Inline" kivétel nélkül. */}
        <div className="kc-auth-actions">
          <Link href={signInHref(returnUrl)}>Vissza a belépéshez</Link>
        </div>
      </Container>
    </Section>
  )
}
