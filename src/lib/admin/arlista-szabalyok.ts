import { CLINIC_TREATMENTS_ANCHOR } from '../menu-seed'

/**
 * A rendelői árlista TELJES formai szabálya, a szerkesztőnek (modul-térkép
 * H29). A felismerő (src/lib/rendeloi-arlista.ts, `felismerRendeloiArlista`)
 * minden ágát egy-egy mondat mondja ki, hogy a szerkesztő a mezőnél lássa,
 * mitől lesz árkártya a szövegből, és mitől esik vissza sima szövegre. Az
 * arlista-szabalyok.test.ts szabályonként egy megfelelő és egy sértő
 * Lexical-dokumentummal köti a mondatokat a felismerőhöz.
 *
 * A címsorszintek neve a Lexical-eszköztár magyar felirata („Címsor 1”,
 * @payloadcms/richtext-lexical/dist/features/heading/server/i18n.js), a
 * figyelmeztetés zárása a piszkozat-szalag mondata („sima szövegként
 * látszik”), így a szerkesztő ugyanazt a nevet látja mindenütt (WCAG 2.2
 * SC 3.2.4 Consistent Identification). Gondolatjel nincs benne: a
 * tartományokat szóval írjuk.
 */
export const ARLISTA_FORMAI_SZABALYOK: readonly string[] = [
  'A szöveg első eleme egy nem üres címsor az első három szint valamelyikén (Címsor 1, 2 vagy 3); a kisebb címsor nem számít.',
  'Valahol utána egy „Árlista” szóval kezdődő címsor jön, szintén az első három szint valamelyikén.',
  'Közvetlenül e címsor alatt egy felsorolás áll legalább egy, legfeljebb négy tétellel, és minden tétel „50 perces alkalom: 18 000 Ft” alakú; a kettőspont helyett kötőjel is állhat, a tétel végén pedig zárójeles megjegyzés.',
  'A felsorolás után csak bekezdés következhet, újabb felsorolás vagy címsor nem.',
  'Ezekben a bekezdésekben legfeljebb egy link lehet, és annak a /kapcsolat oldalra kell mutatnia; a „Helyszíneink:” kezdetű bekezdés legfeljebb egyszer szerepelhet.',
]

/** A szabályok egy bekezdésben, számozott mondatokként, bevezetővel és zárással. */
export function arlistaSzabalySzoveg(): string {
  const szamozott = ARLISTA_FORMAI_SZABALYOK.map((mondat, index) => `${index + 1}. ${mondat}`)
  return [
    `Ennek a szekciónak az ugrópontja „${CLINIC_TREATMENTS_ANCHOR}”, ezért a szövegből akkor lesznek árkártyák, ha az alábbi szabályok mind teljesülnek.`,
    ...szamozott,
    'Ha bármelyik nem teljesül, a szöveg sima szövegként látszik.',
  ].join(' ')
}

type Adat = Readonly<Record<string, unknown>>

function isRecord(value: unknown): value is Adat {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Igaz, ha a blokk ugrópontja (sectionSettings.anchorId, szóközök nélkül) a
 * rendelői árlistáé. A megjelenítő ugyanígy dönt (RenderBlocks.tsx,
 * `rendeloiArlistaFelismerese`: `anchorId.trim()` a CLINIC_TREATMENTS_ANCHOR).
 */
export function rendeloiHorgonyu(siblingData: unknown): boolean {
  if (!isRecord(siblingData)) return false
  const settings = siblingData.sectionSettings
  if (!isRecord(settings)) return false
  const anchorId = settings.anchorId
  return typeof anchorId === 'string' && anchorId.trim() === CLINIC_TREATMENTS_ANCHOR
}
