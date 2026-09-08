import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { createElement, Fragment, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getPageBySlug } from '@/lib/cms'

import { RenderBlocks } from '../components/blocks/RenderBlocks'
import { minimalRichText } from '../lib/home-seed'
import {
  buildKapcsolatLayout,
  buildRolunkLayout,
  buildSzolgaltatasokLayout,
  IDOPONTKERES_HORGONY,
  IDOPONTKERES_URL,
  SZAKMAI_HATTER_URL,
} from '../scripts/restore-legacy-content'
import type { Page } from '../payload-types'

vi.mock('next/headers', () => ({ draftMode: vi.fn(async () => ({ isEnabled: false })) }))
vi.mock('@/lib/cms', () => ({
  getPageBySlug: vi.fn(),
  getPublishedProducts: vi.fn(async () => []),
  getLatestPosts: vi.fn(async () => []),
  getTestimonials: vi.fn(async () => []),
  getPublishedPageSlugs: vi.fn(async () => new Set<string>()),
}))
vi.mock('@/lib/appointment/section', () => ({
  getAppointmentSectionContext: vi.fn(async () => ({ formId: '42', turnstileSiteKey: null })),
}))

/**
 * A /kapcsolat lap IDŐPONTKÉRŐ szekciójának alapállapota (a legacy-visszaépítő
 * script tölti fel egyszer, utána minden szöveg az adminé).
 * 1. Az alap-szekciósor a VALÓS rendelői adatokat viszi (két budapesti cím,
 * a két gyógytornász telefonszáma, az e-mail-cím). A blokkosítás nem
 * veszíthet el kapcsolatfelvételi utat: aki nem tölt ki űrlapot, annak a
 */

vi.stubGlobal('fetch', () => {
  throw new Error('A tesztből SOSEM mehet ki valódi hálózati hívás.')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

type Layout = NonNullable<Page['layout']>

function render(node: ReactNode): string {
  return renderToStaticMarkup(createElement(Fragment, null, node))
}

/** A szekciósor renderelése úgy, ahogy a /kapcsolat route teszi. */
function renderKapcsolatLayout(): string {
  return render(
    createElement(RenderBlocks, {
      layout: buildKapcsolatLayout() as unknown as Layout,
      products: [],
      posts: [],
      testimonials: [],
      appointment: { formId: '42', turnstileSiteKey: null },
    }),
  )
}

describe('/kapcsolat alap-szekciósor', () => {
  it('két szekcióból áll: az időpontkérőből, utána a szakember-elérhetőségből', () => {
    const layout = buildKapcsolatLayout()
    expect(layout.map((blokk) => blokk.blockType)).toEqual(['appointment', 'teamMembers'])
  })

  it('a rendelő MINDEN elérhetősége megjelenik a renderelt kimeneten', () => {
    const html = renderKapcsolatLayout()
    expect(html).toContain('1117 Budapest, Nádorliget u. 7/b')
    expect(html).toContain('1114 Budapest, Fadrusz utca 15.')
    expect(html).toContain('+36 30 169 2263')
    expect(html).toContain('+36 20 357 3493')
    expect(html).toContain('info@kineticare.hu')
    // A telefonszámok kattinthatók (mobilon ez a leggyorsabb út).
    expect(html).toContain('href="tel:+36301692263"')
    expect(html).toContain('href="tel:+36203573493"')
  })

  it('a szekció horgonyt kap, és a szolgáltatás-oldal CTA-ja arra mutat', () => {
    expect(IDOPONTKERES_URL).toBe(`/kapcsolat#${IDOPONTKERES_HORGONY}`)
    expect(renderKapcsolatLayout()).toContain(`id="${IDOPONTKERES_HORGONY}"`)

    // A /szolgaltatasok szekciósorában az „Időpontot kérek" sor-hivatkozás.
    const szolgaltatasok = JSON.stringify(buildSzolgaltatasokLayout())
    expect(szolgaltatasok).toContain(IDOPONTKERES_URL)
  })

  it('a magyarázat kimondja, hogy NEM foglalás, és megmondja a visszahívás idejét', () => {
    const html = renderKapcsolatLayout()
    expect(html).toContain('nem foglalás')
    expect(html).toContain('két munkanapon belül')
  })

  it('a felkínált időpont-sávok között nincs olyan, amit nem tudunk tartani', () => {
    const html = renderKapcsolatLayout()
    expect(html).toContain('Hétköznap délelőtt')
    expect(html).toContain('Hétköznap délután')
    expect(html).toContain('Rugalmas vagyok')
    // Hétvégi rendelést a repó semmilyen forrása nem igazol.
    expect(html.toLowerCase()).not.toContain('hétvég')
  })

  it('az űrlap ott van, és a hozzájárulás az adatvédelmi tájékoztatóra linkel', () => {
    const html = renderKapcsolatLayout()
    expect(html).toContain('kc-appointment__form')
    expect(html).toContain('href="/adatvedelem"')
  })
})

/**
 * A /kapcsolat SZAKEMBER-ELÉRHETŐSÉGE (tulajdonosi kérés, 2026-08-16: „lányok
 * elérhetősége kell a kapcsolat menüpontba is").
 * 1. SORREND. A szekció az időpontkérő UTÁN áll: az időpontkérő bal hasábja
 * már kiírja mindkét telefonszámot (NN/g kapcsolat-oldal irányelve: az
 * űrlap csak a telefonszám MELLETT állhat, nem helyette), ez a szekció
 */
describe('/kapcsolat szakember-elérhetőség', () => {
  const kapcsolatSzakember = () => {
    const blokk = buildKapcsolatLayout({ kocsisPortre: 31, kissPortre: 32 }).find(
      (elem) => elem.blockType === 'teamMembers',
    )
    if (blokk?.blockType !== 'teamMembers') {
      throw new Error('A szakember-szekció hiányzik a /kapcsolat szekciósorból.')
    }
    return blokk
  }

  it('az időpontkérő UTÁN áll, és megtartja a sávritmust (tint → fehér)', () => {
    const layout = buildKapcsolatLayout()
    const idopont = layout.findIndex((blokk) => blokk.blockType === 'appointment')
    const szakember = layout.findIndex((blokk) => blokk.blockType === 'teamMembers')
    expect(idopont).toBeGreaterThanOrEqual(0)
    expect(szakember).toBe(idopont + 1)

    // A sávritmus: az időpontkérő világoskék, a szakember-szekció fehér — az
    // utána következő üzenetküldő szekcióval EGY régiót alkotva (B2.2).
    const idopontBlokk = layout[idopont]
    const szakemberBlokk = layout[szakember]
    if (idopontBlokk.blockType !== 'appointment' || szakemberBlokk.blockType !== 'teamMembers') {
      throw new Error('A /kapcsolat szekciósor nem a várt két blokkot adta.')
    }
    expect(idopontBlokk.sectionSettings?.hatter).toBe('tint')
    expect(szakemberBlokk.sectionSettings?.hatter).toBe('feher')
  })

  it('mindkét gyógytornász neve, titulusa és kattintható száma megjelenik', () => {
    const html = renderKapcsolatLayout()
    expect(html).toContain('Kocsis Kata')
    expect(html).toContain('Kiss Kata')
    expect(html).toContain('Hívd Kocsis Katát')
    expect(html).toContain('Hívd Kiss Katát')
    // A szekció saját, kattintható hívás-felülete (az időpontkérő listáján felül).
    expect((html.match(/class="kc-team__call"/g) ?? []).length).toBe(2)
    for (const tag of kapcsolatSzakember().members ?? []) {
      expect((tag.role ?? '').trim().length).toBeGreaterThan(0)
    }
  })

  it('a portrék bekerülnek, de kép nélkül is felépül a szekció', () => {
    expect((kapcsolatSzakember().members ?? []).map((tag) => tag.photo)).toEqual([31, 32])
    const kepNelkul = buildKapcsolatLayout().find((blokk) => blokk.blockType === 'teamMembers')
    if (kepNelkul?.blockType !== 'teamMembers') {
      throw new Error('A szakember-szekció kép nélkül eltűnt a szekciósorból.')
    }
    expect((kepNelkul.members ?? []).map((tag) => tag.photo)).toEqual([undefined, undefined])
  })

  it('az írásos időpontkérés NEM önmagára mutat, hanem a lapon belüli horgonyra', () => {
    const blokk = kapcsolatSzakember()
    expect(blokk.bookingLink?.url).toBe(`#${IDOPONTKERES_HORGONY}`)
    // A felirat a §3.2 szótár #24 sora — a cselekvés ugyanaz, csak a cél
    // kifejezése lapon belüli (WCAG 2.2 · 3.2.4 Consistent Identification).
    expect(blokk.bookingLink?.felirat).toBe('Kérj időpontot üzenetben')
    // A horgony célja tényleg ezen a lapon van.
    const horgonyok = buildKapcsolatLayout().map((elem) => elem.sectionSettings?.anchorId)
    expect(horgonyok).toContain(IDOPONTKERES_HORGONY)

    const html = renderKapcsolatLayout()
    expect(html).toContain(`href="#${IDOPONTKERES_HORGONY}"`)
    // Körkörös link (a lap önmagára) sehol nem keletkezik.
    expect(html).not.toContain('href="/kapcsolat"')
  })

  it('a szakmai háttér a /rolunk harmonikájára mutat, és az a horgony létezik ott', () => {
    expect(SZAKMAI_HATTER_URL).toBe('/rolunk#szakmai-hatter')
    for (const tag of kapcsolatSzakember().members ?? []) {
      expect(tag.link?.url).toBe(SZAKMAI_HATTER_URL)
      expect(tag.link?.felirat).toBe('Nézd meg a szakmai hátterét')
    }
    // A cél ténylegesen létező horgony a /rolunk szekciósorában.
    const rolunkHorgonyok = buildRolunkLayout().map((blokk) => blokk.sectionSettings?.anchorId)
    expect(rolunkHorgonyok).toContain(SZAKMAI_HATTER_URL.split('#')[1])
    // A /kapcsolat lapon NINCS önéletrajz-harmonika, tehát lapon belüli horgony
    // törött linket adna — ezt méri ez a sor.
    expect(buildKapcsolatLayout().some((blokk) => blokk.blockType === 'accordion')).toBe(false)
  })

  it('NEM talál ki rendelési időt vagy címet', () => {
    // A szabály SOSEM az volt, hogy a mező maradjon üres, hanem hogy ne
    // találjunk ki adatot. A tulajdonos 2026-08-17-én megadta a valós
    // folyamatot (a helyszínt telefonon egyeztetik), ezért a mező már nem
    // üres — de kitalált NYITVATARTÁS és CÍM továbbra sem kerülhet bele.
    // Ezért az őr mostantól a tényleges tilalmat méri, nem az ürességet:
    // enélkül a következő szerkesztés csendben beírhatna egy kitalált
    // „H–P 8–16, Fő utca 1." sort, és a teszt zöld maradna.
    const idoMintak = [
      /\d{1,2}[:.]\d{2}/, //  8:00, 8.00
      /\d{1,2}\s*[–-]\s*\d{1,2}\s*(óra|h\b)/i, //  8–16 óra
      /\b(hétfő|kedd|szerda|csütörtök|péntek|szombat|vasárnap)/i,
    ]
    const cimMintak = [
      /\b(utca|út|tér|körút|krt\.|hrsz|emelet|házszám)\b/i,
      /\b\d{4}\s+[A-ZÁÉÍÓÖŐÚÜŰ]/,
    ]

    for (const tag of kapcsolatSzakember().members ?? []) {
      const szoveg = (tag.availability ?? '').trim()
      for (const minta of idoMintak) {
        expect(szoveg, `kitalált rendelési idő: „${szoveg}"`).not.toMatch(minta)
      }
      for (const minta of cimMintak) {
        expect(szoveg, `kitalált cím: „${szoveg}"`).not.toMatch(minta)
      }
    }
  })

  /**
   * WP15 (2026-09-07): a Kapcsolat a KAPCSOLATFELVÉTELRŐL szól (NN/g Contact
   * Us, https://www.nngroup.com/articles/contact-us-pages/): a kártyán a
   * hívás-felület marad, a bemutatkozás viszont egy mondat („ki mivel
   * foglalkozik"); a teljes bemutatkozás a Rólunk lapé (NN/g About Us,
   * https://www.nngroup.com/articles/about-us-information-on-websites/).
   */
  it('a kártyákon a hívás-felület marad, a bemutatkozás viszont egy mondat', () => {
    const rolunk = buildRolunkLayout().find((blokk) => blokk.blockType === 'teamMembers')
    if (rolunk?.blockType !== 'teamMembers') {
      throw new Error('A szakember-szekció hiányzik a /rolunk szekciósorból.')
    }
    for (const tag of kapcsolatSzakember().members ?? []) {
      const bio = (tag.bio ?? '').trim()
      expect(bio.length).toBeGreaterThan(0)
      expect(bio.match(/[.!?]/g)?.length).toBe(1)
      // Ugyanannak a személynek ugyanaz a leírása: a rövid alak a teljes eleje.
      const teljes = (rolunk.members ?? []).find((r) => r.name === tag.name)?.bio ?? ''
      expect(teljes.startsWith(bio)).toBe(true)
      expect(teljes.length).toBeGreaterThan(bio.length)
      expect((tag.phone ?? '').trim().length).toBeGreaterThan(0)
    }
    // A Rólunk kártyáin viszont NINCS telefon: a két lap tartalma szétvált.
    for (const tag of rolunk.members ?? []) {
      expect((tag.phone ?? '').trim()).toBe('')
      expect((tag.callLabel ?? '').trim()).toBe('')
    }
  })

  it('a felvezetője kapcsolat-fókuszú, és eltér a másik két lapétól', () => {
    const kapcsolat = kapcsolatSzakember()
    const mezok = (blokk: typeof kapcsolat) => [blokk.eyebrow, blokk.title, blokk.lead]
    const masik = [buildRolunkLayout(), buildSzolgaltatasokLayout()].map((layout) => {
      const blokk = layout.find((elem) => elem.blockType === 'teamMembers')
      if (blokk?.blockType !== 'teamMembers') {
        throw new Error('A szakember-szekció hiányzik az egyik belső oldal szekciósorából.')
      }
      return mezok(blokk)
    })

    for (const [eyebrow, title, lead] of masik) {
      expect(kapcsolat.eyebrow).not.toBe(eyebrow)
      expect(kapcsolat.title).not.toBe(title)
      expect(kapcsolat.lead).not.toBe(lead)
    }
    // A titulus továbbra is EGY forrásból jön (nem csúszhat el oldalanként).
    const rolunk = buildRolunkLayout().find((blokk) => blokk.blockType === 'teamMembers')
    if (rolunk?.blockType !== 'teamMembers') {
      throw new Error('A szakember-szekció hiányzik a /rolunk szekciósorból.')
    }
    expect((kapcsolat.members ?? []).map((tag) => tag.role)).toEqual(
      (rolunk.members ?? []).map((tag) => tag.role),
    )
  })

  it('a vevőnek szóló szövegeiben nincs gondolatjel-halmozás', () => {
    const blokk = kapcsolatSzakember()
    const szovegek = [
      blokk.eyebrow ?? '',
      blokk.title ?? '',
      blokk.lead ?? '',
      blokk.bookingLink?.felirat ?? '',
      ...(blokk.members ?? []).flatMap((tag) => [
        tag.name,
        tag.role ?? '',
        tag.bio ?? '',
        tag.callLabel ?? '',
        tag.link?.felirat ?? '',
      ]),
    ]
    for (const szoveg of szovegek) {
      expect(szoveg).not.toContain('—')
      expect(szoveg).not.toContain('–')
    }
  })

  it('nem visz saját h1-et (a lap h1-e a route „Kapcsolat" címe marad)', () => {
    expect(renderKapcsolatLayout()).not.toContain('<h1')
  })
})

describe('/kapcsolat route — MELYIK űrlap van a lapon', () => {
  /**
   * A tulajdonos két lépésben pontosította, mit akar (2026-08-17):
   *  1. „a kapcsolat részből a fölső formot ki kell szedni" → ezt előbb az
   *     IDŐPONTKÉRŐ űrlapra értettük, és ki is vettük;
   *  2. „mégis kell a kapcsolat űrlap, a kapcsolat menüpontra lehet üzenetben
   *     időpontot foglalni… csak az »írj nekünk üzenetet« alsó kapcsolati
   *     űrlap nem kell, arra gondoltam."
   *
   * A végleges állapot tehát: az IDŐPONTKÉRŐ űrlap MARAD, az általános
   * üzenetküldő doboz KIKERÜL. Ez a teszt pontosan ezt a két állítást rögzíti,
   * hogy a következő kör ne fordítsa meg megint.
   *
   * A GOV.UK „question pages" elve mögötte: egy képernyőn egy feladat legyen a
   * fókusz. Két párhuzamos, hasonló kinézetű űrlap éppen ezt rontotta el — a
   * látogatónak kellett kitalálnia, melyikbe írjon.
   */
  it('az IDŐPONTKÉRŐ űrlap ott van', () => {
    const html = renderKapcsolatLayout()
    expect(html).toContain('kc-appointment__form')
    expect(html).toContain('Időpontot kérek')
  })

  it('a route forrása NEM rendereli az általános üzenetküldő szekciót', async () => {
    const forras = await readFile(
      fileURLToPath(new URL('../app/(frontend)/kapcsolat/page.tsx', import.meta.url)),
      'utf8',
    )
    expect(forras).not.toContain('<ContactForm')
    expect(forras).not.toContain('Írj nekünk üzenetet')
  })

  /**
   * A LAPFEJ ÉS A TARTALOM EGY RÁCSON ÁLL.
   *
   * A tulajdonos jelezte, hogy „a header is fura helyen van". Mérve (Chromium,
   * az éles markupon és CSS-en) a cím bal széle ennyivel csúszott el az alatta
   * lévő szekciókétól: 390 px → 0, 768 px → 24 px, 1280 px → 200 px,
   * 1440 px → 200 px. Az ok: a lapfej `Container size="narrow"` (720 px) volt,
   * a lap többi szekciója viszont a széles (1120 px) konténert használja.
   *
   * NN/g, „Why Does a Design Look Good?": „A column grid provides vertical
   * anchoring lines to which objects are aligned"; és „A design will look
   * unprofessional and lack polish when visual elements are used
   * inconsistently or sporadically."
   * https://www.nngroup.com/articles/why-does-design-look-good/
   */
  it.each(['fallback', 'richText', 'layout'] as const)(
    'a lapfej a SZÉLES konténerben áll, a tartalommal egy rácson (%s)',
    async (mode) => {
      const title = mode === 'fallback' ? 'Kapcsolat' : 'Szerkesztett kapcsolat'
      const page: Page | null =
        mode === 'fallback'
          ? null
          : {
              id: 1,
              title,
              slug: 'kapcsolat',
              status: 'published',
              content: minimalRichText('Szerkesztett törzsszöveg.'),
              layout: mode === 'layout' ? buildKapcsolatLayout() : [],
              createdAt: '',
              updatedAt: '',
            }
      vi.mocked(getPageBySlug).mockResolvedValue(page)
      const { default: KapcsolatPage } = await import('../app/(frontend)/kapcsolat/page')
      const html = render(await KapcsolatPage())

      // A tényleges H1 közvetlen szülője széles; a rich-text törzs külön
      // keskeny konténere nem változtathatja meg a lapfej rácsát.
      expect(html).toContain(`<div class="kc-container"><h1>${title}</h1>`)
      expect(html.match(/<h1[\s>]/g)).toHaveLength(1)
      if (mode === 'richText') {
        expect(html).toContain(
          '<div class="kc-container kc-container--narrow"><div class="kc-richtext">',
        )
        expect(html).toContain('Szerkesztett törzsszöveg.')
      }
      if (mode === 'layout') {
        expect(html).toContain('kc-appointment__form')
        expect(html).toContain('Időpontot kérek')
      }
    },
  )

  it('a lap leírása sem ígér általános üzenetküldést', async () => {
    const forras = await readFile(
      fileURLToPath(new URL('../app/(frontend)/kapcsolat/page.tsx', import.meta.url)),
      'utf8',
    )
    // „a felirat legyen igaz": a metaleírás a keresőben is látszik.
    expect(forras).not.toContain('írj üzenetet a Kineticare csapatának')
  })
})
