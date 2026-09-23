import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { formBuilderPlugin } from '@payloadcms/plugin-form-builder'
import { en as ecommerceEn } from '@payloadcms/plugin-ecommerce/translations/languages/en'
import { hu as ecommerceHu } from '@payloadcms/plugin-ecommerce/translations/languages/hu'
import { en as urlapEn } from '@payloadcms/plugin-form-builder/translations/languages/en'
import { hu as urlapHu } from '@payloadcms/plugin-form-builder/translations/languages/hu'
import { initI18n } from '@payloadcms/translations'
import { en } from '@payloadcms/translations/languages/en'
import { hu } from '@payloadcms/translations/languages/hu'
import type { Config, SanitizedConfig } from 'payload'
import { deepMergeSimple } from 'payload/shared'
import { describe, expect, expectTypeOf, it } from 'vitest'

import {
  HU_ADMIN_FORDITAS,
  type HuAdminForditas,
  huAdminForditasPlugin,
} from '../lib/admin/hu-forditas'
import configPromise from '../payload.config'

/**
 * A magyar admin-fordítás javításainak őre (admin-audit K15, K24).
 *
 * A src/lib/admin/hu-forditas.ts a Payload magyar nyelvfájlja fölé fésül. A
 * teszt azt védi, hogy (1) csak létező kulcsot írjunk felül (a halott kulcs
 * némán hatástalan lenne), (2) a helyőrzők ({{…}}) és a <n> jelölők ugyanazok
 * maradjanak, mint az angol forrásban (a K15 hibája pont a lefordított
 * helyőrző volt), (3) a szöveg a projekt írásszabályait kövesse, és (4) a
 * plugin a plugin-névterekben is nyerjen. A megerősítő ablakokra külön őr
 * van: (5) a „Biztos” kérdés hibaosztálya szóhatárral, az egyesített
 * fordításon; (6) a dist-forrás MINDEN ConfirmationModal-hívásának jóváhagyó
 * gombja E/1 vagy indokolt kivétel; (7) a verzió-visszaállítás, a visszatérés
 * a közzétetthez, a törlés, a duplikálás és az irányítópult elvetése minden
 * ágon igaz, egy fogalomra egy szót használó szöveget kap.
 */

type Config18n = NonNullable<Config['i18n']>
type HuForditasHelye = NonNullable<NonNullable<Config18n['translations']>['hu']>

/** Az angol forrás névterenként: a mag és a két plugin saját névtere. */
const ANGOL_FORRAS: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  ...en.translations,
  'plugin-ecommerce': ecommerceEn.translations['plugin-ecommerce'],
  'plugin-form-builder': urlapEn.translations['plugin-form-builder'],
}

interface Felulirt {
  readonly nevter: string
  readonly kulcs: string
  readonly ertek: string
}

const FELULIRT: readonly Felulirt[] = Object.entries(HU_ADMIN_FORDITAS).flatMap(
  ([nevter, kulcsok]) =>
    Object.entries(kulcsok).map(([kulcs, ertek]) => ({ nevter, kulcs, ertek: String(ertek) })),
)

const angolSzoveg = (nevter: string, kulcs: string): unknown => ANGOL_FORRAS[nevter]?.[kulcs]

/** A {{…}} helyőrzők neve, rendezve. */
const helyorzok = (szoveg: string): string[] =>
  [...szoveg.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)].map((talalat) => talalat[1] ?? '').sort()

/** A Trans-jelölők (<0>, </0>, <1> …), rendezve. */
const jelolok = (szoveg: string): string[] =>
  [...szoveg.matchAll(/<\/?\d+>/g)].map((talalat) => talalat[0]).sort()

/**
 * A „Biztos” hibaosztály: a megerősítő ablak rákérdez ahelyett, hogy a
 * következményt kimondaná (NN/g, Confirmation Dialogs,
 * https://www.nngroup.com/articles/confirmation-dialog/). Három alakja van:
 * „Biztos” vagy „Biztosan” egy kérdő mondatban („Biztosan törlöd ezt: …?”),
 * a „Biztos, hogy …” szerkezet, és a „Biztos (vagy) benne” fordulat. A
 * szóhatár ((?<!\p{L}), (?!\p{L})) miatt a „biztosított”, a „biztosítás” és a
 * „biztonság” nem találat.
 */
const BIZTOS_KERDES =
  /(?<!\p{L})biztos(?:an)?(?!\p{L})[^.!?]*\?|(?<!\p{L})biztos,\s*hogy(?!\p{L})|(?<!\p{L})biztos\s+(?:vagy\s+)?benne(?!\p{L})/iu

describe('HU_ADMIN_FORDITAS: a felülírt kulcsok', () => {
  it('van mit ellenőrizni (a lista nem üres)', () => {
    expect(FELULIRT.length).toBeGreaterThan(40)
  })

  it.each(FELULIRT.map((f) => [`${f.nevter}.${f.kulcs}`, f] as const))(
    '%s létezik az angol forrásban (nincs halott kulcs)',
    (_nev, { nevter, kulcs }) => {
      expect(typeof angolSzoveg(nevter, kulcs)).toBe('string')
    },
  )

  it.each(FELULIRT.map((f) => [`${f.nevter}.${f.kulcs}`, f] as const))(
    '%s helyőrzői és <n> jelölői azonosak az angol forráséval',
    (_nev, { nevter, kulcs, ertek }) => {
      const angol = String(angolSzoveg(nevter, kulcs))
      expect(helyorzok(ertek)).toEqual(helyorzok(angol))
      expect(jelolok(ertek)).toEqual(jelolok(angol))
    },
  )

  it('a K15 négy törött helyőrzője javítva, az angol helyőrzőkkel', () => {
    // A magyar nyelvfájlban lefordított helyőrzők: hu.js:399, :499, :564, :339.
    expect(hu.translations.general.showAllLabel).toContain('{{címke}}')
    expect(hu.translations.general.movingCount).toContain('{{Count}}')

    expect(HU_ADMIN_FORDITAS.general.showAllLabel).toBe('{{label}} listájának megnyitása')
    expect(HU_ADMIN_FORDITAS.upload.sizesFor).toBe('Méretek: {{label}}')
    expect(HU_ADMIN_FORDITAS.version.noRowsSelected).toBe('Nincs kijelölt elem ({{label}})')
    expect(HU_ADMIN_FORDITAS.general.movingCount).toBe('{{label}}: {{count}} elem áthelyezése')
  })

  it('számnév után egyes szám áll: a hibajelző „4 hiba”, nem „4 Hibák”', () => {
    // ui/dist/elements/ErrorPill/index.js:26 → `${count} ${t('general:errors')}`
    expect(HU_ADMIN_FORDITAS.general.errors).toBe('hiba')
  })

  it('a mentési hibaüzenet két alakja pontosan egy kettősponttal, a végén zárul', () => {
    // ui/dist/elements/Toasts/fieldErrors.js: az ELSŐ kettőspont választja le
    // a mezőlistát; egy korábbi kettőspont a bevezetőt kettévágná.
    for (const szoveg of [
      HU_ADMIN_FORDITAS.error.followingFieldsInvalid_one,
      HU_ADMIN_FORDITAS.error.followingFieldsInvalid_other,
    ]) {
      expect(szoveg.indexOf(':')).toBe(szoveg.length - 1)
    }
  })

  it('authentication.beginCreateFirstUser: nincs benne szóismétlés', () => {
    const szoveg = HU_ADMIN_FORDITAS.authentication.beginCreateFirstUser
    expect(szoveg).toBe('Kezdésként hozd létre az első felhasználót.')
    expect(szoveg.match(/első/gi)).toHaveLength(1)
  })

  it('a 3.88.0 felülete által nem használt kulcsok nincsenek a felülírásban', () => {
    // A ui, next, richtext-lexical, plugin és payload dist-forrásban nincs
    // felhasználójuk (a K15 két kulcsa kivétel, lásd a modul fejkommentjét).
    expect(Object.keys(HU_ADMIN_FORDITAS.upload)).not.toContain('dragAndDropHere')
    expect(Object.keys(HU_ADMIN_FORDITAS.version)).not.toContain('compareVersion')
    expect(Object.keys(HU_ADMIN_FORDITAS.error)).not.toContain('insufficientClipboardPermissions')
    expect(Object.keys(HU_ADMIN_FORDITAS.error)).not.toContain('invalidFileTypeValue')
  })
})

/**
 * A Payload saját i18n-je a lánc végi plugin kimenetén, kliens-kontextusban:
 * ugyanaz a fésülés (translations/dist/utilities/init.js:90) és ugyanaz a
 * date-fns hu locale (i18n.dateFNS), amelyet az admin felülete használ. Az
 * initI18n nyelv és kontextus szerint memoizál (init.js), ezért ebben a
 * fájlban csak ez a segéd hívja.
 */
const magyarI18n = async () => {
  const kimenet = await huAdminForditasPlugin({
    i18n: { fallbackLanguage: 'hu', supportedLanguages: { hu } },
  } as unknown as Config)
  return initI18n({
    config: {
      fallbackLanguage: 'hu',
      supportedLanguages: { hu },
      translations: kimenet.i18n?.translations,
    },
    context: 'client',
    language: 'hu',
  })
}

describe('version.lastSavedAgo: a {{distance}} alanyesetben érkezik', () => {
  // A Payload a date-fns formatDistanceToNow-t addSuffix NÉLKÜL hívja
  // (ui/dist/utilities/formatDocTitle/formatDateTitle.js:24-31), a magyar
  // kimenet ezért alanyeset („5 perc”). Az „ezelőtt” -val/-vel ragot kívánna
  // („5 perccel ezelőtt”), a hu.js „órája” pedig percre is órát mondana.
  const szoveg = HU_ADMIN_FORDITAS.version.lastSavedAgo

  it('nincs benne „ezelőtt” és „órája”', () => {
    expect(szoveg).not.toMatch(/ezelőtt/i)
    expect(szoveg).not.toMatch(/órája/i)
  })

  it('a {{distance}} a szöveg végén áll, utána nincs rag és nincs szó', () => {
    expect(szoveg).toMatch(/\s\{\{distance\}\}$/)
    expect(szoveg.slice(szoveg.indexOf('{{distance}}'))).toBe('{{distance}}')
  })

  // A date-fns formatDistance tokenjei (date-fns/formatDistance.js:116-154, a
  // perc kerekítve): 10 mp → lessThanXMinutes(1), 30 mp → xMinutes(1),
  // 5 perc → xMinutes(5), 70 perc → aboutXHours(1).
  it.each([
    ['10 másodperc', 'Utolsó mentés óta: kevesebb mint 1 perc', 'lessThanXMinutes', 1],
    ['30 másodperc', 'Utolsó mentés óta: 1 perc', 'xMinutes', 1],
    ['5 perc', 'Utolsó mentés óta: 5 perc', 'xMinutes', 5],
    ['70 perc', 'Utolsó mentés óta: körülbelül 1 óra', 'aboutXHours', 1],
  ] as const)(
    '%s után a Payload t()-je és a date-fns hu locale ezt adja: „%s”',
    async (_ido, vart, token, darab) => {
      const i18n = await magyarI18n()
      const tavolsag = i18n.dateFNS.formatDistance?.(token, darab)
      expect(tavolsag).toBeTypeOf('string')
      expect(i18n.t('version:lastSavedAgo', { distance: tavolsag })).toBe(vart)
    },
  )
})

describe('general.createNewLabel: egyes és többes számú címkével is helyes', () => {
  const szoveg = HU_ADMIN_FORDITAS.general.createNewLabel

  it('a helyőrző-halmaz egyezik az angoléval, a címke a kettőspont után, a végén áll', () => {
    expect(helyorzok(szoveg)).toEqual(helyorzok(en.translations.general.createNewLabel))
    expect(szoveg).toMatch(/: \{\{label\}\}$/)
  })

  it('a kész szöveg „Új létrehozása: Képek”, és a látható „Új létrehozása” szöveggel kezdődik', async () => {
    const { t } = await magyarI18n()
    // Az Irányítópult „+” gombja többes számú címkét kap
    // (ui/dist/widgets/CollectionCards/index.js:111), a lista fejlécgombja
    // egyes számút (ListCreateNewDocButton.js:28).
    expect(t('general:createNewLabel', { label: 'Képek' })).toBe('Új létrehozása: Képek')
    const listaGombNeve = t('general:createNewLabel', { label: 'Oldal' })
    expect(listaGombNeve).toBe('Új létrehozása: Oldal')
    // WCAG 2.2 SC 2.5.3: a hozzáférhető név a látható szöveggel kezdődik.
    const lathatoSzoveg = t('general:createNew')
    expect(lathatoSzoveg).toBe('Új létrehozása')
    expect(listaGombNeve.startsWith(lathatoSzoveg)).toBe(true)
  })
})

describe('general.select: a tömeges kiválasztó gomb', () => {
  it('„Kiválasztás: 3” alakot ad', async () => {
    const { t } = await magyarI18n()
    // ui/dist/elements/SelectMany/index.js:28 → [t('general:select'), ' ', count]
    expect(`${t('general:select')} ${3}`).toBe('Kiválasztás: 3')
  })
})

describe('HU_ADMIN_FORDITAS: írásszabályok (docs/ui-sztenderdek.md §2.7, §3.1)', () => {
  const TILTOTT: readonly { readonly nev: string; readonly minta: RegExp }[] = [
    { nev: 'kvirtmínusz (—)', minta: /—/ },
    { nev: 'felkiáltójel', minta: /!/ },
    {
      nev: '„érvénytelen” (a hiba nem címkézhető, meg kell mondani, mi a teendő)',
      minta: /érvénytelen/i,
    },
    { nev: 'egyenes ASCII idézőjel vagy aposztróf', minta: /["']/ },
    { nev: 'három pont (a „…” jel kell)', minta: /\.\.\./ },
    { nev: '„Kérjük”', minta: /(?<!\p{L})kérjük(?!\p{L})/iu },
    {
      nev: 'magázó alak',
      minta:
        /(?<!\p{L})(Ön|Önnek|szeretné|Válasszon|válasszon|Válassza|válassza|Adjon|adjon|Húzzon|húzzon|Mentsen|Maradjon|Kattintson|Biztos benne|készül)(?!\p{L})/u,
    },
    { nev: '„Biztos” kérdés (a következményt kell kimondani)', minta: BIZTOS_KERDES },
  ]

  it.each(FELULIRT.map((f) => [`${f.nevter}.${f.kulcs}`, f] as const))(
    '%s: nincs tiltott írásmód, és nem üres',
    (_nev, { ertek }) => {
      expect(ertek.trim()).toBe(ertek)
      expect(ertek.length).toBeGreaterThan(0)
      for (const { nev, minta } of TILTOTT) {
        expect(minta.test(ertek), `${nev}: ${ertek}`).toBe(false)
      }
    },
  )
})

describe('huAdminForditasPlugin', () => {
  const alapConfig = (): Config =>
    ({
      i18n: {
        supportedLanguages: { en, hu },
        translations: {
          en: { general: { dashboard: 'Home' } },
          hu: { general: { dashboard: 'Kezdés', showAllLabel: 'régi' }, sajat: { kulcs: 'marad' } },
        },
      },
    }) as unknown as Config

  it('csak a hu nyelvbe fésül; a mi értékünk nyer, a többi kulcs és nyelv érintetlen', async () => {
    const bemenet = alapConfig()
    const masolat = structuredClone(bemenet.i18n)
    const kimenet = await huAdminForditasPlugin(bemenet)
    const huKi = kimenet.i18n?.translations?.hu as Record<string, Record<string, string>>

    expect(huKi.general?.showAllLabel).toBe(HU_ADMIN_FORDITAS.general.showAllLabel)
    expect(huKi.general?.dashboard).toBe('Kezdés')
    expect(huKi.sajat?.kulcs).toBe('marad')
    expect(kimenet.i18n?.translations?.en).toEqual({ general: { dashboard: 'Home' } })
    expect(kimenet.i18n?.supportedLanguages).toBe(bemenet.i18n?.supportedLanguages)
    // A bemenet nem módosul.
    expect(bemenet.i18n).toEqual(masolat)
  })

  it('idempotens: kétszeri futtatás ugyanazt adja', async () => {
    const egyszer = await huAdminForditasPlugin(alapConfig())
    const ketszer = await huAdminForditasPlugin(egyszer)
    expect(ketszer.i18n?.translations).toEqual(egyszer.i18n?.translations)
  })

  it('fordítás nélküli configon is felépíti a hu névteret', async () => {
    const kimenet = await huAdminForditasPlugin({} as Config)
    expect(kimenet.i18n?.translations?.hu).toEqual(HU_ADMIN_FORDITAS)
    // A HU_ADMIN_FORDITAS másolatként kerül be: a config utólagos módosítása
    // nem írhatja át a modul konstansát.
    expect((kimenet.i18n?.translations?.hu as Record<string, unknown>).general).not.toBe(
      HU_ADMIN_FORDITAS.general,
    )
  })

  it('a form-builder névterében is nyer, ha a plugin-fordítás előbb került be', async () => {
    const urlappal = await formBuilderPlugin({})({
      i18n: { supportedLanguages: { en, hu } },
    } as unknown as Config)
    const elotte = urlappal.i18n?.translations?.hu as Record<string, Record<string, string>>
    expect(elotte['plugin-form-builder']?.condition).toBe('Állapot')

    const kimenet = await huAdminForditasPlugin(urlappal)
    const huKi = kimenet.i18n?.translations?.hu as Record<string, Record<string, string>>
    expect(huKi['plugin-form-builder']?.condition).toBe('Feltétel')
    expect(huKi['plugin-form-builder']?.divide).toBe('Osztás')
    // A plugin többi szövege megmarad.
    expect(huKi['plugin-form-builder']?.title).toBe('Cím')
  })

  it('az ecommerce névterében is nyer: a lánc végén a plugin felülírása után fut', async () => {
    // A plugin-ecommerce/dist/index.js:214-229 lépése: a teljes névteret a
    // plugin saját példányára cseréli. Ha a mi értékünk ELŐTTE kerülne a
    // configba, elveszne; ezért kell a lánc végi plugin.
    const ecommerceLepes = (config: Config): Config => {
      const forditasok = { ...(config.i18n?.translations ?? {}) } as Record<
        string,
        Record<string, unknown>
      >
      forditasok.hu = {
        ...(forditasok.hu ?? {}),
        'plugin-ecommerce': { ...ecommerceHu.translations['plugin-ecommerce'] },
      }
      return { ...config, i18n: { ...config.i18n, translations: forditasok } } as Config
    }

    const rosszSorrend = ecommerceLepes(await huAdminForditasPlugin({} as Config))
    const rosszHu = rosszSorrend.i18n?.translations?.hu as Record<string, Record<string, string>>
    expect(rosszHu['plugin-ecommerce']?.customer).toBe('Ügyfél')

    const joSorrend = await huAdminForditasPlugin(ecommerceLepes({} as Config))
    const joHu = joSorrend.i18n?.translations?.hu as Record<string, Record<string, string>>
    expect(joHu['plugin-ecommerce']?.customer).toBe('Vásárló')
    expect(joHu['plugin-ecommerce']?.customerEmail).toBe('Vásárló e-mail-címe')
    expect(joHu['plugin-ecommerce']?.orders).toBe('Rendelések')
  })

  it('a valódi config fordításain is nyer (a névteret ott a valódi ecommerce plugin tette be)', async () => {
    const config = await configPromise
    const valodiHu = config.i18n.translations?.hu as Record<string, Record<string, string>>
    expect(Object.keys(valodiHu['plugin-ecommerce'] ?? {})).toContain('orders')

    const kimenet = await huAdminForditasPlugin(config as unknown as Config)
    const huKi = kimenet.i18n?.translations?.hu as Record<string, Record<string, string>>
    expect(huKi['plugin-ecommerce']?.customer).toBe('Vásárló')
    expect(huKi['plugin-form-builder']?.condition).toBe('Feltétel')
    expect(huKi.general?.showAllLabel).toBe('{{label}} listájának megnyitása')
  })
})

/**
 * A K24 lezárásának gépi őre: az írásszabályokat nem csak a felülírt
 * kulcsokon, hanem az EGYESÍTETT magyar fordítás minden kulcsán ellenőrzi.
 * Az egyesítés ugyanaz, mint futáskor: a nyelvfájl, fölötte a két plugin
 * magyar névtere, fölötte a HU_ADMIN_FORDITAS
 * (translations/dist/utilities/init.js:90, deepMergeSimple).
 */

type Nevterek = Readonly<Record<string, Readonly<Record<string, unknown>>>>

/** A futáskori fésülés alapja: a nyelvfájl és a két plugin magyar névtere. */
const MAGYAR_ALAP: Nevterek = {
  ...hu.translations,
  'plugin-ecommerce': ecommerceHu.translations['plugin-ecommerce'],
  'plugin-form-builder': urlapHu.translations['plugin-form-builder'],
}

/** Névtér:kulcs → szöveg, a szöveges értékekre lapítva. */
const lapit = (nevterek: Nevterek): ReadonlyMap<string, string> =>
  new Map(
    Object.entries(nevterek).flatMap(([nevter, kulcsok]) =>
      Object.entries(kulcsok)
        .filter((par): par is [string, string] => typeof par[1] === 'string')
        .map(([kulcs, ertek]) => [`${nevter}:${kulcs}`, ertek] as const),
    ),
  )

const EGYESITETT_HU = lapit(deepMergeSimple<Nevterek>(MAGYAR_ALAP, HU_ADMIN_FORDITAS))

interface IrasSzabaly {
  readonly jel: 'a' | 'b' | 'c' | 'd' | 'e'
  readonly nev: string
  readonly minta: RegExp
}

/** A docs/ui-sztenderdek.md §3.1, P-1 és §8 szabályai, gépileg mérhető alakban. */
const IRASSZABALYOK: readonly IrasSzabaly[] = [
  {
    jel: 'a',
    nev: 'magázó megszólítás',
    minta:
      /(?<!\p{L})(?:Ön|Önnek|Önt|Öné|Önnel|Önhöz|Önök|szeretné|szeretne|Kérjük|kérjük|Válassza|válassza|Válasszon|válasszon|Adja|adja|Adjon|adjon|Hagyja|hagyja|Ürítse|Állítsa|állítsa|Erősítse|erősítse|Írja|írja|Törölje|törölje|Ellenőrizze|ellenőrizze|Próbálkozzon|próbálkozzon|Próbálja|próbálja|Megerősíti|Kattintson|kattintson|Illessze|illessze|Jelölje|jelölje|Töltse|töltse|Keresse|keresse|Húzzon|húzzon|Mentsen|Maradjon|Másolja|Mozduljon|Korlátozza|Üdvözöljük|Győződjön|Lépjen|lépjen|Frissítse|Nyissa|nyissa|Vegye|vegye|Hozza|hozza|Használja|használja|Újraindexálja|készül)(?!\p{L})/u,
  },
  {
    jel: 'b',
    nev: '„Biztos” kérdés: „Biztos (vagy) benne”, „Biztosan …?”, „Biztos, hogy” (NN/g: a következményt kell kimondani)',
    minta: BIZTOS_KERDES,
  },
  { jel: 'c', nev: 'ASCII három pont vagy egyenes idézőjel', minta: /\.\.\.|"/ },
  {
    jel: 'd',
    nev: 'számnév után közvetlenül címke (a címke többes számú is lehet)',
    minta: /\{\{count\}\}(?:\/\{\{total\}\})?(?:\s|<\/?\d+>)*\{\{label\}\}/,
  },
  {
    jel: 'e',
    nev: 'tiltott szó: vázlat, kuka, szemétdoboz, szemeteskuka, szemét (helyette piszkozat, szemetes)',
    minta: /(?<!\p{L})(?:vázlat|kuk[aá]|szemeteskuk)\p{L}*|(?<!\p{L})sz[eé]m[eé]t(?!es)\p{L}*/iu,
  },
]

const sertettSzabalyok = (szoveg: string): readonly IrasSzabaly[] =>
  IRASSZABALYOK.filter(({ minta }) => minta.test(szoveg))

const REPO_GYOKER = fileURLToPath(new URL('../..', import.meta.url))

/** A Payload-csomagok dist-forrása, ahol a kulcsok hívási helyei vannak. */
const DIST_KONYVTARAK: readonly string[] = [
  'node_modules/@payloadcms/ui/dist',
  'node_modules/@payloadcms/next/dist',
  'node_modules/payload/dist',
  'node_modules/@payloadcms/richtext-lexical/dist',
  'node_modules/@payloadcms/plugin-form-builder/dist',
  'node_modules/@payloadcms/plugin-ecommerce/dist',
]

const fajlok = (konyvtar: string, kiterjesztes: RegExp): string[] =>
  readdirSync(join(REPO_GYOKER, konyvtar), { recursive: true, encoding: 'utf8' })
    .filter((ut) => kiterjesztes.test(ut))
    .map((ut) => join(REPO_GYOKER, konyvtar, ut))

const KULCS_HIVAS =
  /['"`]((?:authentication|dashboard|error|fields|folder|general|localization|operators|plugin-ecommerce|plugin-form-builder|upload|validation|version):[A-Za-z0-9_]+)/g

let hivottKulcsokGyorsitotar: ReadonlySet<string> | undefined

/**
 * Minden kulcs, amelyre a dist-forrás (a bundle-ökkel együtt, a .map nélkül)
 * vagy a saját src/ (a tesztek nélkül) szó szerint hivatkozik. A dinamikus
 * hívások (`general:${…}` a Checkbox-cellában és a groupNavItems-ben,
 * `version:${…}` a Status-ban, `operators:${…}`) csak a true/false, a
 * collections/globals, az állapot- (draft, published, changed,
 * previouslyPublished, previouslyDraft) és az operátorkulcsokat érik el; ezek
 * egyike sincs a hívás nélküli kizárások között.
 */
const hivottKulcsok = (): ReadonlySet<string> => {
  if (hivottKulcsokGyorsitotar) return hivottKulcsokGyorsitotar
  const utak = [
    ...DIST_KONYVTARAK.flatMap((konyvtar) => fajlok(konyvtar, /\.js$/)),
    ...fajlok('src', /\.tsx?$/).filter((ut) => !ut.includes(`${join('src', '__tests__')}`)),
  ]
  const talalatok = new Set<string>()
  for (const ut of utak) {
    for (const [, kulcs] of readFileSync(ut, 'utf8').matchAll(KULCS_HIVAS)) {
      if (kulcs) talalatok.add(kulcs)
    }
  }
  hivottKulcsokGyorsitotar = talalatok
  return talalatok
}

/** A többes számú változat (_one, _other …) a törzskulccsal hívódik. */
const torzsKulcs = (kulcs: string): string => kulcs.replace(/_(?:zero|one|two|few|many|other)$/, '')

type Igazolas =
  | {
      /** A 3.88.0 dist-forrása és a src/ sehol nem hivatkozik rá (a teszt söpri). */
      readonly mod: 'nincs-hivas'
    }
  | {
      /** A hívás egy kikapcsolt funkció kapuja mögött áll. */
      readonly mod: 'kikapcsolt'
      /** A kapu forrássora: node_modules-beli út és sorszám. */
      readonly forras: string
      /** Amit a forrássornak szó szerint tartalmaznia kell. */
      readonly reszlet: string
      /** A valódi configon igaz, ha a funkció ki van kapcsolva. */
      readonly kikapcsolva: (config: SanitizedConfig) => boolean
    }
  | {
      /** A hívás a {{label}}-t mindig üres szöveggel adja. */
      readonly mod: 'ures-cimke'
      readonly forras: string
      readonly reszlet: string
    }

interface Kizaras {
  /** Egy kulcs („general:selectLabel”) vagy egy teljes névtér („folder:*”). */
  readonly kulcs: string
  readonly indok: string
  readonly igazolas: Igazolas
}

const authGyujtemenyek = (config: SanitizedConfig) =>
  config.collections.filter((gyujtemeny) => Boolean(gyujtemeny.auth))

const nincsMappa = (config: SanitizedConfig): boolean => {
  const slugok: readonly string[] = config.collections.map((gyujtemeny) => gyujtemeny.slug)
  return (
    config.collections.every((gyujtemeny) => !gyujtemeny.folders) &&
    !slugok.includes('payload-folders')
  )
}

const nincsNyelviValtozat = (config: SanitizedConfig): boolean => config.localization === false

const urlapBlokkok = (config: SanitizedConfig): readonly string[] => {
  const urlapok = config.collections.find((gyujtemeny) => gyujtemeny.slug === 'forms')
  const mezok = urlapok?.fields.find(
    (mezo) => mezo.type === 'blocks' && 'name' in mezo && mezo.name === 'fields',
  )
  return mezok?.type === 'blocks' ? mezok.blocks.map((blokk) => blokk.slug) : []
}

let srcGyorsitotar: string | undefined
const srcSzoveg = (): string => {
  srcGyorsitotar ??= fajlok('src', /\.tsx?$/)
    .filter((ut) => !ut.includes(join('src', '__tests__')))
    .map((ut) => readFileSync(ut, 'utf8'))
    .join('\n')
  return srcGyorsitotar
}

/**
 * Az írásszabályok alól kivett kulcsok. Mindegyik vagy egy kikapcsolt funkcióé
 * (a kapu forrássorát és a kikapcsolást a teszt ellenőrzi), vagy a 3.88.0
 * sehol nem hívja (a teszt a dist-forrást söpri). Ha egy funkciót
 * bekapcsolnak, a hozzá tartozó teszt elbukik: a kulcsot akkor le kell
 * fordítani a hu-forditas.ts-ben, és ki kell venni innen.
 */
const NEM_ELERHETO: readonly Kizaras[] = [
  {
    kulcs: 'folder:*',
    indok: 'Egy gyűjteményen sincs mappa, ezért a mappanézet és az áthelyezés nem jelenik meg.',
    igazolas: {
      mod: 'kikapcsolt',
      forras: 'node_modules/payload/dist/config/sanitize.js:208',
      reszlet: 'if (config.folders !== false && config.collections[i].folders)',
      kikapcsolva: nincsMappa,
    },
  },
  {
    kulcs: 'general:confirmMove',
    indok: 'Csak a mappába áthelyezés ablaka használja (FolderView/Drawers/MoveToFolder).',
    igazolas: {
      mod: 'kikapcsolt',
      forras: 'node_modules/payload/dist/config/sanitize.js:208',
      reszlet: 'if (config.folders !== false && config.collections[i].folders)',
      kikapcsolva: nincsMappa,
    },
  },
  {
    kulcs: 'localization:*',
    indok: 'Nincs nyelvi változat (a config localization értéke false).',
    igazolas: {
      mod: 'kikapcsolt',
      forras: 'node_modules/@payloadcms/ui/dist/elements/DocumentControls/index.js:150',
      reszlet: 'const showCopyToLocale = localization &&',
      kikapcsolva: nincsNyelviValtozat,
    },
  },
  {
    kulcs: 'general:overwriteExistingData',
    indok: 'A nyelvi változatok közötti másolás ablakáé (CopyLocaleData/index.js:287).',
    igazolas: {
      mod: 'kikapcsolt',
      forras: 'node_modules/@payloadcms/ui/dist/elements/DocumentControls/index.js:150',
      reszlet: 'const showCopyToLocale = localization &&',
      kikapcsolva: nincsNyelviValtozat,
    },
  },
  {
    kulcs: 'version:aboutToUnpublishIn',
    indok:
      'Egy nyelvi változat közzétételének visszavonása; nyelvi változat nélkül nem jelenik meg.',
    igazolas: {
      mod: 'kikapcsolt',
      forras: 'node_modules/@payloadcms/ui/dist/elements/UnpublishButton/index.js:155',
      reszlet: 'if (!canUnpublish || !hasLocalizedFields)',
      kikapcsolva: nincsNyelviValtozat,
    },
  },
  {
    kulcs: 'authentication:forgotPasswordUsernameInstructions',
    indok: 'Csak felhasználónévvel belépésnél jelenik meg; a Felhasználók e-mail-címmel lépnek be.',
    igazolas: {
      mod: 'kikapcsolt',
      forras:
        'node_modules/@payloadcms/next/dist/views/ForgotPassword/ForgotPasswordForm/index.js:101',
      reszlet: 'loginWithUsername ? t("authentication:forgotPasswordUsernameInstructions")',
      kikapcsolva: (config) =>
        authGyujtemenyek(config).every((gyujtemeny) => !gyujtemeny.auth.loginWithUsername),
    },
  },
  {
    kulcs: 'authentication:generatingNewAPIKeyWillInvalidate',
    indok: 'Az API-kulcs mező csak useAPIKey mellett jelenik meg, az pedig nincs bekapcsolva.',
    igazolas: {
      mod: 'kikapcsolt',
      forras: 'node_modules/@payloadcms/ui/dist/views/Edit/Auth/index.js:304',
      reszlet: 'useAPIKey && _jsx("div"',
      kikapcsolva: (config) =>
        authGyujtemenyek(config).every((gyujtemeny) => !gyujtemeny.auth.useAPIKey),
    },
  },
  ...['authentication:newAccountCreated', 'authentication:verifyYourEmail'].map(
    (kulcs): Kizaras => ({
      kulcs,
      indok:
        'Az e-mail-cím megerősítő levele csak auth.verify mellett megy ki, az ki van kapcsolva.',
      igazolas: {
        mod: 'kikapcsolt',
        forras: 'node_modules/payload/dist/collections/operations/create.js:230',
        reszlet: 'collectionConfig.auth && collectionConfig.auth.verify && result.email',
        kikapcsolva: (config) =>
          authGyujtemenyek(config).every((gyujtemeny) => !gyujtemeny.auth.verify),
      },
    }),
  ),
  {
    kulcs: 'error:unverifiedEmail',
    indok: 'Csak auth.verify mellett dobja a belépés, az ki van kapcsolva.',
    igazolas: {
      mod: 'kikapcsolt',
      forras: 'node_modules/payload/dist/auth/operations/login.js:184',
      reszlet: 'if (collectionConfig.auth.verify && user._verified === false)',
      kikapcsolva: (config) =>
        authGyujtemenyek(config).every((gyujtemeny) => !gyujtemeny.auth.verify),
    },
  },
  ...['authentication:youAreReceivingResetPassword', 'authentication:youDidNotRequestPassword'].map(
    (kulcs): Kizaras => ({
      kulcs,
      indok:
        'A Payload alap jelszó-visszaállító levele; a saját sablon (src/lib/email/users-auth.ts:46-60) felülírja.',
      igazolas: {
        mod: 'kikapcsolt',
        forras: 'node_modules/payload/dist/auth/operations/forgotPassword.js:101',
        reszlet: "typeof collectionConfig.auth.forgotPassword?.generateEmailHTML === 'function'",
        kikapcsolva: (config) =>
          authGyujtemenyek(config).every(
            (gyujtemeny) => typeof gyujtemeny.auth.forgotPassword?.generateEmailHTML === 'function',
          ),
      },
    }),
  ),
  ...['general:deleteLabel', 'general:selectLabel'].map((kulcs): Kizaras => ({
    kulcs,
    indok: 'A mentett szűrők (query presets) sávjáé; egy gyűjteményen sincsenek bekapcsolva.',
    igazolas: {
      mod: 'kikapcsolt',
      forras: 'node_modules/@payloadcms/ui/dist/views/List/index.js:186',
      reszlet: 'disableQueryPresets: collectionConfig?.enableQueryPresets !== true',
      kikapcsolva: (config) =>
        config.collections.every((gyujtemeny) => gyujtemeny.enableQueryPresets !== true),
    },
  })),
  {
    kulcs: 'version:aboutToRestoreGlobal',
    indok: 'Verziózott global verziójának visszaállítása; ilyen global nincs.',
    igazolas: {
      mod: 'kikapcsolt',
      forras: 'node_modules/@payloadcms/next/dist/views/Version/Restore/index.js:42',
      reszlet: "t(globalConfig ? 'version:aboutToRestoreGlobal'",
      kikapcsolva: (config) => config.globals.every((global) => !global.versions),
    },
  },
  ...[
    'plugin-form-builder:allowedFileTypesDescription',
    'plugin-form-builder:maxFileSizeDescription',
    'plugin-form-builder:uploadCollectionDescription',
  ].map((kulcs): Kizaras => ({
    kulcs,
    indok:
      'Az űrlapok fájlfeltöltő mezőjéé; a form-builder alapból kikapcsolja, és nincs bekapcsolva.',
    igazolas: {
      mod: 'kikapcsolt',
      forras: 'node_modules/@payloadcms/plugin-form-builder/dist/index.js:25',
      reszlet: 'upload: false',
      kikapcsolva: (config) => !urlapBlokkok(config).includes('upload'),
    },
  })),
  {
    kulcs: 'fields:searchForLanguage',
    indok: 'A Lexical kész kódblokkjáé (CodeBlock); egyik szerkesztő sem használja.',
    igazolas: {
      mod: 'kikapcsolt',
      forras:
        'node_modules/@payloadcms/richtext-lexical/dist/features/blocks/premade/CodeBlock/Component/Block.js:86',
      reszlet: "searchPlaceholder: t('fields:searchForLanguage')",
      kikapcsolva: () => !/\bCodeBlock\b/.test(srcSzoveg()),
    },
  },
  {
    kulcs: 'general:selectedCount',
    indok:
      'A kijelölés számlálója a {{label}}-t mindig üresen adja, így a felület „3 kiválasztva” alakú.',
    igazolas: {
      mod: 'ures-cimke',
      forras: 'node_modules/@payloadcms/ui/dist/elements/ListSelection/index.js:27',
      reszlet: 'label: ""',
    },
  },
  ...[
    'authentication:loggedIn',
    'authentication:loginWithAnotherUser',
    'error:insufficientClipboardPermissions',
    'error:noMatchedField',
    'fields:chooseLabel',
    'general:confirmReindex',
    'general:confirmReindexAll',
    'general:copyWarning',
    'general:moveConfirm',
    'general:moveCount',
    'general:successfullyReindexed',
    'upload:dragAndDropHere',
    'validation:username',
    'plugin-ecommerce:variantOptionsAlreadyExists',
  ].map((kulcs): Kizaras => ({
    kulcs,
    indok: 'A 3.88.0 felülete és a saját kód sehol nem hívja.',
    igazolas: { mod: 'nincs-hivas' },
  })),
]

const kizarva = (kulcs: string): boolean =>
  NEM_ELERHETO.some((kizaras) =>
    kizaras.kulcs.endsWith(':*')
      ? kulcs.startsWith(kizaras.kulcs.slice(0, -1))
      : kizaras.kulcs === kulcs,
  )

/** A forrássor („út:sorszám”) szövege a repó gyökeréhez képest. */
const forrasSor = (forras: string): string => {
  const [ut, sor] = forras.split(/:(?=\d+$)/)
  const sorok = readFileSync(join(REPO_GYOKER, ut ?? ''), 'utf8').split('\n')
  return sorok[Number(sor) - 1] ?? ''
}

describe('Az egyesített magyar fordítás: írásszabályok MINDEN elérhető kulcson (K24)', () => {
  it('a fésülés a teljes kulcskészletet lefedi', () => {
    expect(EGYESITETT_HU.size).toBeGreaterThan(700)
    expect(EGYESITETT_HU.get('general:aboutToTrash')).toBe(HU_ADMIN_FORDITAS.general.aboutToTrash)
    expect(EGYESITETT_HU.get('plugin-form-builder:title')).toBe('Cím')
  })

  it('ugyanazt adja, mint a valódi config a Payload saját fésülésével (init.js:90)', async () => {
    const config = await configPromise
    const futaskori = lapit(
      deepMergeSimple<Nevterek>(hu.translations, config.i18n.translations?.hu ?? {}),
    )
    const elteresek = [...EGYESITETT_HU].filter(([kulcs, ertek]) => futaskori.get(kulcs) !== ertek)
    expect(elteresek).toEqual([])
  })

  it('egyetlen elérhető kulcs sem sérti az írásszabályokat', () => {
    const hibak = [...EGYESITETT_HU]
      .filter(([kulcs]) => !kizarva(kulcs))
      .flatMap(([kulcs, ertek]) =>
        sertettSzabalyok(ertek).map(
          (szabaly) => `${kulcs} (${szabaly.jel}: ${szabaly.nev}): ${ertek}`,
        ),
      )
    expect(hibak).toEqual([])
  })

  it('a szabályok a régi magyar szövegeken bukást jeleznek (az őr nem üres)', () => {
    const regi = lapit(MAGYAR_ALAP)
    const buktak = new Set(
      [...regi]
        .filter(([kulcs]) => !kizarva(kulcs))
        .flatMap(([kulcs, ertek]) =>
          sertettSzabalyok(ertek).map((szabaly) => `${szabaly.jel} ${kulcs}`),
        ),
    )
    // Mind az öt szabály legalább egy valódi, régi szövegen bukik.
    expect(buktak).toContain('a general:aboutToTrash')
    expect(buktak).toContain('b general:aboutToTrash')
    // A „Biztos” hibaosztály mindhárom alakja: „Biztos benne?”, „Biztosan …?”.
    expect(buktak).toContain('b general:aboutToDelete')
    expect(buktak).toContain('b dashboard:discardMessage')
    expect(buktak).toContain('b version:aboutToRevertToPublished')
    expect(buktak).toContain('c general:saving')
    expect(buktak).toContain('d general:editingLabel_other')
    expect(buktak).toContain('e general:trash')
  })

  it('a kizárások kicsik: mindegyik létező kulcsot fed le, és az egyedi kulcs tényleg sért egy szabályt', () => {
    for (const { kulcs } of NEM_ELERHETO) {
      if (kulcs.endsWith(':*')) {
        const elotag = kulcs.slice(0, -1)
        expect(
          [...EGYESITETT_HU.keys()].some((k) => k.startsWith(elotag)),
          kulcs,
        ).toBe(true)
      } else {
        const ertek = EGYESITETT_HU.get(kulcs)
        expect(ertek, kulcs).toBeTypeOf('string')
        expect(sertettSzabalyok(ertek ?? '').length, `${kulcs}: ${ertek}`).toBeGreaterThan(0)
      }
    }
    // A kizárt kulcsot nem is írjuk felül: ami le van fordítva, az nem kivétel.
    for (const { kulcs } of NEM_ELERHETO) {
      const [nevter, nev] = kulcs.split(':')
      const felulirt = (HU_ADMIN_FORDITAS as Nevterek)[nevter ?? '']?.[nev ?? '']
      expect(felulirt, kulcs).toBeUndefined()
    }
  })

  it('a söprés működik: a biztosan hívott kulcsokat megtalálja', () => {
    const hivott = hivottKulcsok()
    expect(hivott.has('general:aboutToTrash')).toBe(true)
    expect(hivott.has('general:selectAll')).toBe(true)
    expect(hivott.has('version:restoreAsDraft')).toBe(true)
    expect(hivott.has('plugin-ecommerce:customer')).toBe(true)
  })

  it.each(
    NEM_ELERHETO.filter(({ igazolas }) => igazolas.mod === 'nincs-hivas').map(
      ({ kulcs }) => [kulcs] as const,
    ),
  )('%s: a dist-forrás és a src/ sehol nem hívja', (kulcs) => {
    expect(hivottKulcsok().has(torzsKulcs(kulcs))).toBe(false)
  })

  it.each(NEM_ELERHETO.map((kizaras) => [kizaras.kulcs, kizaras] as const))(
    '%s: a kizárás indokolt, és a forrássora igazolja',
    async (_kulcs, { indok, igazolas }) => {
      expect(indok.length).toBeGreaterThan(20)
      if (igazolas.mod === 'nincs-hivas') return
      expect(forrasSor(igazolas.forras)).toContain(igazolas.reszlet)
      if (igazolas.mod === 'kikapcsolt') {
        expect(igazolas.kikapcsolva(await configPromise)).toBe(true)
      }
    },
  )
})

describe('A K24 elérhető szövegei a Payload saját t()-jével, a hívási hely argumentumaival', () => {
  it('a Kurzus törlő ablaka a következményt mondja ki, tegezve, E/1-es jelölőnégyzettel', async () => {
    const { t } = await magyarI18n()
    // DeleteDocument/index.js:148-163: egyes számú címke, a cím vagy az id.
    const szoveg = t('general:aboutToTrash', { label: 'Kurzus', title: 'PROBA' })
    expect(szoveg).toBe(
      'A szemetesbe teszed ezt: <1>PROBA</1> (Kurzus), kivéve, ha bejelölöd a lenti négyzetet: akkor véglegesen törlöd, és ez nem vonható vissza. Amíg a szemetesben van, a weboldalon senki nem éri el, a vásárlók sem, és onnan visszaállíthatod.',
    )
    expect(t('general:deletePermanently')).toBe('Véglegesen törlöm, nem teszem a szemetesbe')
    expect(t('general:confirm')).toBe('Megerősítem')
  })

  it('a szemetes ablaka a jelölőnégyzet mindkét állására igaz (a szöveg nem változik vele)', async () => {
    const { t } = await magyarI18n()
    // DeleteDocument/index.js:148 és :154-163, DeleteMany/index.js:355 és
    // :362-371: a szöveg statikus, a „Véglegesen törlöm…” négyzet ugyanott áll.
    for (const szoveg of [
      t('general:aboutToTrash', { label: 'Kurzus', title: 'PROBA' }),
      t('general:aboutToTrashCount', { count: 3, label: 'Kurzusok' }),
    ]) {
      expect(szoveg).toContain('kivéve, ha bejelölöd a lenti négyzetet')
      expect(szoveg).toContain('véglegesen törlöd')
      expect(szoveg).toContain('nem vonható vissza')
      expect(szoveg).toContain('visszaállíthatod')
    }
  })

  it('a számláló üzenetekben a címke elöl áll, a szám után egyes számú „elem”', async () => {
    const { t } = await magyarI18n()
    expect(t('general:editingLabel', { count: 3, label: 'Oldalak' })).toBe(
      'Oldalak: 3 elem szerkesztése',
    )
    expect(t('general:deletedCountSuccessfully', { count: 3, label: 'Oldalak' })).toBe(
      'Oldalak: 3 elem törölve.',
    )
    expect(t('general:trashedCountSuccessfully', { count: 1, label: 'Kurzus' })).toBe(
      'Kurzus: 1 elem a szemetesbe került.',
    )
    // validations.js:272-275: a címke a t('general:rows').
    expect(t('validation:requiresNoMoreThan', { count: 6, label: t('general:rows') })).toBe(
      'Itt legfeljebb 6 elem lehet (Sorok). Törölj közülük, amíg ennyi nem marad.',
    )
    expect(t('error:unableToDeleteCount', { count: 2, label: 'Oldalak', total: 5 })).toBe(
      'Oldalak: 2 elemet nem sikerült törölni (5 elemből).',
    )
  })

  it('a lista kereső helyőrzője és a szűrőpanel kisbetűs „vagy”-ot kap', async () => {
    const { t } = await magyarI18n()
    // ListControls/index.js:60-72: az első mező a searchBy-ba, a többi „or” után.
    const helyorzo = `${t('general:searchBy', { label: 'Cím' })} ${t('general:or')} Webcím`
    expect(helyorzo).toBe('Keresés a következő szerint: Cím vagy Webcím')
    expect(t('general:filterWhere', { label: 'Oldalak' })).toBe('Oldalak szűrése, ahol:')
    // DefaultListViewTabs/index.js:76: `${all} ${többes címke}`.
    expect(`${t('general:all')} Kurzusok`).toBe('Összes: Kurzusok')
  })

  it('a „minden oldal kijelölése” gomb neve a látható szöveggel kezdődik (WCAG 2.2 SC 2.5.3)', async () => {
    const { t } = await magyarI18n()
    // views/List/ListSelection/index.js:57-66: a látható szöveg üres címkét,
    // az aria-label a többes számút kapja; a HTML a szóközöket összevonja.
    const osszevon = (szoveg: string) => szoveg.replace(/\s+/g, ' ').trim()
    const lathato = osszevon(t('general:selectAll', { count: '(25)', label: '' }))
    const nev = osszevon(t('general:selectAll', { count: '(25)', label: 'Oldalak' }))
    expect(lathato).toBe('Az összes kijelölése (25)')
    expect(nev).toBe('Az összes kijelölése Oldalak (25)')
    expect(nev.startsWith('Az összes kijelölése')).toBe(true)
    // Ugyanez a szemetes ürítése gombján (ListEmptyTrashButton.js:132-141).
    expect(
      t('general:emptyTrashLabel', { label: 'Kurzusok' }).startsWith(t('general:emptyTrash')),
    ).toBe(true)
  })

  it('a verzió-visszaállítás ablaka mindhárom ágra igaz, és a gombokat betűre nevezi meg', async () => {
    const { t } = await magyarI18n()
    // next/dist/views/Version/Restore/index.js:42-45: egyes számú címke és a
    // formázott dátum; egy ablak, egy szöveg, három ág (hu-forditas.ts).
    const szoveg = t('version:aboutToRestore', {
      label: 'Oldal',
      versionDate: '2026. 09. 23. 10:00',
    })
    expect(szoveg).toBe(
      'Ezt a dokumentumot (Oldal) erre a verzióra állítod vissza: 2026. 09. 23. 10:00. Közzétett verziónál a weboldalon azonnal ez látszik, kivéve, ha a „Visszaállítás piszkozatként” lehetőséget választottad: akkor a weboldal nem változik. Piszkozat verzió visszaállítása után a lap nem látszik a weboldalon, amíg a „Módosítások közzététele” gombbal közzé nem teszed.',
    )
    // (b) ág: a lenyíló menüpontja (:91), (c) ág: a közzététel gombja
    // (PublishButton/index.js:63), mindkettő betűre.
    expect(szoveg).toContain(`„${t('version:restoreAsDraft')}”`)
    expect(szoveg).toContain(`„${t('version:publishChanges')}”`)
    // (c) ág: ugyanazok a szavak, mint az ElonezetAllapot dobozában (SC 3.2.4).
    expect(szoveg).toMatch(/piszkozat verzió/i)
    expect(szoveg).toContain('nem látszik a weboldalon')
    // Piszkozat verziónál nincs lenyíló (:46), ezért a szöveg nyilat nem említ.
    expect(szoveg).not.toMatch(/nyíl/i)
    // A §8.1 szótár szerint „közzététel”, nem „élesítés”.
    expect(szoveg).not.toMatch(/élesít/i)
  })

  it('a „piszkozat verzió” és a „nem látszik a weboldalon” az ElonezetAllapot dobozában is így áll', () => {
    // A B-2 doboza (src/components/admin/ElonezetAllapot.tsx,
    // visszaallitasMondat) ugyanazt a következményt mondja: ha a gazda
    // átírja, ez az őr bukik, és a két szöveg nem válik el csendben.
    const doboz = readFileSync(
      join(REPO_GYOKER, 'src/components/admin/ElonezetAllapot.tsx'),
      'utf8',
    )
    expect(doboz).toContain('Piszkozat verzió visszaállítása után ${mi} nem látszik a weboldalon')
    expect(doboz).toContain("t('version:publishChanges')")
  })

  it('a visszatérés a közzétetthez nem állít adatvesztést, és megmondja a visszautat', async () => {
    const { t } = await magyarI18n()
    // ui/dist/elements/Status/index.js:78 és :85: GET, majd PATCH draft
    // nélkül; a piszkozat verziók megmaradnak (mérve).
    const szoveg = t('version:aboutToRevertToPublished')
    expect(szoveg).not.toMatch(/elvesz|elvész|törlőd/i)
    expect(szoveg).toContain('nem vesznek el')
    expect(szoveg).toContain(`a ${t('version:versions')} között`)
    // A visszaút (egy piszkozat verzió visszaállítása) következménye is ott áll.
    expect(szoveg).toMatch(/piszkozat verzió/i)
    expect(szoveg).toContain('nem látszik a weboldalon')
    expect(szoveg).toContain(`„${t('version:publishChanges')}”`)
    // Egy fogalomra egy szó: a megnyitó gomb, a cím és a folyamatban-felirat is
    // „Visszatérés” (Status/index.js:141, :145, :144), nem „Visszaállás”.
    for (const kulcs of [
      'version:revertToPublished',
      'version:confirmRevertToSaved',
      'version:reverting',
    ] as const) {
      expect(t(kulcs), kulcs).toMatch(/^Visszatérés/)
      expect(t(kulcs), kulcs).not.toMatch(/Visszaáll/)
    }
  })

  it('a törlő ablakcsalád kijelentő: nincs kérdés, nincs „készülsz” tükörfordítás', async () => {
    const { t } = await magyarI18n()
    // DeleteDocument/index.js:148 (egy elem), DeleteMany/index.js:349-361
    // (több elem), PermanentlyDeleteButton/index.js:129-141,
    // ListEmptyTrashButton.js:144-162.
    const csalad = [
      t('general:aboutToDelete', { label: 'Kategória', title: 'Próba' }),
      t('general:aboutToDeleteCount', { count: 1, label: 'Kategória' }),
      t('general:aboutToDeleteCount', { count: 3, label: 'Kategóriák' }),
      t('general:aboutToTrash', { label: 'Kurzus', title: 'Próba' }),
      t('general:aboutToTrashCount', { count: 3, label: 'Kurzusok' }),
      t('general:aboutToPermanentlyDelete', { label: 'Kurzus', title: 'Próba' }),
      t('general:aboutToPermanentlyDeleteTrash', { count: 3, label: 'Kurzusok' }),
    ]
    for (const szoveg of csalad) {
      expect(szoveg, szoveg).not.toContain('?')
      expect(szoveg, szoveg).toMatch(/\.$/)
      expect(szoveg, szoveg).not.toMatch(/készül/)
      expect(szoveg, szoveg).not.toMatch(/\{\{/)
    }
    expect(csalad[0]).toBe(
      'Véglegesen törlöd ezt: <1>Próba</1> (Kategória). A törlés nem vonható vissza.',
    )
    expect(csalad[2]).toBe('3 elemet törölsz véglegesen (Kategóriák). A törlés nem vonható vissza.')
  })

  it('a duplikáló ablakban egy fogalomra egy szó áll, és a cím nem mond ellent a gombnak', async () => {
    const { t } = await magyarI18n()
    // DuplicateDocument/index.js:137 (menüpont), :153 (szöveg), :154
    // (jóváhagyó gomb), :155 (cím).
    const menupont = t('general:duplicate')
    const cim = t('general:unsavedChanges')
    const szoveg = t('general:unsavedChangesDuplicate')
    const gomb = t('general:duplicateWithoutSaving')
    expect(menupont).toBe('Duplikálás')
    expect(cim).toBe('Duplikálod mentés nélkül?')
    expect(gomb).toBe('Duplikálom mentés nélkül')
    for (const resz of [menupont, cim, szoveg, gomb]) {
      expect(resz, resz).toMatch(/duplik/i)
      expect(resz, resz).not.toMatch(/másol/i)
    }
    // A cím a jóváhagyó gombra kérdez: ugyanaz az ige, E/2 kérdés és E/1 gomb.
    expect(cim.replace(/^Duplikálod (.*)\?$/, 'Duplikálom $1')).toBe(gomb)
    // A szöveg a mentett állapotot nevezi meg, és a visszautat a Mégsem gomb
    // tényleges nevével adja.
    expect(szoveg).toContain('legutóbb mentett állapotból')
    expect(szoveg).toContain(`„${t('general:cancel')}”`)
    expect(szoveg).not.toMatch(/Mentsd vagy vesd el/)
  })

  it('az irányítópult elvetés-ablaka kijelentő, E/1 gombbal és a visszaút gombneveivel', async () => {
    const { t } = await magyarI18n()
    // next/dist/views/Dashboard/Default/ModularDashboard/useDashboardLayout.js:156-162,
    // a visszaút a szerkesztő sáv két gombja (DashboardStepNav.js:113, :118).
    const cim = t('dashboard:discardTitle')
    const szoveg = t('dashboard:discardMessage')
    const gomb = t('dashboard:discardConfirmLabel')
    expect(cim).toBe('Elveted a módosításokat?')
    expect(gomb).toBe('Elvetem')
    expect(szoveg).not.toContain('?')
    expect(szoveg).toContain(`„${t('general:cancel')}”`)
    expect(szoveg).toContain(`„${t('fields:saveChanges')}”`)
  })

  it('version.versionAgo: a {{distance}} alanyesetben érkezik, ezért nincs „ezelőtt”', async () => {
    const i18n = await magyarI18n()
    // next/dist/views/Version/Default/index.js:134-145: formatTimeToNow, addSuffix nélkül.
    const tavolsag = i18n.dateFNS.formatDistance?.('xMinutes', 5)
    expect(i18n.t('version:versionAgo', { distance: tavolsag })).toBe('Mentése óta eltelt: 5 perc')
    expect(HU_ADMIN_FORDITAS.version.versionAgo).not.toMatch(/ezelőtt/)
  })
})

describe('A „Biztos” hibaosztály őre (BIZTOS_KERDES)', () => {
  it.each([
    'Biztos benne?',
    'Biztos vagy benne?',
    'Biztosan törlöd ezt: <1>{{title}}</1> ({{label}})?',
    'Mentetlen módosításaid vannak. Biztosan elveted őket?',
    'Biztos, hogy folytatni szeretnéd?',
    'Biztos, hogy ez kell.',
    'biztosan elveted?',
  ])('elkapja: %s', (szoveg) => {
    expect(BIZTOS_KERDES.test(szoveg)).toBe(true)
  })

  it.each([
    'Token nem biztosított.',
    'Egy ideje nem csináltál semmit, ezért a biztonságod érdekében hamarosan kijelentkeztetünk. Bejelentkezve maradsz?',
    'A biztosítás díját fizeted?',
    'A kapcsolat biztos. Folytatod?',
    'Elveted a módosításokat?',
  ])('nem hamis találat: %s', (szoveg) => {
    expect(BIZTOS_KERDES.test(szoveg)).toBe(false)
  })
})

/**
 * A megerősítő ablakok (ConfirmationModal) jóváhagyó gombjának teljes
 * söprése. A gomb szövege a hívás confirmLabel-je, ha nincs, a general.confirm
 * (ui/dist/elements/ConfirmationModal/index.js:119). A teszt a dist-forrás
 * MINDEN hívását megkeresi (a nagy exports-bundle-ök nélkül); ha a Payload új
 * ablakot hoz, vagy egy meglévő más kulcsot kap, a lista-egyezés bukik, és a
 * gombot át kell nézni. Minden elérhető jóváhagyó gomb E/1 (P-1a:
 * „Megerősítem”, „Elvetem”); a kivétel indokolt, és a teszt igazolja.
 */
const MEGEROSITO_KONYVTARAK: readonly string[] = [
  'node_modules/@payloadcms/ui/dist',
  'node_modules/@payloadcms/next/dist',
  'node_modules/@payloadcms/richtext-lexical/dist',
  'node_modules/@payloadcms/plugin-form-builder/dist',
  'node_modules/@payloadcms/plugin-ecommerce/dist',
]

interface MegerositoAblak {
  /** A hívó fájl a repó gyökeréhez képest. */
  readonly fajl: string
  /** A jóváhagyó gomb fordítási kulcsa. */
  readonly kulcs: string
}

const ABLAK_HIVAS = /\(ConfirmationModal,\s*\{/g
const SAJAT_JOVAHAGYO = /confirmLabel:\s*(?:i18n\.)?t\(\s*['"`]([\w-]+:\w+)['"`]/

let ablakGyorsitotar: readonly MegerositoAblak[] | undefined

const megerositoAblakok = (): readonly MegerositoAblak[] => {
  if (ablakGyorsitotar) return ablakGyorsitotar
  ablakGyorsitotar = MEGEROSITO_KONYVTARAK.flatMap((konyvtar) => fajlok(konyvtar, /\.js$/))
    .filter((ut) => !ut.includes(`${sep}exports${sep}`))
    .flatMap((ut) => {
      const forras = readFileSync(ut, 'utf8')
      return [...forras.matchAll(ABLAK_HIVAS)].map((talalat): MegerositoAblak => {
        const kezdet = talalat.index ?? 0
        // A lefordított JSX a propokat betűrendben adja, a kötelező modalSlug a
        // confirmLabel után áll: a kettő között a hívás saját propjai vannak.
        const vege = forras.indexOf('modalSlug', kezdet)
        const propok = forras.slice(kezdet, vege === -1 ? undefined : vege)
        const kulcs = propok.includes('confirmLabel:')
          ? (SAJAT_JOVAHAGYO.exec(propok)?.[1] ?? 'ismeretlen-kifejezes')
          : 'general:confirm'
        return { fajl: relative(REPO_GYOKER, ut).split(sep).join('/'), kulcs }
      })
    })
    .sort((a, b) => a.fajl.localeCompare(b.fajl))
  return ablakGyorsitotar
}

/** A 3.88.0 minden megerősítő ablaka és a jóváhagyó gomb kulcsa. */
const VART_ABLAKOK: readonly MegerositoAblak[] = [
  {
    fajl: 'node_modules/@payloadcms/next/dist/views/Account/ResetPreferences/index.js',
    kulcs: 'general:confirm',
  },
  {
    fajl: 'node_modules/@payloadcms/next/dist/views/Dashboard/Default/ModularDashboard/useDashboardLayout.js',
    kulcs: 'dashboard:discardConfirmLabel',
  },
  {
    fajl: 'node_modules/@payloadcms/next/dist/views/Version/Restore/index.js',
    kulcs: 'general:confirm',
  },
  {
    fajl: 'node_modules/@payloadcms/ui/dist/elements/BulkUpload/DiscardWithoutSaving/index.js',
    kulcs: 'general:leaveAnyway',
  },
  {
    fajl: 'node_modules/@payloadcms/ui/dist/elements/DeleteDocument/index.js',
    kulcs: 'general:confirm',
  },
  {
    fajl: 'node_modules/@payloadcms/ui/dist/elements/DeleteMany/index.js',
    kulcs: 'general:confirm',
  },
  {
    fajl: 'node_modules/@payloadcms/ui/dist/elements/DuplicateDocument/index.js',
    kulcs: 'general:duplicateWithoutSaving',
  },
  {
    fajl: 'node_modules/@payloadcms/ui/dist/elements/FolderView/CurrentFolderActions/index.js',
    kulcs: 'general:confirm',
  },
  {
    fajl: 'node_modules/@payloadcms/ui/dist/elements/FolderView/Drawers/MoveToFolder/index.js',
    kulcs: 'general:move',
  },
  {
    fajl: 'node_modules/@payloadcms/ui/dist/elements/GenerateConfirmation/index.js',
    kulcs: 'authentication:generate',
  },
  {
    fajl: 'node_modules/@payloadcms/ui/dist/elements/LeaveWithoutSaving/index.js',
    kulcs: 'general:leaveAnyway',
  },
  {
    fajl: 'node_modules/@payloadcms/ui/dist/elements/ListHeader/TitleActions/ListEmptyTrashButton.js',
    kulcs: 'general:confirm',
  },
  {
    fajl: 'node_modules/@payloadcms/ui/dist/elements/PermanentlyDeleteButton/index.js',
    kulcs: 'general:confirm',
  },
  {
    fajl: 'node_modules/@payloadcms/ui/dist/elements/PublishMany/DrawerContent.js',
    kulcs: 'general:confirm',
  },
  {
    fajl: 'node_modules/@payloadcms/ui/dist/elements/QueryPresets/QueryPresetBar/index.js',
    kulcs: 'general:confirm',
  },
  {
    fajl: 'node_modules/@payloadcms/ui/dist/elements/RestoreButton/index.js',
    kulcs: 'general:confirm',
  },
  {
    fajl: 'node_modules/@payloadcms/ui/dist/elements/RestoreMany/index.js',
    kulcs: 'general:confirm',
  },
  { fajl: 'node_modules/@payloadcms/ui/dist/elements/Status/index.js', kulcs: 'general:confirm' },
  {
    fajl: 'node_modules/@payloadcms/ui/dist/elements/StayLoggedIn/index.js',
    kulcs: 'authentication:logOut',
  },
  {
    fajl: 'node_modules/@payloadcms/ui/dist/elements/UnpublishButton/index.js',
    kulcs: 'general:confirm',
  },
  {
    fajl: 'node_modules/@payloadcms/ui/dist/elements/UnpublishMany/DrawerContent.js',
    kulcs: 'general:confirm',
  },
]

/** Az E/1 igealak: egyes szám első személy, tárgyas (-om, -em, -öm, -m) vagy alanyi (-ok, -ek, -ök). */
const E1_IGE = /^\p{Lu}\p{Ll}*(?:[aeoö]m|[eoö]k)(?=\s|$)/u

/** A nem E/1-es jóváhagyó gombok indokolt kivételei; a teszt mindegyiket igazolja. */
const NEM_E1_JOVAHAGYO: readonly {
  readonly kulcs: string
  readonly indok: string
  readonly igazolt: (config: SanitizedConfig) => boolean
}[] = [
  {
    kulcs: 'general:move',
    indok: 'A mappába áthelyezés ablaka; egy gyűjteményen sincs mappa, így nem jelenik meg.',
    igazolt: nincsMappa,
  },
  {
    kulcs: 'authentication:generate',
    indok: 'Az API-kulcs újragenerálásának ablaka; a useAPIKey sehol nincs bekapcsolva.',
    igazolt: (config) => authGyujtemenyek(config).every((gyujtemeny) => !gyujtemeny.auth.useAPIKey),
  },
  {
    kulcs: 'authentication:logOut',
    indok:
      'A tétlenségi ablak kijelentkező gombja; a kulcsot a navigáció kijelentkező ikonja és a jogosultság nélküli nézet is használja, és a docs/ui-sztenderdek.md §3.2 32. sora főnévi (P-1c) „Kijelentkezés”-t ír elő.',
    igazolt: () => {
      const szotar = readFileSync(join(REPO_GYOKER, 'docs/ui-sztenderdek.md'), 'utf8')
      const logout = readFileSync(
        join(REPO_GYOKER, 'node_modules/@payloadcms/ui/dist/elements/Logout/index.js'),
        'utf8',
      )
      return (
        /\| 32 \| \*\*Kijelentkezés\*\* .*főnévi \(P-1c\)/.test(szotar) &&
        logout.includes('"aria-label": t("authentication:logOut")') &&
        EGYESITETT_HU.get('authentication:logOut') === 'Kijelentkezés'
      )
    },
  },
]

describe('A megerősítő ablakok jóváhagyó gombja: teljes söprés, E/1 (P-1a)', () => {
  it('a dist-forrás minden ConfirmationModal-hívását megtalálja, és a lista teljes', () => {
    const talalt = megerositoAblakok()
    expect(talalt.every(({ kulcs }) => kulcs !== 'ismeretlen-kifejezes')).toBe(true)
    expect(talalt).toEqual([...VART_ABLAKOK].sort((a, b) => a.fajl.localeCompare(b.fajl)))
  })

  it('az E/1-minta elkapja a főnévi alakot, és átengedi az E/1-et', () => {
    for (const jo of [
      'Megerősítem',
      'Elvetem',
      'Duplikálom mentés nélkül',
      'Továbblépek mentés nélkül',
    ]) {
      expect(E1_IGE.test(jo), jo).toBe(true)
    }
    for (const rossz of [
      'Megerősítés',
      'Elvetés',
      'Duplikálás a módosítások mentése nélkül',
      'Távozás mindenképp',
      'Kijelentkezés',
    ]) {
      expect(E1_IGE.test(rossz), rossz).toBe(false)
    }
  })

  it.each(
    [...new Set(VART_ABLAKOK.map(({ kulcs }) => kulcs))]
      .filter((kulcs) => !NEM_E1_JOVAHAGYO.some((kivetel) => kivetel.kulcs === kulcs))
      .map((kulcs) => [kulcs] as const),
  )('%s: az egyesített magyar szöveg E/1', (kulcs) => {
    const szoveg = EGYESITETT_HU.get(kulcs) ?? ''
    expect(E1_IGE.test(szoveg), `${kulcs}: ${szoveg}`).toBe(true)
  })

  it('a jóváhagyó gombok pontos szövege', () => {
    expect(EGYESITETT_HU.get('general:confirm')).toBe('Megerősítem')
    expect(EGYESITETT_HU.get('dashboard:discardConfirmLabel')).toBe('Elvetem')
    expect(EGYESITETT_HU.get('general:duplicateWithoutSaving')).toBe('Duplikálom mentés nélkül')
    expect(EGYESITETT_HU.get('general:leaveAnyway')).toBe('Továbblépek mentés nélkül')
  })

  it.each(NEM_E1_JOVAHAGYO.map((kivetel) => [kivetel.kulcs, kivetel] as const))(
    '%s: a kivétel indokolt, és igazolt',
    async (kulcs, { indok, igazolt }) => {
      expect(VART_ABLAKOK.some((ablak) => ablak.kulcs === kulcs)).toBe(true)
      expect(indok.length).toBeGreaterThan(20)
      expect(igazolt(await configPromise)).toBe(true)
    },
  )
})

describe('HU_ADMIN_FORDITAS: típus', () => {
  it('a Config i18n.translations.hu helyére illeszthető', () => {
    expectTypeOf(HU_ADMIN_FORDITAS).toExtend<HuForditasHelye>()
    expectTypeOf(HU_ADMIN_FORDITAS).toExtend<HuAdminForditas>()
    const hely: HuForditasHelye = HU_ADMIN_FORDITAS
    expect(hely).toBe(HU_ADMIN_FORDITAS)
  })

  it('nem létező kulcs típushiba (a halott kulcs már a típusellenőrzésen elbukik)', () => {
    const rossz: HuAdminForditas = {
      // @ts-expect-error: a „nincsIlyenKulcs” nem szerepel az angol forrásban.
      general: { nincsIlyenKulcs: 'x' },
    }
    expect(rossz).toBeDefined()
  })
})
