import type { CollectionConfig, Field } from 'payload'

import { publicMediaReadAccess } from '../access/mediaFilename'
import { resolveMediaStaticDir } from '../lib/media-dir'

/** A feltöltési célkönyvtár a `PAYLOAD_MEDIA_DIR`-ből (env nélkül `undefined`). */
const mediaStaticDir = resolveMediaStaticDir()

/**
 * A Képek gyűjtemény leírása (modul-térkép H34). Egy Kép-dokumentumot több
 * oldal és blokk is kiválaszthat (a modul-térkép mérése szerint élesben a
 * media 12 négy helyen szerepel), a képmező ceruzája pedig ezt a KÖZÖS
 * dokumentumot nyitja meg. A leírás ezért kimondja a hatókört és a helyi
 * csere útját is, ugyanazzal a szóval, mint a képmezők közös súgója
 * (src/blocks/kep-csere.ts
 * KEP_CSERE_SUGO: „X-szel”, „minden oldalon”; WCAG 2.2 SC 3.2.4 Consistent
 * Identification).
 */
export const MEDIA_LEIRAS =
  'Az oldalakon használt képek. Egy kép több helyen is ki lehet választva: ha itt cseréled a fájlt vagy átírod a leírását, minden oldalon megváltozik, ahol használják. Ha csak egy helyen cserélnéd, ott a képmezőben az X-szel vedd ki, és válassz vagy tölts fel másikat.'

/** A Kép-szerkesztő mezői előtt álló figyelmeztetés szövege (csak meglévő képnél). */
export const KOZOS_KEP_FIGYELMEZTETES =
  'Figyelem: ez a kép több oldalon is szerepelhet. Amit itt módosítasz (fájl, leírás, fókuszpont), minden olyan helyen megváltozik, ahol ez a kép ki van választva.'

/** Meglévő (már mentett) Kép-dokumentum-e: csak ennek van azonosítója. */
export function meglevoKep(data: unknown): boolean {
  if (typeof data !== 'object' || data === null) return false
  const id = (data as Record<string, unknown>).id
  return id !== undefined && id !== null && id !== ''
}

/**
 * Figyelmeztetés a Kép-szerkesztő mezői előtt (H34). A képmező ceruzája a
 * meglévő képet egy fiókban (drawer) nyitja meg. A fiók fejlécében a
 * gyűjtemény leírása is ott áll, de a Mentés-sáv és a fájlkártya fölött; ez a
 * mondat közvetlenül a fájlkártya alatt, a Képleírás mező előtt áll, ahol a
 * módosítás történik (mérve 2026-09-23-án a helyi adminban, 1440 × 900: a
 * Rólunk Fejlécképének ceruzája, scratchpad B4-meres/meres.json). Új képnél
 * (feltöltés, „Új létrehozása”) nincs mit félteni, ott nem jelenik meg.
 *
 * Források (megnyitva 2026-09-23-án):
 * - NN/g, 10 Usability Heuristics, #5 Error Prevention: „Good error messages
 *   are important, but the best designs carefully prevent problems from
 *   occurring in the first place.”
 *   (https://www.nngroup.com/articles/ten-usability-heuristics/);
 * - GOV.UK Design System, Warning text: „Use the warning text component when
 *   you need to warn users about something important, such as legal
 *   consequences of an action, or lack of action, that they might take.”
 *   (https://design-system.service.gov.uk/components/warning-text/). A
 *   szöveg ezért „Figyelem:” szóval kezdődik, és a következményt mondja ki.
 * A Payload saját FieldDescription-komponense rajzolja (mint a film-hero.ts
 * videoSzovegTajekoztato mezőjét), így a többi mezőleírással azonos betűt és
 * kontrasztot kap. UI-mező: adatbázis-oszlop és payload-types nem változik.
 */
const kozosKepFigyelmeztetes: Field = {
  name: 'kozosKepFigyelmeztetes',
  type: 'ui',
  admin: {
    // Nem listaoszlop: a lista oszlopválasztója különben felkínálná.
    disableListColumn: true,
    condition: (data) => meglevoKep(data),
    components: {
      Field: {
        path: '@payloadcms/ui#FieldDescription',
        clientProps: {
          description: KOZOS_KEP_FIGYELMEZTETES,
          marginPlacement: 'bottom',
        },
      },
    },
  },
}

/**
 * Médiafeltöltés: webméretek (320–1920), og 1200×630, webp q80, raszter only (SVG
 * kizárva), max 10 MB. Tárolás: `PAYLOAD_MEDIA_DIR` (élesben Railway volume);
 * hiányzó fájlok: `ensureMediaFiles`. Később: R2/S3 adapter.
 */
export const Media: CollectionConfig = {
  slug: 'media',
  labels: {
    singular: 'Kép',
    plural: 'Képek',
  },
  admin: {
    useAsTitle: 'alt',
    group: 'Tartalom',
    defaultColumns: ['alt', 'filename', 'mimeType', 'updatedAt'],
    description: MEDIA_LEIRAS,
  },
  access: {
    read: publicMediaReadAccess,
  },
  fields: [
    kozosKepFigyelmeztetes,
    {
      name: 'alt',
      type: 'text',
      required: true,
      label: 'Képleírás (alt)',
      admin: {
        description:
          'A kép szöveges leírása — kötelező, a képernyőolvasók és a Google miatt. Írd le egy mondatban, mi látszik a képen.',
      },
    },
  ],
  upload: {
    // A kulcs CSAK akkor kerül be, ha van env-érték: enélkül a Payload
    // szanitálása állítja be az alapértelmezést (a collection slugja), tehát a
    // mai fejlesztői viselkedés bitre azonos marad.
    ...(mediaStaticDir === undefined ? {} : { staticDir: mediaStaticDir }),
    formatOptions: {
      format: 'webp',
      options: { quality: 80 },
    },
    imageSizes: [
      { name: 'xs', width: 320, withoutEnlargement: true },
      { name: 'sm', width: 640, withoutEnlargement: true },
      { name: 'md', width: 1280, withoutEnlargement: true },
      { name: 'lg', width: 1920, withoutEnlargement: true },
      {
        name: 'og',
        width: 1200,
        height: 630,
        fit: 'cover',
        position: 'centre',
        withoutEnlargement: true,
      },
    ],
    // SEC-002: AVIF-feltöltés SZÁNDÉKOSAN nincs az allowlistben. A Next.js
    // 16.3.3 javítja az image-optimizer AVIF-dekódolóját érintő RCE-t
    // (GHSA-2xp9-vwfh-vxw4); az AVIF-forrást ettől függetlenül, defense-in-depth
    // rétegként tiltjuk. A kimenet úgyis webp (formatOptions.format), tehát AVIF
    // forrás nem szükséges a minőséghez.
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  },
}
