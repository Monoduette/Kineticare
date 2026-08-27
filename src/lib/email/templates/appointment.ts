import type { EmailTemplate } from '../types'

import { escapeHtml, renderLayout } from './layout'

/**
 * Stáb értesítő + beküldő visszaigazoló sablonok. Külön a contactStaff-től (hívandó workflow).
 * Visszaigazoló: korábban hiányzott; nincs CTA gomb; panasz csak ha megadta (GDPR).
 */
export function appointmentCustomerEmail(input: {
  name: string
  phone: string
  availability: string
  /** A /kapcsolat lap abszolút URL-je (elérhetőségek). Üresen a link kimarad. */
  contactUrl?: string
}): EmailTemplate {
  const name = input.name.trim()
  const greeting = name ? `Kedves ${name}!` : 'Szia!'

  const mit =
    'Megkaptuk az időpontkérésed. Ez még nem foglalás: két munkanapon belül ' +
    'telefonon keresünk, és közösen egyeztetjük a pontos időpontot.'
  const elso = 'Az első alkalom minden esetben 50 perces vizsgálattal kezdődik.'
  const contactUrl = input.contactUrl?.trim()
  const haValtozik = contactUrl
    ? 'Ha közben bármi változna, vagy nem érnénk el telefonon, a rendelőink telefonszámait a kapcsolat oldalon találod.'
    : 'Ha közben bármi változna, vagy nem érnénk el telefonon, keress minket a rendelőink telefonszámain.'

  const rows: Array<[string, string]> = [
    ['Név', name],
    ['Telefonszám', input.phone],
    ['Mikor alkalmas', input.availability],
  ].filter((row): row is [string, string] => row[1].trim().length > 0)

  return {
    subject: 'Megkaptuk az időpontkérésed: Kineticare',
    ...renderLayout({
      preheader: 'Két munkanapon belül telefonon keresünk a pontos időpontért.',
      eyebrow: 'Időpontkérés',
      heading: 'Megkaptuk az időpontkérésed',
      paragraphsHtml: [
        escapeHtml(greeting),
        escapeHtml(mit),
        escapeHtml(elso),
        contactUrl
          ? `Ha közben bármi változna, vagy nem érnénk el telefonon, a rendelőink telefonszámait a <a href="${escapeHtml(contactUrl)}" style="color:#2f6e9f;">kapcsolat oldalon</a> találod.`
          : escapeHtml(haValtozik),
      ],
      paragraphsText: [
        greeting,
        mit,
        elso,
        contactUrl ? `${haValtozik} ${contactUrl}` : haValtozik,
      ],
      ...(rows.length > 0
        ? {
            summary: {
              title: 'Amit megadtál',
              rows: rows.map(([label, value]) => ({ label, value })),
            },
          }
        : {}),
      note: 'Ha nem te kérted ezt az időpontot, hagyd figyelmen kívül ezt a levelet, és nem keresünk.',
    }),
  }
}

export function appointmentStaffEmail(input: {
  name: string
  phone: string
  email: string
  availability: string
  reason: string
  submittedAt: string
}): EmailTemplate {
  const rows: Array<[string, string]> = [
    ['Név', input.name],
    ['Telefon', input.phone],
    ['E-mail', input.email],
    ['Mikor alkalmas', input.availability],
    ['Beküldve', input.submittedAt],
  ].filter((row): row is [string, string] => row[1].trim().length > 0)

  const reason = input.reason.trim()

  return {
    subject: `Új időpontkérés: ${input.name} (${input.phone})`,
    ...renderLayout({
      heading: 'Új időpontkérés érkezett',
      paragraphsHtml: [
        ...rows.map(([label, value]) => `<strong>${label}:</strong> ${escapeHtml(value)}`),
        ...(reason.length > 0
          ? [
              `<strong>Mire kér időpontot:</strong><br />${escapeHtml(reason).replace(/\n/g, '<br />')}`,
            ]
          : []),
      ],
      paragraphsText: [
        ...rows.map(([label, value]) => `${label}: ${value}`),
        ...(reason.length > 0 ? ['', 'Mire kér időpontot:', reason] : []),
      ],
    }),
  }
}
