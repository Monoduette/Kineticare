import { ctaLabel } from '../../cta-vocabulary'
import { isMyCoursePlayerUrl } from '../../courses'
import type { EmailTemplate } from '../types'
import { formatPriceHuf } from '../../format-price'
import { escapeHtml, renderLayout } from './layout'

/**
 * Vásárlás-visszaigazoló sablon (paid után). Fiók-változatok: bejelentkezett,
 * password-setup (aktiváló link titok), login. Generált jelszó sosem a levélben.
 */
export interface OrderConfirmationItem {
  title: string
  quantity: number
  /** Tétel bruttó végösszege (egységár × mennyiség). */
  totalHuf: number
}

export type OrderConfirmationAccount =
  | {
      kind: 'password-setup'
      /** A személyre szóló jelszó-beállító (aktiváló) link — abszolút URL. */
      activationUrl: string
      /** A link élettartama napokban (a levélszöveghez). */
      expiresInDays: number
      /** A fiókhoz tartozó e-mail-cím („erre a címre készült a fiók"). */
      email: string
    }
  | {
      kind: 'login'
      /** A belépés oldalának abszolút URL-je. */
      loginUrl: string
      email: string
    }

export function orderConfirmationEmail(input: {
  orderNumber: string
  buyerName?: string | null
  items: OrderConfirmationItem[]
  totalHuf: number
  coursesUrl: string
  /** true, ha a Számlázz.hu-integráció aktív (a számla-hivatkozás bekerül). */
  invoiceNote: boolean
  /** A fiók állapotából adódó változat (lásd a fájl fejlécét). */
  account?: OrderConfirmationAccount
}): EmailTemplate {
  const greeting = input.buyerName?.trim() ? `Kedves ${input.buyerName.trim()}!` : 'Szia!'

  /**
   * A RENDELÉS ADATAI SZERKEZETBEN, nem bekezdésekben.
   *
   * Korábban a rendelésszám, a tétellista és a végösszeg is `<strong>`-gal
   * megjelölt bekezdés volt. Ez a levél LEGFONTOSABB adata, és a bekezdésfolyam
   * pont attól fosztja meg, ami visszakereshetővé teszi: a kiemelt paneltől és
   * a jobbra igazított, összeadható összegoszloptól. A váz `summary` és `items`
   * blokkja ezt adja meg, ugyanazokkal a tokenekkel, amiket a pénztár használ.
   * Minden érték escape-elve megy át (a váz escape-eli a strukturált mezőket).
   */
  const paragraphsHtml = [
    escapeHtml(greeting),
    'Köszönjük a vásárlásod! A fizetésed sikeres, a kurzushozzáférésed aktív.',
  ]
  const paragraphsText = [
    greeting,
    'Köszönjük a vásárlásod! A fizetésed sikeres, a kurzushozzáférésed aktív.',
  ]

  const summary = {
    rows: [{ label: 'Rendelésszám', value: input.orderNumber }],
  }

  const items = {
    title: 'Amit megvettél',
    rows: input.items.map((item) => ({
      title: item.title,
      meta: `${item.quantity} db`,
      amount: formatPriceHuf(item.totalHuf),
    })),
    totalLabel: 'Végösszeg',
    totalValue: formatPriceHuf(input.totalHuf),
  }

  /**
   * A számla-mondat a levél VÉGÉRE való, nem a rendelés adatai elé.
   * Ez másodlagos, tájékoztató információ: nem kér cselekvést, és nem a
   * vásárlás tényéről szól. A záró jegyzet (elválasztó vonal alatt, halkabb
   * szedéssel) pontosan az ilyen mondatok helye.
   */
  const note = input.invoiceNote
    ? 'A számlát a Számlázz.hu rendszeréből külön e-mailben küldjük el.'
    : undefined

  let cta = {
    label: isMyCoursePlayerUrl(input.coursesUrl)
      ? ctaLabel('course-start')
      : ctaLabel('my-courses-open'),
    url: input.coursesUrl,
  }

  if (input.account?.kind === 'password-setup') {
    const account = input.account
    const created =
      `A vásárláshoz fiókot készítettünk a(z) ${account.email} címmel. ` +
      'Már csak egy jelszót kell beállítanod, utána a kurzusod megnyílik.'
    const validity = `A jelszó-beállító link ${account.expiresInDays} napig érvényes, és személyre szól, ne add tovább senkinek.`
    const notWorking =
      'Ha a link lejárt vagy nem működik, a belépési oldal „Elfelejtett jelszó" gombjával bármikor ' +
      'kérhetsz újat, ugyanezzel az e-mail-címmel.'
    paragraphsHtml.push(
      escapeHtml(created),
      `<strong>${escapeHtml(validity)}</strong>`,
      escapeHtml(notWorking),
    )
    paragraphsText.push(created, validity, notWorking)
    cta = { label: ctaLabel('password-reset-set'), url: account.activationUrl }
  } else if (input.account?.kind === 'login') {
    const account = input.account
    const existing = `A kurzus már elérhető a meglévő fiókodban: jelentkezz be a(z) ${account.email} címmel.`
    const noPassword =
      'Ha nem emlékszel a jelszavadra, a belépési oldal „Elfelejtett jelszó" gombjával állíthatsz be újat.'
    paragraphsHtml.push(escapeHtml(existing), escapeHtml(noPassword))
    paragraphsText.push(existing, noPassword)
    cta = { label: ctaLabel('sign-in'), url: account.loginUrl }
  }

  return {
    subject: `Sikeres vásárlás: ${input.orderNumber}`,
    ...renderLayout({
      // Az előnézeti szöveg a postaláda LISTÁJÁBAN áll a tárgy mellett. Enélkül
      // a kliens a levél első szavait húzná be, ami itt a wordmark lenne.
      preheader: `A ${input.orderNumber} rendelésed megérkezett, a kurzusod elérhető.`,
      eyebrow: 'Visszaigazolás',
      heading: 'Sikeres vásárlás',
      paragraphsHtml,
      paragraphsText,
      summary,
      items,
      cta,
      ...(note ? { note } : {}),
    }),
  }
}
