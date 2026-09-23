/**
 * A „fríz-helyzet” kiszámítása az admin számára (modul-térkép H12).
 *
 * A lap a Bemutatkozás és számok (about) blokk jobb hasábjában a csapatfotó
 * helyett a mozgó fotósort (fríz) mutatja, ha a blokk az első látható about
 * szekció, és közvetlenül előtte (a rejtett szekciókat átugorva) a nyitó
 * videó (filmHero) áll. A szabály forrása a megjelenítő:
 * src/components/blocks/RenderBlocks.tsx, a `previousVisible` és az
 * `afterFilmHero` számítása, valamint az `afterFilmHero && !isRepeat` feltétel
 * az about ágon. Ez a modul ugyanezt a szabályt tükrözi a mentett (vagy éppen
 * szerkesztett) `layout` tömbön, hogy az admin mezőleírása csak ott mondja ki
 * a feltételt, ahol az igaz. A friz-helyzet.test.ts szövegőre jelez, ha a
 * megjelenítő szabálya elmozdul.
 *
 * A hely önmagában nem elég: a src/components/blocks/About.tsx a frízt csak
 * akkor rajzolja, ha a blokknak van szövege (`const founders = frieze &&
 * hasCopy`); szöveg nélkül a sima alakra esik vissza, és a Csapatfotó
 * látszik. Ezt a `vanSzovege` tükrözi, a teljes állapot a kettő együtt.
 *
 * A modul TISZTA: React, DOM és adatbázis nélkül tesztelhető.
 */

type Adat = Readonly<Record<string, unknown>>

function isRecord(value: unknown): value is Adat {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A megjelenítővel azonos láthatóság: csak a kifejezett `visible: false` rejt. */
function lathato(block: unknown): boolean {
  if (!isRecord(block)) return false
  const settings = block.sectionSettings
  return !(isRecord(settings) && settings.visible === false)
}

function blokkTipus(block: unknown): unknown {
  return isRecord(block) ? block.blockType : undefined
}

/**
 * Igaz, ha a `layout` `index`-edik blokkja fríz-helyzetben áll: about típusú,
 * nem rejtett, előtte nincs látható about blokk, és az előtte álló
 * legközelebbi LÁTHATÓ blokk a nyitó videó.
 */
export function frizHelyzetben(layout: readonly unknown[], index: number): boolean {
  if (!Number.isInteger(index) || index < 0 || index >= layout.length) return false
  const blokk = layout[index]
  if (blokkTipus(blokk) !== 'about' || !lathato(blokk)) return false
  const elozoLathatok = layout.slice(0, index).filter(lathato)
  if (elozoLathatok.some((elozo) => blokkTipus(elozo) === 'about')) return false
  const legkozelebbi = elozoLathatok[elozoLathatok.length - 1]
  return blokkTipus(legkozelebbi) === 'filmHero'
}

function nemUres(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Igaz, ha a blokknak van a lapon megjelenő szövege. Az About.tsx `hasCopy`
 * képletének tükre: nem üres felső kis felirat vagy cím, legalább egy nem üres
 * bekezdés, vagy a kiemelt blokk nem üres felirata vagy magyarázata. Minden
 * érték trimmelve számít, a csak szóközből álló mező üres.
 */
export function vanSzovege(block: unknown): boolean {
  if (!isRecord(block)) return false
  if (nemUres(block.eyebrow) || nemUres(block.title)) return true
  const bekezdesek = block.paragraphs
  if (
    Array.isArray(bekezdesek) &&
    bekezdesek.some((bekezdes) => isRecord(bekezdes) && nemUres(bekezdes.text))
  ) {
    return true
  }
  const kiemeles = block.feature
  return isRecord(kiemeles) && (nemUres(kiemeles.label) || nemUres(kiemeles.note))
}

/**
 * Az útvonal `layout` utáni szegmenséből a blokk sorszáma. A Payload 3.88 a
 * condition-nek sztring-szegmenseket ad (`path.split('.')`,
 * @payloadcms/ui/dist/forms/fieldSchemasToFormState/iterateFields.js), a
 * típus szerint szám is érkezhet: mindkettőt elfogadjuk.
 */
function blokkIndex(path: readonly (number | string)[] | undefined): number | null {
  if (!Array.isArray(path)) return null
  const hely = path.indexOf('layout')
  if (hely < 0 || hely + 1 >= path.length) return null
  const szegmens = path[hely + 1]
  const szam =
    typeof szegmens === 'number'
      ? szegmens
      : typeof szegmens === 'string' && /^\d+$/u.test(szegmens)
        ? Number(szegmens)
        : Number.NaN
  return Number.isInteger(szam) && szam >= 0 ? szam : null
}

/**
 * A fríz-helyzet a mező útvonalából és a dokumentum adatából: `true`, ha a lap
 * ennél a blokknál a mozgó fotósort rajzolja (fríz-helyzet ÉS van szöveg),
 * `false`, ha nem, `null`, ha az útvonal vagy a `layout` hiányzik.
 */
export function frizHelyzetAllapot(
  data: unknown,
  path: readonly (number | string)[] | undefined,
): boolean | null {
  const index = blokkIndex(path)
  if (index === null || !isRecord(data)) return null
  const layout = data.layout
  if (!Array.isArray(layout) || index >= layout.length) return null
  return frizHelyzetben(layout, index) && vanSzovege(layout[index])
}

/**
 * Condition-segéd: igaz, ha a lap ennél a blokknál a mozgó fotósort mutatja
 * (fríz-helyzet és van szöveg); hiányzó adatnál hamis.
 */
export function frizHelyzetUtvonalbol(
  data: unknown,
  path: readonly (number | string)[] | undefined,
): boolean {
  return frizHelyzetAllapot(data, path) === true
}

/**
 * A fordított condition-segéd: igaz, ha a lap ennél a blokknál BIZTOSAN nem
 * a mozgó fotósort mutatja (rossz hely, vagy nincs szöveg). Hiányzó adatnál ez is hamis, hogy a leírás ne állítson
 * olyat, amit nem tudunk (a blokk ilyenkor csak a csoport állandó leírását
 * mutatja).
 */
export function nemFrizHelyzetUtvonalbol(
  data: unknown,
  path: readonly (number | string)[] | undefined,
): boolean {
  return frizHelyzetAllapot(data, path) === false
}
