import { budapestDateString } from '../../date/budapest'
import { formatPriceHuf } from '../../format-price'
import type { EmailTemplate } from '../types'
import { escapeHtml, renderLayout } from './layout'
import { hatarozottNevelo } from './order'

/**
 * Vevői értesítő a visszatérítésről (a-refund-6, K14).
 *
 * A visszatérítés után a vevő eddig legfeljebb a Számlázz.hu stornó-levelét
 * kapta; a kártyás jóváírás napokig is eltarthat, és a tájékozatlan vevő
 * visszaterhelést (chargeback) indít, ami a Barion-visszatérítés mellett dupla
 * kifizetést kockáztat. A levél a tényt, az összeget, a rendelésszámot, a
 * pénz útját (a fizetéskor használt kártyára vagy Barion-tárcába) és a
 * bizonylat forrását (Számlázz.hu) mondja el. Amit a rendszer nem tud
 * garantálni (a bank jóváírási ideje), azt nem ígéri: a 30 nap a türelmi
 * határ, amely után a vevő írjon nekünk (a kártyás jóváírás a kibocsátó
 * banktól függően „akár 30 nap” is lehet: oneticket.hu/card_refund_hu.html).
 *
 * Szerkezet: elöl a lényeg (mi történt, mennyi, melyik rendelés), utána a
 * kiegészítő tudnivaló (hozzáférés, bizonylat, mikor írjon). NN/g,
 * Transactional and Confirmation Email: „start with the information that
 * matters most to users in the transaction context”
 * (https://www.nngroup.com/articles/transactional-and-confirmation-email/).
 * GOV.UK, Sending emails and text messages: a levél adja meg a hivatkozási
 * számot és az elérhetőséget
 * (https://www.gov.uk/service-manual/design/sending-emails-and-text-messages).
 * A kapcsolati cím a válaszcím és a lábléc is (K14), így a levél
 * megválaszolható. Nyelv: docs/ui-sztenderdek.md 3.1 (natív magyar, töltelék
 * gondolatjel nélkül, „” idézőjel).
 */

/**
 * A sablon változata a küldés bizonyítékához (műveletnapló). Érdemi
 * szövegváltozásnál léptetni kell.
 */
export const REFUND_NOTICE_TEMPLATE_VERSION = '2026-09-24.1'

/** A visszatérítés fajtája a vevő szemszögéből. */
export type RefundNoticeKind =
  /** Kifizetett rendelés teljes visszatérítése: a hozzáférés megszűnik. */
  | 'full'
  /** Kifizetett rendelés részleges visszatérítése: a hozzáférés megmarad. */
  | 'partial'
  /** A rendszer nem fogadta el a rendelést (pl. dupla vásárlás), a teljes összeg visszajár. */
  | 'order-not-accepted'

/**
 * Mi lett a rendeléshez kötött hozzáféréssel teljes visszatérítésnél. A
 * hozzáférés-rendezés (access-store.ts) megtartja, ami más kifizetett
 * rendelés vagy önálló (ajándék, átállás) jogosultság alapján jár, ezért a
 * levél csak azt mondja, ami biztosan igaz.
 */
export type RefundNoticeAccess = 'revoked' | 'kept' | 'mixed'

/** A bizonylat, amelyet a Számlázz.hu külön levélben küld. */
export type RefundNoticeDocument = 'storno' | 'corrective' | 'none'

export interface RefundNoticeInput {
  orderNumber: string
  buyerName?: string | null
  amountHuf: number
  /** A visszatérítés pillanata (ISO); a levél a budapesti naptári napot írja. */
  refundedAt: string
  kind: RefundNoticeKind
  /** Teljes visszatérítésnél a hozzáférés sorsa; más fajtánál nem számít. */
  access?: RefundNoticeAccess
  /** A rendelés kurzusainak neve (a vevőnek látható cím). */
  courseTitles: readonly string[]
  document: RefundNoticeDocument
  /** A vevő kérdéseinek hivatalos címe (K14); a hívó a válaszcímbe is teszi. */
  supportEmail: string
}

/** „2026. 09. 05.” alak a budapesti naptári napból; hibás időbélyegnél null. */
function refundDay(iso: string): string | null {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  const [year, month, day] = budapestDateString(date).split('-')
  return `${year}. ${month}. ${day}.`
}

/** Kurzusnevek felsorolása idézőjelben („A”, „B” és „C”). */
function courseList(titles: readonly string[]): string {
  const quoted = titles.map((title) => `„${title.trim()}”`)
  if (quoted.length <= 1) return quoted[0] ?? ''
  return `${quoted.slice(0, -1).join(', ')} és ${quoted[quoted.length - 1]}`
}

function accessSentence(input: RefundNoticeInput): string | null {
  const titles = input.courseTitles.filter((title) => title.trim().length > 0)
  const named = titles.length > 0 ? `${courseList(titles)} kurzushoz` : 'a kurzushoz'
  switch (input.kind) {
    case 'partial':
      return `A ${named} tartozó hozzáférésed megmarad.`
    case 'order-not-accepted':
      return 'Ebből a rendelésből nem jött létre kurzushozzáférés. Ha egy korábbi vásárlásodból már van hozzáférésed, az változatlanul megmarad.'
    default:
      break
  }
  switch (input.access ?? 'revoked') {
    case 'kept':
      return `A ${named} tartozó hozzáférésed megmarad, mert az más vásárlásod vagy jogosultságod alapján jár.`
    case 'mixed':
      return `A rendeléshez kötött kurzushozzáférésed a visszatérítéssel megszűnt; ami más vásárlásod vagy jogosultságod alapján jár, az megmarad.`
    default:
      return `A ${named} tartozó hozzáférésed a visszatérítéssel megszűnt.`
  }
}

function documentSentence(document: RefundNoticeDocument): string | null {
  switch (document) {
    case 'storno':
      return 'A számládat érvénytelenítő stornószámlát a Számlázz.hu külön e-mailben küldi el.'
    case 'corrective':
      return 'A helyesbítő számlát a Számlázz.hu külön e-mailben küldi el.'
    default:
      return null
  }
}

export function refundNoticeEmail(input: RefundNoticeInput): EmailTemplate {
  const greeting = input.buyerName?.trim() ? `Kedves ${input.buyerName.trim()}!` : 'Szia!'
  const amount = formatPriceHuf(input.amountHuf)
  const day = refundDay(input.refundedAt)
  const when = day ? ` ${day} napon` : ''
  const support = input.supportEmail.trim()

  const lead =
    input.kind === 'order-not-accepted'
      ? `A ${input.orderNumber} rendelésedet nem tudtuk teljesíteni, ezért a kifizetett ${amount} összeget${when} visszatérítettük.`
      : input.kind === 'partial'
        ? `A ${input.orderNumber} rendelésedből ${amount} összeget${when} visszatérítettünk.`
        : `A ${input.orderNumber} rendelésed ${amount} összegét${when} visszatérítettük.`
  // A pénz útja: a Barion arra a fizetési eszközre írja jóvá, amellyel a vevő
  // fizetett (Payment-Refund-v2). A bank jóváírási idejét nem ígérjük.
  const route =
    'Az összeg a Barionon keresztül arra a bankkártyára vagy Barion-tárcába érkezik, amellyel fizettél. Bankkártyás fizetésnél a jóváírás ideje a kártyát kibocsátó banktól függ.'
  const paragraphs = [greeting, lead, route]
  const closing = [
    accessSentence(input),
    documentSentence(input.document),
    `Ha 30 nap múlva sem látod a jóváírást, írj nekünk ${hatarozottNevelo(support)} ${support} címre, és add meg a rendelésszámot is.`,
  ].filter((sentence): sentence is string => sentence !== null)

  const summary = {
    rows: [
      { label: 'Rendelésszám', value: input.orderNumber },
      { label: 'Visszatérített összeg', value: amount },
      ...(day ? [{ label: 'Visszatérítés napja', value: day }] : []),
    ],
  }

  return {
    subject: `Visszatérítés: ${input.orderNumber}`,
    ...renderLayout({
      preheader: `A ${input.orderNumber} rendeléshez ${amount} összeget visszatérítettünk.`,
      eyebrow: 'Visszatérítés',
      heading:
        input.kind === 'partial' ? 'Részleges visszatérítés' : 'Visszatérítettük az összeget',
      paragraphsHtml: paragraphs.map(escapeHtml),
      paragraphsText: paragraphs,
      summary,
      closingParagraphsHtml: closing.map(escapeHtml),
      closingParagraphsText: closing,
      footer: {
        reason: `Ezt a levelet azért kapod, mert a Kineticare oldalán leadott rendelésedhez visszatérítés történt (rendelésszám: ${input.orderNumber}).`,
        replyNote: `Kérdésed van? Válaszolj erre a levélre, vagy írj ${hatarozottNevelo(support)} ${support} címre.`,
      },
    }),
  }
}
