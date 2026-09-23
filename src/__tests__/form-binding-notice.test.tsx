import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { pageBlocks } from '../blocks'
import {
  EGYEB_CIM,
  EGYEB_SZOVEG,
  FormBindingNotice,
  FormBindingNoticeView,
  HIRLEVEL_CIM,
  HIRLEVEL_SZOVEG,
  IDOPONT_HIBA_CIM,
  IDOPONT_NINCS_CIM,
  IDOPONT_NINCS_SZOVEG,
  IDOPONT_SZOVEG,
  KAPCSOLAT_CIM,
  KAPCSOLAT_SZOVEG,
  idopontHelyek,
  idopontHelyekBetoltese,
  urlapFajta,
  type FormBindingNoticeProps,
} from '../components/admin/FormBindingNotice'
import { szekcioMelylink } from '../components/editor/szekcio-melylink'
import { szerkesztoReteg } from '../components/editor/frontend/szerkeszto-szalag'
import { UGRAS_FELIRAT } from '../lib/section-row-label'

/**
 * A „Hol látszik a weboldalon” tájékoztató (modul-térkép H17) őre.
 *
 * - Mindhárom kötött űrlapon a mért valóságot mondja: Hírlevél a láblécben,
 *   Időpontkérés a közzétett oldal űrlapot mutató, látható Időpontkérés
 *   szekciójában, a Kapcsolat űrlapot a weboldal nem használja.
 * - Az Időpontkérés linkje a szekcioMelylink kimenete, a felirata betűre az
 *   admin sorcímkéje (ugyanaz a `szerkesztoReteg` kimenet, amelyet a frontend
 *   „Szerkesztem” szalagja is mutat).
 * - A „sehol nem használja” állítást forrás-söprés igazolja.
 */

/** Az élő /kapcsolat oldal szekciója (live-pages.json, 2026-09-23), a szöveg rövidítve. */
const IDOPONT_BLOKK_ID = '6a82eaf91c307f002219b8a8'

function idopontBlokk(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: IDOPONT_BLOKK_ID,
    blockType: 'appointment',
    eyebrow: 'Rendelői kezelés',
    title: 'Kérj időpontot a rendelőbe',
    urlapMutatasa: true,
    sikerCim: 'Megkaptuk az időpontkérésed',
    sectionSettings: { visible: true },
    ...extra,
  }
}

const KAPCSOLAT_LAP = {
  id: 7,
  title: 'Kapcsolat',
  slug: 'kapcsolat',
  layout: [idopontBlokk()],
}

const USER = {
  id: 1,
  role: 'owner',
  collection: 'users',
} as unknown as FormBindingNoticeProps['user']

function payloadMock(docs: unknown[] | Error) {
  const find = vi.fn(async (args: Record<string, unknown>) => {
    void args
    if (docs instanceof Error) throw docs
    return { docs }
  })
  const payload = { find, config: { routes: { admin: '/admin' } } }
  return { find, payload: payload as unknown as NonNullable<FormBindingNoticeProps['payload']> }
}

async function render(props: FormBindingNoticeProps): Promise<string> {
  return renderToStaticMarkup(await FormBindingNotice(props))
}

/** HTML-entitások nélküli szöveg-összevetéshez. */
function szoveg(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;/g, "'")
}

describe('urlapFajta: a mentett cím szerint', () => {
  it('a három kötött név és minden más', () => {
    expect(urlapFajta('Hírlevél')).toBe('hirlevel')
    expect(urlapFajta('Időpontkérés')).toBe('idopont')
    expect(urlapFajta('Kapcsolat')).toBe('kapcsolat')
    expect(urlapFajta('Visszahívás')).toBe('egyeb')
    expect(urlapFajta(undefined)).toBe('egyeb')
  })
})

describe('idopontHelyek: hol látszik az időpontkérő űrlap', () => {
  it('az élő Kapcsolat oldalon: a link a szekcioMelylink, a felirat az admin sorcímkéje', () => {
    const helyek = idopontHelyek([KAPCSOLAT_LAP], pageBlocks)
    expect(helyek).toHaveLength(1)
    const [hely] = helyek
    expect(hely?.href).toBe(
      szekcioMelylink({ collection: 'pages', id: 7, blokkId: IDOPONT_BLOKK_ID }),
    )
    expect(hely?.href).toBe(`/admin/collections/pages/7?szekcio=${IDOPONT_BLOKK_ID}`)
    const reteg = szerkesztoReteg({ lap: KAPCSOLAT_LAP, blokkok: pageBlocks })
    expect(hely?.cimke).toBe(reteg.szekciok[IDOPONT_BLOKK_ID]?.cimke)
    expect(hely?.cimke).toBe('01 · Időpontkérés: Kérj időpontot a rendelőbe')
    expect(hely?.lapCim).toBe('Kapcsolat')
  })

  it('kikapcsolt űrlapnál és rejtett szekciónál nem látszik', () => {
    const lap = (blokk: Record<string, unknown>) => ({ ...KAPCSOLAT_LAP, layout: [blokk] })
    expect(idopontHelyek([lap(idopontBlokk({ urlapMutatasa: false }))], pageBlocks)).toEqual([])
    expect(
      idopontHelyek([lap(idopontBlokk({ sectionSettings: { visible: false } }))], pageBlocks),
    ).toEqual([])
    // Hiányzó kapcsoló = látszik (appointmentShowsForm).
    expect(
      idopontHelyek([lap(idopontBlokk({ urlapMutatasa: undefined }))], pageBlocks),
    ).toHaveLength(1)
  })

  it('a sorszám a mentett sorindexből jön, más blokkok és rossz alakú adat kimarad', () => {
    const lap = {
      id: 3,
      title: 'Szolgáltatások',
      slug: 'szolgaltatasok',
      layout: [
        { id: 'aaaaaaaaaaaaaaaaaaaaaaaa', blockType: 'richText' },
        null,
        idopontBlokk({ id: 'bbbbbbbbbbbbbbbbbbbbbbbb', title: 'Időpont' }),
      ],
    }
    const helyek = idopontHelyek([lap, 'rossz', { title: 'nincs id' }], pageBlocks, '/iroda')
    expect(helyek).toEqual([
      {
        lapCim: 'Szolgáltatások',
        cimke: '03 · Időpontkérés: Időpont',
        href: '/iroda/collections/pages/3?szekcio=bbbbbbbbbbbbbbbbbbbbbbbb',
      },
    ])
  })
})

describe('idopontHelyekBetoltese: a Local API a szerkesztő jogosultságával', () => {
  it('a közzétett, Időpontkérés blokkos oldalakat kéri, access-szel', async () => {
    const { find, payload } = payloadMock([KAPCSOLAT_LAP])
    const helyek = await idopontHelyekBetoltese(payload, USER ?? null, '/admin')
    expect(helyek).toHaveLength(1)
    expect(find).toHaveBeenCalledTimes(1)
    expect(find.mock.calls[0]?.[0]).toMatchObject({
      collection: 'pages',
      where: {
        and: [
          { 'layout.blockType': { equals: 'appointment' } },
          { _status: { equals: 'published' } },
        ],
      },
      depth: 0,
      pagination: false,
      overrideAccess: false,
      user: USER,
      select: { title: true, slug: true, layout: true },
    })
  })

  it('lekérdezési hibánál null, nem dob', async () => {
    const { payload } = payloadMock(new Error('adatbázis nem elérhető'))
    await expect(idopontHelyekBetoltese(payload, null, '/admin')).resolves.toBeNull()
  })
})

describe('FormBindingNotice: mindhárom űrlapon a mért valóság', () => {
  it('Hírlevél: minden oldal lábléce, lekérdezés nélkül', async () => {
    const { find, payload } = payloadMock([])
    const html = await render({ data: { title: 'Hírlevél' }, payload, user: USER })
    expect(szoveg(html)).toContain(HIRLEVEL_CIM)
    expect(szoveg(html)).toContain(HIRLEVEL_SZOVEG)
    // A 404-es lapok is a teljes láblécet hozzák a feliratkozó sorral (mérve
    // böngészőben, hidratálás után), ezért a doboz kivételt nem mond.
    expect(HIRLEVEL_CIM).toBe('Itt látszik: minden oldal láblécében')
    expect(html).toContain('class="kc-admin-notice"')
    expect(find).not.toHaveBeenCalled()
  })

  it('Időpontkérés: a Kapcsolat oldal szekciója, linkkel a szekcióra', async () => {
    const { payload } = payloadMock([KAPCSOLAT_LAP])
    const html = await render({ data: { title: 'Időpontkérés' }, payload, user: USER })
    const sima = szoveg(html)
    expect(sima).toContain('Itt látszik: Kapcsolat oldal, Időpontkérés szekció')
    expect(sima).toContain(IDOPONT_SZOVEG)
    expect(html).toContain(
      `<a href="/admin/collections/pages/7?szekcio=${IDOPONT_BLOKK_ID}">${UGRAS_FELIRAT}: Kapcsolat, 01 · Időpontkérés: Kérj időpontot a rendelőbe</a>`,
    )
    expect(html).toContain('class="kc-admin-notice__linkek"')
  })

  it('Időpontkérés két helyen: darabszám és két link', async () => {
    const masik = {
      id: 3,
      title: 'Szolgáltatások',
      slug: 'szolgaltatasok',
      layout: [idopontBlokk({ id: 'cccccccccccccccccccccccc', title: 'Foglalj' })],
    }
    const { payload } = payloadMock([KAPCSOLAT_LAP, masik])
    const html = await render({ data: { title: 'Időpontkérés' }, payload, user: USER })
    expect(szoveg(html)).toContain('Itt látszik: 2 Időpontkérés szekcióban')
    expect(html.match(/<a /g)).toHaveLength(2)
  })

  it('Időpontkérés sehol: figyelmeztető doboz link nélkül', async () => {
    const { payload } = payloadMock([])
    const html = await render({ data: { title: 'Időpontkérés' }, payload, user: USER })
    expect(szoveg(html)).toContain(IDOPONT_NINCS_CIM)
    expect(szoveg(html)).toContain(IDOPONT_NINCS_SZOVEG)
    expect(IDOPONT_NINCS_SZOVEG).toContain('„Legyen űrlap a szekcióban” pipa')
    expect(html).toContain('kc-admin-notice--figyelem')
    expect(html).not.toContain('<a ')
  })

  it('Időpontkérés, lekérdezési hibánál vagy payload nélkül: link nélkül, nem dob', async () => {
    const { payload } = payloadMock(new Error('nincs kapcsolat'))
    const html = await render({ data: { title: 'Időpontkérés' }, payload, user: USER })
    expect(szoveg(html)).toContain(IDOPONT_HIBA_CIM)
    expect(html).not.toContain('<a ')
    expect(szoveg(await render({ data: { title: 'Időpontkérés' } }))).toContain(IDOPONT_HIBA_CIM)
  })

  it('Kapcsolat: a weboldal most sehol nem használja', async () => {
    const html = await render({ data: { title: 'Kapcsolat' } })
    expect(szoveg(html)).toContain('Ezt az űrlapot a weboldal most sehol nem használja')
    expect(szoveg(html)).toContain(KAPCSOLAT_CIM)
    expect(szoveg(html)).toContain(KAPCSOLAT_SZOVEG)
    expect(KAPCSOLAT_SZOVEG).toBe('Ha törlöd, a rendszer a következő indításkor újra létrehozza.')
  })

  it('más űrlap és új űrlap: a weboldal nem használja', async () => {
    // A kötött nevű űrlap duplikált másolata is ide tartozik (urlapCimMasolatNeve).
    expect(urlapFajta('Hírlevél (másolat)')).toBe('egyeb')
    for (const data of [{ title: 'Visszahívás' }, { title: 'Hírlevél (másolat)' }, {}, undefined]) {
      const html = await render({ data })
      expect(szoveg(html)).toContain(EGYEB_CIM)
      expect(szoveg(html)).toContain(EGYEB_SZOVEG)
    }
  })

  it('statikus doboz: nincs élő régió, nincs gondolatjel', () => {
    for (const model of [
      { fajta: 'hirlevel' as const },
      { fajta: 'kapcsolat' as const },
      { fajta: 'egyeb' as const },
      { fajta: 'idopont' as const, helyek: null },
      { fajta: 'idopont' as const, helyek: [] },
      {
        fajta: 'idopont' as const,
        helyek: [{ lapCim: 'Kapcsolat', cimke: '01 · Időpontkérés: X', href: '/admin/x' }],
      },
    ]) {
      const html = renderToStaticMarkup(<FormBindingNoticeView model={model} />)
      expect(html).not.toMatch(/role=|aria-live/)
      expect(szoveg(html)).not.toMatch(/[–—]/)
    }
  })
})

describe('a „Kapcsolat” űrlapot a weboldal most sehol nem használja (forrás-söprés)', () => {
  const gyoker = fileURLToPath(new URL('..', import.meta.url))

  function forrasok(): Array<{ relativ: string; tartalom: string }> {
    const eredmeny: Array<{ relativ: string; tartalom: string }> = []
    const bejar = (konyvtar: string): void => {
      for (const nev of readdirSync(konyvtar)) {
        const teljes = path.join(konyvtar, nev)
        if (statSync(teljes).isDirectory()) {
          if (nev !== '__tests__' && nev !== 'migrations') bejar(teljes)
          continue
        }
        if (/\.(ts|tsx)$/.test(nev)) {
          eredmeny.push({
            relativ: path.relative(gyoker, teljes).split(path.sep).join('/'),
            tartalom: readFileSync(teljes, 'utf8'),
          })
        }
      }
    }
    bejar(gyoker)
    return eredmeny
  }

  it('a forms gyűjteményt cím szerint csak a két használt űrlap keresője és a seed kérdezi', () => {
    const cimSzerint = forrasok()
      .filter(({ tartalom }) => /where:\s*\{\s*title:\s*\{\s*equals:/.test(tartalom))
      .filter(({ tartalom }) => tartalom.includes("'forms'"))
      .map(({ relativ }) => relativ)
      .sort()
    expect(cimSzerint).toEqual([
      'lib/appointment/form.ts',
      'lib/newsletter/form.ts',
      'payload.config.ts',
    ])
    // A payload.config.ts-ben az egyetlen címkeresés az induláskori seedé.
    const config = readFileSync(path.join(gyoker, 'payload.config.ts'), 'utf8')
    const talalatok = config.match(/where:\s*\{\s*title:\s*\{\s*equals:\s*(\w+)/g) ?? []
    expect(talalatok).toEqual(['where: { title: { equals: CONTACT_FORM_TITLE'])
    const seed = config.slice(config.indexOf('async function ensureContactForm'))
    expect(seed).toMatch(
      /^async function ensureContactForm[\s\S]*?where: \{ title: \{ equals: CONTACT_FORM_TITLE/,
    )
  })

  it('a régi kapcsolat-űrlap komponenst semmilyen oldal nem rendereli', () => {
    const importalok = forrasok()
      .filter(({ tartalom }) => /_components\/ContactForm['"]/.test(tartalom))
      .map(({ relativ }) => relativ)
    expect(importalok).toEqual([])
  })
})
