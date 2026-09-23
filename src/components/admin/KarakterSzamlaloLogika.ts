/**
 * Az admin élő karakterszámlálójának tiszta logikája (React- és Payload-mentes).
 *
 * A számláló (KarakterSzamlalo.tsx) és a mezők szerveroldali validátora
 * (pl. src/lib/film-captions.ts) UGYANEZZEL a függvénnyel számol, így a
 * szerkesztő sosem lát „58 / 60”-at olyan szövegre, amit a mentés 61-nek
 * mond (NN/g 4. heurisztika, következetesség:
 * https://www.nngroup.com/articles/ten-usability-heuristics/).
 *
 * Minta: GOV.UK Design System, Character count
 * (https://design-system.service.gov.uk/components/character-count/):
 * - a mező nem tiltja a túlírást („does not restrict the user from entering
 *   information”), hanem kiírja, mennyivel hosszabb;
 * - a képernyőolvasó a számot akkor hallja, amikor a gépelés megállt
 *   („will hear the count announcement when they stop typing”); a
 *   govuk-frontend forrása ehhez külön, látássérülteknek szóló
 *   aria-live="polite" régiót használ, a látható számot aria-hidden-nel
 *   rejti, és legalább 500 ms csendet vár (1000 ms-os lekérdezéssel).
 * A túllépést szöveg ÉS szín jelzi, nem csak szín (WCAG 2.2 SC 1.4.1,
 * https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html); a
 * bejelentés fókusz nélkül jut el a képernyőolvasóhoz (SC 4.1.3,
 * https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html).
 */

/**
 * Ennyi csend után szól a képernyőolvasó. A govuk-frontend 500 ms csendet vár
 * és másodpercenként ellenőriz, a tényleges késés így 0,5–1,5 mp; mi a közepét
 * vesszük fix késleltetésnek, hogy gépelés közben ne szóljon minden betűre.
 */
export const BEJELENTES_KESLELTETES_MS = 1000

/**
 * Egy szöveg hossza a korlát szempontjából: a két végéről levágott szóközök
 * nélkül, NFC-normalizálva, Unicode-kódpontonként.
 *
 * Miért így:
 * - trim: a véletlen szóköz a mező végén nem látszik, nem is számít bele
 *   (a megjelenítés is levágja);
 * - kódpont, nem UTF-16 egység: a JavaScript `.length` egy emojit (😀) 2-nek
 *   számolna, a szerkesztő viszont egy jelet lát; a kódpont-számítás a
 *   böngészőben és a Node-szerveren betűre ugyanazt adja;
 * - NFC: a másolt szövegben az „ő” néha két kódpontként érkezik (o + kettős
 *   ékezet, U+030B); normalizálva ez is egy, ahogy a képernyőn.
 * - NEM grafémafürt (Intl.Segmenter): annak eredménye a futtatókörnyezet
 *   ICU-adataitól függ, így a számláló és a szerver validátora eltérhetne.
 *   Az összetett emoji (pl. családemoji) ezért több karakternek számít, ami a
 *   korlátot legfeljebb szigorítja, sosem lazítja.
 */
export function karakterHossz(value: unknown): number {
  if (typeof value !== 'string') {
    return 0
  }
  return Array.from(value.normalize('NFC').trim()).length
}

export interface SzamlaloModell {
  hossz: number
  max: number
  /** Ennyivel hosszabb a megengedettnél (0, ha belefér). */
  tullepes: number
  tullepve: boolean
  /** A mező alatt látható szöveg, pl. „38 / 60 karakter”. */
  lathatoSzoveg: string
  /** A képernyőolvasónak szóló, teljes mondatos változat. */
  bejelentes: string
}

/** A számláló állapota egy mezőértékre és korlátra. Érvénytelen korlátnál null. */
export function szamlaloModell(value: unknown, max: unknown): SzamlaloModell | null {
  if (typeof max !== 'number' || !Number.isInteger(max) || max <= 0) {
    return null
  }
  const hossz = karakterHossz(value)
  const tullepes = Math.max(0, hossz - max)
  if (tullepes > 0) {
    const tulSzoveg = `${tullepes} karakterrel hosszabb a megengedettnél`
    return {
      hossz,
      max,
      tullepes,
      tullepve: true,
      lathatoSzoveg: tulSzoveg,
      bejelentes: `${tulSzoveg}. Legfeljebb ${max} karakter lehet.`,
    }
  }
  return {
    hossz,
    max,
    tullepes: 0,
    tullepve: false,
    lathatoSzoveg: `${hossz} / ${max} karakter`,
    bejelentes: `Eddig ${hossz} karakter, legfeljebb ${max} lehet.`,
  }
}
