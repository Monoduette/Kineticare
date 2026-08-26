import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { BarionPixel, BarionPixelNoscript } from '../components/analytics/BarionPixel'
import {
  BARION_PIXEL_NOSCRIPT_HOST,
  BARION_PIXEL_ORIGIN,
  BARION_PIXEL_SCRIPT_SRC,
  bp,
  getBarionPixelId,
  isBarionPixelId,
} from '../lib/analytics/barion-pixel'
import { buildContentSecurityPolicy } from '../lib/security/csp'

/**
 * Az ALAP (Base) Barion Pixel őr-tesztje.
 * Az alap Pixel NEM marketing-eszköz: a Barion Smart Gateway használatának
 * feltétele, és a hivatalos dokumentáció kifejezetten kiköti, hogy a
 * süti-hozzájárulás kezelője NE nyúljon hozzá:
 * „Marketing consent management software should not interact with this code,
 */

/** Kitalált, szabályos alakú teszt-azonosító (valódi kulcs a repóba nem kerülhet). */
const TESZT_PIXEL_ID = 'BP-Teszt00000-T0'

/**
 * Forrásfájl kommentek NÉLKÜL.
 *
 * A repóban bevett minta (lásd `suti-sav-menu-takaras.test.ts`): kommenttel a
 * forrás-szintű őr vakon zöld lehet, mert a magyarázó szöveg maga tartalmazza
 * a keresett kifejezést — ebben a fájlban a komponens fejléc-kommentje például
 * szó szerint leírja, hogy „consent”. Egy kommentre illeszkedő őr nem őr.
 * A sorkommenteket sor eleji `//`-ként vágjuk, hogy a `https://` sértetlen
 * maradjon.
 */
function forrasKommentNelkul(relativPath: string): string {
  const nyers = readFileSync(fileURLToPath(new URL(relativPath, import.meta.url)), 'utf8')
  return nyers
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((sor) => {
      const trimmelt = sor.trim()
      return !trimmelt.startsWith('//') && !trimmelt.startsWith('*')
    })
    .join('\n')
}

/** A fejléc egy direktívájának forrásai (a direktíva neve nélkül). */
function direktiva(csp: string, nev: string): string[] {
  const talalt = csp.split('; ').find((entry) => entry === nev || entry.startsWith(`${nev} `))
  expect(talalt, `hiányzó direktíva: ${nev}`).toBeDefined()
  return (talalt as string).split(' ').slice(1)
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('a Pixel-azonosító alak-ellenőrzése', () => {
  it('a szabályos alakot elfogadja, a BPT-előtagút elutasítja', () => {
    // BP- + 10 jel + - + 2 jel, vegyes betűállással (az azonosítók ilyenek).
    expect(isBarionPixelId('BP-oA1zcu4uwm-C0')).toBe(true)
    expect(isBarionPixelId(TESZT_PIXEL_ID)).toBe(true)

    // A `BPT`-vel kezdődő azonosító a Barion admin MÁS értéke, a Pixellel nem
    // működik — ezt a hivatalos doksi külön kiemeli.
    expect(isBarionPixelId('BPT-Teszt00000-T0')).toBe(false)
    expect(isBarionPixelId('BPTeszt00000T0')).toBe(false)
  })

  it('a rossz hosszt és a kódbecsempészést is kizárja', () => {
    for (const rossz of [
      '',
      'BP-Teszt0000-T0', // 9 jel a középső blokkban
      'BP-Teszt00000-T', // 1 jel a végén
      'BP-Teszt00000-T00', // 3 jel a végén
      'BP-Teszt00000-T0"</script><script>alert(1)</script>',
      "BP-Teszt00000-T0'; script-src *",
      'BP-Teszt 0000-T0',
    ]) {
      expect(isBarionPixelId(rossz), rossz).toBe(false)
    }
  })

  it('getBarionPixelId: szóközt vág, hibás/hiányzó értéknél null', () => {
    expect(getBarionPixelId({ NEXT_PUBLIC_BARION_PIXEL_ID: `  ${TESZT_PIXEL_ID}  ` })).toBe(
      TESZT_PIXEL_ID,
    )
    expect(getBarionPixelId({ NEXT_PUBLIC_BARION_PIXEL_ID: undefined })).toBeNull()
    expect(getBarionPixelId({})).toBeNull()
    expect(getBarionPixelId({ NEXT_PUBLIC_BARION_PIXEL_ID: 'BPT-Teszt00000-T0' })).toBeNull()
  })
})

describe('a bp() biztonságos hívó', () => {
  it('window nélkül (SSR) és bp nélkül is néma no-op — sosem dob', () => {
    expect(typeof globalThis.window).toBe('undefined')
    expect(() => bp('track', 'contentView')).not.toThrow()

    vi.stubGlobal('window', {})
    expect(() => bp('track', 'contentView')).not.toThrow()
  })

  it('meglévő window.bp esetén továbbadja az argumentumokat', () => {
    const hivasok: unknown[][] = []
    vi.stubGlobal('window', {
      bp: (...args: unknown[]): void => {
        hivasok.push(args)
      },
    })

    bp('track', 'contentView', { id: 1 })
    expect(hivasok).toEqual([['track', 'contentView', { id: 1 }]])
  })

  it('a dobó Pixel nem viheti magával a hívó folyamatot', () => {
    vi.stubGlobal('window', {
      bp: (): void => {
        throw new Error('a Pixel elszállt')
      },
    })
    expect(() => bp('track', 'contentView')).not.toThrow()
  })
})

describe('a beillesztett snippet', () => {
  it('beállított azonosítóval a hivatalos alap-snippet kerül ki', () => {
    vi.stubEnv('NEXT_PUBLIC_BARION_PIXEL_ID', TESZT_PIXEL_ID)
    const html = renderToStaticMarkup(createElement(BarionPixel))

    // A hivatalos snippet kötelező elemei — a bp.js MINDEGYIKRE épül.
    expect(html).toContain(BARION_PIXEL_SCRIPT_SRC)
    expect(html).toContain('window["bp"]')
    expect(html).toContain('.q = window["bp"].q || []).push(arguments)')
    expect(html).toContain(`window["barion_pixel_id"] = "${TESZT_PIXEL_ID}"`)
    expect(html).toContain('bp("init", "addBarionPixelId", window["barion_pixel_id"])')
    expect(html).toContain('scriptElement.async = true')
    expect(html).toContain('insertBefore(scriptElement, firstScript)')
  })

  it('azonosító nélkül SEMMI nem renderelődik (fejlesztés, CI)', () => {
    vi.stubEnv('NEXT_PUBLIC_BARION_PIXEL_ID', '')
    expect(renderToStaticMarkup(createElement(BarionPixel))).toBe('')
    expect(renderToStaticMarkup(createElement(BarionPixelNoscript))).toBe('')

    vi.stubEnv('NEXT_PUBLIC_BARION_PIXEL_ID', 'BPT-Teszt00000-T0')
    expect(renderToStaticMarkup(createElement(BarionPixel))).toBe('')
  })

  it('a JS nélküli tartalék-képpont a Barion hostjára mutat, rejtve', () => {
    vi.stubEnv('NEXT_PUBLIC_BARION_PIXEL_ID', TESZT_PIXEL_ID)
    const html = renderToStaticMarkup(createElement(BarionPixelNoscript))

    expect(html).toContain('<noscript>')
    expect(html).toContain(`${BARION_PIXEL_NOSCRIPT_HOST}/a.gif`)
    expect(html).toContain('ev=contentView')
    expect(html).toContain('noscript=1')
    expect(html).toContain('display:none')
    expect(BARION_PIXEL_NOSCRIPT_HOST).toBe(BARION_PIXEL_ORIGIN)
  })
})

describe('az alap Pixel NINCS consent-kapu mögött', () => {
  const KOMPONENS = forrasKommentNelkul('../components/analytics/BarionPixel.tsx')
  const LAYOUT = forrasKommentNelkul('../app/(frontend)/layout.tsx')

  it('a komponens SEHOL nem hivatkozik a hozzájárulás-állapotgépre', () => {
    // Ha ez elbukik, valaki consent-kaput tett az alap Pixel elé — pontosan
    // az, amit a Barion dokumentációja tilt (fraud prevention).
    for (const tiltott of [
      'consent',
      'Consent',
      'CONSENT',
      'readConsent',
      'ConsentBanner',
      'analytics-consent',
    ]) {
      expect(KOMPONENS, tiltott).not.toContain(tiltott)
    }
  })

  it('a komponens szerver-oldali marad (nincs kliens-direktíva, nincs effekt)', () => {
    // 'use client' + useEffect esetén a snippet nem a kiszolgált HTML-be
    // kerülne, hanem futásidőben — onnantól kapuzható lenne.
    expect(KOMPONENS).not.toContain("'use client'")
    expect(KOMPONENS).not.toContain('useEffect')
  })

  it('a layoutban a <head> legelső eleme, és NEM a PostHogProvider alatt', () => {
    const head = /<head>([\s\S]*?)<\/head>/.exec(LAYOUT)
    expect(head, 'a layout <head> blokkja').not.toBeNull()
    const headTartalom = (head as RegExpExecArray)[1]

    expect(headTartalom).toContain('<BarionPixel />')
    // „Minél feljebb”: a betű-előtöltő <link>-ek elé kerül.
    expect(headTartalom.indexOf('<BarionPixel />')).toBeLessThan(headTartalom.indexOf('<link'))

    // A PostHogProvider a <body>-ban él; ha a Pixel oda csúszna, egy
    // kliensoldali provider (és a benne futó consent-logika) alá kerülne.
    const provider = LAYOUT.indexOf('<PostHogProvider>')
    expect(provider).toBeGreaterThan(-1)
    expect(LAYOUT.indexOf('<BarionPixel />')).toBeLessThan(provider)
  })

  it('a Pixel beillesztése feltétel nélküli (nincs && vagy ?: kapu)', () => {
    // A render EGYETLEN feltétele a beállított azonosító, ami a komponensen
    // BELÜL dől el; a layoutban nem lehet további kapu.
    expect(LAYOUT).toMatch(/\n\s*<BarionPixel \/>\n/)
    expect(LAYOUT).not.toMatch(/&&\s*<BarionPixel/)
    expect(LAYOUT).not.toMatch(/\?\s*<BarionPixel/)
  })
})

describe('CSP — a Barion Pixel forrásai', () => {
  const pixellel = buildContentSecurityPolicy(undefined, undefined, TESZT_PIXEL_ID)
  const pixelNelkul = buildContentSecurityPolicy()

  it('beállított azonosítóval a script-src, az img-src ÉS a frame-src nyílik', () => {
    // frame-src: MÉRT igény — a bp.js rejtett iframe-eket szúr be
    // (barion.html / barionbase.html / barionmarketing.html), ezek a tényleges
    // adatcsatornák. Nélküle a Pixel betöltődik, de semmit nem mér.
    for (const nev of ['script-src', 'img-src', 'frame-src']) {
      expect(direktiva(pixellel, nev), nev).toContain(BARION_PIXEL_ORIGIN)
    }
  })

  it('azonosító nélkül a Barion host SEHOL nem jelenik meg', () => {
    expect(pixelNelkul).not.toContain('barion')
    expect(buildContentSecurityPolicy(undefined, undefined, 'BPT-Teszt00000-T0')).not.toContain(
      'barion',
    )
  })

  it("a connect-src marad 'self' — a bp.js nem indít XHR-t/fetch-et", () => {
    expect(direktiva(pixellel, 'connect-src')).toEqual(["'self'"])
  })

  it("a Pixel NEM hoz be 'unsafe-eval'-t", () => {
    // A bp.js egyetlen eval-ja a js-sha1 Node-ágában van, böngészőben nem fut.
    expect(direktiva(pixellel, 'script-src')).not.toContain("'unsafe-eval'")
    expect(pixellel).not.toContain('unsafe-eval')
  })

  it('a meglévő direktívák nem sérülnek (a Bunny és a Turnstile marad)', () => {
    const script = direktiva(pixellel, 'script-src')
    expect(script).toContain("'self'")
    expect(script).toContain('https://challenges.cloudflare.com')
    expect(direktiva(pixellel, 'frame-src')).toContain('https://iframe.mediadelivery.net')
    expect(direktiva(pixellel, 'img-src')).toContain('data:')
  })
})
