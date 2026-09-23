import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import {
  MenuChildrenNotice,
  REJTVE_JELZES,
  almenupontModel,
  type MenuChildrenNoticeProps,
} from '../components/admin/MenuChildrenNotice'
import { buildNavTree } from '../lib/menu-tree'
import type { Menu } from '../payload-types'

/**
 * Az „Almenüpontok” tájékoztató őre (K22).
 *
 * - Csak gyerekkel bíró menüpontnál ír ki bármit; a darabszám és a nevek a
 *   Local API válaszából jönnek, a szerkesztő jogosultságával
 *   (`overrideAccess: false` + `user`), a szülőre szűrve.
 * - A szöveg IGAZ: a mai navigáció (menu-tree.ts) a rejtett szülő nem rejtett
 *   gyermekeit a főmenübe emeli, a rejtett gyermekeket nem. A teszt a szöveg
 *   állítását a buildNavTree tényleges kimenetével veti össze.
 */

interface FindArgs {
  collection: string
  where: unknown
  depth: number
  pagination: boolean
  overrideAccess: boolean
  user: unknown
  select: Record<string, boolean>
}

function payloadMock(docs: unknown[] | Error) {
  const find = vi.fn(async (args: FindArgs) => {
    void args
    if (docs instanceof Error) throw docs
    return { docs }
  })
  const payload = { find, config: { routes: { admin: '/admin' } } }
  return { find, payload: payload as unknown as NonNullable<MenuChildrenNoticeProps['payload']> }
}

const USER = {
  id: 1,
  role: 'owner',
  collection: 'users',
} as unknown as MenuChildrenNoticeProps['user']

async function render(props: MenuChildrenNoticeProps): Promise<string> {
  const element = await MenuChildrenNotice(props)
  return element === null ? '' : renderToStaticMarkup(element)
}

describe('MenuChildrenNotice: mikor jelenik meg', () => {
  it('gyerek nélküli menüpontnál semmit nem ír ki', async () => {
    const { payload } = payloadMock([])
    expect(await render({ id: 6, payload, user: USER })).toBe('')
  })

  it('új, még nem mentett menüpontnál le sem kérdez', async () => {
    const { find, payload } = payloadMock([])
    expect(await render({ id: undefined, payload, user: USER })).toBe('')
    expect(find).not.toHaveBeenCalled()
  })

  it('a lekérdezés a szülőre szűr, a szerkesztő jogosultságával (overrideAccess nélkül)', async () => {
    const { find, payload } = payloadMock([{ id: 7, label: 'Kéztorna', order: 0 }])
    await render({ id: 6, payload, user: USER })
    expect(find).toHaveBeenCalledTimes(1)
    const args = find.mock.calls[0]?.[0]
    expect(args).toMatchObject({
      collection: 'menus',
      where: { parent: { equals: 6 } },
      depth: 0,
      overrideAccess: false,
      user: USER,
    })
  })

  it('lekérdezési hibánál csendben semmit nem ír ki (a tájékoztató nem akadályozhatja a szerkesztést)', async () => {
    const { payload } = payloadMock(new Error('adatbázis nem elérhető'))
    expect(await render({ id: 6, payload, user: USER })).toBe('')
  })
})

describe('MenuChildrenNotice: a szöveg', () => {
  it('a darabszám, a nevek (sorrend szerint) és a szerkesztő-linkek helyesek', async () => {
    const { payload } = payloadMock([
      { id: 9, label: 'Ingyenes SOS KézRelax', order: 2, visible: true, unlisted: false },
      { id: 7, label: 'Rendelői kezelések', order: 0, visible: true, unlisted: false },
      { id: 8, label: 'Szakembereknek', order: 1, visible: true, unlisted: false },
    ])
    const html = await render({ id: 6, payload, user: USER })
    expect(html).toContain('ennek a menüpontnak 3 almenüpontja van')
    const nevek = [...html.matchAll(/<a href="([^"]+)">([^<]+)<\/a>/g)].map((m) => [m[1], m[2]])
    expect(nevek).toEqual([
      ['/admin/collections/menus/7', 'Rendelői kezelések'],
      ['/admin/collections/menus/8', 'Szakembereknek'],
      ['/admin/collections/menus/9', 'Ingyenes SOS KézRelax'],
    ])
    expect(html).toContain(
      'Ha ezt a menüpontot elrejted, ezek a főmenübe kerülnek, a „Sorrend” mezőjük szerinti helyre.',
    )
    expect(html).toContain(
      'Ha velük együtt rejtenéd el, náluk is vedd ki a pipát a „Látható” mezőből.',
    )
    expect(html).toContain('class="kc-admin-notice"')
    expect(html).not.toContain('role=')
  })

  it('a már rejtett gyermeket jelöli, és a mondat csak a nem rejtettekről állít', async () => {
    const { payload } = payloadMock([
      { id: 7, label: 'Látszó', order: 0, visible: true, unlisted: false },
      { id: 8, label: 'Kikapcsolt', order: 1, visible: false, unlisted: false },
      { id: 9, label: 'Rejtett linkes', order: 2, visible: true, unlisted: true },
    ])
    const html = await render({ id: 6, payload, user: USER })
    expect(html).toContain(`Kikapcsolt</a><span>\u00a0${REJTVE_JELZES}</span>`)
    expect(html).toContain(`Rejtett linkes</a><span>\u00a0${REJTVE_JELZES}</span>`)
    expect(html).not.toContain(`Látszó</a><span>`)
    expect(html).toContain(
      'a nem rejtett almenüpontjai a főmenübe kerülnek, a „Sorrend” mezőjük szerinti helyre',
    )
  })

  it('egyetlen gyermeknél egyes számban szól', () => {
    const model = almenupontModel([{ id: 3, label: 'Demó', rejtett: false }])
    expect(model?.cim).toBe('Tudnivaló: ennek a menüpontnak 1 almenüpontja van')
    expect(model?.magyarazat).toBe(
      'Ha ezt a menüpontot elrejted, az almenüpontja a főmenübe kerül, a „Sorrend” mezője szerinti helyre. Ha vele együtt rejtenéd el, nála is vedd ki a pipát a „Látható” mezőből.',
    )
  })

  it('ha minden gyermek rejtett, kimondja, hogy egyik sem kerül a főmenübe', () => {
    const model = almenupontModel([
      { id: 3, label: 'A', rejtett: true },
      { id: 4, label: 'B', rejtett: true },
    ])
    expect(model?.magyarazat).toBe(
      'Mindegyik almenüpont most is rejtve van, ezért ha ezt a menüpontot elrejted, egyik sem kerül a főmenübe.',
    )
  })

  it('a szövegekben nincs gondolatjel és egyenes idézőjel', () => {
    const modellek = [
      almenupontModel([{ id: 1, label: 'A', rejtett: false }]),
      almenupontModel([
        { id: 1, label: 'A', rejtett: false },
        { id: 2, label: 'B', rejtett: false },
      ]),
      almenupontModel([
        { id: 1, label: 'A', rejtett: false },
        { id: 2, label: 'B', rejtett: true },
      ]),
      almenupontModel([{ id: 1, label: 'A', rejtett: true }]),
    ]
    for (const model of modellek) {
      expect(`${model?.cim} ${model?.magyarazat}`).not.toMatch(/[–—"]/)
    }
  })
})

describe('a szöveg állítása egyezik a navigáció tényleges viselkedésével (menu-tree.ts)', () => {
  function menu(id: number, extra: Partial<Menu>): Menu {
    return {
      id,
      label: `M${id}`,
      type: 'url',
      url: `/m${id}`,
      order: id,
      visible: true,
      unlisted: false,
      updatedAt: '',
      createdAt: '',
      ...extra,
    } as Menu
  }

  it.each([
    ['a „Látható” pipa kivételével', { visible: false }],
    ['a „Rejtett link” bejelölésével', { unlisted: true }],
  ])(
    'a szülő elrejtése (%s) a nem rejtett gyermekeket a főmenübe emeli, a rejtetteket nem',
    (_, rejtes) => {
      const gyerekek = [
        menu(11, { parent: 10 }),
        menu(12, { parent: 10 }),
        menu(13, { parent: 10, visible: false }),
      ]
      const elotte = buildNavTree([menu(1, {}), menu(10, {}), ...gyerekek])
      expect(elotte.map((item) => item.id)).toEqual([1, 10])
      expect(elotte[1]?.children.map((item) => item.id)).toEqual([11, 12])

      const utana = buildNavTree([menu(1, {}), menu(10, rejtes), ...gyerekek])
      // A fejléc elemszáma 2-ről 3-ra nő: a szülő kiesik, a két nem rejtett
      // gyermek főmenüpont lesz, a rejtett gyermek (13) rejtve marad.
      expect(utana.map((item) => item.id)).toEqual([1, 11, 12])

      const model = almenupontModel(
        gyerekek.map((gyerek) => ({
          id: gyerek.id,
          label: gyerek.label,
          rejtett: gyerek.visible === false || gyerek.unlisted === true,
        })),
      )
      expect(model?.magyarazat).toContain('a nem rejtett almenüpontjai a főmenübe kerülnek')
    },
  )
})
