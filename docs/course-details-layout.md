# A kurzus leírásának célzott elrendezése

Kérés: kizárólag az „A kurzusról”, „Mi vár a programban”, „Bónusz minikurzusok” és az alattuk lévő kép elrendezése változzon. A meglévő CMS-szöveg és képhivatkozás marad; nincs új adatmodell vagy tartalmi mentés.

## Terv és határ

Az aktív, csomagblokkot tartalmazó akciós nézet leírása használja az új megjelenítőt. A normál, előnézeti és csomag nélküli megjelenítés a korábbi renderelőt kapja. A hero, csomaglista, alkalmasság, működés, tananyag, garancia, GYIK, ár, CTA és listázás nem változik.

A meglévő H2/H3 hierarchia veszteségmentes csoportosítása tagolja a tartalmat: két hasábos bevezető; négy modul két sorban, két hasábban; három bónusz egymás mellett asztalon. Mobilon egy hasáb. A szöveg, formázás, listák, linkek és dokumentumsorrend megmarad. A kép azonos forrásból és alt szöveggel, a teljes belső rácshoz igazítva, a kézmozdulatot megtartó kivágással jelenik meg.

Meglévő Container és rácsok, 24 px oszlopköz, 48 px csoportköz, Tenor Sans/Nunito Sans, L/M/S mérettokenek, eredeti paper/tint/ink színek. Nincs új animáció, ikon vagy kártyakészlet. A megjelenítési csoportosítás nem címszövegből vagy termékslugból következtet, ezért a CMS-címek továbbra is szerkeszthetők.

## Források és helyi következtetés

2026-09-21-én megnyitott források:

- [NN/g: The Layer-Cake Pattern of Scanning Content on the Web](https://www.nngroup.com/articles/layer-cake-pattern-scanning/): a leíró címek és következetes csoportközök segítik a pásztázó olvasást. A H2/H3 határok megtartása helyi alkalmazás, nem konverziós ígéret.
- [GOV.UK Design System: Layout](https://design-system.service.gov.uk/styles/layout/): következetes rács és olvasható tartalomszélesség. A Kineticare meglévő rácsát használjuk; a forrás stílusát nem másoljuk át.
- [W3C: WCAG 2.2, 1.4.10 Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html): 320 CSS px-en is olvasható tartalom vízszintes görgetés nélkül.

## Elfogadási bizonyíték

A csoportosítás visszalapítása ugyanazokat a csomópontokat adja ugyanabban a sorrendben. Teszt igazolja a szöveg- és formázásmegőrzést, a hibás vagy szokatlan hierarchia olvasható fallbackjét és az aktiválási határt. Böngészős ellenőrzés szükséges 1440/390/320 px-en a tényleges publikus kurzusadatból, valamint kiadás után élőben. A nem érintett szakaszok tartalma és komponensei változatlanok maradnak.

Kockázat: a szöveg szerkezeti csoportosítása elveszíthetne vagy megkettőzhetne csomópontot; ezt identitás/sorrend- és render-tesztek védik. Nincs új biztonsági határ vagy író végpont; a meglévő LexicalContent végzi a szöveg és a linkek renderelését.

Kiadási stopjel: hiányzó/duplikált szöveg, hibás képkivágás, mobil-túlcsordulás, módosult nem érintett szakasz, hibás CI/build/runtime/health. Nincs kézi deployment, DB-migráció vagy CMS-átírás. Visszaállítás a szűk megjelenítési commit visszavonásával lehetséges, adat-visszaállítás nélkül.
