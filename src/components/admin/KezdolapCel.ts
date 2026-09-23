import type { PayloadRequest } from 'payload'

import { HOME_PAGE_SLUG } from '../../lib/content-slugs'
import { ervenyesBlokkId } from '../editor/szekcio-melylink'

/**
 * A kezdőlap és a nyitó videó szekciójának feloldása az admin belépési
 * útjaihoz (`/admin/kezdolap`, `/admin/kezdolap-video`).
 *
 * MIÉRT KELL: a kezdőlap az Oldalak listában a hero-mondatával szerepelt, a
 * „kezdőlap” keresés 0 találatot adott, és a lista 2. oldalán állt (admin-audit
 * K32, séta t1). A tulajdonos kérése szó szerint: „létre kell hozni az
 * adminisztrációs felületen egy olyan modult vagy menüpontot, ahol a videón
 * lévő szövegeket lehet szerkeszteni”. A két nézet ezért slug alapján keresi
 * meg az oldalt, így az id változása (új telepítés, visszaállítás) sem töri el
 * a menüpontot.
 *
 * A lekérdezés a KÉRÉS FELHASZNÁLÓJÁNAK jogaival fut (`overrideAccess: false`),
 * a legújabb változaton (`draft: true`): a szerkesztő ugyanazt a sorrendet
 * kapja, amit a szerkesztő-nézet megnyit. A lekérdező injektálható, így a
 * feloldás adatbázis nélkül tesztelhető (src/__tests__/admin-kezdolap-utak.test.tsx).
 */

/**
 * Az admin saját belépési útjai (útvonal a config.routes.admin alatt, és a
 * látható név). EGY helyen áll, mert a menü (AdminNavLinks), az Irányítópult
 * (GyakoriTeendok), a nézetek címe és a payload.config.ts regisztrációja
 * ugyanezt használja: ugyanaz a cél mindenhol ugyanazon a néven szerepel
 * (WCAG 2.2 SC 3.2.4 Consistent Identification,
 * https://www.w3.org/WAI/WCAG22/Understanding/consistent-identification.html).
 *
 * A „Kezdőlapi videó szövegei” név indoklása:
 * - a tulajdonos saját szavai: „a videón lévő szövegek”; az NN/g menütervezési
 *   irányelve szerint „Use clear, specific, and familiar wording for link
 *   labels” (7. pont), https://www.nngroup.com/articles/menu-design/;
 * - az első szó a HELYET mondja meg („Kezdőlapi”), így a felirat eleje nem
 *   azonos a kurzusvideók „Videótár” menüpontjával; ugyanott a 8. pont:
 *   „Make Link Labels Easy to Scan” a kulcsszó előre hozásával;
 * - 24 karakter, az oldalsáv szélességében egy sorban marad (mérve,
 *   scratchpad leadA/A3).
 */
export const ADMIN_UTAK = {
  kezdolap: { utvonal: '/kezdolap', felirat: 'Kezdőlap' },
  videoSzovegei: { utvonal: '/kezdolap-video', felirat: 'Kezdőlapi videó szövegei' },
  statisztika: { utvonal: '/statisztika', felirat: 'Statisztika' },
  webanalitika: { utvonal: '/webanalitika', felirat: 'Webanalitika' },
  videotar: { utvonal: '/videok', felirat: 'Videótár' },
} as const

export type AdminUt = (typeof ADMIN_UTAK)[keyof typeof ADMIN_UTAK]

/** Egy admin-cím a Payload admin-útvonala alatt (a `/` gyökér is kezelve). */
export function adminCim(adminRoute: string, utvonal: string): string {
  return `${adminRoute.replace(/\/+$/, '')}${utvonal}`
}

/** A kezdőlap slugja: a közös leaf-modulból (a seed és a frontend `/` útvonala is ezt kéri). */
export const KEZDOLAP_SLUG = HOME_PAGE_SLUG

/** A nyitó videó szekció blokktípusa (src/blocks/film-hero.ts, „Nyitó videó (kéznyitás)”). */
export const NYITO_VIDEO_BLOKKTIPUS = 'filmHero'

export type KezdolapCel =
  | { allapot: 'nincs-kezdolap' }
  | {
      allapot: 'megvan'
      oldalId: number | string
      /** Van-e nyitó videó szekció a lapon. */
      vanNyitoVideo: boolean
      /** Az első nyitó videó szekció azonosítója, ha érvényes alakú. */
      nyitoVideoBlokkId: string | null
    }

/** A `kezdolap` slugú oldal lekérdezése: a találatok a `docs` tömbben. */
export type KezdolapLekerdezo = () => Promise<{ docs: readonly unknown[] }>

/** A valódi lekérdező: Payload Local API, a kérés felhasználójával. */
export function payloadKezdolapLekerdezo(req: PayloadRequest): KezdolapLekerdezo {
  return () =>
    req.payload.find({
      collection: 'pages',
      where: { slug: { equals: KEZDOLAP_SLUG } },
      draft: true,
      depth: 0,
      limit: 1,
      overrideAccess: false,
      req,
    })
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * A kezdőlap azonosítója és benne az ELSŐ nyitó videó szekció.
 * A lekérdezés hibáját nem nyeli el: a hívó nézet naplózza, és magyar
 * üzenetet ad.
 */
export async function kezdolapCelFeloldasa(lekerdezo: KezdolapLekerdezo): Promise<KezdolapCel> {
  const { docs } = await lekerdezo()
  const oldal = docs[0]
  if (!isRecord(oldal)) {
    return { allapot: 'nincs-kezdolap' }
  }
  const oldalId = oldal.id
  if (typeof oldalId !== 'number' && typeof oldalId !== 'string') {
    return { allapot: 'nincs-kezdolap' }
  }
  const layout = Array.isArray(oldal.layout) ? oldal.layout : []
  const nyitoVideo = layout.find(
    (blokk: unknown) => isRecord(blokk) && blokk.blockType === NYITO_VIDEO_BLOKKTIPUS,
  )
  const blokkId = isRecord(nyitoVideo) ? nyitoVideo.id : null
  return {
    allapot: 'megvan',
    oldalId,
    vanNyitoVideo: nyitoVideo !== undefined,
    nyitoVideoBlokkId: ervenyesBlokkId(blokkId) ? blokkId : null,
  }
}
