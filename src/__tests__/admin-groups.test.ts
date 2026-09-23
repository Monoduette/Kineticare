import type { CollectionConfig, Config } from 'payload'
import { describe, expect, it } from 'vitest'

import configPromise from '../payload.config'
import {
  ADMIN_GROUP_DISPLAY_NAMES,
  ADMIN_GROUP_ITEM_ORDER,
  ADMIN_GROUP_ORDER,
  adminGroupRank,
  adminGroups,
} from '../plugins/admin-groups'

/**
 * Az admin-oldalsáv csoportjainak őre (admin-audit K32, R1 #13), a valódi,
 * szanitált configon (a payload-config.test.ts mintája).
 *
 * Mit véd:
 *  - egyetlen csoport megjelenített neve sem azonos egy benne álló collection
 *    többes számú címkéjével („Űrlapok › Űrlapok” nem lehet többé);
 *  - a Tartalom csoport első eleme az Oldalak;
 *  - a plugin csak a megjelenítést (sorrend, csoportnév) változtatja: a mezők,
 *    a hookok, az access és a slug ugyanaz a példány marad.
 */

type Collection = CollectionConfig

/** A címke szöveges alakja (a projektben minden címke sima szöveg). */
const szovegkent = (cimke: unknown): string | undefined => {
  if (typeof cimke === 'string') return cimke
  if (cimke && typeof cimke === 'object' && 'hu' in cimke) {
    const hu = (cimke as { hu?: unknown }).hu
    return typeof hu === 'string' ? hu : undefined
  }
  return undefined
}

const csoportja = (collection: Pick<Collection, 'admin'>): string | undefined =>
  typeof collection.admin?.group === 'string' ? collection.admin.group : undefined

/** Az oldalsáv csoportjai a config-sorrendben, a bennük álló collectionökkel. */
const csoportok = (collections: readonly Collection[]): Map<string, Collection[]> => {
  const eredmeny = new Map<string, Collection[]>()
  for (const collection of collections) {
    const csoport = csoportja(collection)
    if (!csoport || collection.admin?.hidden === true) continue
    eredmeny.set(csoport, [...(eredmeny.get(csoport) ?? []), collection])
  }
  return eredmeny
}

describe('admin-groups a valódi configon', () => {
  it('egyetlen csoport neve sem azonos egy benne álló collection többes számú címkéjével', async () => {
    const config = await configPromise
    const utkozesek: string[] = []
    for (const [csoport, tagok] of csoportok(config.collections)) {
      for (const tag of tagok) {
        if (szovegkent(tag.labels?.plural) === csoport) {
          utkozesek.push(`${csoport} › ${tag.slug}`)
        }
      }
    }
    expect(utkozesek).toEqual([])
  })

  it('a két korábbi duplikátum a megjelenített nevet kapja', async () => {
    const config = await configPromise
    const csoportNeve = (slug: string): string | undefined =>
      csoportja(config.collections.find((c) => c.slug === slug) ?? {})
    expect(csoportNeve('forms')).toBe('Űrlapok és beküldések')
    expect(csoportNeve('form-submissions')).toBe('Űrlapok és beküldések')
    expect(csoportNeve('users')).toBe('Fiókok')
  })

  it('a csoportok sorrendje a forrásnév szerinti rangsor (Tartalom elöl, Rendszer hátul)', async () => {
    const config = await configPromise
    const sorrend = [...csoportok(config.collections).keys()]
    const vart = ADMIN_GROUP_ORDER.map((forras) => ADMIN_GROUP_DISPLAY_NAMES[forras] ?? forras)
    expect(sorrend).toEqual(vart.filter((nev) => sorrend.includes(nev)))
    expect(sorrend[0]).toBe('Tartalom')
    expect(sorrend.at(-1)).toBe('Rendszer')
  })

  it('a Tartalom csoport első eleme az Oldalak, utána a gyakoriság szerinti sorrend', async () => {
    const config = await configPromise
    const tartalom = (csoportok(config.collections).get('Tartalom') ?? []).map((c) => c.slug)
    expect(tartalom[0]).toBe('pages')
    const felsorolt = ADMIN_GROUP_ITEM_ORDER.Tartalom ?? []
    expect(tartalom.filter((slug) => felsorolt.includes(slug))).toEqual(
      felsorolt.filter((slug) => tartalom.includes(slug)),
    )
  })

  it('a plugin a mezőket, hookokat, access-t és slugot nem érinti (ugyanaz a példány)', async () => {
    const config = await configPromise
    const valodi = config.collections as unknown as Collection[]
    // A valódi configon a plugin már lefutott, ezért a csoportneveket
    // visszaírjuk forrásnévre (csak az admin-objektum új), hogy az átnevező ág
    // is fusson. A mezők, hookok és az access ugyanaz a példány marad.
    const forrasnevvel = valodi.map((collection) => {
      const csoport = csoportja(collection)
      const forras = Object.entries(ADMIN_GROUP_DISPLAY_NAMES).find(
        ([, megjelenitett]) => megjelenitett === csoport,
      )?.[0]
      return forras ? { ...collection, admin: { ...collection.admin, group: forras } } : collection
    })
    expect(forrasnevvel.filter((c, i) => c !== valodi[i]).length).toBeGreaterThanOrEqual(3)

    const kimenet = (await adminGroups({ collections: forrasnevvel } as Config)).collections ?? []

    // A szanitizálás a plugin-lánc UTÁN fűzi a végére a belső collectionöket
    // (payload-kv, payload-jobs …, a mi csoportjainkon kívül); az újrarendezés
    // ezeket a felsorolt csoportok elé tenné, ezért a sorrendet a mi
    // csoportjainkba tartozó collectionökön vetjük össze.
    const csoportosSlugok = (lista: readonly Collection[]): string[] =>
      lista.filter((c) => adminGroupRank(c) >= 0).map((c) => c.slug)
    expect(csoportosSlugok(kimenet)).toEqual(csoportosSlugok(valodi))
    expect(kimenet.map((c) => c.slug).sort()).toEqual(valodi.map((c) => c.slug).sort())
    for (const eredeti of valodi) {
      const uj = kimenet.find((c) => c.slug === eredeti.slug)
      expect(uj, eredeti.slug).toBeDefined()
      expect(uj?.fields, eredeti.slug).toBe(eredeti.fields)
      expect(uj?.hooks, eredeti.slug).toBe(eredeti.hooks)
      expect(uj?.access, eredeti.slug).toBe(eredeti.access)
      expect(uj?.labels, eredeti.slug).toBe(eredeti.labels)
      expect(uj?.versions, eredeti.slug).toBe(eredeti.versions)
      expect(uj?.upload, eredeti.slug).toBe(eredeti.upload)
      expect(uj?.auth, eredeti.slug).toBe(eredeti.auth)
      // Az admin-objektumban is csak a csoportnév változhat, és az is a
      // valódi config megjelenített nevére.
      expect({ ...uj?.admin, group: undefined }, eredeti.slug).toEqual({
        ...eredeti.admin,
        group: undefined,
      })
      expect(uj?.admin?.group, eredeti.slug).toEqual(eredeti.admin?.group)
    }
  })

  it('idempotens: a már átnevezett configon újra futtatva ugyanaz a sorrend és név', async () => {
    const config = await configPromise
    const egyszer = (await adminGroups({ collections: config.collections } as unknown as Config))
      .collections
    const ketszer = (await adminGroups({ collections: egyszer } as Config)).collections
    expect(ketszer?.map((c) => [c.slug, csoportja(c)])).toEqual(
      egyszer?.map((c) => [c.slug, csoportja(c)]),
    )
  })
})

describe('admin-groups a forrásnévre épít', () => {
  it('a megjelenített név ugyanazt a rangot kapja, mint a forrásnév', () => {
    for (const [forras, megjelenitett] of Object.entries(ADMIN_GROUP_DISPLAY_NAMES)) {
      expect(adminGroupRank({ admin: { group: megjelenitett } })).toBe(
        adminGroupRank({ admin: { group: forras } }),
      )
      expect(adminGroupRank({ admin: { group: forras } })).toBeGreaterThanOrEqual(0)
    }
  })

  it('a megjelenített nevek egyediek, és nem ütköznek forrásnévvel', () => {
    const nevek = Object.values(ADMIN_GROUP_DISPLAY_NAMES)
    expect(new Set(nevek).size).toBe(nevek.length)
    for (const nev of nevek) {
      expect(ADMIN_GROUP_ORDER).not.toContain(nev)
    }
  })

  it('a csoport nélküli collection a felsoroltak elé kerül, a sorrendje stabil', async () => {
    const kimenet = (
      await adminGroups({
        collections: [
          { slug: 'b', fields: [], admin: { group: 'Rendszer' } },
          { slug: 'a', fields: [] },
          { slug: 'c', fields: [], admin: { group: 'Tartalom' } },
          { slug: 'pages', fields: [], admin: { group: 'Tartalom' } },
        ],
      } as unknown as Config)
    ).collections
    expect(kimenet?.map((c) => c.slug)).toEqual(['a', 'pages', 'c', 'b'])
  })
})
