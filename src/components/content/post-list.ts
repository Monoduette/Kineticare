/**
 * Tudástár lista-oldal — megjelenítési szabályok (tiszta függvények).
 * A `docs/tudastar-technikai-terv.md` 3.7 pontja ezt a szabályt az
 * `src/lib/tudastar.ts`-be tervezi (B-csomag). Az a modul ebben a körben más
 * csapat fájlja, ezért a lista-oldal a saját, azonos szerződésű függvényét
 * hozza. Ha a B-csomag megérkezik, ez a modul egy importcserével kiváltható.
 */

/**
 * Megjelenjen-e a kategória-szűrő chip-sora.
 * Küszöb (`docs/ux-belso-oldalak-kutatas.md` B4.3): legalább HÁROM olyan
 * kategória van, amelyhez tartozik cikk, VAGY legalább ÖT cikk van a listán.
 * és plusz kattintási költséget. A szűrő értelme a választás szűkítése; ha
 * nincs mit szűkíteni, a sor csak elveszi a helyet a tartalom elől, és
 * lejjebb tolja az első kártyát a hajtás alá.
 */
export function shouldShowCategoryFilter(
  categoriesWithPostCount: number,
  postCount: number,
): boolean {
  return categoriesWithPostCount >= 3 || postCount >= 5
}
