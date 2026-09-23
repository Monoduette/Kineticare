import type { Payload, TypedUser } from 'payload'
import type { JSX } from 'react'

import { logger } from '../../lib/logger'
import { isMenupontLathato } from '../../lib/tudastar-kapcsolo'

/**
 * „Almenüpontok” tájékoztató a menüpont szerkesztőjében (K22, UI-mező, nem
 * tárol adatot). Csak akkor ír ki bármit, ha a menüpontnak van almenüpontja.
 *
 * MIT MOND KI: a navigáció a kiesett szülő gyermekét gyökér-szintre emeli
 * (src/lib/menu-tree.ts, `buildNavTree` → `rootAncestorIdOf`). A 2026-09-22-i
 * kognitív séta mérte: a „Szolgáltatások” elrejtése után a fejléc 7-ről 9
 * elemre nőtt, azonnal, mert a menünek nincs piszkozata. A szerkesztő ezt a
 * pipa ELŐTT tudja meg, nem a weboldalon.
 * - NN/g, Visibility of System Status: „No action with consequences to users
 *   should be taken without informing them.”
 *   https://www.nngroup.com/articles/visibility-system-status/
 * - NN/g, Preventing User Errors: Avoiding Conscious Mistakes: „Preventing
 *   mistakes involves understanding users' mental models” (a szerkesztő azt
 *   várja, hogy a szülővel a gyermekek is eltűnnek).
 *   https://www.nngroup.com/articles/user-mistakes/
 * - GOV.UK Design System, Inset text: „additional information about the page”,
 *   ezért keretezett, címmel ellátott doboz (.kc-admin-notice, B1 szerződés),
 *   https://design-system.service.gov.uk/components/inset-text/
 *
 * A szülő–gyermek viselkedés TULAJDONOSI DÖNTÉSRE vár (K22); ez a komponens a
 * mai viselkedést írja le, nem változtat rajta.
 *
 * SZERVERKOMPONENS: a Payload a mezőt a szerkesztőlap betöltésekor a szerveren
 * rendereli, és átadja a `payload` példányt, a dokumentum `id`-jét és a belépett
 * felhasználót. A gyermekek lekérdezése ezért a Local API, `overrideAccess:
 * false`-szal és a felhasználóval: ugyanazt látja, amit a szerkesztő a
 * Menüpontok listában (src/access/menus-visibility.ts). Az almenüpontok a
 * szerkesztett dokumentumon kívül élnek, így az űrlap változásai nem hatnak
 * rájuk; a betöltéskori lekérdezés elég.
 *
 * Nincs élő régió (role="status"/"alert"): a doboz betöltéskor már ott áll,
 * menet közben nem változik (WCAG 2.2 SC 4.1.3 a változó tartalomra szól).
 */

/** Egy almenüpont a tájékoztatóhoz. */
export interface AlmenupontSor {
  id: number | string
  label: string
  rejtett: boolean
}

export interface AlmenupontModel {
  cim: string
  elemek: AlmenupontSor[]
  magyarazat: string
}

/** A „Látható” mező pontos felirata (Menus.ts), a súgó erre hivatkozik. */
export const LATHATO_MEZO = 'Látható'

/**
 * A „Sorrend” mező felirata. A kiemelt gyermek a főmenüpontok közé a saját
 * sorrend-értéke szerint áll be (buildNavTree: order, majd felirat); mérve
 * 2026-09-23-án a 3100-on: a 0-s és 1-es sorrendű próbagyerek a Kezdőlap (0)
 * és a Kurzusok (1) mellé került, nem a szülő helyére.
 */
export const SORREND_MEZO = 'Sorrend'

export const REJTVE_JELZES = '(rejtve)'

/**
 * A tájékoztató szövege az almenüpontokból (tiszta függvény). Üres listára
 * null: ilyenkor a mező semmit nem jelenít meg.
 */
export function almenupontModel(elemek: readonly AlmenupontSor[]): AlmenupontModel | null {
  if (elemek.length === 0) {
    return null
  }
  const egy = elemek.length === 1
  const cim = `Tudnivaló: ennek a menüpontnak ${elemek.length} almenüpontja van`
  const lathatoDb = elemek.filter((elem) => !elem.rejtett).length
  let magyarazat: string
  if (lathatoDb === 0) {
    magyarazat = egy
      ? 'Az almenüpont most is rejtve van, ezért ha ezt a menüpontot elrejted, nem kerül a főmenübe.'
      : 'Mindegyik almenüpont most is rejtve van, ezért ha ezt a menüpontot elrejted, egyik sem kerül a főmenübe.'
  } else if (egy) {
    magyarazat = `Ha ezt a menüpontot elrejted, az almenüpontja a főmenübe kerül, a „${SORREND_MEZO}” mezője szerinti helyre. Ha vele együtt rejtenéd el, nála is vedd ki a pipát a „${LATHATO_MEZO}” mezőből.`
  } else {
    const kik = lathatoDb === elemek.length ? 'ezek' : 'a nem rejtett almenüpontjai'
    magyarazat = `Ha ezt a menüpontot elrejted, ${kik} a főmenübe kerülnek, a „${SORREND_MEZO}” mezőjük szerinti helyre. Ha velük együtt rejtenéd el, náluk is vedd ki a pipát a „${LATHATO_MEZO}” mezőből.`
  }
  return { cim, elemek: [...elemek], magyarazat }
}

function rendezes(a: MenuSor, b: MenuSor): number {
  const diff = (a.order ?? 0) - (b.order ?? 0)
  return diff !== 0 ? diff : a.label.localeCompare(b.label, 'hu')
}

interface MenuSor {
  id: number | string
  label: string
  order: number | null
  visible: boolean | null
  unlisted: boolean | null
}

function olvasSor(doc: unknown): MenuSor | null {
  if (typeof doc !== 'object' || doc === null) return null
  const record = doc as Record<string, unknown>
  const { id } = record
  if (typeof id !== 'number' && typeof id !== 'string') return null
  return {
    id,
    label: typeof record.label === 'string' ? record.label : '',
    order: typeof record.order === 'number' ? record.order : null,
    visible: typeof record.visible === 'boolean' ? record.visible : null,
    unlisted: typeof record.unlisted === 'boolean' ? record.unlisted : null,
  }
}

export interface MenuChildrenNoticeProps {
  id?: number | string | null
  payload?: Pick<Payload, 'find'> & { config?: { routes?: { admin?: string } } }
  user?: TypedUser | null
}

/** Az almenüpontok a Local API-ból, a szerkesztő jogosultságával; hibánál null. */
export async function almenupontokBetoltese(
  payload: NonNullable<MenuChildrenNoticeProps['payload']>,
  id: number | string,
  user: TypedUser | null,
): Promise<AlmenupontSor[] | null> {
  try {
    const { docs } = await payload.find({
      collection: 'menus',
      where: { parent: { equals: id } },
      depth: 0,
      pagination: false,
      overrideAccess: false,
      user,
      select: { label: true, order: true, visible: true, unlisted: true },
    })
    return docs
      .map(olvasSor)
      .filter((sor): sor is MenuSor => sor !== null)
      .sort(rendezes)
      .map((sor) => ({
        id: sor.id,
        label: sor.label,
        rejtett: !isMenupontLathato({ visible: sor.visible, unlisted: sor.unlisted }),
      }))
  } catch (error) {
    logger.warn('menüpont-szerkesztő: az almenüpontok betöltése sikertelen', {
      menuId: id,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

export interface MenuChildrenNoticeViewProps {
  model: AlmenupontModel
  adminRoute: string
}

/** Megjelenítés (tiszta, tesztelhető). */
export function MenuChildrenNoticeView({
  model,
  adminRoute,
}: MenuChildrenNoticeViewProps): JSX.Element {
  return (
    <div className="kc-admin-notice">
      <p className="kc-admin-notice__cim">{model.cim}</p>
      <ul className="kc-admin-notice__linkek">
        {model.elemek.map((elem) => (
          <li key={String(elem.id)}>
            <a href={`${adminRoute}/collections/menus/${encodeURIComponent(String(elem.id))}`}>
              {elem.label}
            </a>
            {elem.rejtett ? <span>&nbsp;{REJTVE_JELZES}</span> : null}
          </li>
        ))}
      </ul>
      <p className="kc-admin-notice__szoveg" style={{ marginTop: '0.5em' }}>
        {model.magyarazat}
      </p>
    </div>
  )
}

export async function MenuChildrenNotice({
  id,
  payload,
  user,
}: MenuChildrenNoticeProps): Promise<JSX.Element | null> {
  // Új, még nem mentett menüpontnak nem lehet almenüpontja.
  if (id === undefined || id === null || id === '' || payload === undefined) {
    return null
  }
  const elemek = await almenupontokBetoltese(payload, id, user ?? null)
  const model = elemek === null ? null : almenupontModel(elemek)
  if (model === null) {
    return null
  }
  return (
    <MenuChildrenNoticeView adminRoute={payload.config?.routes?.admin ?? '/admin'} model={model} />
  )
}

export default MenuChildrenNotice
