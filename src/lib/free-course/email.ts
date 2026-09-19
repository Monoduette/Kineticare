import { ctaLabel } from '../cta-vocabulary'
import { accountEmailBlock, escapeHtml, renderLayout } from '../email/templates/layout'
import type { EmailTemplate } from '../email/types'

/**
 * Ingyenes kurzus igénylés — belépő levél sablonja. Mechanika: Payload forgotPassword token
 * (`disableEmail: true`), mint az import-invite. Szöveg külön (nem migrációs szöveg).
 * A levél nem árulja el, új vagy meglévő-e a fiók.
 */

export interface FreeCourseEmailInput {
  /** A címzett neve; üres/hiányzó névnél semleges megszólítás megy ki. */
  readonly name?: string | null
  /** A kurzus megjelenő címe (courseTitle). */
  readonly courseTitle: string
  /** A személyre szóló belépő (jelszó-beállító) link, abszolút URL. */
  readonly activationUrl: string
  /** A címzett e-mail-címe — a levélben is szerepel („erre a címre küldtük"). */
  readonly email: string
  /** A link élettartama napokban. */
  readonly expiresInDays: number
}

/**
 * A belépő levél (tárgy + HTML + plain-text).
 *
 * Egyetlen kért cselekvés (jelszót beállítani), az ingyenesség kimondva, és a
 * „mi van, ha nem működik / nem én kértem" ág is benne van (GOV.UK
 * confirmation-pattern: mondd meg, mi a következő lépés, és mi van, ha
 * elakadsz).
 */
export function freeCourseEmail(input: FreeCourseEmailInput): EmailTemplate {
  const name = input.name?.trim() ?? ''
  const greeting = name ? `Kedves ${name}!` : 'Szia!'
  const account = accountEmailBlock(input.email)
  const validity = `A link ${input.expiresInDays} napig érvényes.`
  const notWorking =
    'Ha a link lejárt vagy nem működik, a belépési oldal „Elfelejtett jelszó" gombjával bármikor ' +
    'kérhetsz újat, ugyanezzel az e-mail-címmel. Ilyenkor a régi link érvénytelenné válik, ' +
    'mindig a legfrissebb levélben lévőt használd.'
  const wrongPerson =
    `Ezt a levelet a(z) ${input.email} címre küldtük, mert ezzel a címmel kérték a kurzust. ` +
    'Ha nem te kérted, ne használd a linket, és nyugodtan töröld ezt a levelet.'

  const intro = `A(z) ${input.courseTitle} mostantól a tiéd. Ingyenes, fizetned nem kell érte.`
  const howTo =
    'Nyisd meg az alábbi gombot, és adj meg egy jelszót (legalább 12 karakter, kis- és nagybetűvel ' +
    'és számmal). A jelszó után a kurzusod megnyílik, külön belépés nem kell.'

  const bodyHtml = [
    escapeHtml(greeting),
    account.html,
    `A(z) <strong>${escapeHtml(input.courseTitle)}</strong> mostantól a tiéd. ` +
      '<strong>Ingyenes</strong>, fizetned nem kell érte.',
    escapeHtml(howTo),
    `<strong>${escapeHtml(validity)}</strong> A link személyre szól, ne add tovább.`,
    escapeHtml(notWorking),
    escapeHtml(wrongPerson),
  ]
  const bodyText = [
    greeting,
    account.text,
    intro,
    howTo,
    `${validity} A link személyre szól, ne add tovább.`,
    notWorking,
    wrongPerson,
  ]

  return {
    subject: `Itt a belépő linked: ${input.courseTitle}`,
    ...renderLayout({
      // A postaláda LISTÁJÁBAN a tárgy mellett álló szöveg. Enélkül a kliens a
      // levél első szavait húzná be, ami itt a wordmark lenne.
      preheader: `A(z) ${input.courseTitle} elérhető, már csak egy jelszó kell hozzá.`,
      eyebrow: 'Ingyenes hozzáférés',
      heading: 'Állítsd be a jelszavad, és indul a kurzus',
      paragraphsHtml: bodyHtml,
      paragraphsText: bodyText,
      // A levél EGYETLEN cselekvése. A felirat a `/jelszo-visszaallitas`
      // oldal tényleges műveletét nevezi meg (a CTA-szótár §3.2 #22 sorának
      // igéjével), nem ígér mást, mint ami a link túloldalán történik.
      cta: { label: ctaLabel('password-reset-set'), url: input.activationUrl },
    }),
  }
}

export interface ExistingAccountFreeCourseEmailInput {
  readonly name?: string | null
  readonly courseTitle: string
  readonly signInUrl: string
  readonly passwordResetUrl: string
  readonly email: string
}

/**
 * Meglévő, már aktivált fiók: NEM adjuk hozzá csendben az ingyenes kurzust.
 * A levél a belépésre (vagy jelszó-helyreállításra) visz.
 *
 * Forrás:
 * - GOV.UK Design System, Confirm a user exists: a postaláda a megfelelő
 *   hely a „van fiókod" üzenetre; a nyilvános válasz maradjon semleges.
 *   https://design-system.service.gov.uk/patterns/confirm-a-user-exists/
 * - NN/g, Error-message guidelines: mondd meg, mi a következő lépés.
 *   https://www.nngroup.com/articles/error-message-guidelines/
 * - WCAG 2.2 3.3.3 Error Suggestion: a javítás módja legyen benne.
 */
export function existingAccountFreeCourseEmail(
  input: ExistingAccountFreeCourseEmailInput,
): EmailTemplate {
  const name = input.name?.trim() ?? ''
  const greeting = name ? `Kedves ${name}!` : 'Szia!'
  const intro =
    `Ehhez az e-mail-címhez (${input.email}) már van Kineticare-fiók. ` +
    `Az ingyenes „${input.courseTitle}” kurzust ezért nem írtuk rá automatikusan.`
  const howTo =
    'A Belépés gomb a belépő oldalra visz, utána a kurzus oldala nyílik meg. Ott kérd újra az ingyenes hozzáférést: akkor a fiókodhoz rendeljük.'
  const resetHtml =
    `Ha nem emlékszel a jelszavadra, <a href="${escapeHtml(input.passwordResetUrl)}">kérj új jelszót</a> ` +
    'ugyanerre a címre.'
  const resetText = `Ha nem emlékszel a jelszavadra, kérj új jelszót: ${input.passwordResetUrl}`

  return {
    subject: `Már van fiókod: lépj be a(z) ${input.courseTitle} kurzushoz`,
    ...renderLayout({
      preheader: 'Ehhez a címhez már tartozik fiók. Lépj be, vagy állíts új jelszót.',
      eyebrow: 'Meglévő fiók',
      heading: 'Lépj be a fiókodba',
      paragraphsHtml: [
        escapeHtml(greeting),
        escapeHtml(intro),
        escapeHtml(howTo),
        resetHtml,
        `Ha nem te kérted: nyugodtan töröld a levelet. A cím: ${escapeHtml(input.email)}.`,
      ],
      paragraphsText: [
        greeting,
        intro,
        howTo,
        resetText,
        `Ha nem te kérted, töröld a levelet. Cím: ${input.email}.`,
      ],
      cta: { label: ctaLabel('sign-in'), url: input.signInUrl },
    }),
  }
}
