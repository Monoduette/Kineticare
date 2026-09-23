import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { linkFields } from '../blocks/link-fields'
import { Menus, isTudastarKapcsoloUrlap } from '../collections/Menus'
import { CtaBanner } from '../components/blocks/CtaBanner'
import { RichText } from '../components/lexical/RichText'
import { buildNavTree } from '../lib/menu-tree'
import { isTudastarHref, tudastarLathatoMenukbol } from '../lib/tudastar-kapcsolo'
import { layoutTudastarLinkekNelkul, lexicalTudastarLinkekNelkul } from '../lib/tudastar-link-szuro'
import { HUB_OLDALAK } from '../lib/tudastar/hub-oldalak'
import type { BlockCtaBanner, Menu, Page } from '../payload-types'

/**
 * „A Tudástár kapcsolója” tájékoztató őre (A2-2-2).
 *
 * - Csak a kapcsoló-menüpontnál látszik (type='url' + /blog), a két pipa
 *   állásától FÜGGETLENÜL; a Menus.ts feltétele és a komponens ugyanazt a tiszta
 *   szabályt kérdezi (src/lib/tudastar-kapcsolo.ts).
 * - Az állapotsor az élő űrlapértékekből, a kapcsoló szabályával számol, a
 *   többi /blog menüponttal együtt; mentés előtt „Mentés után:”, mentve „Most:”.
 * - A szöveg kimondja a tulajdonos kérésének minden elemét: sehol ne jelenjen
 *   meg, közvetlen linkkel elérhető (noindex), visszakapcsolva visszajön, a
 *   törlés nem rejti el.
 * - A hatáslista minden mechanizmus-állítását a valódi függvény igazolja
 *   (buildNavTree, layoutTudastarLinkekNelkul + CtaBanner,
 *   lexicalTudastarLinkekNelkul + RichText), a tünetoldalak számát a hub-lista.
 *
 * DOM nélkül futunk (renderToStaticMarkup); a `fetch` hangosan dob, mert
 * tesztből hálózati hívás SOSEM mehet ki (CLAUDE.md, 15. tanulság). Az SSR-ben
 * a useEffect nem fut, így a többi menüpont betöltése sem indul el.
 */

const formFields: Record<string, { value: unknown }> = {}
let documentId: number | undefined
let modified = false

vi.mock('@payloadcms/ui', () => ({
  useDocumentInfo: () => ({ id: documentId }),
  useFormModified: () => modified,
  useFormFields: (selector: (state: [Record<string, { value: unknown }>]) => unknown) =>
    selector([formFields]),
}))

// Minden teszt előtt újra: az afterEach-es unstub után is dobjon.
beforeEach(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('A tesztből SOSEM mehet ki valódi hálózati hívás.')
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const {
  ALLAPOT_LATSZIK,
  ALLAPOT_NEM_LATSZIK,
  BETOLTESI_HIBA,
  ELOTAG_MENTES_UTAN,
  ELOTAG_MOST,
  HATASOK,
  KIKAPCSOLAS_MODJA,
  KOZVETLEN_LINK,
  MenuTudastarNotice,
  MenuTudastarNoticeView,
  NOTICE_TITLE,
  TOBBI_MENU_API,
  TORLES,
  TUNETOLDALAK_SZAMA,
  VISSZAKAPCSOLAS,
  masikKapcsoloSzoveg,
  tudastarNoticeModel,
} = await import('../components/admin/MenuTudastarNotice')

const BLOG = { type: 'url', url: '/blog' } as const

describe('tudastarNoticeModel', () => {
  it.each([
    [{ visible: true, unlisted: false }, true],
    [{ visible: null, unlisted: null }, true],
    [{ visible: false, unlisted: false }, false],
    [{ visible: true, unlisted: true }, false],
    [{ visible: false, unlisted: true }, false],
  ])('az állapot a kapcsoló szabályával egyezik: %o', (pipak, latszik) => {
    const model = tudastarNoticeModel({
      sajat: { ...BLOG, ...pipak },
      tobbi: [],
      betoltesiHiba: false,
      mentett: true,
    })
    expect(model.kapcsolo).toBe(true)
    expect(model.latszik).toBe(latszik)
    expect(model.latszik).toBe(tudastarLathatoMenukbol([{ ...BLOG, ...pipak }]))
  })

  it('a többi /blog menüpontot is beszámítja: ha egy másik látszik, a Tudástár látszik', () => {
    const model = tudastarNoticeModel({
      sajat: { ...BLOG, visible: false },
      tobbi: [
        { type: 'url', url: '/blog/', visible: true, unlisted: false },
        { type: 'url', url: '/kapcsolat', visible: false },
        { type: 'post', url: null, visible: true },
      ],
      betoltesiHiba: false,
      mentett: true,
    })
    expect(model.latszik).toBe(true)
    expect(model.masikKapcsolok).toBe(1)
  })

  it('mentés előtt „Mentés után:”, mentett, módosítatlan állapotban „Most:”', () => {
    const alap = { sajat: BLOG, tobbi: [], betoltesiHiba: false }
    expect(tudastarNoticeModel({ ...alap, mentett: true }).elotag).toBe(ELOTAG_MOST)
    expect(tudastarNoticeModel({ ...alap, mentett: false }).elotag).toBe(ELOTAG_MENTES_UTAN)
  })

  it('nem kapcsoló menüpontnál (más webcím vagy más típus) a doboz nem jelenik meg', () => {
    for (const sajat of [
      { type: 'url', url: '/blog/cikk' },
      { type: 'url', url: '/blogger' },
      { type: 'page', url: '/blog' },
      { type: 'post', url: null },
    ]) {
      const model = tudastarNoticeModel({ sajat, tobbi: [], betoltesiHiba: false, mentett: true })
      expect(model.kapcsolo).toBe(false)
      expect(renderToStaticMarkup(createElement(MenuTudastarNoticeView, { model }))).toBe('')
    }
  })
})

describe('Menus.ts: a tájékoztató mező feltétele', () => {
  const mezo = Menus.fields.find((field) => 'name' in field && field.name === 'tudastarHatas')

  it('UI-mező, a saját komponensére mutat, a pipák ELŐTT áll', () => {
    expect(mezo?.type).toBe('ui')
    expect(mezo?.admin?.components?.Field).toBe(
      '/components/admin/MenuTudastarNotice#MenuTudastarNotice',
    )
    const nevek = Menus.fields.map((field) => ('name' in field ? field.name : ''))
    expect(nevek.indexOf('tudastarHatas')).toBeLessThan(nevek.indexOf('visible'))
  })

  it('csak a /blog webcímű „Webcím” menüpontnál igaz, a pipáktól függetlenül', () => {
    const feltetel = mezo?.admin?.condition as (
      data: unknown,
      sibling: unknown,
      ctx: unknown,
    ) => boolean
    for (const pipak of [
      { visible: true, unlisted: false },
      { visible: false, unlisted: false },
      { visible: true, unlisted: true },
    ]) {
      expect(feltetel({}, { ...BLOG, ...pipak }, {})).toBe(true)
      expect(feltetel({}, { type: 'url', url: 'https://kineticare.hu/blog/', ...pipak }, {})).toBe(
        true,
      )
      expect(feltetel({}, { type: 'url', url: '/blog/cikk', ...pipak }, {})).toBe(false)
      expect(feltetel({}, { type: 'post', ...pipak }, {})).toBe(false)
    }
    expect(isTudastarKapcsoloUrlap(null)).toBe(false)
    expect(isTudastarKapcsoloUrlap({ type: 'url', url: 42 })).toBe(false)
  })
})

describe('MenuTudastarNoticeView: a szöveg', () => {
  function html(latszik: boolean, extra: Record<string, unknown> = {}): string {
    const model = {
      kapcsolo: true,
      latszik,
      elotag: ELOTAG_MOST,
      masikKapcsolok: 0,
      betoltesiHiba: false,
      ...extra,
    } as Parameters<typeof MenuTudastarNoticeView>[0]['model']
    return renderToStaticMarkup(createElement(MenuTudastarNoticeView, { model }))
  }

  it('mindkét állásban a helyes állapotot mondja, élő régióban (role="status")', () => {
    expect(html(true)).toMatch(
      new RegExp(`role="status">.*<strong>${ELOTAG_MOST}</strong> ${ALLAPOT_LATSZIK}`),
    )
    expect(html(false)).toContain(`<strong>${ELOTAG_MOST}</strong> ${ALLAPOT_NEM_LATSZIK}`)
    expect(html(true)).not.toContain('role="alert"')
  })

  it('kimondja a kérés minden elemét', () => {
    const kimenet = html(true)
    expect(kimenet).toContain(NOTICE_TITLE)
    expect(kimenet).toContain(KIKAPCSOLAS_MODJA)
    for (const hatas of HATASOK) expect(kimenet).toContain(hatas)
    expect(kimenet).toContain(KOZVETLEN_LINK)
    expect(kimenet).toContain(VISSZAKAPCSOLAS)
    expect(kimenet).toContain(TORLES)
    const osszes = [KIKAPCSOLAS_MODJA, ...HATASOK, KOZVETLEN_LINK, VISSZAKAPCSOLAS, TORLES].join(
      ' ',
    )
    expect(osszes).toContain('„Látható”')
    expect(osszes).toContain('„Rejtett link”')
    expect(osszes).toMatch(/sehol nem jelenik meg/)
    expect(osszes).toMatch(/menüből/)
    expect(osszes).toMatch(/sitemap/)
    expect(osszes).toMatch(/llms/)
    expect(osszes).toMatch(/noindex/)
    expect(osszes).toMatch(/közvetlen linkkel/)
    expect(osszes).toMatch(/Visszakapcsolva/)
    expect(osszes).toMatch(/törlése nem rejti el/)
  })

  it('a többi /blog menüpontot és a betöltési hibát is kimondja', () => {
    expect(html(true, { masikKapcsolok: 2 })).toContain(masikKapcsoloSzoveg(2))
    expect(html(true, { masikKapcsolok: 0 })).not.toContain('másik /blog')
    expect(html(true, { betoltesiHiba: true })).toContain(BETOLTESI_HIBA)
  })

  it('a szövegekben nincs gondolatjel és egyenes idézőjel', () => {
    for (const szoveg of [
      NOTICE_TITLE,
      ALLAPOT_LATSZIK,
      ALLAPOT_NEM_LATSZIK,
      KIKAPCSOLAS_MODJA,
      ...HATASOK,
      KOZVETLEN_LINK,
      VISSZAKAPCSOLAS,
      TORLES,
      BETOLTESI_HIBA,
      masikKapcsoloSzoveg(1),
    ]) {
      expect(szoveg).not.toMatch(/[–—"]/)
    }
  })

  it('a közvetlen link mondata a hub-lista hosszát és egy valódi tünetoldalt nevez meg', () => {
    expect(TUNETOLDALAK_SZAMA).toBe(HUB_OLDALAK.length)
    expect(KOZVETLEN_LINK).toContain(`a ${HUB_OLDALAK.length} tünetoldal (pl. /`)
    const pelda = /\(pl\. \/([a-z-]+)\)/.exec(KOZVETLEN_LINK)?.[1]
    expect(HUB_OLDALAK.map((hub) => hub.slug)).toContain(pelda)
    expect(KOZVETLEN_LINK).toContain('A /blog, a blog kategóriaoldalai, a blogbejegyzések és a ')
    // Mind a négy fajta lap a kapcsoló hatálya alá esik (noindex, sitemap).
    for (const ut of ['/blog', '/blog/kategoria/kezfajdalom', '/blog/pattano-ujj', `/${pelda}`]) {
      expect(isTudastarHref(ut)).toBe(true)
    }
  })

  it('a többi menüpont REST-útvonala csak a Webcím típust kéri, a négy döntő mezővel', () => {
    expect(TOBBI_MENU_API).toContain('where[type][equals]=url')
    for (const mezo of ['type', 'url', 'visible', 'unlisted']) {
      expect(TOBBI_MENU_API).toContain(`select[${mezo}]=true`)
    }
    expect(TOBBI_MENU_API).toContain('pagination=false')
  })
})

/*
 * A hatáslista ELEMENKÉNT a valódi mechanizmushoz mérve (nem az, hogy a
 * konstans a kimenetben van): a menüpont és a szekció link-mezős gombja a
 * feliratával együtt kimarad, a szövegbe tett link szövege megmarad.
 */
describe('a hatáslista a valódi mechanizmust mondja', () => {
  const MENU_ES_GOMB =
    'a menüből kimaradnak a Tudástárra mutató menüpontok, a szekciókból pedig azok a gombok és linkek, amelyeknek a „Hová vigyen (webcím)” mezője a Tudástárra mutat, a feliratukkal együtt;'
  const SZOVEGBE_TETT_LINK =
    'ha egy oldal, kurzus vagy lecke szövegébe Tudástárra mutató linket tettél, a link szövege megmarad, csak nem kattintható;'

  it('két külön mondat, mechanizmus szerint; a régi, összemosó mondat nincs', () => {
    expect(HATASOK).toContain(MENU_ES_GOMB)
    expect(HATASOK).toContain(SZOVEGBE_TETT_LINK)
    expect(HATASOK.join(' ')).not.toMatch(/linkek, a szövegük megmarad/)
    // A mondat a szekció-link valódi mezőfeliratát idézi (WCAG 2.2 SC 3.2.4).
    const url = linkFields().find((field) => 'name' in field && field.name === 'url')
    expect(url && 'label' in url ? url.label : null).toBe('Hová vigyen (webcím)')
  })

  describe('menü: a Tudástárra mutató menüpont a feliratával együtt kiesik (buildNavTree)', () => {
    const sor = (id: number, extra: Record<string, unknown>): Menu =>
      ({
        id,
        label: `M${id}`,
        type: 'url',
        url: null,
        order: id,
        visible: true,
        unlisted: false,
        updatedAt: '',
        createdAt: '',
        ...extra,
      }) as unknown as Menu
    const kapcsolo = (pipak: Record<string, unknown>) =>
      sor(1, { label: 'Tudástár', url: '/blog', ...pipak })
    const cikk = sor(2, {
      label: 'Kéztőalagút-cikk',
      type: 'post',
      ref: {
        relationTo: 'posts',
        value: { id: 5, slug: 'keztoalagut-szindroma', status: 'published' },
      },
    })
    const rolunk = sor(3, { label: 'Rólunk', url: '/rolunk' })

    it('bekapcsolva a blogbejegyzés típusú menüpont látszik', () => {
      const fa = buildNavTree([kapcsolo({}), cikk, rolunk])
      expect(fa.map((item) => item.label)).toEqual(['Tudástár', 'Kéztőalagút-cikk', 'Rólunk'])
    })

    it.each([[{ visible: false }], [{ unlisted: true }]])(
      'kikapcsolva (%o) a blogbejegyzés típusú menüpont felirata sem marad',
      (pipak) => {
        const fa = buildNavTree([kapcsolo(pipak), cikk, rolunk])
        expect(fa.map((item) => item.label)).toEqual(['Rólunk'])
        expect(fa.some((item) => isTudastarHref(item.href))).toBe(false)
      },
    )
  })

  describe('szekció: a „Hová vigyen (webcím)” mezős gomb a feliratával együtt kimarad', () => {
    type LayoutBlock = NonNullable<Page['layout']>[number]

    it('gombos kiemelő sáv: a cél ÉS a felirat ürül, a lapon nincs gomb, a sáv címe marad', () => {
      const blokk = {
        blockType: 'ctaBanner',
        id: 'cta-1',
        title: 'Olvass tovább a tünetekről',
        text: null,
        cta: { felirat: 'Megnézem a Tudástárat', url: '/blog', ujAblakban: false },
      } as BlockCtaBanner
      const szurt = layoutTudastarLinkekNelkul([blokk as LayoutBlock])[0] as BlockCtaBanner
      expect(szurt.cta).toEqual({ felirat: null, url: null, ujAblakban: false })

      const elotte = renderToStaticMarkup(createElement(CtaBanner, { block: blokk }))
      const utana = renderToStaticMarkup(createElement(CtaBanner, { block: szurt }))
      expect(elotte).toContain('href="/blog"')
      expect(elotte).toContain('Megnézem a Tudástárat')
      expect(utana).not.toContain('<a')
      expect(utana).not.toContain('Megnézem a Tudástárat')
      expect(utana).toContain('Olvass tovább a tünetekről')
    })

    it('tiszta link-tömb (Nyitó videó gombjai): a Tudástár-gomb elem kikerül, a többi marad', () => {
      const blokk = {
        blockType: 'filmHero',
        id: 'film-1',
        ctas: [
          { id: 'a', felirat: 'Megnézem a Tudástárat', url: '/blog', ujAblakban: false },
          { id: 'b', felirat: 'Megnézem a kurzusokat', url: '/kurzusok', ujAblakban: false },
        ],
      } as unknown as LayoutBlock
      const szurt = layoutTudastarLinkekNelkul([blokk])[0] as unknown as {
        ctas: Array<{ felirat: string }>
      }
      expect(szurt.ctas.map((cta) => cta.felirat)).toEqual(['Megnézem a kurzusokat'])
    })
  })

  it('szöveg: a szövegbe tett Tudástár-link szövege megmarad, csak nem kattintható (RichText)', () => {
    const szoveg = (text: string) => ({
      type: 'text',
      version: 1,
      text,
      format: 0,
      detail: 0,
      mode: 'normal',
      style: '',
    })
    const link = (url: string, text: string) => ({
      type: 'link',
      version: 3,
      format: '',
      indent: 0,
      direction: 'ltr',
      fields: { linkType: 'custom', url, newTab: false },
      children: [szoveg(text)],
    })
    const bekezdes = (children: unknown[]) => ({
      type: 'paragraph',
      version: 1,
      format: '',
      indent: 0,
      direction: 'ltr',
      children,
    })
    const tartalom = {
      root: {
        type: 'root',
        version: 1,
        format: '',
        indent: 0,
        direction: 'ltr',
        children: [
          bekezdes([
            szoveg('Bővebben: '),
            link('/blog/teniszkonyok', 'a teniszkönyökről'),
            szoveg('.'),
          ]),
          // Önálló bekezdésben a link a lapon gombként jelenik meg (renderCta).
          bekezdes([link('/blog', 'Megnézem a Tudástárat')]),
        ],
      },
    }
    const elotte = renderToStaticMarkup(createElement(RichText, { content: tartalom }))
    const utana = renderToStaticMarkup(
      createElement(RichText, { content: lexicalTudastarLinkekNelkul(tartalom) }),
    )
    expect(elotte).toContain('href="/blog/teniszkonyok"')
    expect(elotte).toContain('kc-button')
    expect(utana).not.toContain('<a')
    expect(utana).not.toContain('kc-button')
    expect(utana).toContain('Bővebben: a teniszkönyökről.')
    expect(utana).toContain('Megnézem a Tudástárat')
  })
})

describe('MenuTudastarNotice (konténer, SSR): az élő űrlapértékekből', () => {
  function render(values: Record<string, unknown>, id: number | undefined, isModified: boolean) {
    for (const key of Object.keys(formFields)) delete formFields[key]
    for (const [key, value] of Object.entries(values)) formFields[key] = { value }
    documentId = id
    modified = isModified
    return renderToStaticMarkup(createElement(MenuTudastarNotice))
  }

  it('a kapcsoló mindkét állásában látszik, és a helyes állapotot mutatja', () => {
    const be = render({ ...BLOG, visible: true, unlisted: false }, 7, false)
    expect(be).toContain(`<strong>${ELOTAG_MOST}</strong> ${ALLAPOT_LATSZIK}`)
    const kiLathato = render({ ...BLOG, visible: false, unlisted: false }, 7, false)
    expect(kiLathato).toContain(`<strong>${ELOTAG_MOST}</strong> ${ALLAPOT_NEM_LATSZIK}`)
    const kiRejtett = render({ ...BLOG, visible: true, unlisted: true }, 7, true)
    expect(kiRejtett).toContain(`<strong>${ELOTAG_MENTES_UTAN}</strong> ${ALLAPOT_NEM_LATSZIK}`)
  })

  it('nem kapcsoló menüpontnál semmit nem renderel', () => {
    expect(render({ type: 'url', url: '/kapcsolat', visible: true }, 7, false)).toBe('')
    expect(render({ type: 'page', visible: true }, 7, false)).toBe('')
  })

  it('új, mentetlen menüpontnál „Mentés után:”', () => {
    expect(render({ ...BLOG, visible: true }, undefined, false)).toContain(
      `<strong>${ELOTAG_MENTES_UTAN}</strong>`,
    )
  })
})
