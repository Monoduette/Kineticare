import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Field } from 'payload'
import { describe, expect, it } from 'vitest'

import { visibleMenusOrAdmin } from '../access/menus-visibility'
import { knowledge } from '../blocks/knowledge'
import { Menus } from '../collections/Menus'
import { NavAnchor } from '../components/layout/NavAnchor'
import { buildNavTree, COURSES_NAV_ITEM, withCoursesNavItem, type NavItem } from '../lib/menu-tree'
import { validateCmsUrl } from '../lib/safe-url'
import { SOS_FREE_MENU_LABEL, SOS_MENU_LABEL } from '../lib/sos-offer-copy'
import type { Menu, Product } from '../payload-types'

/**
 * A Menüpontok gyűjtemény szerkesztőjének és listájának őre (K41, K22, H20).
 *
 * A szerkesztőnek szóló szöveg csak akkor maradhat, ha IGAZ: ahol a leírás a
 * weboldal viselkedését állítja, a teszt a tényleges kódot futtatja
 * (buildNavTree, withCoursesNavItem, NavAnchor, validateCmsUrl), nem a szöveget
 * hasonlítja önmagához. Minden változás admin-tulajdonság (séma-semleges, a G2
 * schema-config-sync őrzi); az access és a hookok érintetlenek.
 */

function mezo(name: string): Field | undefined {
  return Menus.fields.find((field) => 'name' in field && field.name === name)
}

function leiras(name: string): string {
  const field = mezo(name)
  const description = field?.admin && 'description' in field.admin ? field.admin.description : ''
  return typeof description === 'string' ? description : ''
}

function cimke(name: string): string {
  const field = mezo(name)
  return field && 'label' in field && typeof field.label === 'string' ? field.label : ''
}

function menu(id: number, extra: Partial<Menu>): Menu {
  return {
    id,
    label: `M${id}`,
    type: 'url',
    url: `/m${id}`,
    order: id,
    visible: true,
    unlisted: false,
    openInNewTab: false,
    updatedAt: '',
    createdAt: '',
    ...extra,
  } as Menu
}

/** Minden szerkesztőnek szóló szöveg a gyűjteményben. */
function szerkesztoiSzovegek(): string[] {
  const kimenet: string[] = []
  const description = Menus.admin?.description
  if (typeof description === 'string') kimenet.push(description)
  for (const field of Menus.fields) {
    if ('label' in field && typeof field.label === 'string') kimenet.push(field.label)
    if (
      field.admin &&
      'description' in field.admin &&
      typeof field.admin.description === 'string'
    ) {
      kimenet.push(field.admin.description)
    }
    if (field.type === 'select') {
      for (const option of field.options) {
        if (typeof option === 'object' && typeof option.label === 'string')
          kimenet.push(option.label)
      }
    }
  }
  return kimenet
}

describe('K41: a lista', () => {
  it('alapból Sorrend szerint rendez (gyűjtemény-szintű defaultSort, Payload 3)', () => {
    expect(Menus.defaultSort).toBe('order')
  })

  it('az oszlopok: felirat, szülő, sorrend, a két kapcsoló', () => {
    expect(Menus.admin?.defaultColumns).toEqual(['label', 'parent', 'order', 'visible', 'unlisted'])
  })

  it('a két kapcsoló szöveges cellát kap (BooleanCell), nem a gyári „igaz/hamis” cellát', () => {
    const visible = mezo('visible')
    const unlisted = mezo('unlisted')
    expect(visible?.admin?.components && 'Cell' in visible.admin.components).toBe(true)
    expect((visible?.admin?.components as { Cell?: unknown } | undefined)?.Cell).toBe(
      '/components/admin/BooleanCell#MenuLathatoCell',
    )
    expect((unlisted?.admin?.components as { Cell?: unknown } | undefined)?.Cell).toBe(
      '/components/admin/BooleanCell#MenuRejtettLinkCell',
    )
  })

  it('a tájékoztató UI-mezők nem kínálhatók listaoszlopnak', () => {
    for (const name of ['tudastarHatas', 'almenupontokJelzes', 'unlistedLinkPanel']) {
      const field = mezo(name)
      expect(field?.type).toBe('ui')
      expect((field?.admin as { disableListColumn?: boolean } | undefined)?.disableListColumn).toBe(
        true,
      )
    }
  })

  /*
   * Az „Oszlopok” választó a gyűjtemény MINDEN mezőjét felkínálja, nem csak az
   * alaposzlopokat (mérve a 3100-on: a „Közvetlen link” üres oszlopként, az
   * „Új lapon nyíljon” a gyári igaz/hamis cellával jelent meg). Ezért a teszt a
   * mezőket bejárja: egy később felvett jelölőnégyzet vagy UI-mező is elbukik
   * rajta, ha nincs szöveges cellája, illetve ha oszlopnak kínálható.
   */
  describe('minden mező az „Oszlopok” választóban', () => {
    function osszesMezo(fields: readonly Field[]): Field[] {
      const kimenet: Field[] = []
      for (const field of fields) {
        kimenet.push(field)
        if ('fields' in field && Array.isArray(field.fields)) {
          kimenet.push(...osszesMezo(field.fields))
        }
        if (field.type === 'tabs') {
          for (const tab of field.tabs) kimenet.push(...osszesMezo(tab.fields))
        }
      }
      return kimenet
    }
    const mezok = osszesMezo(Menus.fields)

    it('MINDEN jelölőnégyzetnek saját, a BooleanCell.tsx-re mutató cellája van', () => {
      const jelolok = mezok.filter((field) => field.type === 'checkbox')
      expect(jelolok.map((field) => ('name' in field ? field.name : ''))).toEqual([
        'visible',
        'unlisted',
        'openInNewTab',
      ])
      for (const field of jelolok) {
        const cell = (field.admin?.components as { Cell?: unknown } | undefined)?.Cell
        expect(typeof cell === 'string' && cell.startsWith('/components/admin/BooleanCell#')).toBe(
          true,
        )
      }
      expect((mezo('openInNewTab')?.admin?.components as { Cell?: unknown })?.Cell).toBe(
        '/components/admin/BooleanCell#BooleanCell',
      )
    })

    it('a cella-hivatkozások a BooleanCell.tsx létező exportjaira mutatnak', async () => {
      const modul: Record<string, unknown> = await import('../components/admin/BooleanCell')
      for (const field of mezok) {
        const cell = (field.admin?.components as { Cell?: unknown } | undefined)?.Cell
        if (typeof cell !== 'string') continue
        const exportNev = cell.split('#')[1] ?? ''
        expect(typeof modul[exportNev]).toBe('function')
      }
    })

    it('MINDEN UI-mező disableListColumn: true (nincs üres oszlop a választóban)', () => {
      const uiMezok = mezok.filter((field) => field.type === 'ui')
      expect(uiMezok.map((field) => ('name' in field ? field.name : ''))).toEqual([
        'tudastarHatas',
        'almenupontokJelzes',
        'unlistedLinkPanel',
      ])
      for (const field of uiMezok) {
        expect(
          (field.admin as { disableListColumn?: boolean } | undefined)?.disableListColumn,
        ).toBe(true)
      }
    })
  })
})

describe('K41: a típusnevek és a webcím', () => {
  it('a típusok: Oldal, Blogbejegyzés, Webcím (saját vagy más oldal), Kurzus', () => {
    const type = mezo('type')
    expect(type?.type).toBe('select')
    const options = type?.type === 'select' ? type.options : []
    expect(options).toEqual([
      { label: 'Oldal', value: 'page' },
      { label: 'Blogbejegyzés', value: 'post' },
      { label: 'Webcím (saját vagy más oldal)', value: 'url' },
      { label: 'Kurzus', value: 'product' },
    ])
  })

  it('a Cél leírása az admin-szótár szavát használja', () => {
    expect(leiras('ref')).toBe(
      'Csak a fent választott típus elemei: oldal, blogbejegyzés vagy kurzus.',
    )
  })

  it('a webcím súgójának mindkét példája átmegy a mentéskori ellenőrzésen (validateCmsUrl)', () => {
    expect(cimke('url')).toBe('Webcím')
    const szoveg = leiras('url')
    expect(szoveg).toContain('/blog')
    expect(szoveg).toContain('https://')
    const peldak = [...szoveg.matchAll(/pl\. ([^)\s]+)\)/g)].map((match) => match[1])
    expect(peldak).toEqual(['/blog', 'https://pelda.hu'])
    for (const pelda of peldak) expect(validateCmsUrl(pelda)).toBe(true)
  })
})

describe('K41: az „Új lapon nyíljon” minden típusnál hat, ezért nincs feltétele', () => {
  it('a mezőn nincs admin.condition, és a leírás kimondja, hogy a céltól független', () => {
    expect(mezo('openInNewTab')?.admin && 'condition' in (mezo('openInNewTab')?.admin ?? {})).toBe(
      false,
    )
    expect(leiras('openInNewTab')).toContain('a céljától függetlenül')
  })

  it('a navigáció oldal, blogbejegyzés, kurzus és webcím típusnál is átviszi (buildNavTree)', () => {
    const cel = (relationTo: string, value: Record<string, unknown>): Menu['ref'] =>
      ({ relationTo, value }) as unknown as Menu['ref']
    const items = buildNavTree([
      menu(1, {
        type: 'page',
        url: null,
        openInNewTab: true,
        ref: cel('pages', { id: 1, slug: 'rolunk', status: 'published' }),
      }),
      menu(2, {
        type: 'post',
        url: null,
        openInNewTab: true,
        ref: cel('posts', { id: 2, slug: 'cikk', status: 'published' }),
      }),
      menu(3, {
        type: 'product',
        url: null,
        openInNewTab: true,
        ref: cel('products', { id: 3, slug: 'kurzus', status: 'published' }),
      }),
      menu(4, { type: 'url', url: '/kapcsolat', openInNewTab: true }),
    ])
    expect(items.map((item) => [item.href, item.openInNewTab])).toEqual([
      ['/rolunk', true],
      ['/blog/cikk', true],
      ['/kurzusok/kurzus', true],
      ['/kapcsolat', true],
    ])
  })

  it('a fejléc linkje belső célnál is új lapot nyit (NavAnchor target="_blank")', () => {
    const item: NavItem = {
      id: 1,
      label: 'Rólunk',
      href: '/rolunk',
      openInNewTab: true,
      isExternal: false,
      children: [],
    }
    const html = renderToStaticMarkup(createElement(NavAnchor, { item }))
    expect(html).toContain('target="_blank"')
    expect(html).toContain('href="/rolunk"')
  })
})

describe('K22: a két pipa leírása a tényleges viselkedést mondja', () => {
  it('a „Látható” leírása: kimarad a menüből, nem törlődik, a gyermekek a főmenübe kerülnek, /blog', () => {
    const szoveg = leiras('visible')
    expect(szoveg).toContain('kimarad a weboldal menüjéből')
    expect(szoveg).toContain('nem törlődik')
    expect(szoveg).toContain('almenüpontjai ilyenkor a főmenübe kerülnek')
    expect(szoveg).toContain('A /blog webcímű menüpontnál ez a pipa a Tudástár kapcsolója is.')
  })

  it('a „Rejtett link” leírása kimondja az egyenértékűséget és az egyetlen különbséget', () => {
    const szoveg = leiras('unlisted')
    expect(szoveg).toContain('Ugyanazt teszi, mint a „Látható” pipa kivétele')
    expect(szoveg).toContain(
      'Az egyetlen különbség, hogy alább kimásolhatod a cél közvetlen linkjét.',
    )
    expect(szoveg).toContain('A /blog webcímű menüpontnál ez is kikapcsolja a Tudástárat.')
  })

  it('a navigációban a két pipa hatása valóban azonos (a gyermek-emeléssel együtt)', () => {
    const gyerek = menu(11, { parent: 10 })
    const lathatoNelkul = buildNavTree([menu(10, { visible: false }), gyerek])
    const rejtettLinkkel = buildNavTree([menu(10, { unlisted: true }), gyerek])
    expect(lathatoNelkul).toEqual(rejtettLinkkel)
    expect(lathatoNelkul.map((item) => item.id)).toEqual([11])
  })

  it('a két tájékoztató mező a pipák ELŐTT áll, a pipák és a link-doboz sorrendje változatlan', () => {
    const nevek = Menus.fields.map((field) => ('name' in field ? field.name : ''))
    const visible = nevek.indexOf('visible')
    expect(nevek.slice(visible - 2, visible + 4)).toEqual([
      'tudastarHatas',
      'almenupontokJelzes',
      'visible',
      'unlisted',
      'unlistedLinkPanel',
      'openInNewTab',
    ])
    expect((mezo('almenupontokJelzes')?.admin?.components as { Field?: unknown })?.Field).toBe(
      '/components/admin/MenuChildrenNotice#MenuChildrenNotice',
    )
  })
})

describe('H20: a gyűjtemény leírása a kódbeli Kurzusok-pontot és az „Ingyenes” előtagot mondja', () => {
  const description = typeof Menus.admin?.description === 'string' ? Menus.admin.description : ''

  it('a leírás mondatai', () => {
    expect(description).toContain('A mentés azonnal megjelenik a weboldalon.')
    expect(description).toContain(
      'A menü első pontját (Kurzusok) a rendszer adja, ha itt nincs /kurzusok webcímű főmenüpont.',
    )
    expect(description).toContain(
      'A Kurzus típusú SOS KézRelax menüpont „Ingyenes” előtagját is a rendszer kezeli.',
    )
    // A régi, csak az egyik irányt és típust mondó mondat nem maradhat.
    expect(description).not.toContain(
      'Az ingyenes SOS pont „Ingyenes” előtagját is a rendszer adja.',
    )
  })

  it('a Kurzusok pontot a kód teszi az ELSŐ helyre, és nem duplázza a /kurzusok főmenüpontot', () => {
    const cms = buildNavTree([menu(1, { label: 'Rólunk', url: '/rolunk' })])
    const items = withCoursesNavItem(cms)
    expect(items[0]).toBe(COURSES_NAV_ITEM)
    expect(items[0]?.label).toBe('Kurzusok')
    const sajat = buildNavTree([menu(2, { label: 'Kurzusaink', url: '/kurzusok' })])
    expect(withCoursesNavItem(sajat).map((item) => item.label)).toEqual(['Kurzusaink'])
  })

  describe('az „Ingyenes” előtag: mindkét felirat, mindkét irány, csak Kurzus típusnál', () => {
    const kurzusMenu = (
      label: string,
      priceInHUFEnabled: boolean,
      slug = 'sos-kezrelax-villamkurzus',
    ): Menu =>
      menu(5, {
        type: 'product',
        url: null,
        label,
        ref: {
          relationTo: 'products',
          value: { id: 3, slug, status: 'published', priceInHUFEnabled } as Product,
        } as Menu['ref'],
      })
    const felirat = (sor: Menu): string | undefined => buildNavTree([sor])[0]?.label

    it('„SOS KézRelax” felirat: ingyenes kurzusnál a rendszer kiteszi, fizetősnél marad', () => {
      expect(felirat(kurzusMenu(SOS_MENU_LABEL, false))).toBe(SOS_FREE_MENU_LABEL)
      expect(felirat(kurzusMenu(SOS_MENU_LABEL, true))).toBe(SOS_MENU_LABEL)
    })

    it('(a) „Ingyenes SOS KézRelax” felirat + fizetős kurzus: a rendszer leveszi az „Ingyenes” szót', () => {
      expect(felirat(kurzusMenu(SOS_FREE_MENU_LABEL, true))).toBe(SOS_MENU_LABEL)
    })

    it('(b) „Ingyenes SOS KézRelax” felirat + ingyenes kurzus: marad', () => {
      expect(felirat(kurzusMenu(SOS_FREE_MENU_LABEL, false))).toBe(SOS_FREE_MENU_LABEL)
    })

    it('(c) Webcím típusú „Ingyenes SOS KézRelax” menüpont felirata változatlan (a seed tartalék-alakja)', () => {
      for (const label of [SOS_FREE_MENU_LABEL, SOS_MENU_LABEL]) {
        const sor = menu(9, { type: 'url', url: '/kurzusok/2', label })
        expect(felirat(sor)).toBe(label)
      }
    })

    it('más felirat vagy más kurzus esetén a rendszer nem nyúl a felirathoz', () => {
      expect(felirat(kurzusMenu('SOS gyakorlatok', false))).toBe('SOS gyakorlatok')
      expect(felirat(kurzusMenu(SOS_MENU_LABEL, false, 'kezrehab'))).toBe(SOS_MENU_LABEL)
      expect(felirat(kurzusMenu(SOS_FREE_MENU_LABEL, true, 'kezrehab'))).toBe(SOS_FREE_MENU_LABEL)
    })

    it('(d) a Felirat súgója mindkét feliratot, mindkét irányt és a Kurzus típust kimondja', () => {
      const szoveg = leiras('label')
      expect(szoveg).toContain(
        'Kivétel a Kurzus típusú menüpont, ha az SOS KézRelax kurzusra mutat, és a felirata „SOS KézRelax” vagy „Ingyenes SOS KézRelax”',
      )
      expect(szoveg).toContain(`„${SOS_MENU_LABEL}”`)
      expect(szoveg).toContain(`„${SOS_FREE_MENU_LABEL}”`)
      expect(szoveg).toContain('a rendszer teszi ki vagy veszi le')
      expect(szoveg).toContain('aszerint, hogy a kurzus ingyenes-e')
      // A „Kurzus” a „Hová mutat” mező opciójának felirata (SC 3.2.4).
      const type = mezo('type')
      const opciok = type?.type === 'select' ? type.options : []
      expect(opciok).toContainEqual({ label: 'Kurzus', value: 'product' })
    })
  })

  it('a Felirat példája nem a kódbeli „Kurzusok”', () => {
    expect(leiras('label')).toContain('(pl. „Rólunk”)')
    expect(leiras('label')).not.toContain('Kurzusok')
  })
})

describe('a Tudástár-ajánló blokk ugyanazokkal a szavakkal hivatkozik a kapcsolóra (SC 3.2.4)', () => {
  const heading = knowledge.fields.find((field) => 'name' in field && field.name === 'heading')
  const szoveg =
    heading?.admin &&
    'description' in heading.admin &&
    typeof heading.admin.description === 'string'
      ? heading.admin.description
      : ''

  it('a két mező felirata és a „/blog webcímű menüpont” kifejezés egyezik a Menus.ts-sel', () => {
    expect(cimke('visible')).toBe('Látható')
    expect(cimke('unlisted').startsWith('Rejtett link')).toBe(true)
    expect(szoveg).toContain('a /blog webcímű menüpontnál nincs pipa a „Látható” mezőben')
    expect(szoveg).toContain('be van jelölve a „Rejtett link”')
    expect(leiras('visible')).toContain('A /blog webcímű menüpontnál')
    expect(leiras('unlisted')).toContain('A /blog webcímű menüpontnál')
  })

  it('az admin-szótár szava: blogbejegyzés (nem „bejegyzés”)', () => {
    expect(szoveg).toContain('a legfrissebb közzétett blogbejegyzésekből')
    const limit = knowledge.fields.find((field) => 'name' in field && field.name === 'limit')
    expect(limit && 'label' in limit ? limit.label : null).toBe('Hány blogbejegyzés jelenjen meg')
  })
})

describe('tipográfia és érintetlen hozzáférés', () => {
  it('a szerkesztői szövegekben nincs gondolatjel, egyenes vagy angol idézőjel', () => {
    for (const szoveg of szerkesztoiSzovegek()) {
      expect(szoveg).not.toMatch(/[–—"“]/)
    }
  })

  it('az access és a hookok érintetlenek', () => {
    expect(Menus.access?.read).toBe(visibleMenusOrAdmin)
    expect(Object.keys(Menus.access ?? {})).toEqual(['read'])
    expect(Menus.hooks?.beforeValidate).toHaveLength(1)
    expect(Menus.hooks?.afterChange).toHaveLength(1)
    expect(Menus.hooks?.afterDelete).toHaveLength(1)
    expect(Object.keys(Menus.hooks ?? {}).sort()).toEqual([
      'afterChange',
      'afterDelete',
      'beforeValidate',
    ])
  })
})
