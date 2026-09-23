import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Payload } from 'payload'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Page } from '../payload-types'

/**
 * ŐR — A KAPCSOLATI E-MAIL EGY FORRÁSBÓL (modul-térkép H18/A10, H46).
 *
 * A cím a /kapcsolat oldal első LÁTHATÓ Időpontkérő szekciójának E-mail-cím
 * mezője, hibatűrő kódtartalékkal (src/lib/contact-email.ts). A teszt:
 *  1. a tiszta feloldó szabályait (rejtett szekció, üres és hibás mező);
 *  2. a szerveroldali lekérdezést mockolt Payloaddal (valódi adatbázis és
 *     hálózat nélkül; a `fetch` hangosan dob, CLAUDE.md 15. tanulság);
 *  3. hogy EGY eltérő CMS-címmel MINDEN fogyasztó az új címet adja (lábléc,
 *     (frontend) 404, Organization, Kapcsolat-lap, llms.txt, llms-full.txt,
 *     az átállási levél Reply-To-ja), a global-not-found pedig a tartalékot;
 *  4. hogy mai adatokkal a kimenet betűre a korábbi;
 *  5. forrás-pásztázással, hogy a tartalék-literál csak egy helyen áll.
 */

const h = vi.hoisted(() => ({
  /** A mockolt Payload `pages` válasza (a Kapcsolat-oldal szekciósora). */
  kapcsolatOldal: null as { layout?: unknown } | null,
  /** Ha nem null, a `find` ezzel a hibával dob (adatbázis-hiba). */
  findHiba: null as Error | null,
  /** Ha igaz, a `getPayload` maga dob (nincs adatbázis). */
  payloadHiba: false,
  findHivasok: [] as unknown[],
  warn: [] as { msg: string; context?: unknown }[],
}))

vi.mock('../lib/logger', () => {
  const naplo = {
    debug: () => undefined,
    info: () => undefined,
    warn: (msg: string, context?: unknown) => {
      h.warn.push({ msg, context })
    },
    error: () => undefined,
    child: () => naplo,
  }
  return { logger: naplo, createLogger: () => naplo }
})

/** A Payload helyi API-jának az a szelete, amit a feloldó és a kiküldő használ. */
function hamisPayload(): Payload {
  return {
    find: async (args: { collection: string }) => {
      if (args.collection !== 'pages') {
        throw new Error(`váratlan gyűjtemény: ${args.collection}`)
      }
      h.findHivasok.push(args)
      if (h.findHiba) throw h.findHiba
      return { docs: h.kapcsolatOldal ? [h.kapcsolatOldal] : [] }
    },
    update: async () => ({}),
  } as unknown as Payload
}

vi.mock('payload', () => ({
  getPayload: async () => {
    if (h.payloadHiba) throw new Error('nincs adatbázis (teszt)')
    return hamisPayload()
  },
}))
vi.mock('../payload.config', () => ({ default: {} }))
vi.mock('next/navigation', () => ({ usePathname: () => '/' }))
vi.mock('../components/layout/NewsletterSignup', () => ({ NewsletterSignup: () => null }))
vi.mock('@/lib/tudastar-lathatosag', () => ({ getTudastarLathato: async () => true }))

const {
  KAPCSOLAT_OLDAL_WEBCIM,
  KAPCSOLATI_EMAIL_TARTALEK,
  ervenyesKapcsolatiEmail,
  feloldottKapcsolatiEmail,
  kapcsolatiEmailLayoutbol,
} = await import('../lib/contact-email')
const { getContactEmail, kapcsolatiEmailPayloadbol } = await import('../lib/contact-email-server')
const { Footer, FeloldottFooter } = await import('../components/layout/Footer')
const NotFound = (await import('../app/(frontend)/not-found')).default
const GlobalNotFound = (await import('../app/global-not-found')).default
const { CONTACT_EMAIL, organizationJsonLd, organizationNode } = await import('../lib/seo')
const { contactDataFromLayout, contactOrganizationNode, medicalBusinessNodes, siteGraphJsonLd } =
  await import('../lib/seo-graph')
const { buildLlmsFullTxt, buildLlmsTxt } = await import('../lib/seo-llms')
const { migrationNoticeEmail } = await import('../lib/email/templates/migration')
const { sendMigrationNotices } = await import('../lib/migration-notice/send')

const UJ_CIM = 'rendelo@pelda-kineticare.hu'

/** Egy Időpontkérő blokk a Kapcsolat-oldal szekciósorából. */
function idopontkero(email: unknown, rejtett = false): Record<string, unknown> {
  return {
    blockType: 'appointment',
    title: 'Kérj időpontot a rendelőbe',
    helyszinek: [{ cim: '1117 Budapest, Nádorliget u. 7/b' }],
    telefonszamok: [{ nev: 'Kocsis Kata', szam: '+36 30 169 2263' }],
    email,
    ...(rejtett ? { sectionSettings: { visible: false } } : {}),
  }
}

const kapcsolatLayout = (email: unknown) =>
  [idopontkero(email)] as unknown as NonNullable<Page['layout']>

/** A Kapcsolat-oldal az llms-bemenet alakjában. */
function kapcsolatOldal(email: unknown) {
  return {
    title: 'Kapcsolat',
    slug: KAPCSOLAT_OLDAL_WEBCIM,
    excerpt: null,
    updatedAt: '2026-09-20T10:00:00.000Z',
    layout: kapcsolatLayout(email),
  }
}

beforeEach(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('A tesztből SOSEM mehet ki valódi hálózati hívás.')
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  h.kapcsolatOldal = null
  h.findHiba = null
  h.payloadHiba = false
  h.findHivasok.length = 0
  h.warn.length = 0
})

describe('1. a tiszta feloldó', () => {
  it('az első látható Időpontkérő trimmelt e-mailje', () => {
    expect(kapcsolatiEmailLayoutbol([idopontkero(`  ${UJ_CIM}  `)])).toBe(UJ_CIM)
    expect(feloldottKapcsolatiEmail([idopontkero(UJ_CIM)])).toBe(UJ_CIM)
  })

  it('a rejtett Időpontkérő nem forrás; a következő látható igen', () => {
    expect(kapcsolatiEmailLayoutbol([idopontkero(UJ_CIM, true)])).toBeNull()
    expect(
      kapcsolatiEmailLayoutbol([idopontkero('rejtett@pelda.hu', true), idopontkero(UJ_CIM)]),
    ).toBe(UJ_CIM)
    // Csak a kifejezett `visible: false` rejt, ahogy a lapon.
    expect(
      kapcsolatiEmailLayoutbol([{ ...idopontkero(UJ_CIM), sectionSettings: { visible: true } }]),
    ).toBe(UJ_CIM)
  })

  it('az első látható Időpontkérő üres mezőjénél NEM lép tovább a másodikra', () => {
    expect(kapcsolatiEmailLayoutbol([idopontkero(''), idopontkero(UJ_CIM)])).toBeNull()
  })

  it('üres, hiányzó vagy hibás alakú mező → null, a feloldott érték a tartalék', () => {
    const hibasak: unknown[] = [
      '',
      '   ',
      null,
      undefined,
      42,
      'info',
      'info@',
      '@kineticare.hu',
      'info@localhost',
      'két szó@pelda.hu',
      'a@b@pelda.hu',
      `${UJ_CIM}?subject=hamis`,
      `${UJ_CIM}#horgony`,
      'info%40pelda.hu@pelda.hu',
      `${'a'.repeat(250)}@pelda.hu`,
      '<script>@pelda.hu',
    ]
    for (const ertek of hibasak) {
      expect(kapcsolatiEmailLayoutbol([idopontkero(ertek)]), String(ertek)).toBeNull()
      expect(feloldottKapcsolatiEmail([idopontkero(ertek)])).toBe(KAPCSOLATI_EMAIL_TARTALEK)
    }
  })

  it('nem tömb, nincs Időpontkérő vagy furcsa elem → tartalék', () => {
    for (const layout of [null, undefined, {}, 'x', [], [null, 7, 'x'], [{ blockType: 'faq' }]]) {
      expect(feloldottKapcsolatiEmail(layout)).toBe(KAPCSOLATI_EMAIL_TARTALEK)
    }
  })

  it('a formai ellenőrzés a valódi címeket elfogadja', () => {
    for (const cim of [KAPCSOLATI_EMAIL_TARTALEK, UJ_CIM, 'kata.kiss+rendelo@pelda.co.hu']) {
      expect(ervenyesKapcsolatiEmail(cim), cim).toBe(true)
    }
  })
})

describe('2. a szerveroldali feloldó (mockolt Payload, adatbázis nélkül)', () => {
  it('a KÖZZÉTETT Kapcsolat-oldal szekciósorát kéri, egy sorral, reláció nélkül', async () => {
    h.kapcsolatOldal = { layout: kapcsolatLayout(UJ_CIM) }
    expect(await kapcsolatiEmailPayloadbol(hamisPayload())).toBe(UJ_CIM)
    expect(h.findHivasok).toEqual([
      {
        collection: 'pages',
        where: {
          and: [{ slug: { equals: KAPCSOLAT_OLDAL_WEBCIM } }, { status: { equals: 'published' } }],
        },
        draft: false,
        depth: 0,
        limit: 1,
        overrideAccess: true,
        select: { layout: true },
      },
    ])
    expect(h.warn).toEqual([])
  })

  it.each([
    ['nincs közzétett Kapcsolat-oldal', null],
    ['rejtett Időpontkérő', { layout: [idopontkero(UJ_CIM, true)] }],
    ['üres mező', { layout: kapcsolatLayout('') }],
    ['hibás alakú mező', { layout: kapcsolatLayout('nem-email-cim') }],
  ])('%s → tartalék + logger.warn', async (_nev, oldal) => {
    h.kapcsolatOldal = oldal
    expect(await kapcsolatiEmailPayloadbol(hamisPayload())).toBe(KAPCSOLATI_EMAIL_TARTALEK)
    expect(h.warn).toHaveLength(1)
  })

  it('adatbázis-hiba → tartalék + logger.warn, kivétel nem szökik ki', async () => {
    h.findHiba = new Error('kapcsolat megszakadt (teszt)')
    await expect(kapcsolatiEmailPayloadbol(hamisPayload())).resolves.toBe(KAPCSOLATI_EMAIL_TARTALEK)
    expect(h.warn).toHaveLength(1)
    expect(JSON.stringify(h.warn[0]?.context)).toContain('kapcsolat megszakadt')
  })

  it('a getContactEmail a Payloadot lustán tölti, és hibánál is csak tartalékot ad', async () => {
    h.kapcsolatOldal = { layout: kapcsolatLayout(UJ_CIM) }
    expect(await getContactEmail()).toBe(UJ_CIM)
    h.payloadHiba = true
    await expect(getContactEmail()).resolves.toBe(KAPCSOLATI_EMAIL_TARTALEK)
    expect(h.warn.length).toBeGreaterThanOrEqual(1)
  })

  it('kérésenként legfeljebb egy lekérdezés: a getContactEmail React `cache`-be burkolt', () => {
    // A React `cache` csak szerver-komponens renderelésén belül memoizál
    // (https://react.dev/reference/react/cache); ezen kívül, így ebben a
    // Node-tesztben is, átengedő. Ezért a memoizálást a forrásból igazoljuk:
    // a lábléc, a 404 és a lap JSON-LD-je ugyanazt a `cache`-elt függvényt
    // hívja, és a modul nem használ tartós (`unstable_cache`) gyorsítótárat.
    const forras = readFileSync(
      fileURLToPath(new URL('../lib/contact-email-server.ts', import.meta.url)),
      'utf8',
    )
    expect(forras).toContain("import { cache } from 'react'")
    expect(forras).toMatch(/export const getContactEmail = cache\(async \(\): Promise<string> =>/)
    expect(forras).not.toMatch(/import\s*\{[^}]*unstable_cache/)
  })
})

describe('3. eltérő CMS-címmel minden fogyasztó az új címet adja', () => {
  beforeEach(() => {
    h.kapcsolatOldal = { layout: kapcsolatLayout(UJ_CIM) }
  })

  it('lábléc: a feloldott cím a mailto-linkben és a szövegben', async () => {
    const markup = renderToStaticMarkup(await FeloldottFooter())
    expect(markup).toContain(`<a href="mailto:${UJ_CIM}">${UJ_CIM}</a>`)
    expect(markup).not.toContain(KAPCSOLATI_EMAIL_TARTALEK)
  })

  it('(frontend) 404: az új cím; global-not-found: a tartalék', async () => {
    const frontend = renderToStaticMarkup(await NotFound())
    expect(frontend).toContain(`href="mailto:${UJ_CIM}"`)
    expect(frontend).not.toContain(KAPCSOLATI_EMAIL_TARTALEK)
    const globalis = renderToStaticMarkup(createElement(GlobalNotFound))
    expect(globalis).toContain(`href="mailto:${KAPCSOLATI_EMAIL_TARTALEK}"`)
  })

  it('Organization: az e-mail és a customer service ContactPoint e-mailje', async () => {
    const graf = siteGraphJsonLd({
      page: { path: '/rolunk', name: 'Rólunk' },
      contactEmail: await getContactEmail(),
    })
    const szervezet = (graf['@graph'] as Record<string, unknown>[])[0]!
    expect(szervezet['@type']).toBe('Organization')
    expect(szervezet.email).toBe(UJ_CIM)
    expect(szervezet.contactPoint).toEqual([
      expect.objectContaining({ contactType: 'customer service', email: UJ_CIM }),
    ])
    expect(organizationJsonLd(UJ_CIM).email).toBe(UJ_CIM)
    expect(organizationNode({ email: UJ_CIM, founder: [] }).email).toBe(UJ_CIM)
  })

  it('Kapcsolat-lap: a szervezet és a MedicalBusiness csomópontok az új címet viszik', () => {
    const contact = contactDataFromLayout(kapcsolatLayout(UJ_CIM))
    expect(contact.email).toBe(UJ_CIM)
    for (const node of medicalBusinessNodes(contact)) {
      expect(node.email).toBe(UJ_CIM)
    }
    const org = contactOrganizationNode(contact, KAPCSOLATI_EMAIL_TARTALEK)
    expect(org.email).toBe(UJ_CIM)
    // Ha a lap Időpontkérője üres, a közös feloldó címe jön, végül a tartalék.
    const ures = contactDataFromLayout(kapcsolatLayout(''))
    expect(contactOrganizationNode(ures, UJ_CIM).email).toBe(UJ_CIM)
    expect(contactOrganizationNode(ures).email).toBe(KAPCSOLATI_EMAIL_TARTALEK)
    expect(medicalBusinessNodes(ures).some((node) => 'email' in node)).toBe(false)
  })

  it('a lap JSON-LD-jének szervezete és a lábléc ugyanazt a címet adja', async () => {
    const graf = siteGraphJsonLd({
      page: { path: '/', name: 'Kezdőlap' },
      contactEmail: await getContactEmail(),
    })
    const szervezet = (graf['@graph'] as Record<string, unknown>[])[0]!
    expect(renderToStaticMarkup(await FeloldottFooter())).toContain(
      `mailto:${String(szervezet.email)}`,
    )
  })

  it('llms.txt és llms-full.txt: a Kapcsolat-oldal rekordjából', () => {
    const forras = { pages: [kapcsolatOldal(UJ_CIM)], posts: [], products: [] }
    const llms = buildLlmsTxt(forras)
    expect(llms).toContain(`Kapcsolat: ${UJ_CIM}.`)
    expect(llms).toContain(`Időpontkérés és elérhetőségek, e-mail: ${UJ_CIM}`)
    expect(llms).not.toContain(KAPCSOLATI_EMAIL_TARTALEK)
    const teljes = buildLlmsFullTxt(forras)
    expect(teljes).toContain(`Kapcsolat: ${UJ_CIM}`)
    expect(teljes).not.toContain(KAPCSOLATI_EMAIL_TARTALEK)
    // Kapcsolat-oldal nélkül (vagy rejtett Időpontkérővel) a tartalék.
    expect(buildLlmsTxt({ pages: [], posts: [], products: [] })).toContain(
      `Kapcsolat: ${KAPCSOLATI_EMAIL_TARTALEK}.`,
    )
  })

  it('átállási levél: a Reply-To és a lábléc-mondat a futás elején egyszer feloldott cím', async () => {
    const kuldesek: { replyTo?: string; text: string }[] = []
    const eredmeny = await sendMigrationNotices(
      hamisPayload(),
      [
        { id: 1, email: 'a@example.com', name: 'A', sentAt: null, hasAccess: true },
        { id: 2, email: 'b@example.com', name: 'B', sentAt: null, hasAccess: true },
      ],
      {
        serverUrl: 'https://kineticare.example.com',
        send: async (input) => {
          kuldesek.push({ replyTo: input.replyTo, text: input.text })
          return { ok: true, provider: 'resend', id: 'x' }
        },
        sleep: async () => undefined,
      },
    )
    expect(eredmeny.summary.elkuldve).toBe(2)
    expect(kuldesek.map((kuldes) => kuldes.replyTo)).toEqual([UJ_CIM, UJ_CIM])
    for (const kuldes of kuldesek) {
      expect(kuldes.text).toContain(`vagy írj a(z) ${UJ_CIM} címre.`)
    }
    // Két címzett, egy lekérdezés.
    expect(h.findHivasok).toHaveLength(1)
  })
})

describe('4. mai adatokkal a kimenet betűre a korábbi', () => {
  // A mai élő érték: a /kapcsolat Időpontkérőjének E-mail-címe = a tartalék.
  const MAI = 'info@kineticare.hu'

  it('a mai CMS-érték és a tartalék ugyanaz, a régi név is erre mutat', () => {
    expect(KAPCSOLATI_EMAIL_TARTALEK).toBe(MAI)
    expect(CONTACT_EMAIL).toBe(MAI)
  })

  it('lábléc és 404: ugyanaz a markup, mint a korábbi kódkonstanssal', async () => {
    h.kapcsolatOldal = { layout: kapcsolatLayout(MAI) }
    const regi = `<li class="kc-site-footer__contact">Kapcsolat: <a href="mailto:${MAI}">${MAI}</a></li>`
    expect(renderToStaticMarkup(await FeloldottFooter())).toContain(regi)
    expect(renderToStaticMarkup(createElement(Footer))).toBe(
      renderToStaticMarkup(await FeloldottFooter()),
    )
    expect(renderToStaticMarkup(await NotFound())).toContain(
      `Nem találod, amit kerestél? Írj a <a href="mailto:${MAI}">${MAI}</a> címre.`,
    )
  })

  it('JSON-LD és llms: a korábbi szöveg', () => {
    expect(organizationNode().email).toBe(MAI)
    expect(siteGraphJsonLd({ page: { path: '/x', name: 'X' }, contactEmail: MAI })).toEqual(
      siteGraphJsonLd({ page: { path: '/x', name: 'X' } }),
    )
    const llms = buildLlmsTxt({ pages: [kapcsolatOldal(MAI)], posts: [], products: [] })
    expect(llms).toContain(`A cikkek és a kurzusok magyar nyelvűek. Kapcsolat: ${MAI}.`)
    expect(migrationNoticeEmail({ email: 'x@example.com', serverUrl: 'https://k.hu' }).text).toBe(
      migrationNoticeEmail({ email: 'x@example.com', serverUrl: 'https://k.hu', replyTo: MAI })
        .text,
    )
  })
})

describe('5. forrás-pásztázás: a tartalék-literál egyetlen helyen áll', () => {
  const SRC = fileURLToPath(new URL('..', import.meta.url))
  /**
   * Kivétel indoklással: a restore-legacy-content.ts az Időpontkérő
   * seed-ADATA (maga a CMS-érték, amit a feloldó olvas), nem kódtartalék.
   */
  const ENGEDETT = new Set(['lib/contact-email.ts', 'scripts/restore-legacy-content.ts'])

  function fajlok(konyvtar: string): string[] {
    return readdirSync(konyvtar).flatMap((nev) => {
      const ut = join(konyvtar, nev)
      if (statSync(ut).isDirectory()) return nev === '__tests__' ? [] : fajlok(ut)
      return /\.(ts|tsx)$/.test(nev) ? [ut] : []
    })
  }

  it("az 'info@kineticare.hu' literál csak a src/lib/contact-email.ts-ben (és a seed-adatban) áll", () => {
    const talalatok = fajlok(SRC)
      .filter((ut) => readFileSync(ut, 'utf8').includes('info@kineticare.hu'))
      .map((ut) => relative(SRC, ut).split('\\').join('/'))
    expect(
      talalatok.filter((ut) => !ENGEDETT.has(ut)),
      'A kapcsolati e-mail literálja csak a src/lib/contact-email.ts-ben állhat; a fogyasztó a feloldót használja (getContactEmail, feloldottKapcsolatiEmail) vagy a KAPCSOLATI_EMAIL_TARTALEK-ot.',
    ).toEqual([])
    expect(talalatok).toContain('lib/contact-email.ts')
  })

  it('a fogyasztók a feloldót hívják', () => {
    const olvas = (ut: string) => readFileSync(join(SRC, ut), 'utf8')
    const elvart: [string, string][] = [
      ['components/layout/Footer.tsx', 'await getContactEmail()'],
      ['app/(frontend)/not-found.tsx', 'getContactEmail()'],
      ['app/(frontend)/[slug]/page.tsx', 'getContactEmail()'],
      ['app/(frontend)/kapcsolat/page.tsx', 'contactOrganizationNode(contact, contactEmail)'],
      ['app/(frontend)/blog/[slug]/page.tsx', 'getContactEmail()'],
      ['app/(frontend)/blog/kategoria/[slug]/page.tsx', 'getContactEmail()'],
      ['lib/seo-llms.ts', 'feloldottKapcsolatiEmail(contact?.layout)'],
      ['lib/migration-notice/send.ts', 'await kapcsolatiEmailPayloadbol(payload)'],
      ['scripts/send-migration-notice.ts', 'kapcsolatiEmailPayloadbol('],
    ]
    for (const [ut, minta] of elvart) {
      expect(olvas(ut), `${ut}: ${minta}`).toContain(minta)
    }
  })
})

describe('6. llms: a /szakembereknek lap és az Ajánlat-kártyák blokk', () => {
  /**
   * Az A6 „Ajánlat-kártyák” blokkja rekord-alakban (a típusai később
   * érkeznek). A kártyák a lapon látható sorrendben kerülnek a markdownba.
   */
  const szakembereknek = {
    title: 'Szakembereknek',
    slug: 'szakembereknek',
    excerpt: 'Akkreditált képzés gyógytornászoknak.',
    seoDescription: 'Kézrehabilitációs továbbképzés szakembereknek.',
    updatedAt: '2026-09-22T10:00:00.000Z',
    layout: [
      {
        blockType: 'offerCards',
        title: 'Mit kínálunk szakembereknek?',
        kartyak: [
          {
            cim: 'Kézterápiás alapképzés',
            szoveg: 'Két napos, gyakorlatközpontú képzés.',
            tenyek: [{ szoveg: '16 kreditpont' }, { szoveg: 'Budapest' }, { szoveg: '  ' }],
            gomb: { felirat: 'Megnézem a képzést', url: '/szakembereknek#alapkepzes' },
          },
          {
            cim: 'Gomb nélküli kártya',
            szoveg: 'Csak szöveg.',
            gombFelirat: 'Veszélyes',
            gombUrl: 'javascript:alert(1)',
          },
        ],
      },
      {
        blockType: 'offerCards',
        title: 'Rejtett szekció',
        sectionSettings: { visible: false },
        kartyak: [{ cim: 'Nem látszik', szoveg: 'Nem látszik.' }],
      },
    ],
  } as unknown as Parameters<typeof buildLlmsTxt>[0]['pages'][number]

  it('a szakembereknek webcímű lap pontosan egyszer szerepel az llms.txt-ben', () => {
    const llms = buildLlmsTxt({ pages: [szakembereknek], posts: [], products: [] })
    expect(llms.split('/szakembereknek)').length - 1).toBe(1)
    expect(llms).toContain('- [Szakembereknek](')
  })

  it('a kártyák az llms-full.txt-ben: cím, szöveg, tények, gomb; a rejtett szekció kimarad', () => {
    const teljes = buildLlmsFullTxt({ pages: [szakembereknek], posts: [], products: [] })
    expect(teljes).toContain('## Mit kínálunk szakembereknek?')
    expect(teljes).toContain(
      [
        '### Kézterápiás alapképzés',
        'Két napos, gyakorlatközpontú képzés.',
        '- 16 kreditpont\n- Budapest',
        '[Megnézem a képzést](',
      ].join('\n\n'),
    )
    expect(teljes).toMatch(/\[Megnézem a képzést\]\(https?:\/\/[^)]+\/szakembereknek#alapkepzes\)/)
    expect(teljes).toContain('### Gomb nélküli kártya\n\nCsak szöveg.')
    expect(teljes).not.toContain('javascript:')
    expect(teljes).not.toContain('Veszélyes')
    expect(teljes).not.toContain('Nem látszik')
    // A kártyák nem íródnak le kétszer (az általános tömb-bejárás is látná őket).
    expect(teljes.split('Kézterápiás alapképzés').length - 1).toBe(1)
  })
})
