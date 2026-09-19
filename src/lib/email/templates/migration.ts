import { ctaLabel } from '../../cta-vocabulary'
import { CONTACT_EMAIL } from '../../seo'
import {
  MIGRATION_COURSES_NOTE,
  MIGRATION_EXISTING_PASSWORD_NOTE,
  MIGRATION_MISSING_COURSE_NOTE,
} from '../../migration-copy'
import { RATE_LIMIT_RULES } from '../../security/rate-limit'
import type { EmailTemplate } from '../types'
import { accountEmailBlock, escapeHtml, renderLayout } from './layout'

/**
 * Átköltöztetési értesítő a MÁR feltöltött vevőknek (WP40, 2026-09-16).
 *
 * A szöveg alapja `docs/vasarlo-migracio-terv.md` 4.5 (közös link a
 * `/belepes-atallas` lapra, személyes token NÉLKÜL), a tulajdonos 7. körös
 * hangsúlyaival: megújult az oldal; a régi jelszó nem költözött át; új jelszót AZZAL
 * a címmel kell beállítani, amelyre a levél érkezett; belépés után a Kurzusaim
 * menüpontban vannak a megvett kurzusok vagy az ingyenes SOS-villámkurzus.
 *
 * Tervezési döntések és forrásaik (a termektervezes skill 1. pontja szerint):
 *
 * - EGY levél, EGY gomb, aláírás (a terv 1. alapelve, 3. pont). NN/g,
 *   Transactional and Confirmation Email: a tárgy a vevő saját ügyéhez
 *   kötődjön, és a levél az elején mondja, ami a vevőnek számít
 *   („start with the information that matters most to users").
 *   https://www.nngroup.com/articles/transactional-and-confirmation-email/
 * - Tárgy legfeljebb 60 karakter; a tárgy elején a lényeg, mert a kliens
 *   rövidít. Postmark: „Keep subject length around 50 characters or fewer".
 *   https://postmarkapp.com/guides/transactional-email-best-practices
 *   GOV.UK Service Manual: „email subject lines are often shortened".
 *   https://www.gov.uk/service-manual/design/sending-emails-and-text-messages
 * - Plain-text változat, a HTML-lel azonos tartalommal, a link külön sorban
 *   (Postmark, ugyanott: „Include a plain text equivalent").
 * - A lábléc kimondja, MIÉRT kapja a vevő (fiók-átköltöztetés), és hogy
 *   válaszolhat rá; a válasz-cím a kapcsolat-cím, nem noreply (Postmark:
 *   „Avoid a noreply@ address if you can"; GOV.UK: „include contact details
 *   for your service if the user might need to contact you").
 *   List-Unsubscribe fejléc NINCS: ez fiókkal kapcsolatos, tranzakciós
 *   értesítés, nem hírlevél.
 * - A gomb E/1, ige + tárgy, a §3.2 #22 sorából (`docs/ui-sztenderdek.md`):
 *   ugyanaz a cselekvés (új jelszó beállítása), mint az aktiváló levélben és a
 *   jelszó-beállító lapon, tehát ugyanaz a felirat (WCAG 2.2 SC 3.2.4,
 *   Consistent Identification; Polaris: „identify and eliminate synonyms").
 *   Új, szinonim felirat („Beállítom a jelszavam") ezért NEM került a szótárba.
 * - A „10 percen belül legfeljebb 3 levél" mondat a `password-forgot-email`
 *   kérés-korlát valódi értékéből épül (őr-teszt köti), és bitre azonos a
 *   `/belepes-atallas` lap mondatával.
 * - Natív magyar, töltelék gondolatjel nélkül (§3.1); E/2 tegezés a
 *   magyarázatban, E/1 a gombon (§3.1.5, P-1).
 */

/** Az átállási céllap útvonala; a levél EGYETLEN linkje ide megy (terv 4.6). */
export const MIGRATION_NOTICE_PATH = '/belepes-atallas'

/** A levél tárgya; a tárgy hosszát őr-teszt köti (≤ 60 karakter). */
export const MIGRATION_NOTICE_SUBJECT = 'Megújult a Kineticare: állítsd be az új jelszavad'

/** Előnézeti sor a postaláda listanézetébe (a tárgy mellett látszik). */
export const MIGRATION_NOTICE_PREHEADER =
  'Ugyanazzal az e-mail-címmel térhetsz vissza. Segítünk a jelszó beállításában.'

/** A levél és a céllap közös, tényleges hozzáférést előre nem ígérő mondata. */
export const MIGRATION_NOTICE_ACCESS_SENTENCE = MIGRATION_COURSES_NOTE

/**
 * A kérés-korlát emberi nyelven, a `password-forgot-email` szabály VALÓDI
 * értékéből. Ugyanez a mondat áll a `/belepes-atallas` lapon
 * (`ATALLAS_KERES_KORLAT_MONDAT`); ha a keretet átállítják, a két hely együtt
 * változik, és az őr-teszt ellenőrzi az egyezést.
 */
export function migrationNoticeRateLimitSentence(): string {
  const keret = RATE_LIMIT_RULES['password-forgot-email']
  const perc = Math.round(keret.windowMs / 60_000)
  return (
    `Ugyanarra a címre ${perc} percen belül legfeljebb ${keret.limit} levelet küldünk ki, ` +
    'ezért ha többször is kérted, várj néhány percet az újabb próbálkozással.'
  )
}

/**
 * A visszaállító link élettartama ezredmásodpercben: a Payload
 * `forgotPassword.expiration` alapértéke (3 600 000 ms = 1 óra), mert a Users
 * collection nem ad meg sajátot. Őr-teszt köti a `payload.config`-hoz
 * (`src/__tests__/email-migracio-sablon.test.ts`), hogy a levél mondata ne
 * csússzon szét a valódi lejárattal.
 */
export const MIGRATION_NOTICE_LINK_VALIDITY_MS = 3_600_000

/** „A link 1 óráig érvényes; …" a valódi lejáratból számolva. */
export function migrationNoticeLinkValiditySentence(): string {
  const ora = MIGRATION_NOTICE_LINK_VALIDITY_MS / 3_600_000
  const mennyi =
    Number.isInteger(ora) && ora >= 1
      ? `${ora} óráig`
      : `${Math.round(MIGRATION_NOTICE_LINK_VALIDITY_MS / 60_000)} percig`
  return `A link ${mennyi} érvényes; ha lejár, ugyanott kérhetsz újat.`
}

/** Az aláírás: a terv 4.1 és 4.2 leveleivel AZONOS (1. alapelv: egy hang). */
export const MIGRATION_NOTICE_SIGNATURE = 'a Kineticare csapata'

/** A válasz-cím: a kapcsolat-cím, ami a láblécben és a Kapcsolat oldalon is áll. */
export const MIGRATION_NOTICE_REPLY_TO = CONTACT_EMAIL

export interface MigrationNoticeInput {
  /** A címzett neve; üres/hiányzó névnél semleges megszólítás megy ki. */
  readonly name?: string | null
  /** A címzett e-mail-címe: a levél kimondja, hogy EZZEL a címmel regisztrált. */
  readonly email: string
  /** A NEXT_PUBLIC_SERVER_URL (záró perjel nélkül vagy azzal, mindegy). */
  readonly serverUrl: string
}

/** Az átállási céllap abszolút címe (e-mailben csak abszolút URL használható). */
export function buildMigrationNoticeUrl(serverUrl: string): string {
  return `${serverUrl.trim().replace(/\/+$/, '')}${MIGRATION_NOTICE_PATH}`
}

/**
 * Az átköltöztetési értesítő sablonja (tárgy + HTML + plain-text).
 *
 * MINDEN behelyettesített érték escape-elve (név, e-mail-cím): egy furcsa
 * vagy hosszú cím sem törheti szét a HTML-t.
 */
export function migrationNoticeEmail(input: MigrationNoticeInput): EmailTemplate {
  const name = input.name?.trim() ?? ''
  const greeting = name ? `Kedves ${name}!` : 'Szia!'
  const url = buildMigrationNoticeUrl(input.serverUrl)
  const email = input.email.trim()
  const account = accountEmailBlock(email)

  const miert =
    'A Kineticare oldala megújult: a kurzusok új, saját felületre költöztek. ' +
    'Ha eddig a korábbi felületet használtad, a régi jelszavad nem költözött át.'
  const hogyan =
    'Ha még nem állítottál be jelszót az új felületen, a gombbal nyisd meg a beállító oldalt. ' +
    'Ott add meg azt az e-mail-címet, amelyre ezt a levelet kaptad. ' +
    'Küldünk rá egy külön levelet, amelynek linkjén kiválaszthatod az új jelszavadat. ' +
    migrationNoticeLinkValiditySentence()
  const kurzusaim =
    'Ez a megvásárolt kurzusaidra és az ingyenes SOS KézRelax villámkurzusra is vonatkozik. ' +
    MIGRATION_MISSING_COURSE_NOTE
  const segitseg =
    'Ha elakadsz, vagy nem emlékszel, melyik címmel regisztráltál, válaszolj erre a levélre. ' +
    'Emberi választ kapsz, és megkeressük a fiókodat.'
  const spam =
    'Ha pár percen belül nem érkezik meg a levél, nézd meg a levélszemét mappát is, és keress rá ' +
    `a Kineticare szóra. ${migrationNoticeRateLimitSentence()}`

  return {
    subject: MIGRATION_NOTICE_SUBJECT,
    ...renderLayout({
      eyebrow: 'Fiók-átköltöztetés',
      preheader: MIGRATION_NOTICE_PREHEADER,
      heading: 'Megújult a Kineticare',
      paragraphsHtml: [
        escapeHtml(greeting),
        escapeHtml(miert),
        account.html,
        escapeHtml(hogyan),
        `<strong>${escapeHtml(MIGRATION_NOTICE_ACCESS_SENTENCE)}</strong>`,
        escapeHtml(kurzusaim),
      ],
      paragraphsText: [
        greeting,
        miert,
        account.text,
        hogyan,
        MIGRATION_NOTICE_ACCESS_SENTENCE,
        kurzusaim,
      ],
      cta: { label: ctaLabel('password-reset-set'), url },
      closingParagraphsHtml: [
        escapeHtml(MIGRATION_EXISTING_PASSWORD_NOTE),
        escapeHtml(segitseg),
        `Üdvözlettel:<br />${escapeHtml(MIGRATION_NOTICE_SIGNATURE)}`,
      ],
      closingParagraphsText: [
        MIGRATION_EXISTING_PASSWORD_NOTE,
        segitseg,
        `Üdvözlettel: ${MIGRATION_NOTICE_SIGNATURE}`,
      ],
      note: spam,
      footer: {
        reason:
          `Ezt a levelet azért kapod, mert a(z) ${email} címmel fiókod van a Kineticare oldalán, ` +
          'és az új felületen történő belépéshez küldünk segítséget.',
        replyNote: `Kérdésed van? Válaszolj erre a levélre, vagy írj a(z) ${MIGRATION_NOTICE_REPLY_TO} címre.`,
      },
    }),
  }
}
