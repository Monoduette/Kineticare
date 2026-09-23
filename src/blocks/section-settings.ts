import type { Field } from 'payload'

/**
 * Közös szekció-beállítások MINDEN kezdőlapi blokkhoz (szekció-rendszer terv, 2. pont).
 * Egyetlen forrásból (DRY) adja a három kapcsolót, amit a szerkesztő minden
 * szekciónál ugyanott, ugyanúgy talál meg:
 * - `visible`  — elrejtés törlés helyett (a tartalom megmarad),
 * - `anchorId` — lapon belüli hivatkozás (pl. /#kurzusok), a felületen „ugrópont”,
 * - `hatter`   — a szekció háttérsávja, ott, ahol értelmezett.
 *
 * Megjelenés (K28, 2026-09-22): a `sectionSettings` csoport egy NÉV NÉLKÜLI,
 * alapból csukott „Megjelenés és elrejtés” collapsible-ben áll. A kezdőlap
 * tizenöt szekciójánál a mindig nyitott beállításcsoport szekciónként három
 * mezőt és 474 karakternyi leírást tett a tartalommezők közé. A ritkán kellő
 * beállítás így csak kérésre nyílik ki (NN/g, Progressive Disclosure:
 * „Initially, show users only a few of the most important options. Offer a
 * larger set of specialized options upon request.”, és a fejléc mondja meg,
 * mi van mögötte: „label the button or link in a way that sets clear
 * expectations for what users will find”,
 * https://www.nngroup.com/articles/progressive-disclosure/).
 *
 * SÉMA-SEMLEGES: a Payload szerint a collapsible „presentational-only and only
 * affects the Admin Panel” (https://payloadcms.com/docs/fields/collapsible), a
 * név nélküli mező nem kerül az adatútvonalba. A `sectionSettings.visible`,
 * `.anchorId` és `.hatter` útvonal és a DB-oszlopok változatlanok; ezt a G2 őr
 * (src/__tests__/schema-config-sync.test.ts) bizonyítja. A csoport `label:
 * false`: a fejlécet a collapsible adja, így nincs két egymásba ágyazott cím.
 * Hibánál a csukott fejléc is mutatja a hibajelzőt (a Payload Collapsible
 * WatchChildErrors + ErrorPill, @payloadcms/ui/dist/fields/Collapsible).
 */

/** A szekciók háttérsávjának lehetséges értékei. */
export type SectionBackground = 'feher' | 'tint' | 'sotet'

/**
 * A horgony-azonosító megengedett alakja: ékezet nélküli kisbetűvel kezdődik,
 * utána kisbetű / szám / kötőjel. Ez az, ami URL-ben (#horgony) is működik.
 */
const ANCHOR_ID_PATTERN = /^[a-z][a-z0-9-]*$/

/**
 * Horgony-azonosító ellenőrzése (tiszta függvény — DB nélkül tesztelhető).
 *
 * Üres érték mindig rendben van (a mező nem kötelező). A leggyakoribb laikus
 * hiba a bemásolt `#kurzusok` és a szóközös/ékezetes alak — mindkettő néma
 * hibához vezetne (a link egyszerűen nem ugrana sehova), ezért itt kerül elő.
 */
export const validateAnchorId = (value: unknown): string | true => {
  if (typeof value !== 'string') {
    return true
  }
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return true
  }
  if (!ANCHOR_ID_PATTERN.test(trimmed)) {
    return 'Az ugrópont neve ékezet nélküli kisbetűvel kezdődjön, és csak kisbetű, szám vagy kötőjel legyen benne (pl. „kurzusok”). A # jelet és a szóközt hagyd ki.'
  }
  return true
}

export interface SectionSettingsOptions {
  /**
   * Legyen-e háttér-választó a blokkon. A katalógus szerint „ahol értelmezett" —
   * a film-hero az egyetlen kivétel.
   * @default true
   */
  background?: boolean
  /**
   * A háttér-választó alapértéke. A meglévő kezdőlap sávritmusát követi
   * (fehér ↔ világoskék váltakozás), ezért blokkonként eltérhet.
   * @default 'feher'
   */
  defaultBackground?: SectionBackground
}

/** A csukott csoport fejléce: a mögötte álló két fő dolgot nevezi meg. */
export const SECTION_SETTINGS_LABEL = 'Megjelenés és elrejtés'

/**
 * A blokkok végére kerülő „Megjelenés és elrejtés” rész (benne a
 * `sectionSettings` csoport).
 *
 * Mindig az UTOLSÓ mező a blokkban: előbb a tartalom, aztán a technikai
 * kapcsolók — így a szerkesztő nem a beállításokon keresztül jut el a szövegig.
 */
export const sectionSettings = ({
  background = true,
  defaultBackground = 'feher',
}: SectionSettingsOptions = {}): Field => {
  const fields: Field[] = [
    {
      name: 'visible',
      type: 'checkbox',
      defaultValue: true,
      label: 'Látható',
      admin: {
        description: 'Kikapcsolva a szekció nem látszik, a tartalma megmarad.',
      },
    },
    {
      name: 'anchorId',
      type: 'text',
      label: 'Ugrópont neve (haladó beállítás)',
      admin: {
        description:
          'Nem kötelező. Pl. „kurzusok”: a webcím végére írt #kurzusok ide ugrik. Ékezet és szóköz nélkül.',
      },
      validate: (value: string | null | undefined) => validateAnchorId(value),
    },
  ]

  if (background) {
    fields.push({
      name: 'hatter',
      type: 'select',
      defaultValue: defaultBackground,
      label: 'Háttér',
      options: [
        { label: 'Fehér', value: 'feher' },
        { label: 'Világoskék', value: 'tint' },
        { label: 'Sötétkék', value: 'sotet' },
      ],
      admin: {
        description:
          'Váltogasd a fehéret és a világoskéket, hogy a szekciók elkülönüljenek. A sötétkék kiemelésre való.',
      },
    })
  }

  return {
    type: 'collapsible',
    label: SECTION_SETTINGS_LABEL,
    admin: { initCollapsed: true },
    fields: [
      {
        name: 'sectionSettings',
        type: 'group',
        label: false,
        fields,
      },
    ],
  }
}
