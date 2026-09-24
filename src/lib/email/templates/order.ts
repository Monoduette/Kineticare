import { ctaLabel } from '../../cta-vocabulary'
import { isMyCoursePlayerUrl } from '../../courses'
import { budapestDateTimeString } from '../../date/budapest'
import type { EmailTemplate, MailAttachment } from '../types'
import { formatPriceHuf } from '../../format-price'
import { accountEmailBlock, escapeHtml, inlineLinkHtml, renderLayout } from './layout'
import { formatHungarianPhone, type SellerIdentity } from './order-legal'

/**
 * Vásárlás-visszaigazoló sablon (paid után). Fiók-változatok: bejelentkezett,
 * password-setup (aktiváló link titok), login. Generált jelszó sosem a levélben.
 *
 * JOGI SZEREP: ez a levél a 45/2014. (II. 26.) Korm. rendelet 18. §-a szerinti
 * tartós adathordozón adott visszaigazolás. Tartalmazza a vevő két, a
 * pénztárban tett nyilatkozatának visszaigazolását (18. § b), a 29. § (1) m)
 * feltétele), a 11. § (1) szerinti fő adatokat (a kurzus, a fizetendő
 * végösszeg, a hozzáférés hossza, a szolgáltató adatai, a panaszkezelés), az
 * ÁSZF teljes szövegét pedig mellékletként viszi. A szöveg jogászi
 * jóváhagyásra vár.
 *
 * ELÉRHETŐSÉG (tulajdonosi döntés K14, 2026-09-24): a vevő kérdéseinek és
 * panaszainak EGYETLEN hivatalos címe a weboldal kapcsolati címe
 * (`supportEmail`; a hívó a Kapcsolat oldalból oldja fel, hiányában a
 * src/lib/contact-email.ts kódtartaléka). Erre mutat a levél válaszcíme, a
 * lábléc és a panaszkezelési bekezdés. A „szolgáltató adatai” blokk ettől
 * függetlenül SZÓ SZERINT az ÁSZF-et követi, mert az a szerződő fél jogi
 * azonosítása.
 */

/**
 * A sablon változata: a küldés bizonyítékaként a műveletnaplóba kerül, így
 * utólag is látszik, melyik szövegű levél ment ki. Érdemi szövegváltozásnál
 * léptetni kell. Őr-teszt köti a renderelt szöveghez
 * (src/__tests__/order-paid-visszaigazolas.test.ts, „sablonváltozat”): ha a
 * szöveg változik, a teszt addig bukik, amíg a változat nem lép, és az új
 * ujjlenyomat nem kerül a tesztbe.
 */
export const ORDER_CONFIRMATION_TEMPLATE_VERSION = '2026-09-24.3'

/**
 * A pénztár két jelölőnégyzetének SZÓ SZERINTI szövege
 * (src/components/checkout/CheckoutForm.tsx, „Elállási jog" kártya). A levél
 * pontosan ezt idézi vissza; az egyezést őr-teszt köti a pénztár forrásához
 * (src/__tests__/order-paid-visszaigazolas.test.ts), hogy a kettő ne
 * csúszhasson szét.
 */
export const WAIVER_START_STATEMENT =
  'Kifejezetten kérem, hogy a digitális tartalomhoz a hozzáférés azonnal megkezdődjön.'
export const WAIVER_LOSS_STATEMENT =
  'Tudomásul veszem, hogy a teljesítés megkezdésével elveszítem a 14 napos elállási jogomat.'

export interface OrderConfirmationItem {
  title: string
  quantity: number
  /** Tétel bruttó végösszege (egységár × mennyiség). */
  totalHuf: number
  /**
   * A hozzáférés hossza napokban (a termék `accessDurationDays` mezőjéből):
   * `null` = nem jár le. Hiányában (`undefined`) a hossz nem ismert, és a
   * levél nem állít róla semmit.
   */
  accessDurationDays?: number | null
}

/**
 * A két elállási nyilatkozat a rendelésről (a `consentWithdrawalWaiver` és a
 * `consentWithdrawalWaiverAt` mező). Kifejezett szerződés: `given: false`
 * esetén a levél NEM igazol vissza nyilatkozatot; `given: true` és
 * `at: null` esetén időpont nélkül igazol vissza (a rögzítés hiányos).
 */
export interface OrderConfirmationWaiver {
  given: boolean
  /** A nyilatkozat időpontja (ISO); `null`, ha a rendelés nem rögzítette. */
  at: string | null
}

/** Az ÁSZF a levélben: a melléklet és a weboldali címe. */
export interface OrderConfirmationTerms {
  /** A mellékelt ÁSZF-szöveg; hiányában csak a link megy (a hívó ilyenkor riaszt). */
  attachment?: MailAttachment | null
  /** A /aszf oldal abszolút címe. */
  url: string
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

/**
 * A tétel másodlagos sora: darabszám és, ha ismert, a hozzáférés hossza. A
 * megfogalmazás a kurzusoldal tényadat-soraival egyezik
 * (src/components/courses/sales-content.ts: `factHighlights` „N napos
 * hozzáférés", `factSteps` „A hozzáférésed nem jár le"), hogy a vevő ugyanazt
 * olvassa a levélben, amit vásárláskor látott.
 */
function itemMeta(item: OrderConfirmationItem): string {
  const quantity = `${item.quantity} db`
  if (item.accessDurationDays === undefined) {
    return quantity
  }
  if (item.accessDurationDays === null || item.accessDurationDays <= 0) {
    return `${quantity}, a hozzáférés nem jár le`
  }
  return `${quantity}, ${item.accessDurationDays} napos hozzáférés`
}

/** A nyilatkozat időpontja magyar alakban; hibás időbélyegnél null. */
function statementTime(iso: string): string | null {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : budapestDateTimeString(date)
}

/** Egy címkés jogi bekezdés: félkövér címke kettősponttal, utána a szöveg. */
interface LabeledParagraph {
  label: string
  /** Sima szöveg (escape-elve kerül a HTML-be). */
  body: string
  /**
   * A törzs HTML-alakja, ha nem a puszta escape-elt szöveg (pl. kattintható
   * link van benne). A hívó felel érte, hogy minden változó escape-elve
   * álljon benne, és hogy a látható szövege a `body`-val egyezzen.
   */
  bodyHtml?: string
}

function labeledHtml(paragraph: LabeledParagraph): string {
  return `<strong>${escapeHtml(paragraph.label)}:</strong> ${paragraph.bodyHtml ?? escapeHtml(paragraph.body)}`
}

function labeledText(paragraph: LabeledParagraph): string {
  return `${paragraph.label}: ${paragraph.body}`
}

/**
 * A határozott névelő egy szó (itt: e-mail-cím) elé: magánhangzóval kezdődő
 * szó előtt „az”, mássalhangzóval kezdődő előtt „a” (A magyar nyelv
 * értelmező szótára, „a³” szócikk, https://ertelmezo.oszk.hu/; Sulinet
 * Tudásbázis, A határozott és a határozatlan névelő helyes használata,
 * https://tudasbazis.sulinet.hu/hu/magyar-nyelv-es-irodalom/magyar-nyelv/nyelvtan-4-osztaly/a-ragos-fonevek/a-hatarozott-es-a-hatarozatlan-nevelo-helyes-hasznalata).
 * A számjeggyel kezdődő címnél a kiejtett számnév dönt: az 1 („egy”) és az 5
 * („öt”) magánhangzóval kezdődik.
 */
export function hatarozottNevelo(szo: string): 'a' | 'az' {
  const elso = szo.trim().charAt(0).toLocaleLowerCase('hu-HU')
  return /^[aáeéiíoóöőuúüű15]$/u.test(elso) ? 'az' : 'a'
}

/**
 * A levél jogi része a gomb UTÁN, a kártyán belül (záró bekezdések). NN/g,
 * Transactional and Confirmation Email: „start with the information that
 * matters most to users", a „what to do if things go wrong" jellegű tudnivaló
 * lejjebb kerül (https://www.nngroup.com/articles/transactional-and-confirmation-email/).
 * GOV.UK: a levél adja meg a hivatkozási számot és az elérhetőséget
 * (https://www.gov.uk/service-manual/design/sending-emails-and-text-messages).
 * Minden bekezdés félkövér címkével indul, hogy a hosszabb rész is átfutható
 * legyen.
 */
function legalParagraphs(input: {
  withdrawalWaiver?: OrderConfirmationWaiver | null
  withdrawalUrl?: string | null
  seller?: SellerIdentity | null
  terms?: OrderConfirmationTerms | null
  supportEmail?: string | null
}): { html: string[]; text: string[] } {
  const html: string[] = []
  const text: string[] = []
  const push = (paragraph: LabeledParagraph): void => {
    html.push(labeledHtml(paragraph))
    text.push(labeledText(paragraph))
  }

  if (input.withdrawalWaiver?.given === true) {
    const at = input.withdrawalWaiver.at
    const time = at === null ? null : statementTime(at)
    const when = time ? `a rendelésed leadásakor (${time})` : 'a rendelésed leadásakor'
    // Mindkét nyilatkozat kettősponttal bevezetett, szó szerinti idézet: nagy
    // kezdőbetűvel, a saját záró pontjával az idézőjelen belül (AkH. 12.
    // kiadás, 256. a); https://hu.wikisource.org/wiki/A_magyar_helyes%C3%ADr%C3%A1s_szab%C3%A1lyai/Az_%C3%ADr%C3%A1sjelek).
    push({
      label: 'Az elállási jogodról',
      body:
        `${when} két nyilatkozatot tettél. Az első: „${WAIVER_START_STATEMENT}” ` +
        `A második: „${WAIVER_LOSS_STATEMENT}” Ezzel a levéllel mindkét nyilatkozatodat ` +
        'visszaigazoljuk. A hozzáférést a kérésednek megfelelően azonnal megnyitottuk.',
    })
  }

  /**
   * Az elállási funkció linkje (45/2014. Korm. rendelet 22. § (1b)): a
   * felirat a rendelet szövege, a webcím kiírva és kattinthatóan, mint az
   * ÁSZF-é. A jog fennállásáról a levél nem nyilatkozik (az az ÁSZF és a
   * vevő nyilatkozatainak dolga), csak az utat adja meg.
   */
  const withdrawalUrl = input.withdrawalUrl?.trim()
  if (withdrawalUrl) {
    const elotag =
      'ha élni szeretnél az elállási jogoddal, a nyilatkozatot online, ezen az oldalon is ' +
      'megteheted: '
    push({
      label: 'Elállás a szerződéstől',
      body: `${elotag}${withdrawalUrl}`,
      bodyHtml: `${escapeHtml(elotag)}${inlineLinkHtml(withdrawalUrl)}`,
    })
  }

  push({
    label: 'A kurzusról',
    body:
      'online videókurzust vásároltál, vagyis nem tárgyi adathordozón nyújtott digitális ' +
      'tartalmat. Belépés után a fiókodban, böngészőből nézheted meg asztali gépen, ' +
      'laptopon vagy mobileszközön. Stabil internetkapcsolat kell hozzá, a lejátszáshoz a ' +
      'Google Chrome vagy a Safari böngészőt javasoljuk. A videók lementése és másolása tilos.',
  })

  if (input.terms) {
    // A webcím kiírva ÉS kattinthatóan áll: GOV.UK, Sending emails: „spell out
    // any web addresses (URLs) in full to show the user where links are going”
    // (https://www.gov.uk/service-manual/design/sending-emails-and-text-messages);
    // WCAG 2.2 SC 2.4.4 (Link Purpose): a link szövege maga a cél.
    const { url, attachment } = input.terms
    const elotag = attachment
      ? `a teljes szövegét mellékeltük ehhez a levélhez (${attachment.filename}), így bármikor ` +
        'újra elolvashatod. A weboldalon is megtalálod: '
      : 'a teljes szövegét a weboldalon olvashatod: '
    push({
      label: 'Általános szerződési feltételek (ÁSZF)',
      body: `${elotag}${url}`,
      bodyHtml: `${escapeHtml(elotag)}${inlineLinkHtml(url)}`,
    })
  }

  const seller = input.seller
  if (seller) {
    const court = seller.registryCourt ? ` (${seller.registryCourt})` : ''
    const lines = [
      seller.name,
      `Székhely: ${seller.seat}`,
      `Cégjegyzékszám: ${seller.companyRegistrationNumber}${court}`,
      `Adószám: ${seller.taxNumber}`,
      `E-mail: ${seller.email}`,
      `Telefon: ${formatHungarianPhone(seller.phone)}`,
    ]
    html.push(
      `<strong>A szolgáltató adatai:</strong><br />${lines.map((line) => escapeHtml(line)).join('<br />')}`,
    )
    text.push(['A szolgáltató adatai:', ...lines].join('\n'))

    const place = seller.complaintHandledAtSeat ? ', amely egyben a panaszügyintézés helye is' : ''
    const support = input.supportEmail?.trim()
    const where = support
      ? `e-mailben ${hatarozottNevelo(support)} ${support} címre, vagy postai levélben a fenti ` +
        `székhelyünkre${place}`
      : `e-mailben vagy postai levélben a fenti elérhetőségeken${place}`
    push({
      label: 'Ha panaszod van',
      body:
        `írd meg nekünk ${where}. ` +
        'Legkésőbb 30 napon belül írásban válaszolunk. Ha nem sikerül megegyeznünk, ingyenesen ' +
        'fordulhatsz a lakóhelyed vagy a tartózkodási helyed szerinti békéltető testülethez ' +
        '(elérhetőségük: www.bekeltetes.hu). A panaszkezelés részleteit, a további ' +
        'jogérvényesítési lehetőségeidet és a hibás teljesítés esetén járó kellékszavatossági ' +
        'jogaidat az ÁSZF írja le.',
    })
  }

  // A szöveges változatban üres sor választja el a bekezdéseket: a jogi rész
  // hosszabb, egybefolyva nem lenne átfutható.
  return {
    html,
    text: text.flatMap((paragraph, index) => (index === 0 ? [paragraph] : ['', paragraph])),
  }
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
  /**
   * A két elállási nyilatkozat (lásd `OrderConfirmationWaiver`). Hiányában,
   * vagy `given: false` esetén a levél nem igazol vissza olyat, ami nem
   * történt meg.
   */
  withdrawalWaiver?: OrderConfirmationWaiver | null
  /**
   * Az elállási funkció abszolút webcíme, előtöltött rendelésszámmal
   * (src/lib/withdrawal/client.ts `withdrawalHref`). Hiányában a bekezdés
   * kimarad.
   */
  withdrawalUrl?: string | null
  /** A szolgáltató adatai az ÁSZF-ből (lásd order-legal.ts). */
  seller?: SellerIdentity | null
  /** Az ÁSZF melléklete és címe. */
  terms?: OrderConfirmationTerms | null
  /**
   * A vevő kérdéseinek és panaszainak hivatalos címe (K14; lásd a fájl
   * fejlécét). Megadva a lábléc erre a címre terel, és a hívó ezt teszi a
   * levél válaszcímébe; hiányában a lábléc a megszokott „ne válaszolj” sor.
   */
  supportEmail?: string | null
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
      meta: itemMeta(item),
      amount: formatPriceHuf(item.totalHuf),
    })),
    // 45/2014. Korm. rendelet 11. § (1) e): az ellenszolgáltatás teljes,
    // fizetendő összege. A szó az ÁSZF-fel egyezik („A Weboldalon feltüntetett
    // ár a fizetendő végösszeg.”), áfára nem utal: az eladó alanyi adómentes
    // (tulajdonosi döntés, 2026-09-24), a szó pedig áfás számlázásnál is igaz
    // maradna. Egy dologra egy szó: NN/g, Consistency and Standards
    // (https://www.nngroup.com/articles/consistency-and-standards/).
    totalLabel: 'Fizetendő végösszeg',
    totalValue: formatPriceHuf(input.totalHuf),
  }

  /**
   * A számla-mondat a gomb UTÁN, de a hosszú jogi rész ELŐTT áll. Nem a
   * rendelés adatai elé való: nem kér cselekvést, és nem a vásárlás tényéről
   * szól. A jogi rész viszont tizenöt-húsz sor, a levél legvégén a vevő már
   * nem találná meg, pedig a „hol a számlám?” a vásárlás utáni gyakori
   * kérdés. NN/g, Transactional and Confirmation Email: „start with the
   * information that matters most to users in the transaction context”
   * (https://www.nngroup.com/articles/transactional-and-confirmation-email/);
   * GOV.UK: a levél adja meg, amire a címzettnek a továbblépéshez szüksége
   * van (https://www.gov.uk/service-manual/design/sending-emails-and-text-messages).
   */
  const invoiceSentence = input.invoiceNote
    ? 'A számlát a Számlázz.hu rendszeréből külön e-mailben küldjük el.'
    : null

  let cta = {
    label: isMyCoursePlayerUrl(input.coursesUrl)
      ? ctaLabel('course-start')
      : ctaLabel('my-courses-open'),
    url: input.coursesUrl,
  }

  if (input.account?.kind === 'password-setup') {
    const account = input.account
    const identity = accountEmailBlock(account.email)
    // A vevő címének kiejtését nem ismerjük (betűzve vagy szóként mondja-e),
    // ezért itt a semleges „a(z)” marad; az ismert kapcsolati címnél a névelő
    // számolt (lásd `hatarozottNevelo`).
    const created =
      `A vásárláshoz fiókot készítettünk a(z) ${account.email} címmel. ` +
      'Már csak egy jelszót kell beállítanod, utána a kurzusod megnyílik.'
    const validity = `A jelszó-beállító link ${account.expiresInDays} napig érvényes, és személyre szól, ne add tovább senkinek.`
    const notWorking =
      'Ha a link lejárt vagy nem működik, a belépési oldal „Elfelejtett jelszó" gombjával bármikor ' +
      'kérhetsz újat, ugyanezzel az e-mail-címmel.'
    paragraphsHtml.push(
      identity.html,
      escapeHtml(created),
      `<strong>${escapeHtml(validity)}</strong>`,
      escapeHtml(notWorking),
    )
    paragraphsText.push(identity.text, created, validity, notWorking)
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

  const legal = legalParagraphs({
    withdrawalWaiver: input.withdrawalWaiver,
    withdrawalUrl: input.withdrawalUrl,
    seller: input.seller,
    terms: input.terms,
    supportEmail: input.supportEmail,
  })
  const attachment = input.terms?.attachment ?? null
  const support = input.supportEmail?.trim() || null

  // A szöveges változatban üres sor választja el a számla-mondatot a jogi
  // résztől, ahogy a jogi bekezdéseket is egymástól.
  const closingParagraphsHtml = [
    ...(invoiceSentence ? [escapeHtml(invoiceSentence)] : []),
    ...legal.html,
  ]
  const closingParagraphsText = [
    ...(invoiceSentence ? [invoiceSentence, ...(legal.text.length > 0 ? [''] : [])] : []),
    ...legal.text,
  ]

  return {
    subject: `Sikeres vásárlás: ${input.orderNumber}`,
    ...(attachment ? { attachments: [attachment] } : {}),
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
      closingParagraphsHtml,
      closingParagraphsText,
      // A kapcsolati címmel a levél megválaszolható: a Reply-To ez a cím (a
      // hívó teszi a fejlécbe), ezért a lábléc sem mondhatja, hogy ne
      // válaszolj. GOV.UK: „include a reference number and contact details
      // for your service if the user might need to contact you”; NN/g: a
      // hiányzó elérhetőség a tranzakciós levelek egyik fő kifogása („Lack of
      // contact information was another primary concern”).
      ...(support
        ? {
            footer: {
              reason: `Ezt a levelet azért kapod, mert a Kineticare oldalán vásároltál (rendelésszám: ${input.orderNumber}).`,
              replyNote: `Kérdésed vagy panaszod van? Válaszolj erre a levélre, vagy írj ${hatarozottNevelo(support)} ${support} címre.`,
            },
          }
        : {}),
    }),
  }
}
