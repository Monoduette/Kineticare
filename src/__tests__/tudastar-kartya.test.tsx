import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { PostCard } from '../components/content/PostCard'
import { KnowledgeSection } from '../components/content/home/KnowledgeSection'
import { PostView } from '../components/content/PostView'
import { hosszPx, stilusLapNezetablakra, tokenek, varFeloldas } from './helpers/css-geometria'
import type { Category, Post } from '../payload-types'

/**
 * ŐR — A TUDÁSTÁR KÁRTYÁJA (PostCard).
 *
 * Mit véd, és miért csak végrehajtható szabály védheti meg:
 *
 *  K1  A kártya-link HOZZÁFÉRHETŐ NEVE = a cikk címe, legfeljebb 80 karakter.
 *      A `docs/tudastar-a11y-meres.md` 3.2 pontja három valódi kapcsolódó
 *      kártyán 206 / 227 / 212 karaktert mért, mert az egész kártya EGY `<a>`
 *      volt: a név a kategória-címke + cím + kivonat + dátum összeragadása. Ez
 *      NÉMA hiba — a lap 200-zal válaszol, semmi nem hibázik, a képernyőolvasó
 *      link-listája (VoiceOver rotor, NVDA link lista) mégis használhatatlan.
 *      Egy jó szándékú „tegyük vissza a kivonatot a linkbe" szerkesztés
 *      bármikor visszahozná.
 *  K2  A kártya címe VALÓDI CÍMSOR, és a link ABBAN áll. `<span>` címmel a
 *      kártyák a címsor-listából is kiesnek (WCAG 2.2 2.4.10, AAA).
 *  K3  A `compact` változat a kivonatot NEM RENDERELI (nem elrejti). Elrejtés
 *      esetén a szöveg a DOM-ban maradna, és a képernyőolvasó/keresőrobot
 *      számára a kártya továbbra is hordozná — a hármas rács 24–38
 *      karakter/soros kivonatát viszont nem szabad odatenni
 *      (`docs/ui-sztenderdek.md` Ü6: a 45 alatti sor bukás).
 *  K4  A `list` (alapértelmezett) változat viszont HOZZA a kivonatot — a
 *      visszafelé kompatibilitás mérve, nem ígérve.
 *  K5  A CSS-minta: a kártya `position: relative`, és a cím-link `::after`
 *      pszeudoeleme `inset: 0`-val kitölti a kártyát. E kettő EGYÜTT tartja
 *      meg a teljes kártyát kattinthatónak, miközben a link neve a cím marad.
 *      Ha bármelyik kiesik, a kártya többi felülete némán elveszti a
 *      kattinthatóságot.
 *  K6  CÍMSOR-HIERARCHIA HÉZAG NÉLKÜL mind a NÉGY felületen, ahol a kártya
 *      megjelenik. A szint nem lehet fix: a kezdőlapi szekció és a kapcsolódó
 *      blokk fölött h2 áll (→ a kártya h3), a `/blog` és a kategória-oldal
 *      fölött viszont csak h1 (→ a kártya h2). Fix h3 mellett a lista-oldalak
 *      h1 → h3 ugrást kapnának.
 *  K7  A fókuszgyűrű a TELJES kártyát rajzolja körbe, és a betűméret-skála
 *      zárva marad (három token).
 *
 * A tesztkörnyezet `node` (nincs jsdom), ezért a SZERVER-RENDELT kimenetet
 * mérjük — pontosan azt, amit a JS nélküli látogató és a keresőrobot lát.
 */

const REPO = fileURLToPath(new URL('..', import.meta.url))

const render = (element: Parameters<typeof renderToStaticMarkup>[0]): string =>
  renderToStaticMarkup(element)

const KARTYA_CSS = `${REPO}app/(frontend)/styles/blocks/knowledge.css`

/** A CSS kommentek nélkül — a kommentben álló minta nem számít szabálynak. */
const kodCsak = (forras: string): string => forras.replace(/\/\*[\s\S]*?\*\//g, '')

/** Jelölés nélküli szöveg, a React entitásainak visszafejtésével. */
function szoveg(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replaceAll('&quot;', '"')
    .replaceAll('&#x27;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
}

/**
 * `aria-hidden="true"` részfák eltávolítása. A hozzáférhető név számítása
 * ezeket KIHAGYJA (W3C, *Accessible Name and Description Computation 1.2*,
 * 2.1 „Hidden Not Referenced"), tehát a dekoratív nyíl nem része a névnek.
 * A minta nem kezel azonos elemnevű egymásba ágyazást — a kártyán nincs ilyen.
 */
function ariaRejtettNelkul(html: string): string {
  return html.replace(/<(\w+)\b[^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/\1>/g, '')
}

/**
 * A kártya-linkek HOZZÁFÉRHETŐ NEVE, sorrendben. `aria-label` és
 * `aria-labelledby` nélkül a név a leszármazottak szövegéből áll össze
 * (ugyanaz a szabvány, 4.3.2 „Name From Content"), tehát a linken belüli
 * minden nem rejtett szöveg beleszámít.
 */
function kartyaLinkNevek(html: string): string[] {
  const nevek: string[] = []
  const minta = /<a\b[^>]*class="[^"]*kc-post-card__link[^"]*"[^>]*>([\s\S]*?)<\/a>/g
  let talalat: RegExpExecArray | null
  while ((talalat = minta.exec(html)) !== null) {
    // A beágyazott kép ALT-ja is a névhez tartozik (a szabvány 2F/„Name From
    // Content" ága a `img` helyettesítő szövegét is beszámítja), ezért a
    // jelölés-kiszedés ELŐTT beemeljük szövegként.
    const altfeloldva = talalat[1]!.replace(
      /<img\b[^>]*\balt="([^"]*)"[^>]*>/g,
      (_egesz, alt: string) => alt,
    )
    nevek.push(szoveg(ariaRejtettNelkul(altfeloldva)))
  }
  return nevek
}

/** A kártyacímek címsor-szintjei a renderelt kimenetből (`h2` / `h3` / …). */
function kartyaCimSzintek(html: string): string[] {
  return [...html.matchAll(/<(h[1-6])\b[^>]*class="[^"]*kc-post-card__title[^"]*"/g)].map(
    (talalat) => talalat[1]!,
  )
}

/** A lap címsorai szintenként, dokumentum-sorrendben (a hézag-vizsgálathoz). */
function cimsorSzintek(html: string): number[] {
  return [...html.matchAll(/<h([1-6])\b/g)].map((talalat) => Number(talalat[1]))
}

// ---------------------------------------------------------------------------
// Fixture — a docs/tudastar-a11y-meres.md 3.2 pontjában MÉRT három kártya
// ---------------------------------------------------------------------------

const KATEGORIA: Category = {
  id: 1,
  title: 'Kézzsibbadás',
  slug: 'kezzsibbadas',
  updatedAt: '2026-01-02T10:00:00.000Z',
  createdAt: '2026-01-02T10:00:00.000Z',
} as Category

type Minta = { readonly cim: string; readonly kivonat: string; readonly datum: string }

/**
 * A három minta a mérési jegyzőkönyv kártyáit hozza vissza: a cím és a
 * kivonat-kezdet onnan való, a kivonat hossza pedig úgy van beállítva, hogy a
 * RÉGI szerkezet linkneve pontosan a mért 206 / 227 / 212 karaktert adja
 * (kategória + cím + kivonat + magyar hosszú dátum).
 */
const MINTAK: readonly Minta[] = [
  {
    cim: 'Kéztőalagút-szindróma: mit tehetsz otthon?',
    kivonat:
      'A kéztőalagút-szindróma a leggyakoribb idegbecsípődés a kézen. Megmutatjuk, mit tehetsz otthon a panaszok ellen, és mikor kell orvoshoz.',
    datum: '2026-03-04T09:00:00.000Z',
  },
  {
    cim: 'Teniszkönyök: miért fáj, és mennyi idő alatt javul?',
    kivonat:
      'A teniszkönyök a legtöbb embernél nem sportsérülés, hanem terhelési hiba. Végigvesszük, mi okozza a fájdalmat, és mennyi idő alatt gyógyul a könyök.',
    datum: '2026-04-08T09:00:00.000Z',
  },
  {
    cim: 'Pattanó ujj: mi történik az ínhüvelyben?',
    kivonat:
      'Reggel beragad az ujjad, majd hangos kattanással kienged? Az ínhüvely szűkületéről van szó. Elmondjuk, mi történik benne, és mit tehetsz otthon.',
    datum: '2026-01-15T09:00:00.000Z',
  },
]

function poszt(minta: Minta, index: number): Post {
  return {
    id: index + 1,
    title: minta.cim,
    slug: `minta-${index + 1}`,
    excerpt: minta.kivonat,
    status: 'published',
    publishedAt: minta.datum,
    categories: [KATEGORIA],
    content: null,
    updatedAt: minta.datum,
    createdAt: minta.datum,
  } as unknown as Post
}

const POSZTOK: readonly Post[] = MINTAK.map(poszt)

/** A terv 3.5 pontjának elfogadási feltétele: a linknév felső határa. */
const NEV_HATAR = 80

// ---------------------------------------------------------------------------
// K1 — a link hozzáférhető neve
// ---------------------------------------------------------------------------

describe('K1 — a kártya-link neve a cikk címe, legfeljebb 80 karakter', () => {
  it('mind a három mintán a név PONTOSAN a cím', () => {
    for (const minta of MINTAK) {
      const html = render(createElement(PostCard, { post: poszt(minta, 0) }))
      expect(kartyaLinkNevek(html)).toEqual([minta.cim])
    }
  })

  it('mind a három mintán a név 80 karakter alatt marad', () => {
    const hosszak = MINTAK.map((minta) => {
      const html = render(createElement(PostCard, { post: poszt(minta, 0) }))
      return kartyaLinkNevek(html)[0]?.length ?? -1
    })
    // A mért kiindulás (docs/tudastar-a11y-meres.md 3.2): 206 / 227 / 212.
    expect(hosszak).toEqual([42, 51, 40])
    for (const hossz of hosszak) {
      expect(hossz).toBeLessThanOrEqual(NEV_HATAR)
    }
  })

  it('a kivonat, a kategória-címke és a dátum a linken KÍVÜL áll', () => {
    const minta = MINTAK[0]!
    const html = render(createElement(PostCard, { post: poszt(minta, 0) }))
    const nev = kartyaLinkNevek(html)[0] ?? ''
    expect(nev).not.toContain(KATEGORIA.title)
    expect(nev).not.toContain(minta.kivonat.slice(0, 24))
    expect(nev).not.toContain('2026.')
    // A kártya EGÉSZE viszont továbbra is hozza mindhármat.
    expect(szoveg(html)).toContain(KATEGORIA.title)
    expect(szoveg(html)).toContain(minta.kivonat)
  })

  it('a hármas rács három neve az ELSŐ KARAKTERTŐL különbözik', () => {
    // NN/g, *Writing Hyperlinks*: az emberek „mostly look at the first 2 words
    // of a link". A régi szerkezetben mindhárom név a KATEGÓRIA nevével
    // kezdődött („Kézzsibbadás…"), tehát a rotor link-listája
    // megkülönböztethetetlen volt.
    const html = render(createElement(KnowledgeSection, { posts: [...POSZTOK] }))
    const nevek = kartyaLinkNevek(html)
    expect(nevek).toHaveLength(3)
    for (const nev of nevek) {
      expect(nev.startsWith(KATEGORIA.title)).toBe(false)
    }
    const eleje = nevek.map((nev) => nev.slice(0, 12))
    expect(new Set(eleje).size).toBe(3)
  })

  it('a BORÍTÓ alt-szövege sem kerül a link nevébe', () => {
    // A régi szerkezetben a `<a>` a borítót is átfogta, tehát a kép alt-ja is
    // a névbe került. A borító innentől a linken kívül áll.
    const boritos = {
      ...POSZTOK[0]!,
      heroImage: {
        id: 9,
        url: '/borito.webp',
        width: 1280,
        height: 720,
        alt: 'Kézfej vizsgálata a rendelőben, a terapeuta a csuklót mozgatja',
        sizes: { sm: { url: '/borito-640.webp', width: 640, height: 360 } },
      },
    } as unknown as Post
    const html = render(createElement(PostCard, { post: boritos }))
    expect(html).toContain('kc-post-card__cover')
    expect(kartyaLinkNevek(html)).toEqual([POSZTOK[0]!.title])
    expect(kartyaLinkNevek(html)[0]).not.toContain('Kézfej')
  })

  it('a kártyán nincs beágyazott második link vagy gomb (az overlay elnyelné)', () => {
    const html = render(createElement(PostCard, { post: POSZTOK[0]! }))
    expect([...html.matchAll(/<a\b/g)]).toHaveLength(1)
    expect(html).not.toContain('<button')
  })
})

// ---------------------------------------------------------------------------
// K2 — a cím valódi címsor
// ---------------------------------------------------------------------------

describe('K2 — a kártya címe címsor, és a link abban áll', () => {
  it('a cím címsor-elem, nem span', () => {
    const html = render(createElement(PostCard, { post: POSZTOK[0]! }))
    expect(kartyaCimSzintek(html)).toEqual(['h3'])
    expect(html).not.toMatch(/<span[^>]*class="[^"]*kc-post-card__title/)
  })

  it('a link a címsoron BELÜL van (a címsor szövege = a link neve)', () => {
    const html = render(createElement(PostCard, { post: POSZTOK[1]! }))
    const cimsor = /<h3\b[^>]*class="[^"]*kc-post-card__title[^"]*"[^>]*>([\s\S]*?)<\/h3>/.exec(html)
    expect(cimsor).not.toBeNull()
    expect(cimsor![1]).toContain('kc-post-card__link')
    expect(szoveg(cimsor![1]!)).toBe(POSZTOK[1]!.title)
  })
})

// ---------------------------------------------------------------------------
// K3 / K4 — a két változat
// ---------------------------------------------------------------------------

describe('K3 — a compact változat NEM rendereli a kivonatot', () => {
  it('a kivonat szövege nincs a kimenetben', () => {
    const minta = MINTAK[0]!
    const html = render(createElement(PostCard, { post: poszt(minta, 0), variant: 'compact' }))
    expect(html).not.toContain(minta.kivonat)
    expect(szoveg(html)).not.toContain(minta.kivonat.slice(0, 24))
  })

  it('nem elrejtés: a kivonat DOBOZA sincs a DOM-ban', () => {
    const html = render(createElement(PostCard, { post: POSZTOK[0]!, variant: 'compact' }))
    expect(html).not.toContain('kc-post-card__excerpt')
    // Nem elrejtés semmilyen alakban: se stílus, se attribútum, se levágás.
    expect(html).not.toMatch(/display:\s*none/)
    expect(html).not.toMatch(/visibility:\s*hidden/)
    expect(html).not.toContain('line-clamp')
    expect(html).not.toMatch(/<[^>]*\bhidden\b(?!=)/)
  })

  it('a HÁRMAS rácsú felületek ténylegesen `compact`-ot kérnek', () => {
    // Enélkül a 24–38 karakter/soros kivonat NÉMÁN visszatérne a kezdőlapra
    // és a cikkoldal kapcsolódó blokkjába: a lap 200-zal válaszolna, semmi nem
    // hibázna, csak olvashatatlan lenne (docs/tudastar-a11y-meres.md 3.1).
    const kezdolap = render(createElement(KnowledgeSection, { posts: [...POSZTOK] }))
    expect(kezdolap).not.toContain('kc-post-card__excerpt')

    const cikkoldal = render(
      createElement(PostView, {
        post: { ...POSZTOK[0]!, relatedPosts: [...POSZTOK] } as unknown as Post,
      }),
    )
    expect(cikkoldal).not.toContain('kc-post-card__excerpt')
    // A cikk SAJÁT kivonata viszont ott marad a lead-bekezdésben — a kártya
    // szövege tehát nem tűnik el a lapról, csak a kártyáról.
    expect(cikkoldal).toContain('kc-page-hero__lead')
  })

  it('a compact kártya minden MÁS mezőt hoz (cím, kategória, dátum)', () => {
    const html = render(createElement(PostCard, { post: POSZTOK[0]!, variant: 'compact' }))
    const kimenet = szoveg(html)
    expect(kimenet).toContain(POSZTOK[0]!.title)
    expect(kimenet).toContain(KATEGORIA.title)
    expect(kimenet).toContain('2026. március 4.')
  })
})

describe('K4 — a list változat (és az alapértelmezés) hozza a kivonatot', () => {
  it('alapértelmezésben ott a kivonat — a meglévő hívások változatlanok', () => {
    const html = render(createElement(PostCard, { post: POSZTOK[2]! }))
    expect(html).toContain('kc-post-card__excerpt')
    expect(szoveg(html)).toContain(MINTAK[2]!.kivonat)
  })

  it('a kimondott `list` változat ugyanaz, mint az alapértelmezés', () => {
    const alap = render(createElement(PostCard, { post: POSZTOK[2]! }))
    const lista = render(createElement(PostCard, { post: POSZTOK[2]!, variant: 'list' }))
    expect(lista).toBe(alap)
  })
})

// ---------------------------------------------------------------------------
// K5 — a CSS-minta (overlay + relatív kártya)
// ---------------------------------------------------------------------------

describe('K5 — az egész kártya kattintható marad (overlay-minta)', () => {
  const css = kodCsak(readFileSync(KARTYA_CSS, 'utf8'))

  it('a kártya gyökere `position: relative`', () => {
    expect(css).toMatch(/\.kc-post-card\s*\{[^}]*position:\s*relative;/)
  })

  it('a cím-link `::after` pszeudoeleme `inset: 0`-val kitölti a kártyát', () => {
    const szabaly = /\.kc-post-card__link::after\s*\{([^}]*)\}/.exec(css)
    expect(szabaly).not.toBeNull()
    const test = szabaly![1]!
    expect(test).toMatch(/content:\s*''/)
    expect(test).toMatch(/position:\s*absolute;/)
    expect(test).toMatch(/inset:\s*0;/)
  })

  it('a link nem viszi tovább a régi, kártya-méretű flex-dobozt', () => {
    expect(css).toMatch(/\.kc-post-card\s+\.kc-post-card__link\s*\{[^}]*display:\s*inline;/)
  })
})

// ---------------------------------------------------------------------------
// K6 — címsor-hierarchia mind a négy felületen
// ---------------------------------------------------------------------------

describe('K6 — a címsor-szint hézag nélküli minden felületen', () => {
  it('kezdőlapi szekció: h2 szekciócím → h3 kártyacímek, ugrás nélkül', () => {
    const html = render(createElement(KnowledgeSection, { posts: [...POSZTOK] }))
    expect(cimsorSzintek(html)).toEqual([2, 3, 3, 3])
    expect(kartyaCimSzintek(html)).toEqual(['h3', 'h3', 'h3'])
  })

  it('cikkoldal kapcsolódó blokkja: h1 → h2 szekciócím → h3 kártyacímek', () => {
    const html = render(
      createElement(PostView, {
        post: { ...POSZTOK[0]!, relatedPosts: [...POSZTOK] } as unknown as Post,
      }),
    )
    const szintek = cimsorSzintek(html)
    expect(szintek[0]).toBe(1)
    expect(szintek.filter((szint) => szint === 1)).toHaveLength(1)
    expect(kartyaCimSzintek(html)).toEqual(['h3', 'h3', 'h3'])
    // Hézag: két egymást követő címsor között legfeljebb EGY szint a lépés.
    for (let i = 1; i < szintek.length; i += 1) {
      expect(szintek[i]! - szintek[i - 1]!).toBeLessThanOrEqual(1)
    }
  })

  it('a lista-oldalak h1 alá h2 kártyacímet kérnek (nincs h1 → h3 ugrás)', () => {
    const html = render(
      createElement(PostCard, { post: POSZTOK[0]!, headingLevel: 2 }),
    )
    expect(kartyaCimSzintek(html)).toEqual(['h2'])
  })

  it('a /blog és a kategória-oldal ténylegesen h2-t kér a kártyától', () => {
    for (const ut of ['app/(frontend)/blog/page.tsx', 'app/(frontend)/blog/kategoria/[slug]/page.tsx']) {
      const forras = readFileSync(`${REPO}${ut}`, 'utf8')
      expect(forras).toContain('<h1')
      expect(forras).toMatch(/<PostCard[^>]*headingLevel=\{2\}/)
    }
  })
})

// ---------------------------------------------------------------------------
// K7 — fókusz, érintőcél, zárt betűskála
// ---------------------------------------------------------------------------

describe('K7 — fókusz, érintőcél és a zárt betűskála', () => {
  const css = kodCsak(readFileSync(KARTYA_CSS, 'utf8'))

  it('a fókuszgyűrű a TELJES kártyát rajzolja körbe, nem csak a címet', () => {
    expect(css).toMatch(
      /\.kc-post-card__link:focus-visible::after\s*\{[^}]*outline:\s*3px solid var\(--kc-color-focus\);/,
    )
    expect(css).toMatch(
      /\.kc-post-card__link:focus-visible::after\s*\{[^}]*outline-offset:\s*2px;/,
    )
  })

  it('a kártya érintőcélja bőven 44 px fölött van (a body két paddingje)', () => {
    const lap = stilusLapNezetablakra(
      [`${REPO}app/(frontend)/styles/tokens.css`],
      320,
      1000, // docs/ui-sztenderdek.md N-4/N-5: dokumentált 320×1000 CSS px-es mérési nézet.
    )
    const map = tokenek(lap)
    const padding = hosszPx(varFeloldas('var(--kc-space-5)', map), 320, 16, 16)
    expect(padding).toBeCloseTo(24, 5)
    // A cím sormagasságát NEM számoljuk bele: a puszta belső margó is elég.
    expect(2 * padding).toBeGreaterThanOrEqual(44)
  })

  it('betűméret kizárólag a három tokenről (a skála zárt)', () => {
    for (const meret of [...css.matchAll(/font-size:\s*([^;]+);/g)].map((m) => m[1]!.trim())) {
      expect(['var(--kc-font-l)', 'var(--kc-font-m)', 'var(--kc-font-s)']).toContain(meret)
    }
  })
})
