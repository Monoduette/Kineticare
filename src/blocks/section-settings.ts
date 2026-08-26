import type { Field } from 'payload'

/**
 * Közös szekció-beállítások MINDEN kezdőlapi blokkhoz (szekció-rendszer terv, 2. pont).
 * Egyetlen forrásból (DRY) adja a három kapcsolót, amit a szerkesztő minden
 * szekciónál ugyanott, ugyanúgy talál meg:
 * - `visible`  — elrejtés törlés helyett (a tartalom megmarad),
 * - `anchorId` — lapon belüli hivatkozás (pl. /#kurzusok),
 * - `hatter`   — a szekció háttérsávja, ott, ahol értelmezett.
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
    return 'A horgony azonosító csak ékezet nélküli kisbetűvel kezdődhet, és kisbetűt, számot vagy kötőjelet tartalmazhat (pl. „kurzusok"). A # jelet és a szóközt hagyd ki belőle.'
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

/**
 * A blokkok végére kerülő „Szekció-beállítások" csoport.
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
        description:
          'Ha kiveszed a pipát, a szekció eltűnik az oldalról, de a tartalma megmarad — bármikor visszakapcsolhatod.',
      },
    },
    {
      name: 'anchorId',
      type: 'text',
      label: 'Horgony azonosító',
      admin: {
        description:
          'Nem kötelező. Rövid azonosító a lapon belüli ugráshoz (pl. „kurzusok"): ezután a szekcióra a webcím végére írt #kurzusok résszel lehet hivatkozni. Csak ékezet nélküli kisbetű, szám és kötőjel; a # jelet ne írd bele.',
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
          'A szekció háttérsávja. Váltogasd a fehéret és a világoskéket, hogy az egymás alatti szekciók jól elkülönüljenek; a sötétkéket ritkán, kiemelésre használd.',
      },
    })
  }

  return {
    name: 'sectionSettings',
    type: 'group',
    label: 'Szekció-beállítások',
    admin: {
      description: 'Megjelenés és elrejtés — a szekció szövegét fölötte szerkesztheted.',
    },
    fields,
  }
}
