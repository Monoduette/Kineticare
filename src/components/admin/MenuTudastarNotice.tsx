'use client'

import { useDocumentInfo, useFormFields, useFormModified } from '@payloadcms/ui'
import { useEffect, useState, type JSX } from 'react'

import {
  isTudastarKapcsolo,
  tudastarLathatoMenukbol,
  type TudastarKapcsoloMenu,
} from '../../lib/tudastar-kapcsolo'
import { HUB_OLDALAK } from '../../lib/tudastar/hub-oldalak'

/**
 * „A Tudástár kapcsolója” tájékoztató a menüpont szerkesztőjében (UI-mező, nem
 * tárol adatot). Csak a Tudástár kapcsolójánál látszik: `type='url'` és a
 * webcím a /blog (a Menus.ts feltétele és ez a komponens is a
 * src/lib/tudastar-kapcsolo.ts szabályát kérdezi), a két pipa állásától
 * függetlenül.
 *
 * A TULAJDONOS KÉRÉSE, szó szerint: „ha kikapcsolom a tudástár menüpontot,
 * akkor azt szeretném, hogy sehol ne jelenjen meg … Ha visszakapcsolom majd,
 * akkor jöjjön vissza.” A doboz kimondja, mit jelent a kikapcsolás a
 * weboldalon, és mutatja az állapotot is, az űrlap ÉLŐ értékeiből számolva:
 * - NN/g, Visibility of System Status: „Systems should always keep users
 *   informed about what is going on, through appropriate feedback within
 *   reasonable time.”, és „No action with consequences to users should be taken
 *   without informing them.” https://www.nngroup.com/articles/visibility-system-status/
 * - NN/g, Preventing User Errors: Avoiding Conscious Mistakes: „Wherever
 *   possible, offer a preview state that users can examine to make sure that
 *   they will get what they want.” Ezért mentés előtt „Mentés után:” előtaggal
 *   mondja, mi lesz, mentett állapotban „Most:”-tal, mi van.
 *   https://www.nngroup.com/articles/user-mistakes/
 * - GOV.UK Design System, Inset text: kiegészítő információ, keretezve
 *   (.kc-admin-notice, a B1 stílusszerződése a custom.scss-ben),
 *   https://design-system.service.gov.uk/components/inset-text/
 *
 * Az állapotsor élő régió (role="status"): a pipák kattintására változik, és a
 * képernyőolvasó fókuszváltás nélkül felolvassa (WCAG 2.2 SC 4.1.3 Status
 * Messages). Betöltéskor nem szól be, mert a tartalma már ott van.
 *
 * TÖBB /blog MENÜPONT: a kapcsoló szabálya szerint a Tudástár akkor tűnik el,
 * ha MINDEGYIK /blog menüpont rejtett. A többi menüpont állását a REST-ből
 * töltjük be (az admin saját sütijével, tehát a szerkesztő jogosultságával),
 * és ezzel együtt számolunk, hogy a doboz ne állítson mást, mint a weboldal.
 */

export const NOTICE_TITLE = 'Tudnivaló: ez a menüpont a Tudástár kapcsolója'

export const ALLAPOT_LATSZIK = 'a Tudástár látszik a weboldalon.'

export const ALLAPOT_NEM_LATSZIK = 'a Tudástár nem látszik a weboldalon.'

export const ELOTAG_MOST = 'Most:'

export const ELOTAG_MENTES_UTAN = 'Mentés után:'

export const KIKAPCSOLAS_MODJA =
  'Kikapcsolod, ha a „Látható” mezőből kiveszed a pipát, vagy bejelölöd a „Rejtett link” mezőt. Kikapcsolva a Tudástár sehol nem jelenik meg a weboldalon:'

/*
 * A hatáslista a MECHANIZMUS szerint bontva, mert a kettő mást tesz a lapon
 * (NN/g, Preventing User Errors: Avoiding Unconscious Slips: „Mistakes are
 * conscious errors, and often arise when a user has incomplete or incorrect
 * information about the task.”, https://www.nngroup.com/articles/slips/):
 * - a menüpont (src/lib/menu-tree.ts, buildNavTree: a Tudástár-cél nem kap
 *   href-et) és a szekció link-mezős gombja vagy linkje (a „Hová vigyen
 *   (webcím)” mező, src/blocks/link-fields.ts; src/lib/tudastar-link-szuro.ts
 *   1. pont: a tömbelem kikerül, a csoport célja ÉS felirata ürül) a
 *   feliratával együtt eltűnik;
 * - a szövegszerkesztőbe írt (Lexical) link kibomlik (ugyanott, 2. pont): a
 *   szövege marad, csak nem kattintható. Ez az önálló bekezdésben álló, a
 *   lapon gombként megjelenő linkre is igaz (serialize.tsx renderCta), ezért a
 *   mondat a szerkesztő szemszögéből szól („szövegébe … linket tettél”).
 * A menu-tudastar-notice.test.tsx mindkét állítást a valódi függvényen méri.
 */
export const HATASOK: readonly string[] = [
  'nem látszik a Tudástár-ajánló szekció, és a hibaoldal sem ajánlja a Tudástárat;',
  'a menüből kimaradnak a Tudástárra mutató menüpontok, a szekciókból pedig azok a gombok és linkek, amelyeknek a „Hová vigyen (webcím)” mezője a Tudástárra mutat, a feliratukkal együtt;',
  'ha egy oldal, kurzus vagy lecke szövegébe Tudástárra mutató linket tettél, a link szövege megmarad, csak nem kattintható;',
  'kimarad a sitemapből és az llms-fájlokból.',
]

/** A tünetoldalak száma a hub-listából jön, így a szöveg nem avulhat el. */
export const TUNETOLDALAK_SZAMA = HUB_OLDALAK.length

export const KOZVETLEN_LINK = `A /blog, a blog kategóriaoldalai, a blogbejegyzések és a ${TUNETOLDALAK_SZAMA} tünetoldal (pl. /keztoalagut-szindroma) közvetlen linkkel továbbra is elérhetők, de a keresők nem indexelik őket (noindex).`

export const VISSZAKAPCSOLAS = 'Visszakapcsolva a mentés után azonnal minden visszajön.'

export const TORLES =
  'A menüpont törlése nem rejti el a Tudástárat: ha nincs /blog webcímű menüpont, a Tudástár látszik.'

export const BETOLTESI_HIBA =
  'A többi menüpont most nem tölthető be, ezért az állapot csak ennek a menüpontnak az állását mutatja.'

/** A többi /blog menüpont figyelmeztetése (a darabszám a többi kapcsoló száma). */
export function masikKapcsoloSzoveg(db: number): string {
  return `Van még ${db} másik /blog webcímű menüpont. A Tudástár csak akkor tűnik el, ha mindegyiknél ki van kapcsolva.`
}

export interface TudastarNoticeModel {
  /** Igaz, ha a menüpont a kapcsoló (a doboz csak ilyenkor látszik). */
  kapcsolo: boolean
  latszik: boolean
  elotag: typeof ELOTAG_MOST | typeof ELOTAG_MENTES_UTAN
  /** A többi /blog menüpont száma; null, ha még nem ismert vagy hiba volt. */
  masikKapcsolok: number | null
  betoltesiHiba: boolean
}

export interface TudastarNoticeBemenet {
  /** Az űrlap élő értékei. */
  sajat: TudastarKapcsoloMenu
  /** A TÖBBI menüpont (a szerkesztett nélkül); null, ha még nem jött meg. */
  tobbi: ReadonlyArray<TudastarKapcsoloMenu> | null
  /** Hiba a többi menüpont betöltésekor. */
  betoltesiHiba: boolean
  /** Mentett, módosítatlan dokumentum-e (különben a mentés utáni állapotot mondjuk). */
  mentett: boolean
}

/** A doboz állapota (tiszta függvény, a tudastar-kapcsolo.ts szabályával). */
export function tudastarNoticeModel(bemenet: TudastarNoticeBemenet): TudastarNoticeModel {
  const tobbiKapcsolo = (bemenet.tobbi ?? []).filter((menu) => isTudastarKapcsolo(menu))
  return {
    kapcsolo: isTudastarKapcsolo(bemenet.sajat),
    latszik: tudastarLathatoMenukbol([bemenet.sajat, ...tobbiKapcsolo]),
    elotag: bemenet.mentett ? ELOTAG_MOST : ELOTAG_MENTES_UTAN,
    masikKapcsolok: bemenet.tobbi === null ? null : tobbiKapcsolo.length,
    betoltesiHiba: bemenet.betoltesiHiba,
  }
}

/** A többi Webcím típusú menüpont REST-útvonala: csak a döntéshez kellő mezők. */
export const TOBBI_MENU_API =
  '/api/menus?depth=0&pagination=false&where[type][equals]=url' +
  '&select[type]=true&select[url]=true&select[visible]=true&select[unlisted]=true'

function olvasMenuk(body: unknown, sajatId: unknown): TudastarKapcsoloMenu[] | null {
  if (typeof body !== 'object' || body === null || !('docs' in body)) return null
  const { docs } = body as { docs: unknown }
  if (!Array.isArray(docs)) return null
  const menuk: TudastarKapcsoloMenu[] = []
  for (const doc of docs) {
    if (typeof doc !== 'object' || doc === null) continue
    const record = doc as Record<string, unknown>
    if (sajatId !== undefined && sajatId !== null && String(record.id) === String(sajatId)) {
      continue
    }
    menuk.push({
      type: typeof record.type === 'string' ? record.type : null,
      url: typeof record.url === 'string' ? record.url : null,
      visible: typeof record.visible === 'boolean' ? record.visible : null,
      unlisted: typeof record.unlisted === 'boolean' ? record.unlisted : null,
    })
  }
  return menuk
}

const listaStilus = {
  // Alul ugyanannyi térköz, mint két bekezdés között (.kc-admin-notice__szoveg).
  margin: '0.35em 0 0.5em',
  paddingInlineStart: '1.25em',
  listStyle: 'disc',
} as const

/** Megjelenítés (állapot-független, tesztelhető). */
export function MenuTudastarNoticeView({
  model,
}: {
  model: TudastarNoticeModel
}): JSX.Element | null {
  if (!model.kapcsolo) {
    return null
  }
  return (
    <div className="kc-admin-notice">
      <p className="kc-admin-notice__cim">{NOTICE_TITLE}</p>
      <p aria-live="polite" className="kc-admin-notice__szoveg" role="status">
        <strong>{model.elotag}</strong> {model.latszik ? ALLAPOT_LATSZIK : ALLAPOT_NEM_LATSZIK}
      </p>
      {model.masikKapcsolok !== null && model.masikKapcsolok > 0 ? (
        <p className="kc-admin-notice__szoveg">{masikKapcsoloSzoveg(model.masikKapcsolok)}</p>
      ) : null}
      {model.betoltesiHiba ? <p className="kc-admin-notice__szoveg">{BETOLTESI_HIBA}</p> : null}
      <p className="kc-admin-notice__szoveg">{KIKAPCSOLAS_MODJA}</p>
      <ul style={listaStilus}>
        {HATASOK.map((hatas) => (
          <li key={hatas}>{hatas}</li>
        ))}
      </ul>
      <p className="kc-admin-notice__szoveg">{KOZVETLEN_LINK}</p>
      <p className="kc-admin-notice__szoveg">{VISSZAKAPCSOLAS}</p>
      <p className="kc-admin-notice__szoveg">{TORLES}</p>
    </div>
  )
}

interface TobbiAllapot {
  menuk: TudastarKapcsoloMenu[] | null
  hiba: boolean
}

export function MenuTudastarNotice(): JSX.Element | null {
  const { id } = useDocumentInfo()
  const modified = useFormModified()
  const type = useFormFields(([fields]) => fields?.type?.value)
  const url = useFormFields(([fields]) => fields?.url?.value)
  const visible = useFormFields(([fields]) => fields?.visible?.value)
  const unlisted = useFormFields(([fields]) => fields?.unlisted?.value)

  const [tobbi, setTobbi] = useState<TobbiAllapot>({ menuk: null, hiba: false })

  useEffect(() => {
    const controller = new AbortController()
    const load = async () => {
      try {
        const response = await fetch(TOBBI_MENU_API, {
          credentials: 'include',
          signal: controller.signal,
        })
        const body: unknown = await response.json().catch(() => null)
        const menuk = response.ok ? olvasMenuk(body, id) : null
        setTobbi(menuk === null ? { menuk: [], hiba: true } : { menuk, hiba: false })
      } catch {
        if (!controller.signal.aborted) {
          setTobbi({ menuk: [], hiba: true })
        }
      }
    }
    void load()
    return () => controller.abort()
  }, [id])

  const mentett = id !== undefined && id !== null && id !== '' && !modified
  const model = tudastarNoticeModel({
    sajat: {
      type: typeof type === 'string' ? type : null,
      url: typeof url === 'string' ? url : null,
      visible: typeof visible === 'boolean' ? visible : null,
      unlisted: typeof unlisted === 'boolean' ? unlisted : null,
    },
    tobbi: tobbi.menuk,
    betoltesiHiba: tobbi.hiba,
    mentett,
  })
  return <MenuTudastarNoticeView model={model} />
}

export default MenuTudastarNotice
