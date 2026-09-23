/**
 * A blokkok képmezőinek közös súgómondata (K36, 2026-09-22; a gombnév
 * 2026-09-23-án javítva).
 *
 * A kiválasztott kép kártyáján a Payload két felirat nélküli ikont mutat: a
 * ceruza a Képek közös dokumentumát nyitja meg (a fájl vagy a képleírás
 * cseréje MINDEN oldalon érvényesül, ahol a kép szerepel), az X csak ebből a
 * mezőből veszi ki a képet (@payloadcms/ui/dist/fields/Upload/
 * RelationshipContent: `icon: 'edit'` → openDrawer, `icon: 'x'` → onRemove).
 * A mért séta (admin-audit, seta/t6.json) szerint a szerkesztő a ceruzával
 * akarta a helyi képet cserélni. Az ikonok felirata upstream (K53), ezért a
 * mező leírása mondja ki a helyi csere útját és a ceruza hatókörét.
 *
 * Az X után a mező üres állapotának két gombja áll, a súgó ezek tényleges
 * magyar nevét mondja (@payloadcms/ui/dist/fields/Upload/Input.js):
 *  - :571 `t('general:createNew')` → „Új létrehozása” (a core magyar
 *    fordítása, a src/lib/admin/hu-forditas.ts nem írja felül);
 *  - :582 `t('fields:chooseFromExisting')` → „Válassz a meglévők közül” (a
 *    hu-forditas.ts tegező alakja; a súgóban kis kezdőbetűvel áll).
 * A src/__tests__/blokknevek.test.ts mindkét nevet a fordítási forráshoz köti,
 * így fordításváltozásnál a teszt bukik, nem a súgó avul el csendben.
 *
 * Források: NN/g, Icon Usability: „a text label must be present alongside an
 * icon to clarify its meaning in that particular context”
 * (https://www.nngroup.com/articles/icon-usability/); GOV.UK Design System,
 * Text input: „Use hint text for help that's relevant to the majority of
 * users, like how their information will be used, or where to find it.”
 * (https://design-system.service.gov.uk/components/text-input/). A súgó ezért
 * két rövid mondat, nem magyarázat. Egyetlen forrás, hogy minden képmezőn szó
 * szerint ugyanaz álljon (WCAG 2.2 SC 3.2.4, Consistent Identification).
 */
export const KEP_CSERE_SUGO =
  'Cseréhez az X-szel vedd ki a képet, aztán tölts fel újat az „Új létrehozása” gombbal, vagy válassz a meglévők közül. A ceruza a kép adatait minden oldalon módosítja.'
