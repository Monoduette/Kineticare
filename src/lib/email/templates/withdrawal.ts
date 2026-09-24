import type { EmailTemplate } from '../types'

import { WITHDRAWAL_STATEMENT } from '../../withdrawal/client'
import { escapeHtml, inlineLinkHtml, renderLayout } from './layout'
import { hatarozottNevelo } from './order'

/**
 * Az elállási funkció két levele (45/2014. Korm. rendelet 22. § (1c)).
 *
 * 1. ÁTVÉTELI ELISMERVÉNY a fogyasztónak, tartós adathordozón (e-mail): „az
 *    elállás tartalmát, valamint a megküldés napját és időpontját” tartalmazza.
 *    A tartalom a beküldött nyilatkozat szó szerint (név, rendelés, e-mail-cím),
 *    a két időpont budapesti idő szerint áll benne. A lábléc a K14 szerinti
 *    hivatalos címre terel, a válaszcím is az (a hívó teszi a fejlécbe).
 * 2. STÁB-ÉRTESÍTŐ: a teendő (a rendelés azonosítása, a visszatérítés) és a
 *    23. § (1) szerinti 14 napos határidő.
 *
 * A levél hangja a többi tranzakciós levélé: elöl a tény és az adatok, utána a
 * következő lépés (NN/g, Transactional and Confirmation Email:
 * https://www.nngroup.com/articles/transactional-and-confirmation-email/),
 * hivatkozási számmal és elérhetőséggel (GOV.UK, Sending emails and text
 * messages: https://www.gov.uk/service-manual/design/sending-emails-and-text-messages).
 * A nyilatkozat szövege a vevő szavait visszhangozza, ezért minden érték
 * escape-elve kerül a HTML-be (a váz a summary-sorokat maga escape-eli).
 */

export interface WithdrawalMailInput {
  name: string
  orderReference: string
  email: string
  /** A nyilatkozat beérkezése, budapesti idő szerint formázva („2026. 09. 24. 14:05”). */
  receivedAt: string
  /** A nyilatkozat azonosítója (a levelezésben erre lehet hivatkozni). */
  reference: string
}

function summaryRows(input: WithdrawalMailInput): Array<{ label: string; value: string }> {
  return [
    { label: 'Nyilatkozat', value: WITHDRAWAL_STATEMENT },
    { label: 'Név', value: input.name },
    { label: 'Rendelés', value: input.orderReference },
    { label: 'E-mail-cím', value: input.email },
    { label: 'Beérkezett', value: input.receivedAt },
    { label: 'Azonosító', value: input.reference },
  ]
}

export function withdrawalReceiptEmail(
  input: WithdrawalMailInput & {
    /** Az elismervény elküldésének időpontja, budapesti idő szerint. */
    sentAt: string
    /** A hivatalos kapcsolati cím (K14). */
    supportEmail: string
    /** Az ÁSZF abszolút webcíme; üresen a mondat link nélkül áll. */
    termsUrl?: string | null
  },
): EmailTemplate {
  const greeting = `Kedves ${input.name}!`
  const intro =
    'Ezzel a levéllel igazoljuk, hogy megkaptuk az elállási nyilatkozatodat. ' +
    'A nyilatkozatod tartalmát alább olvashatod.'
  const sent = `Ezt az átvételi elismervényt ${input.sentAt}-kor küldtük el.`
  const next =
    'Munkatársunk azonosítja a rendelésedet. Ha az elállás érvényes, a kifizetett összeget a ' +
    'nyilatkozatod beérkezésétől számított 14 napon belül visszatérítjük, ugyanazzal a fizetési ' +
    'móddal, amellyel fizettél.'
  const terms = input.termsUrl?.trim() || null
  const termsText = 'Az elállási jog feltételeit az ÁSZF tartalmazza'
  const support = input.supportEmail

  return {
    subject: 'Átvételi elismervény az elállási nyilatkozatodról',
    ...renderLayout({
      preheader: 'Megkaptuk az elállási nyilatkozatodat.',
      eyebrow: 'Átvételi elismervény',
      heading: 'Megkaptuk az elállási nyilatkozatodat',
      paragraphsHtml: [escapeHtml(greeting), escapeHtml(intro)],
      paragraphsText: [greeting, intro],
      summary: { title: 'A nyilatkozatod', rows: summaryRows(input) },
      closingParagraphsHtml: [
        `<strong>${escapeHtml(sent)}</strong>`,
        escapeHtml(next),
        terms ? `${escapeHtml(termsText)}: ${inlineLinkHtml(terms)}` : `${escapeHtml(termsText)}.`,
      ],
      closingParagraphsText: [
        sent,
        '',
        next,
        '',
        terms ? `${termsText}: ${terms}` : `${termsText}.`,
      ],
      footer: {
        reason:
          'Ezt a levelet azért kapod, mert a Kineticare oldalán elállási nyilatkozatot küldtél.',
        replyNote: `Kérdésed vagy panaszod van? Válaszolj erre a levélre, vagy írj ${hatarozottNevelo(support)} ${support} címre.`,
      },
    }),
  }
}

export function withdrawalStaffEmail(
  input: WithdrawalMailInput & {
    /**
     * A 23. § (1) szerinti visszatérítési határidő napja, ZÁRÓ PONT NÉLKÜL
     * („2026. 10. 08”), mert a „-ig” rag a nap utáni pont helyére kerül
     * („2026. 10. 08-ig”).
     */
    refundDeadline: string
    /** A rendelés, ha a rendelésszám alapján megtaláltuk. */
    order: { orderNumber: string; status: string | null; emailMatches: boolean } | null
    /** Kiment-e az elismervény a vevőnek. */
    receiptSent: boolean
  },
): EmailTemplate {
  const orderLine = input.order
    ? `A rendelés megvan: ${input.order.orderNumber}, állapota: ${input.order.status ?? 'ismeretlen'}. ` +
      (input.order.emailMatches
        ? 'A megadott e-mail-cím egyezik a rendelésével.'
        : 'A megadott e-mail-cím NEM egyezik a rendelésével, ellenőrizd, ki küldte.')
    : 'A megadott adat alapján a rendelést nem találtuk meg automatikusan, keresd meg kézzel.'
  const receiptLine = input.receiptSent
    ? 'Az átvételi elismervény kiment a vevőnek.'
    : 'Az átvételi elismervényt NEM sikerült elküldeni a vevőnek: küldd el kézzel, még ma.'
  const todo =
    `Teendő: ha az elállás érvényes, a visszatérítést legkésőbb ${input.refundDeadline}-ig ` +
    'indítsd el a Kineticare adminból (45/2014. Korm. rendelet 23. § (1)). Ha nem érvényes, ' +
    'írd meg a vevőnek az okát.'

  return {
    subject: `Elállási nyilatkozat érkezett: ${input.orderReference}`,
    ...renderLayout({
      eyebrow: 'Elállás',
      heading: 'Elállási nyilatkozat érkezett',
      paragraphsHtml: [escapeHtml(orderLine), escapeHtml(receiptLine)],
      paragraphsText: [orderLine, receiptLine],
      summary: { title: 'A nyilatkozat', rows: summaryRows(input) },
      closingParagraphsHtml: [`<strong>${escapeHtml(todo)}</strong>`],
      closingParagraphsText: [todo],
    }),
  }
}
