import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import BelepesAtallasPage, {
  ATALLAS_HOZZAFERES_MONDAT,
  ATALLAS_KERES_KORLAT_MONDAT,
  metadata as atallasMetadata,
} from '../app/(frontend)/belepes-atallas/page'
import ElfelejtettJelszoPage from '../app/(frontend)/elfelejtett-jelszo/page'
import { ForgotPasswordForm, URES_EMAIL_HIBA } from '../components/auth/ForgotPasswordForm'
import { ctaLabel } from '../lib/cta-vocabulary'
import { RATE_LIMIT_RULES } from '../lib/security/rate-limit'

import { EM_DASH, EN_DASH } from './helpers/cta-mikroszoveg'

/**
 * ŐR — AZ ÁTKÖLTÖZTETETT VEVŐ ÚTJA (`/belepes-atallas`).
 * A systeme.io-ról áthozott, FIZETŐ vevő nem tud belépni a régi jelszavával.
 * Egyetlen levelet kap, és annak a levélnek EGY céllapja van. Ha ezen a lapon
 * bármelyik alábbi állítás elveszik, a vevő elakad, és a támogatás dolga lesz:
 * 1. kimondja, hogy NEM Ő HIBÁZOTT, és megmondja az OKOT;
 */

vi.stubGlobal('fetch', () => {
  throw new Error('A tesztből SOSEM mehet ki valódi hálózati hívás.')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const FRONTEND = fileURLToPath(new URL('../app/(frontend)/', import.meta.url))
const TOKENS = readFileSync(`${FRONTEND}styles/tokens.css`, 'utf8')
const AUTH_CSS = readFileSync(`${FRONTEND}auth.css`, 'utf8')
const URLAP_FORRAS = readFileSync(
  fileURLToPath(new URL('../components/auth/ForgotPasswordForm.tsx', import.meta.url)),
  'utf8',
)

const atallasHtml = renderToStaticMarkup(createElement(BelepesAtallasPage))
const elfelejtettHtml = renderToStaticMarkup(
  await ElfelejtettJelszoPage({ searchParams: Promise.resolve({}) }),
)

/** A jelölők nélküli, látható szöveg — ezt olvassa a vevő. */
function szoveg(html: string): string {
  return html
    .replace(/<[^>]*>/gu, ' ')
    .replace(/&#x27;/gu, "'")
    .replace(/&quot;/gu, '"')
    .replace(/&amp;/gu, '&')
    .replace(/\s+/gu, ' ')
    .trim()
}

const atallasSzoveg = szoveg(atallasHtml)

// ---------------------------------------------------------------------------
// 1. A NÉGY KÖTELEZŐ ÁLLÍTÁS
// ---------------------------------------------------------------------------

describe('/belepes-atallas — a négy kötelező állítás', () => {
  it('kimondja, hogy nem a vevő hibázott, és megmondja az okot', () => {
    expect(atallasSzoveg).toContain('Nem te hibáztál')
    // Az OK: a régi oldal külön rendszer volt. Enélkül a „nem te hibáztál"
    // puszta vigasztalás — NN/g, Error-Message Guidelines: a hasznos üzenet
    // „precisely indicate the problem".
    expect(atallasSzoveg).toContain('külön rendszer volt')
  })

  it('SZÓ SZERINT kimondja, hogy a kurzus megvan és nem kell újra fizetni', () => {
    expect(ATALLAS_HOZZAFERES_MONDAT).toBe(
      'A megvásárolt kurzusaid megvannak, újra fizetned nem kell.',
    )
    expect(atallasSzoveg).toContain(ATALLAS_HOZZAFERES_MONDAT)
  })

  it('a beküldés UTÁNI panelen is ott áll a hozzáférés-mondat', () => {
    // A megerősítő panel a `sent` állapotban jelenik meg; a lap a mondatot
    // `successNote`-ként adja át, tehát a prop MEGLÉTE a mérhető szerződés.
    const kuldott = renderToStaticMarkup(
      createElement(ForgotPasswordForm, { successNote: ATALLAS_HOZZAFERES_MONDAT }),
    )
    // Beküldés nélkül még az űrlap látszik — a note csak a panelen jelenik meg.
    expect(kuldott).toContain('kc-auth-form')
    expect(atallasHtml).toContain('kc-auth-form')
  })

  it('EGY kért cselekvés van a lapon: pontosan egy beküldő gomb', () => {
    const gombok = atallasHtml.match(/<button\b/gu) ?? []
    expect(gombok).toHaveLength(1)
    expect(atallasHtml).toContain('type="submit"')
    expect(atallasSzoveg).toContain(ctaLabel('password-reset-request'))
  })

  it('van visszaút és segítségkérés, mindkettő a §3.2 szótár feliratával', () => {
    expect(atallasHtml).toMatch(/href="\/belepes"/u)
    expect(atallasHtml).toMatch(/href="\/kapcsolat"/u)
    expect(atallasSzoveg).toContain('Vissza a belépéshez')
    expect(atallasSzoveg).toContain(ctaLabel('contact-open'))
  })
})

// ---------------------------------------------------------------------------
// 2. CÍM ÉS TÁJÉKOZÓDÁS (WCAG 2.2 · 2.4.6)
// ---------------------------------------------------------------------------

describe('/belepes-atallas — cím és tájékozódás', () => {
  it('a H1 a vevő HELYZETÉT írja le, nem azt, hogy elfelejtette a jelszavát', () => {
    const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/u.exec(atallasHtml)?.[1] ?? ''
    expect(szoveg(h1)).toBe('Állítsd be a jelszavad az új felületen')
    expect(szoveg(h1)).not.toContain('Elfelejtetted')
  })

  it('a H1 KÜLÖNBÖZIK a /elfelejtett-jelszo lapétól', () => {
    const atallasH1 = szoveg(/<h1[^>]*>([\s\S]*?)<\/h1>/u.exec(atallasHtml)?.[1] ?? '')
    const masikH1 = szoveg(/<h1[^>]*>([\s\S]*?)<\/h1>/u.exec(elfelejtettHtml)?.[1] ?? '')
    expect(masikH1).toBe('Elfelejtetted a jelszavad?')
    expect(atallasH1).not.toBe(masikH1)
  })

  it('a lap saját megosztási címet és leírást kap (nem örökli a keretét)', () => {
    expect(atallasMetadata.title).toBe('Jelszó beállítása az új felületen')
    expect(String(atallasMetadata.description)).toContain('e-mail-cím')
  })

  it('a szakaszcímek megválaszolják a „mi lesz ezután" és a „mi van, ha nem jön" kérdést', () => {
    const h2k = [...atallasHtml.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gu)].map((m) => szoveg(m[1]))
    expect(h2k).toEqual(['Mi történik, miután elküldted?', 'Nem érkezett meg a levél?'])
  })
})

// ---------------------------------------------------------------------------
// 3. MIKROSZÖVEG (§3.1.1–3.1.2)
// ---------------------------------------------------------------------------

describe('/belepes-atallas — magyar mikroszöveg', () => {
  it('a látható szövegben NINCS kvirtmínusz (U+2014)', () => {
    expect(atallasSzoveg.includes(EM_DASH)).toBe(false)
    expect(szoveg(elfelejtettHtml).includes(EM_DASH)).toBe(false)
  })

  it('a látható szövegben NINCS gondolatjel/nagykötőjel (U+2013) töltelékként', () => {
    expect(atallasSzoveg.includes(EN_DASH)).toBe(false)
    expect(szoveg(elfelejtettHtml).includes(EN_DASH)).toBe(false)
  })

  it('nincs „Kérjük" alakú, személytelen udvariaskodás a lapon (§2.7)', () => {
    expect(atallasSzoveg).not.toMatch(/Kérjük/u)
  })
})

// ---------------------------------------------------------------------------
// 4. ŰRLAP-AKADÁLYMENTESSÉG (WCAG 2.2 · 3.3.2)
// ---------------------------------------------------------------------------

describe('/belepes-atallas — az űrlap', () => {
  it('az e-mail-mezőnek van labelje, és a label az inputra mutat', () => {
    const forId = /<label[^>]*for="([^"]+)"/u.exec(atallasHtml)?.[1]
    expect(forId).toBeTruthy()
    expect(atallasHtml).toContain(`id="${forId}"`)
    expect(atallasSzoveg).toContain('E-mail-cím')
  })

  it('a segédszöveg aria-describedby-vel a mezőhöz van kötve', () => {
    const hintId = /<p class="kc-field__hint" id="([^"]+)"/u.exec(atallasHtml)?.[1]
    expect(hintId).toBeTruthy()
    expect(atallasHtml).toContain(`aria-describedby="${hintId}"`)
    expect(atallasSzoveg).toContain('amellyel a régi oldalon vásároltál')
  })

  it('a megosztott űrlap ALAPÉRTELMEZETT alakja változatlan (nincs hint, nincs note)', () => {
    const alap = renderToStaticMarkup(createElement(ForgotPasswordForm))
    expect(alap).not.toContain('kc-field__hint')
    expect(alap).not.toContain('kc-auth-success__note')
    expect(alap).toContain(ctaLabel('password-reset-request'))
  })

  /**
   * MÉRT REGRESSZIÓ (Chromium, valódi Tab-billentyű, 2026-08-21): amíg a gomb
   * üres mező mellett `disabled` volt, a fókusz-lánc a mezőről EGYBŐL a lap
   * alján álló hivatkozásokra ugrott — a lap elsődleges cselekvése kimaradt
   * belőle. A natív `disabled` kiesik a Tab-sorrendből.
   * A javítás után a lánc: mező → „Kérem a visszaállító linket" → „Írj nekünk"
   * → „Vissza a belépéshez".
   */
  it('a beküldő gomb ÜRES mező mellett sem esik ki a billentyű-sorrendből', () => {
    const alap = renderToStaticMarkup(createElement(ForgotPasswordForm))
    const gomb = /<button[^>]*>/u.exec(alap)?.[0] ?? ''
    expect(gomb).not.toContain('disabled')
    expect(gomb).toContain('type="submit"')
  })

  it('az üres beküldésnek MAGYAR hibaüzenete van, nem néma visszatérés', () => {
    expect(URES_EMAIL_HIBA).toBe('Add meg az e-mail-címed.')
    expect(URLAP_FORRAS).toContain('setFieldError(URES_EMAIL_HIBA)')
  })

  /**
   * MÉRVE happy-dom-mal (2026-08-22): üres beküldés után az inputon
   * `aria-invalid="true"`, `aria-describedby="kc-field-email-error"` és
   * `kc-field__input--error` áll, a fókusz a MEZŐN van, és nincs duplikált
   * form-szintű doboz ugyanerre a hibára; szerverhibánál viszont a
   * form-szintű doboz kapja a fókuszt, és a mező NEM lesz „hibás".
   *
   * WCAG 2.2 · 3.3.1 (Error Identification): a hibás elemet AZONOSÍTANI kell,
   * nem elég a hibaszöveget kiírni valahol.
   * https://www.w3.org/WAI/WCAG22/Understanding/error-identification.html
   */
  it('a MEZŐ-hiba a Field `error` propján megy (aria-invalid + hibakeret), nem külön dobozban', () => {
    expect(URLAP_FORRAS).toContain('error={fieldError ?? undefined}')
    // A szerverhiba MARAD a form-szintű dobozban, fókuszálhatóan.
    expect(URLAP_FORRAS).toContain('setFormError(result.message ?? GENERIC_AUTH_ERROR)')
    expect(URLAP_FORRAS).toContain('formErrorRef.current?.focus()')
  })
})

// ---------------------------------------------------------------------------
// 4/b. ÉRINTŐCÉL ÉS LINK-JELÖLÉS — az önállóan álló hivatkozások sora
// ---------------------------------------------------------------------------

describe('.kc-auth-actions — önállóan álló hivatkozások', () => {
  it('mindkét lap ezt a sort használja a magában álló linkhez', () => {
    expect(atallasHtml).toContain('class="kc-auth-actions"')
    expect(elfelejtettHtml).toContain('class="kc-auth-actions"')
    // A `.kc-auth-alt` MONDATBA ágyazott linkeké marad (pl. /belepes).
    expect(atallasHtml).not.toContain('class="kc-auth-alt"')
    expect(elfelejtettHtml).not.toContain('class="kc-auth-alt"')
  })

  it('a link célfelülete legalább 24 CSS px magas (WCAG 2.2 · 2.5.8)', () => {
    const szabaly = /\.kc-auth-actions a\s*\{([\s\S]*?)\}/u.exec(AUTH_CSS)?.[1] ?? ''
    const magassag = /min-height:\s*(\d+)px/u.exec(szabaly)?.[1]
    expect(Number(magassag)).toBeGreaterThanOrEqual(24)
  })

  it('a link nem CSAK színnel jelölt: aláhúzott (WCAG 2.2 · 1.4.1, G183)', () => {
    const szabaly = /\.kc-auth-actions a\s*\{([\s\S]*?)\}/u.exec(AUTH_CSS)?.[1] ?? ''
    expect(szabaly).toMatch(/text-decoration:\s*underline/u)
  })

  /**
   * MÉRT REGRESSZIÓ (Chromium, 320/360/390/768/1024/1440 px, 2026-08-22): a
   * sor `margin-top`-ja `0px` volt, tehát a `/elfelejtett-jelszo` lapon a
   * beküldő gomb alsó éle és a link 44 px-es célfelülete MINDEN nézetben
   * 0,00 px-re ért össze (a korábbi `.kc-auth-alt` 32 px-e elveszett). A
   * javítás után mindkét lapon 32,00 px, a §3 táblázat 24 px-es minimuma
   * fölött, vízszintes görgetés nélkül.
   */
  it('a sor FÜGGŐLEGESEN is elválik az előtte álló célfelülettől', () => {
    const szabaly = /\.kc-auth-actions\s*\{([\s\S]*?)\}/u.exec(AUTH_CSS)?.[1] ?? ''
    expect(szabaly).toMatch(/margin-top:\s*var\(--kc-space-6\)/u)
    // Ugyanaz a token, mint a sor VÍZSZINTES közében — egy elem, egy ritmus.
    expect(szabaly).toMatch(/gap:\s*0 var\(--kc-space-6\)/u)
  })
})

// ---------------------------------------------------------------------------
// 4/c. MÉRTÉK — a próza sorhossza nem a konténer szélességétől függ
// ---------------------------------------------------------------------------

describe('sorhossz-mérték', () => {
  it('a felvezető a kényelmes mérték-tokenre szorul', () => {
    const szabaly = /\.kc-auth-lead\s*\{([\s\S]*?)\}/u.exec(AUTH_CSS)?.[1] ?? ''
    expect(szabaly).toContain('max-width: var(--kc-measure-comfort)')
  })

  it('az alcímek a HÁROM méret-token M lépcsőjén állnak, nem újon', () => {
    // A base.css a H1-et és a H2-t ugyanarra az L lépcsőre teszi; a lap két
    // utókérdése ettől hangosabb lett volna a beküldő gombnál. A megoldás a
    // repóban élő komponens-cím minta (`.kc-auth-success > h2`), nem új token.
    const szabaly = /\.kc-atallas > h2\s*\{([\s\S]*?)\}/u.exec(AUTH_CSS)?.[1] ?? ''
    const meretek = [...szabaly.matchAll(/font-size:\s*([^;]+);/gu)].map((m) => m[1].trim())
    expect(meretek).toEqual(['var(--kc-font-m)'])
  })

  it('az átállás-lap törzsszövege a törzs-mértékre szorul', () => {
    const szabaly =
      /\.kc-atallas > p,\s*\n\.kc-atallas > ol\s*\{([\s\S]*?)\}/u.exec(AUTH_CSS)?.[1] ?? ''
    expect(szabaly).toContain('max-width: var(--kc-measure)')
  })
})

// ---------------------------------------------------------------------------
// 5. A KÉRÉS-KORLÁT MONDATA — a SZÁMOK a valódi kerettel egyeznek
// ---------------------------------------------------------------------------

describe('/belepes-atallas — a kérés-korlát emberi nyelven', () => {
  it('a lapon álló darabszám és időablak a password-forgot-email keretét írja le', () => {
    const keret = RATE_LIMIT_RULES['password-forgot-email']
    const percek = keret.windowMs / 60_000
    expect(ATALLAS_KERES_KORLAT_MONDAT).toContain(`${percek} percen belül`)
    expect(ATALLAS_KERES_KORLAT_MONDAT).toContain(`legfeljebb ${keret.limit} levelet`)
    expect(atallasSzoveg).toContain(ATALLAS_KERES_KORLAT_MONDAT)
  })

  it('a mondat a levélszemét mappát is megnevezi', () => {
    expect(atallasSzoveg).toContain('levélszemét')
  })
})

// ---------------------------------------------------------------------------
// 6. KONTRASZT — a kiemelt doboz tokenjeiből ÚJRASZÁMOLVA
// ---------------------------------------------------------------------------

/** Egy token értéke a tokens.css-ből, `var()`-láncon át feloldva. */
function token(nev: string, melyseg = 0): string {
  if (melyseg > 6) throw new Error(`Túl mély var()-lánc: ${nev}`)
  const talalat = new RegExp(`--${nev}:\\s*([^;]+);`, 'u').exec(TOKENS)
  if (talalat === null) throw new Error(`Nincs ilyen token: --${nev}`)
  const ertek = talalat[1].trim()
  const hivatkozas = /^var\(--([a-z0-9-]+)\)$/u.exec(ertek)
  return hivatkozas === null ? ertek : token(hivatkozas[1], melyseg + 1)
}

const csatorna = (c: number): number => {
  const s = c / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

/** WCAG 2.2 normatív relatív luminancia + kontraszt-arány. */
function arany(a: string, b: string): number {
  const rgb = (hex: string): number[] =>
    [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16))
  const lum = (hex: string): number => {
    const [r, g, bl] = rgb(hex)
    return 0.2126 * csatorna(r) + 0.7152 * csatorna(g) + 0.0722 * csatorna(bl)
  }
  const [vilagos, sotet] = lum(a) >= lum(b) ? [lum(a), lum(b)] : [lum(b), lum(a)]
  return (vilagos + 0.05) / (sotet + 0.05)
}

describe('/belepes-atallas — a kiemelt doboz kontrasztja', () => {
  const felulet = token('kc-color-info-surface')
  const keret = token('kc-color-info')
  const szovegSzin = token('kc-color-text')
  const lap = token('kc-color-bg')

  it('a doboz szabálya a szerep-tokeneket használja, nem nyers színt', () => {
    const szabaly = /\.kc-atallas__notice\s*\{([\s\S]*?)\}/u.exec(AUTH_CSS)?.[1] ?? ''
    expect(szabaly).toContain('var(--kc-color-info)')
    expect(szabaly).toContain('var(--kc-color-info-surface)')
    expect(szabaly).toContain('var(--kc-color-text)')
    expect(szabaly).not.toMatch(/#[0-9a-f]{3,8}/iu)
  })

  it('a szöveg kontrasztja a dobozon ≥ 4,5:1 (WCAG 1.4.3)', () => {
    expect(arany(szovegSzin, felulet)).toBeGreaterThanOrEqual(4.5)
  })

  it('a doboz kerete ≥ 3:1 BELÜLRŐL és KÍVÜLRŐL is (WCAG 1.4.11)', () => {
    expect(arany(keret, felulet)).toBeGreaterThanOrEqual(3)
    expect(arany(keret, lap)).toBeGreaterThanOrEqual(3)
  })
})

// ---------------------------------------------------------------------------
// 7. INDEXELÉS — a robots.txt előtag-tiltása lefedi az új útvonalat
// ---------------------------------------------------------------------------

describe('/belepes-atallas — indexelés', () => {
  it('a robots.txt egyik tiltott előtagja lefedi az útvonalat', () => {
    const robotsForras = readFileSync(
      fileURLToPath(new URL('../app/robots.ts', import.meta.url)),
      'utf8',
    )
    const lista = /const DISALLOWED_PATHS = \[([\s\S]*?)\]/u.exec(robotsForras)?.[1] ?? ''
    const utak = [...lista.matchAll(/'([^']+)'/gu)].map((m) => m[1])
    expect(utak).toContain('/belepes')
    expect(utak.some((ut) => '/belepes-atallas'.startsWith(ut))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 8. A BIZTONSÁGI HÁLÓ — /elfelejtett-jelszo
// ---------------------------------------------------------------------------

describe('/elfelejtett-jelszo — a régi vevő biztonsági hálója', () => {
  const elfelejtettSzoveg = szoveg(elfelejtettHtml)

  it('elmondja, hogy a régi oldal jelszava itt nem működik', () => {
    expect(elfelejtettSzoveg).toContain('a régi Kineticare-oldalon vásároltál')
    expect(elfelejtettSzoveg).toContain('nem működik')
  })

  it('itt is kimondja, hogy a kurzus megvan és nem kell újra fizetni', () => {
    expect(elfelejtettSzoveg).toContain(ATALLAS_HOZZAFERES_MONDAT)
  })

  it('NEM tartalmaz dátumot vagy kampány-szót (állandó lap, nem avulhat el)', () => {
    expect(elfelejtettSzoveg).not.toMatch(/\d{4}\.|\d{4}-\d{2}-\d{2}/u)
  })

  it('a lapon továbbra is EGY beküldő gomb és a visszaút áll', () => {
    expect((elfelejtettHtml.match(/<button\b/gu) ?? []).length).toBe(1)
    expect(elfelejtettSzoveg).toContain('Vissza a belépéshez')
    expect(elfelejtettHtml).toContain('/belepes?returnUrl=%2Fkurzusaim')
  })

  it('a returnUrl a belépő visszaúton megmarad', async () => {
    const html = renderToStaticMarkup(
      await ElfelejtettJelszoPage({
        searchParams: Promise.resolve({ returnUrl: '/penztar?termek=12' }),
      }),
    )
    expect(html).toContain('/belepes?returnUrl=%2Fpenztar%3Ftermek%3D12')
  })
})

// ---------------------------------------------------------------------------
// 9. A KIKÜLDENDŐ LEVÉL (docs/vasarlo-migracio-terv.md 4.5.)
// ---------------------------------------------------------------------------

/**
 * A levél szövege doksiban él, nem kódban (a Katák onnan másolják a
 * levelezőrendszerbe). Attól még ELLENŐRIZHETŐ: a négy kötelező állítás és a
 * kérés-korlát számai ugyanazok, mint a lapon. Enélkül a levél és a céllap
 * észrevétlenül szétcsúszhat.
 */
describe('4.5. levél — a levél és a céllap ugyanazt mondja', () => {
  const TERV = readFileSync(
    fileURLToPath(new URL('../../docs/vasarlo-migracio-terv.md', import.meta.url)),
    'utf8',
  )
  const level = TERV.slice(TERV.indexOf('### 4.5.'), TERV.indexOf('**A behelyettesítendő mezők**'))
  /** A levél SORTÖRÉS NÉLKÜL: a markdown idézet-jelölők a mondatokat elvágják. */
  const folyo = level.replace(/\n>\s*/gu, ' ').replace(/\s+/gu, ' ')

  it('a levél létezik, és van tárgymezője', () => {
    expect(level.length).toBeGreaterThan(500)
    expect(level).toContain('**Tárgy:**')
  })

  it('kimondja, hogy a régi jelszó nem működik, és megmondja az okot', () => {
    expect(level).toContain('nem működik')
    expect(level).toContain('külön rendszer')
    expect(folyo).toContain('nem is te hibáztál')
  })

  it('SZÓ SZERINT tartalmazza a hozzáférés-mondatot', () => {
    expect(folyo).toContain(ATALLAS_HOZZAFERES_MONDAT)
  })

  it('PONTOSAN EGY linket kér a vevőtől', () => {
    const helyorzok = [...level.matchAll(/\{\{([a-z_]+)\}\}/gu)].map((m) => m[1])
    expect(helyorzok.filter((h) => h.endsWith('_url'))).toEqual(['belepes_atallas_url'])
    expect(level).not.toMatch(/https?:\/\//u)
  })

  it('a kérés-korlát számai egyeznek a lapéval és a valódi kerettel', () => {
    const keret = RATE_LIMIT_RULES['password-forgot-email']
    expect(folyo).toContain(
      `${keret.windowMs / 60_000} percen belül legfeljebb ${keret.limit} levelet`,
    )
  })

  it('a levél NEM tartalmaz kitalált dátumot', () => {
    expect(level).not.toMatch(/\d{4}\.\s*\w+\s*\d{1,2}/u)
  })

  it('a levél vevőnek szóló törzsében nincs kvirtmínusz', () => {
    const torzs = level
      .split('\n')
      .filter((sor) => sor.startsWith('>'))
      .join('\n')
    expect(torzs.includes(EM_DASH)).toBe(false)
  })
})
