/**
 * Tartalom-szabály: a „szakembereknek” webcímű Oldalak-rekord létrehozása a
 * WP49 lap mai szövegéből (modul-térkép H11, A7).
 *
 * MIÉRT KELL: 2026-09-23-tól a /szakembereknek lap a „szakembereknek” slugú
 * Oldalak-rekord Címét, Rövid bevezetőjét és szekciósorát rendereli (a
 * /kapcsolat mintája, src/app/(frontend)/szakembereknek/page.tsx). Amíg
 * nincs rekord, a lap a kódtartalékot mutatja, és az adminban nincs mit
 * szerkeszteni. Ez a szabály a rekordot PONTOSAN a mai lap adataiból hozza
 * létre: a Cím, a Rövid bevezető és az „Ajánlat-kártyák” szekció a
 * kódtartalékkal azonos (`szakembereknekAlapBlokk`), ezért a közzététel után
 * a lap látványa nem változik, a szerkesztő pedig a mai szövegből indul.
 *
 * HATÁR: csak akkor ad adatot, ha nincs rekord. Meglévő rekordnál (bármilyen
 * állapotban: piszkozat, közzétett, üres szekciósor) SEMMIT nem ír: az
 * szerkesztői döntés, ehhez a szabály nem nyúl.
 *
 * A `seoDescription` a kódbeli meta-leírás (`SZAKEMBEREKNEK_DESCRIPTION`): a
 * Google-találat és az llms.txt ebből dolgozik, így a leírás a rekorddal sem
 * vált át a hosszabb Rövid bevezetőre. A kötelező `content` (a Szekciók
 * nélküli oldalak fő szövege) a bevezető egy bekezdésben: a lapon nem
 * látszik, mert az oldalnak van szekciója (a Pages súgója szerint).
 *
 * TISZTA FÜGGVÉNY: nincs adatbázis, hálózat vagy naplózás; a bemenetet nem
 * módosítja. A hívó (src/scripts/apply-owner-content.ts, az A8 köti be) előbb
 * megkeresi a rekordot (`slug = szakembereknek`, piszkozattal együtt), és
 * `LETREHOZANDO` állapotnál az `adat`-ot a `payload.create`-nek adja, az
 * `uzenet`-et pedig a loggerrel naplózza.
 */
import type { RequiredDataFromCollectionSlug } from 'payload'

import {
  SZAKEMBEREKNEK_DESCRIPTION,
  SZAKEMBEREKNEK_LEAD,
  SZAKEMBEREKNEK_TITLE,
  szakembereknekAlapBlokk,
} from '../lib/szakembereknek'

/** A rekord webcíme (a dedikált route ezt kérdezi le). */
export const SZAKEMBEREKNEK_OLDAL_SLUG = 'szakembereknek'

/** A létrehozandó rekord adata (a Pages `create` bemenete). */
export type SzakembereknekOldalAdat = RequiredDataFromCollectionSlug<'pages'>

/** A szabály kimenete. */
export interface SzakembereknekOldalTerv {
  /** `LETREHOZANDO`: nincs rekord, az `adat` a létrehozandó; `MAR_LETEZIK`: nincs teendő. */
  allapot: 'LETREHOZANDO' | 'MAR_LETEZIK'
  /** A `payload.create` adata, vagy null, ha nincs mit írni. */
  adat: SzakembereknekOldalAdat | null
  /** Egy magyar mondat a naplóba. */
  uzenet: string
}

/** A kötelező `content` mező: a bevezető egy Lexical-bekezdésben. */
function bevezetoTartalom(): SzakembereknekOldalAdat['content'] {
  return {
    root: {
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [
            {
              type: 'text',
              detail: 0,
              format: 0,
              mode: 'normal',
              style: '',
              text: SZAKEMBEREKNEK_LEAD,
              version: 1,
            },
          ],
          direction: null,
          format: '',
          indent: 0,
          version: 1,
        },
      ],
      direction: null,
      format: '',
      indent: 0,
      version: 1,
    },
  }
}

/**
 * A terv: meglévő rekordnál `MAR_LETEZIK` (adat nélkül), különben
 * `LETREHOZANDO` a mai lap adataival, közzétéve, `most` közzétételi dátummal.
 */
export function szakembereknekOldalTerv(
  meglevo: { id: number | string } | null,
  most: Date,
): SzakembereknekOldalTerv {
  if (meglevo !== null) {
    return {
      allapot: 'MAR_LETEZIK',
      adat: null,
      uzenet: `A „${SZAKEMBEREKNEK_OLDAL_SLUG}” oldal már létezik (azonosító: ${String(meglevo.id)}), a szabály nem ír rá.`,
    }
  }
  return {
    allapot: 'LETREHOZANDO',
    adat: {
      title: SZAKEMBEREKNEK_TITLE,
      slug: SZAKEMBEREKNEK_OLDAL_SLUG,
      excerpt: SZAKEMBEREKNEK_LEAD,
      seoDescription: SZAKEMBEREKNEK_DESCRIPTION,
      content: bevezetoTartalom(),
      layout: [szakembereknekAlapBlokk()],
      status: 'published',
      _status: 'published',
      publishedAt: most.toISOString(),
    },
    uzenet: `A „${SZAKEMBEREKNEK_OLDAL_SLUG}” oldal létrehozandó a mai lap szövegével (Cím, Rövid bevezető, egy Ajánlat-kártyák szekció két kártyával), közzétéve.`,
  }
}
