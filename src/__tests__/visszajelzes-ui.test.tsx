import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { FeedbackDialog } from '../components/feedback/FeedbackDialog'
import { FeedbackTrigger } from '../components/feedback/FeedbackTrigger'
import {
  hianyzikAMiTortent,
  kuldVisszajelzest,
  type VisszajelzesHttpValasz,
  type VisszajelzesKuldo,
} from '../components/feedback/visszajelzes-kuldes'
import {
  KAPCSOLAT_UTVONAL,
  VISSZAJELZES_BEVEZETO,
  VISSZAJELZES_CIM,
  VISSZAJELZES_HIBA,
  VISSZAJELZES_KULDES_ALLAPOT,
  VISSZAJELZES_MI_TORTENT_CIMKE,
  VISSZAJELZES_MI_TORTENT_HIBA,
  VISSZAJELZES_MI_TORTENT_SUGO,
  VISSZAJELZES_MIT_CSINALTAL_CIMKE,
  VISSZAJELZES_SIKER_CIM,
  VISSZAJELZES_SIKER_SZOVEG,
  VISSZAJELZES_SZOVEGEK,
  VISSZAJELZES_VEGPONT,
} from '../components/feedback/visszajelzes-szoveg'
import { CTA_PROGRESS_LABELS, ctaLabel } from '../lib/cta-vocabulary'

/**
 * WP65 — a hibajelző doboz VEVŐI felülete (renderToStaticMarkup, a
 * newsletter-ui.test.tsx mintája szerint; a vitest `node` környezetben fut,
 * jsdom nincs).
 *
 * Amit ez a réteg őriz:
 *  - a belépőpont felirata BITRE a §3.2 szótárból való,
 *  - a dialógusnak van neve (aria-labelledby a LÁTHATÓ címsorra), a kötelező
 *    mező `required`, és a hibaüzenet-azonosítója be van kötve,
 *  - a csalétek-mező a képernyőolvasó és a Tab-sorrend elől is rejtett,
 *  - a mikroszövegben NINCS gondolatjel (magyar mikroszöveg-szabályzat),
 *  - a beküldés tiszta függvényként mérhető, injektált hálózati hívóval.
 *
 * HÁLÓZAT: a globális fetch hangosan dobó mock, hogy a render és a beküldés
 * semmilyen ágon ne indíthasson valódi hívást (CLAUDE.md 15. tanulság).
 */

vi.stubGlobal('fetch', () => {
  throw new Error('A tesztből SOSEM mehet ki valódi hálózati hívás.')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const REPO = fileURLToPath(new URL('..', import.meta.url))

const triggerHtml = renderToStaticMarkup(createElement(FeedbackTrigger))
const dialogHtml = renderToStaticMarkup(
  createElement(FeedbackDialog, { onClose: () => {}, oldal: '/kurzusok' }),
)

/** A hamis hívó naplója: mit és hova küldött a kliens. */
interface Naplo {
  utvonal?: string
  body?: string
  hivasok: number
}

/** Egy sikeres/hibás szerverválasz hamisítása injektált hívóval. */
function valaszHivo(ok: boolean, torzs: unknown, naplo: Naplo): VisszajelzesKuldo {
  return (utvonal, opciok) => {
    naplo.hivasok += 1
    naplo.utvonal = utvonal
    naplo.body = opciok.body
    const valasz: VisszajelzesHttpValasz = { ok, json: () => Promise.resolve(torzs) }
    return Promise.resolve(valasz)
  }
}

/** Olyan hívó, amelynek NEM szabad lefutnia — ha mégis, hangosan bukik. */
const tiltottHivo: VisszajelzesKuldo = () => {
  throw new Error('ezen az ágon NEM mehet ki hálózati hívás')
}

describe('WP65 — a belépőpont gombja', () => {
  it('a felirat BITRE a §3.2 szótárból való („Hibát jelzek")', () => {
    expect(ctaLabel('feedback-open')).toBe('Hibát jelzek')
    expect(triggerHtml).toContain('Hibát jelzek')
  })

  it('gomb, nem link: a hibajelzés cselekvés, nem navigáció', () => {
    expect(triggerHtml).toContain('<button')
    expect(triggerHtml).toContain('type="button"')
    expect(triggerHtml).not.toContain('<a ')
  })

  it('a doboz CSAK nyitás után kerül a DOM-ba (a 404 cél-leltára nem duplázódik)', () => {
    expect(triggerHtml).not.toContain('<dialog')
    expect(triggerHtml).not.toContain(VISSZAJELZES_CIM)
  })
})

describe('WP65 — a dialógus jelölése', () => {
  it('natív <dialog>, és a nevét a LÁTHATÓ címsor adja (ARIA APG dialog-minta)', () => {
    expect(dialogHtml).toContain('<dialog')
    const labelledby = /aria-labelledby="([^"]+)"/.exec(dialogHtml)
    expect(labelledby, 'hiányzó aria-labelledby').not.toBeNull()
    expect(dialogHtml).toContain(`id="${(labelledby as RegExpExecArray)[1]}"`)
  })

  it('a cím és a felvezető a jóváhagyott mikroszöveg', () => {
    expect(dialogHtml).toContain(VISSZAJELZES_CIM)
    expect(dialogHtml).toContain(VISSZAJELZES_BEVEZETO)
  })

  it('a megnevezett címsor programozottan fókuszálható (a fókusz a dobozba kerül)', () => {
    expect(dialogHtml).toMatch(/<h2[^>]*tabindex="-1"/)
  })

  it('mindkét kérdés mezője címkézett, és mindkettő <textarea>', () => {
    expect(dialogHtml).toContain(VISSZAJELZES_MIT_CSINALTAL_CIMKE)
    expect(dialogHtml).toContain(VISSZAJELZES_MI_TORTENT_CIMKE)
    expect([...dialogHtml.matchAll(/<textarea/g)]).toHaveLength(2)
    const cimkek = [...dialogHtml.matchAll(/<label[^>]*for="([^"]+)"/g)].map((t) => t[1])
    for (const cimkeCel of cimkek) {
      expect(dialogHtml, `a label nem mutat létező mezőre: ${cimkeCel}`).toContain(
        `id="${cimkeCel}"`,
      )
    }
  })

  it('a KÖTELEZŐ mező `required`, és a súgója aria-describedby-n lóg', () => {
    expect(dialogHtml).toContain('required=""')
    expect(dialogHtml).toContain(VISSZAJELZES_MI_TORTENT_SUGO)
    const leiras = /aria-describedby="([^"]+)"/.exec(dialogHtml)
    expect(leiras, 'a kötelező mezőnek nincs aria-describedby-ja').not.toBeNull()
    for (const azonosito of (leiras as RegExpExecArray)[1].split(' ')) {
      expect(dialogHtml, `nem létező leíró azonosító: ${azonosito}`).toContain(`id="${azonosito}"`)
    }
  })

  it('a hibaüzenet AZONOSÍTÓJA a mező id-jéből képződik (a kötés nem csúszhat el)', () => {
    const forras = readFileSync(join(REPO, 'components/feedback/FeedbackDialog.tsx'), 'utf8')
    expect(forras).toContain('const miTortentHibaId = `${miTortentId}-error`')
    expect(forras).toContain(`${'${miTortentHibaId} ${miTortentSugoId}'}`)
    expect(forras).toContain('role="alert"')
  })

  it('a csalétek-mező rejtett: aria-hidden és tabIndex -1', () => {
    expect(dialogHtml).toContain('kc-visszajelzes__csaletek')
    expect(dialogHtml).toMatch(/aria-hidden="true"[^>]*class="kc-visszajelzes__csaletek"/)
    expect(dialogHtml).toContain('tabindex="-1"')
    expect(dialogHtml).toContain('name="weboldal"')
    // A React a `autoComplete` propot a forrás írásmódjával adja vissza a
    // szerver-renderben, ezért kis-nagybetű-érzéketlenül mérünk.
    expect(dialogHtml.toLowerCase()).toContain('autocomplete="off"')
  })

  it('a beküldő gomb a szótári feliratot viszi, és van „folyamatban" alakja', () => {
    expect(ctaLabel('feedback-submit')).toBe('Elküldöm')
    expect(dialogHtml).toContain('Elküldöm')
    expect(CTA_PROGRESS_LABELS.send).toBe('Küldés…')
  })

  it('az élő állapot-régió a beküldés ELŐTT is a DOM-ban áll (SC 4.1.3)', () => {
    expect(dialogHtml).toContain('role="status"')
    expect(dialogHtml).toContain('aria-live="polite"')
    expect(dialogHtml).toContain('class="kc-visszajelzes__allapot"')
  })

  it('kezdetben nincs hibaüzenet és nincs nyugta a jelölésben', () => {
    expect(dialogHtml).not.toContain('role="alert"')
    expect(dialogHtml).not.toContain(VISSZAJELZES_SIKER_CIM)
    expect(dialogHtml).not.toContain(VISSZAJELZES_HIBA)
    expect(dialogHtml).not.toContain(VISSZAJELZES_KULDES_ALLAPOT)
  })

  it('a válaszcsatorna a kapcsolati oldal, a szótári felirattal (nincs e-mail-mező)', () => {
    expect(dialogHtml).toContain(`href="${KAPCSOLAT_UTVONAL}"`)
    expect(dialogHtml).toContain(ctaLabel('contact-open'))
    expect(dialogHtml).not.toContain('type="email"')
  })
})

describe('WP65 — mikroszöveg', () => {
  it('EGYETLEN látogatói szövegben sincs gondolatjel (U+2013) vagy kvirtmínusz (U+2014)', () => {
    const vetok = VISSZAJELZES_SZOVEGEK.filter((szoveg) => /[–—]/u.test(szoveg))
    expect(vetok, 'gondolatjel a vevői szövegben').toEqual([])
  })

  it('nincs benne tiltott hibaszó (G-UI7: Kérjük, Sajnos, Érvénytelen, Hopp, hibakód)', () => {
    const tiltott = /(kérjük|sajnos|érvénytelen|hoppá?|hibakód)/iu
    const vetok = VISSZAJELZES_SZOVEGEK.filter((szoveg) => tiltott.test(szoveg))
    expect(vetok, 'tiltott hibaszó a vevői szövegben').toEqual([])
  })

  it('a siker- és a hibaszöveg megvan, és a hiba megmondja a következő lépést', () => {
    expect(VISSZAJELZES_SIKER_CIM).toBe('Megkaptuk. Köszönjük, hogy szóltál.')
    expect(VISSZAJELZES_SIKER_SZOVEG).toContain('a Kapcsolat oldalon')
    expect(VISSZAJELZES_HIBA).toBe(
      'Most nem sikerült elküldeni. Próbáld újra, vagy írj a Kapcsolat oldalon.',
    )
    expect(VISSZAJELZES_MI_TORTENT_HIBA).toBe('Írd le, mi történt.')
  })
})

describe('WP65 — a beküldés logikája (injektált hálózati hívóval)', () => {
  const alapAdat = {
    mitCsinaltal: 'Megnyitottam a kurzusoldalt.',
    miTortent: 'A videó nem indult el.',
    oldal: '/kurzusok/sos',
    weboldal: '',
    analitikaAzonosito: null,
  }

  it('boldog ág: a végpontra POST megy, és a válasz ok', async () => {
    const naplo: Naplo = { hivasok: 0 }
    const eredmeny = await kuldVisszajelzest(alapAdat, valaszHivo(true, { ok: true }, naplo))
    expect(eredmeny).toEqual({ ok: true })
    expect(naplo.hivasok).toBe(1)
    expect(naplo.utvonal).toBe(VISSZAJELZES_VEGPONT)
    expect(JSON.parse(naplo.body as string)).toEqual(alapAdat)
  })

  it('a csomag mind az öt mezőt viszi, az `oldal` pedig CSAK útvonal', () => {
    const naplo: Naplo = { hivasok: 0 }
    return kuldVisszajelzest(alapAdat, valaszHivo(true, { ok: true }, naplo)).then(() => {
      const csomag = JSON.parse(naplo.body as string) as Record<string, unknown>
      expect(Object.keys(csomag).sort()).toEqual([
        'analitikaAzonosito',
        'miTortent',
        'mitCsinaltal',
        'oldal',
        'weboldal',
      ])
      expect(csomag.oldal).toBe('/kurzusok/sos')
      expect(String(csomag.oldal)).not.toContain('?')
      expect(String(csomag.oldal)).not.toContain('http')
    })
  })

  it('szerverhiba: a végpont üzenetét adja vissza, nem dob', async () => {
    const naplo: Naplo = { hivasok: 0 }
    const eredmeny = await kuldVisszajelzest(
      alapAdat,
      valaszHivo(false, { ok: false, uzenet: VISSZAJELZES_HIBA }, naplo),
    )
    expect(eredmeny).toEqual({ ok: false, uzenet: VISSZAJELZES_HIBA })
  })

  it('üzenet nélküli szerverhiba: a magyar alapüzenet megy ki', async () => {
    const naplo: Naplo = { hivasok: 0 }
    const eredmeny = await kuldVisszajelzest(alapAdat, valaszHivo(false, null, naplo))
    expect(eredmeny).toEqual({ ok: false, uzenet: VISSZAJELZES_HIBA })
  })

  it('hálózati kivétel: magyar hibaüzenet, nem felbuborékoló hiba', async () => {
    const eredmeny = await kuldVisszajelzest(alapAdat, () => Promise.reject(new Error('offline')))
    expect(eredmeny).toEqual({ ok: false, uzenet: VISSZAJELZES_HIBA })
  })

  it('a csalétek ÉRINTETLEN: a boldog ág tényleg hívja a szervert', async () => {
    const naplo: Naplo = { hivasok: 0 }
    await kuldVisszajelzest({ ...alapAdat, weboldal: '' }, valaszHivo(true, { ok: true }, naplo))
    expect(naplo.hivasok).toBe(1)
  })

  it('a csalétek KITÖLTVE: hálózati hívás nélkül „sikerül" (bot-ág)', async () => {
    const eredmeny = await kuldVisszajelzest({ ...alapAdat, weboldal: 'bot' }, tiltottHivo)
    expect(eredmeny).toEqual({ ok: true })
  })

  it('a kötelező mező validálása a csupa szóközt is hiánynak látja', () => {
    expect(hianyzikAMiTortent('')).toBe(true)
    expect(hianyzikAMiTortent('   \n ')).toBe(true)
    expect(hianyzikAMiTortent('Nem tölt be.')).toBe(false)
  })
})

describe('WP65 — stíluslap', () => {
  const css = readFileSync(join(REPO, 'app/(frontend)/styles/visszajelzes.css'), 'utf8')

  it('be van kötve a (frontend) globális stíluslapjába', () => {
    const belepo = readFileSync(join(REPO, 'app/(frontend)/styles.css'), 'utf8')
    expect(belepo).toContain("@import './styles/visszajelzes.css';")
  })

  it('NEM vezet be új betűméretet (a három-méretes skála sértetlen)', () => {
    expect(css.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/font-size:/)
  })

  it('mindkét saját kattintható elem legalább 44px magas (WCAG 2.2 SC 2.5.8)', () => {
    expect(css).toMatch(/\.kc-visszajelzes__nyito\s*\{[^}]*min-height:\s*2\.75rem/)
    expect(css).toMatch(/\.kc-visszajelzes__bezar\s*\{[^}]*min-height:\s*2\.75rem/)
  })

  it('320px-en nem nyílik szét: a doboz szélességét max-inline-size fogja', () => {
    expect(css).toMatch(
      /\.kc-visszajelzes\s*\{[^}]*max-inline-size:\s*calc\(100% - 2 \* var\(--kc-space-4\)\)/,
    )
  })

  it('320px-en a fejléc TÖRIK, hogy a címsor ne csorduljon túl (SC 1.4.10 Reflow)', () => {
    // Mérve (Tenor Sans 400 @32px, a repó font-metrics mérőjével): a
    // tartalom-hasáb 320px-en 238px, a bezáró gomb 83px, marad 143px; a cím
    // leghosszabb szava („probléma?") 160px, a nyugtáé („Megkaptuk.") 181px.
    expect(css).toMatch(/\.kc-visszajelzes__fejlec\s*\{[^}]*flex-wrap:\s*wrap-reverse/)
    expect(css).toMatch(/\.kc-visszajelzes__cim\s*\{[^}]*flex:\s*1 1 11rem/)
  })

  it('a mozgás `prefers-reduced-motion` mögött áll', () => {
    const mozgas = css.slice(css.indexOf('@media (prefers-reduced-motion'))
    expect(mozgas).toContain('no-preference')
    expect(mozgas).toContain('animation: kc-fade-up')
  })

  it('nincs benne sötét felület (a G-K3 fókusz-regiszter érintetlen marad)', () => {
    expect(css).not.toMatch(
      /background(-color)?\s*:\s*var\(\s*--kc-color-(surface-dark|ink|navy-900|primary|primary-hover|accent-deep|accent-deeper)\s*\)/,
    )
  })
})
