# Dokumentáció-index

A `docs/` mappa minden fájlja és almappája, egy sorban, területenként. A
projekt leírása és a funkciók listája a gyökér [`README.md`](../README.md)-ben
van; az ügynököknek szóló részletes térkép a
[`ugynok-kezikonyv.md`](ugynok-kezikonyv.md).

**Állapot:**

- **élő**: ma is így működik a rendszer, vagy ma is ez a szabály; a változással
  együtt frissítendő.
- **történeti**: dátumhoz kötött audit, review, kutatás, terv vagy jelentés. Egy
  korábbi állapotot rögzít, nyilvántartásként marad, a mai működésről nem
  mérvadó. Ha ellentmond a kódnak vagy egy élő dokumentumnak, azoknak van igaza.

Mérvadó szabálykönyv minden dokumentum fölött: [`CLAUDE.md`](../CLAUDE.md).

## Ügynök-munka és projektirányítás

| Fájl                                                                       | Mi ez                                                                                       | Állapot   |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | --------- |
| [`ugynok-kezikonyv.md`](ugynok-kezikonyv.md)                               | Ügynök-kézikönyv: route-ok, API-k, gyűjtemények, `lib`-modulok, jobok, UI-rétegek, tilalmak | élő       |
| [`claude-indito-prompt.md`](claude-indito-prompt.md)                       | Bemásolható indító prompt a következő kódoló ügynöknek (Claude, Codex)                      | élő       |
| [`agent-feature-map.md`](agent-feature-map.md)                             | Cikk-CTA, Craft-sáv, Shop-sáv és Ads zárak: amit ügynök nem találgathat                     | élő       |
| [`feladatlista.md`](feladatlista.md)                                       | A nyitott és lezárt feladatok teljes listája                                                | élő       |
| [`repo-figyelo/`](repo-figyelo/)                                           | A repó folyamatos követése: állapot-pillanatkép, napló, megfigyelések, `digest.sh`          | élő       |
| [`atadas-szamlazz-kor.md`](atadas-szamlazz-kor.md)                         | Átadás-dokumentum a Számlázz.hu-kör végéről (2026-08-10)                                    | történeti |
| [`kc-v1-delivery-plan.md`](kc-v1-delivery-plan.md)                         | KC V1 kör szállítási terve, fájltulajdonlással (2026-09-05)                                 | történeti |
| [`kc-v1-owner-review.md`](kc-v1-owner-review.md)                           | KC V1 tulajdonosi kéréslista és ellenőrzése (2026-09-05)                                    | történeti |
| [`kc-v1-remaining-inputs.md`](kc-v1-remaining-inputs.md)                   | KC V1 után fennmaradt tulajdonosi bemenetek (2026-09-05)                                    | történeti |
| [`megrendeloi-igeny-specifikacio.txt`](megrendeloi-igeny-specifikacio.txt) | A tulajdonosok eredeti igény-specifikációja a projektindításkor                             | történeti |
| [`igeny-valtozas-pontok.md`](igeny-valtozas-pontok.md)                     | A megrendelői igények leképezése a terv ticketjeire                                         | történeti |
| [`w3-inditas-specifikacio.md`](w3-inditas-specifikacio.md)                 | A W3 fejlesztési hullám briefjeinek módosításai az igény-specifikáció alapján (2026-08-02)  | történeti |

## Üzemeltetés és fejlesztés

| Fájl                                                               | Mi ez                                                                                             | Állapot   |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | --------- |
| [`deploy-railway.md`](deploy-railway.md)                           | Railway deploy-runbook: build, migráció, healthcheck, merge utáni ellenőrzés                      | élő       |
| [`kineticare-hu-atallas.md`](kineticare-hu-atallas.md)             | A `kineticare.hu` domain átállítása: DNS, Search Console, CORS/CSRF, indexelés-kapu, Ads          | élő       |
| [`adatbazis-mentes.md`](adatbazis-mentes.md)                       | Adatbázis-mentés és visszaállítás (`npm run backup:db`, `db-backup.yml`)                          | élő       |
| [`ci-orok.md`](ci-orok.md)                                         | A CI-őrök (G1–G4 és meta-őr), amelyek a migrációs tilos zónát kikényszerítik                      | élő       |
| [`e2e-staging-runbook.md`](e2e-staging-runbook.md)                 | Végponttól végpontig tartó próba lépései stagingen, Barion sandboxszal                            | élő       |
| [`consent-e2e.md`](consent-e2e.md)                                 | A süti-hozzájárulás valódi böngészős ellenőrzője (`scripts/e2e/consent-e2e.mjs`)                  | élő       |
| [`jelszo-politika.md`](jelszo-politika.md)                         | Jelszópolitika: szabályok, kikényszerítés, hibaüzenetek                                           | élő       |
| [`vasarlo-migracio-terv.md`](vasarlo-migracio-terv.md)             | Vevők átköltöztetése a Systeme.io-ról: idővonal, levelek, `import:customers` használata, rollback | élő       |
| [`manualis-vasarlas-hozzaadas.md`](manualis-vasarlas-hozzaadas.md) | Kézi hozzáférés-adás vásárlás nélkül (`npm run grant:purchase`)                                   | élő       |
| [`access-grants-backfill.md`](access-grants-backfill.md)           | Hiányzó `accessGrants` kezdőpontok pótlása (`npm run backfill:access-grants`)                     | élő       |
| [`ar-snapshot-backfill.md`](ar-snapshot-backfill.md)               | Hiányzó rendelési ár-snapshot pótlása (`npm run backfill:ar-snapshot`)                            | élő       |
| [`demo-kornyezet.md`](demo-kornyezet.md)                           | A `Kineticare-demo` környezet leírása; 2026-08-29 óta kivezetve                                   | történeti |

## Fizetés és számlázás

| Fájl                                                                         | Mi ez                                                                             | Állapot   |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | --------- |
| [`barion-sandbox-setup.md`](barion-sandbox-setup.md)                         | Barion teszt-shop beállítása és tesztkártyák                                      | élő       |
| [`szamlazz-storno.md`](szamlazz-storno.md)                                   | Stornó és helyesbítő számla a visszatérítési folyamatban                          | élő       |
| [`szamlazz-hivatalos-kovetelmenyek.md`](szamlazz-hivatalos-kovetelmenyek.md) | A Számla Agent hivatalos követelményeinek szintézise (2026-08-09)                 | történeti |
| [`szamlazz-megfeleles.md`](szamlazz-megfeleles.md)                           | Megfelelőségi vizsgálat a Számlázz.hu-követelményekre, javító-körrel (2026-08-10) | történeti |
| [`refund-intent-phase-a.md`](refund-intent-phase-a.md)                       | A visszatérítési szándék (`refund-intents`) első, passzív fázisa                  | történeti |
| [`refund-recovery-release.md`](refund-recovery-release.md)                   | A visszatérítés-helyreállítás kiadási leírása és elfogadási feltételei            | történeti |
| [`barion-pixel-jogi-szovegterv.md`](barion-pixel-jogi-szovegterv.md)         | Barion süti- és adatkezelési szövegjavaslat ügyvédi felülvizsgálatra (2026-08-17) | történeti |

## Tartalom és admin

| Fájl                                                                       | Mi ez                                                                                   | Állapot   |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | --------- |
| [`szerkesztoi-utmutato.md`](szerkesztoi-utmutato.md)                       | Szerkesztői útmutató az admin használatához                                             | élő       |
| [`mi-hol-szerkesztheto.md`](mi-hol-szerkesztheto.md)                       | Oldalanként és modulonként: mi írható át az adminban, és mi van a kódban                | élő       |
| [`video-szovegek-szerkesztese.md`](video-szovegek-szerkesztese.md)         | A kezdőlapi nyitó videó feliratainak szerkesztése                                       | élő       |
| [`hero-video-feltoltes.md`](hero-video-feltoltes.md)                       | A kezdőlapi háttérvideó feltöltése a Bunny publikus libraryjébe                         | élő       |
| [`hirlevel.md`](hirlevel.md)                                               | A lábléc hírlevél-feliratkozása: mit lát a szerkesztő és az üzemeltető                  | élő       |
| [`course-unlisted.md`](course-unlisted.md)                                 | A csak linkkel elérhető, listákból rejtett kurzus működése                              | élő       |
| [`course-package-content-ux.md`](course-package-content-ux.md)             | A Kurzuscsomag blokk: szerkeszthető, ikonos csomagtartalom az akciós kurzusoldalon      | élő       |
| [`course-details-layout.md`](course-details-layout.md)                     | Az akciós kurzusoldal leírásának elrendezése                                            | élő       |
| [`admin-video-ux.md`](admin-video-ux.md)                                   | Az admin videótár és kurzusszerkesztés átalakításának hatóköre és döntései (2026-09-09) | történeti |
| [`video-platform-dontes.md`](video-platform-dontes.md)                     | A videóplatform-döntés (Bunny) indoklása és átállási terve (2026-08-09)                 | történeti |
| [`video-stream-keszenlet.md`](video-stream-keszenlet.md)                   | A kurzusvideó-lejátszás készenléti állapota és élesítési listája (2026-08-28)           | történeti |
| [`szekcio-rendszer-terv.md`](szekcio-rendszer-terv.md)                     | A CMS-ből szerkeszthető szekció-rendszer eredeti megvalósíthatósági terve               | történeti |
| [`akcios-kurzus-2026-09-20.md`](akcios-kurzus-2026-09-20.md)               | Akciós kurzus rejtett menüponttal és kattintható rendelőcím (2026-09-20)                | történeti |
| [`owner-content-2026-09-19.md`](owner-content-2026-09-19.md)               | A `content:owner` script 2026-09-19-én felvett tartalmi szabályai                       | történeti |
| [`owner-content-2026-09-22.md`](owner-content-2026-09-22.md)               | A `content:owner` script 2026-09-22-i szabálya                                          | történeti |
| [`kc-demo-course-cms.md`](kc-demo-course-cms.md)                           | A demó kurzusoldal CMS-életciklusa; a demó route azóta kivezetve                        | történeti |
| [`kc-demo-course-content-research.md`](kc-demo-course-content-research.md) | A képzeletbeli akciós kurzus kutatási briefje és szövege (2026-09-05)                   | történeti |
| [`kc-v1-logo-sources.md`](kc-v1-logo-sources.md)                           | A sajtó- és partnerlogók forrásnyilvántartása (2026-09-05)                              | történeti |
| [`tartalom-leltar-regi-oldal.md`](tartalom-leltar-regi-oldal.md)           | Tartalom-leltár: mi volt a régi kineticare.hu-n, és mi van az új platformon             | történeti |
| [`grafikai-leltar-regi-oldal.md`](grafikai-leltar-regi-oldal.md)           | A régi oldal vizuális elemeinek leltára és átvételi javaslata                           | történeti |
| [`regi-oldal-valaszok.md`](regi-oldal-valaszok.md)                         | A tartalom-leltár nyitott kérdéseinek lezárása a régi oldal alapján                     | történeti |
| [`legacy/`](legacy/)                                                       | A régi kineticare.hu referencia-másolata (egy mintaoldal HTML-je és leírás)             | történeti |

## UX és UI

| Fájl                                                                 | Mi ez                                                                         | Állapot   |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------- | --------- |
| [`ui-sztenderdek.md`](ui-sztenderdek.md)                             | Kötelező felületi szabályrendszer és magyar mikroszöveg-szabályzat            | élő       |
| [`ertekesitesi-ux-skill.md`](ertekesitesi-ux-skill.md)               | Értékesítési UX-szabályok: cél-hierarchia M1–M8, navigáció, tipográfiai skála | élő       |
| [`gomb-inventar.md`](gomb-inventar.md)                               | Gomb- és CTA-leltár a vevői felületen, CTA-szótárral (mérve 2026-08-16)       | történeti |
| [`gomb-kontraszt-audit.md`](gomb-kontraszt-audit.md)                 | Gombok kontraszt- és állapot-auditja, WCAG 2.2 AA (2026-08-16)                | történeti |
| [`informacios-architektura.md`](informacios-architektura.md)         | Útvonal- és gombgráf, hibalista (2026-08-16)                                  | történeti |
| [`felhasznaloi-seta.md`](felhasznaloi-seta.md)                       | Kognitív séta az élő oldalon egy átlagos vásárló szemével (2026-08-16)        | történeti |
| [`regi-oldal-osszehasonlitas.md`](regi-oldal-osszehasonlitas.md)     | A régi és az új oldal navigációjának és vásárlási útjának összevetése         | történeti |
| [`ux-hierarchia-audit.md`](ux-hierarchia-audit.md)                   | A régi kineticare.hu cél-hierarchia auditja (2026-08)                         | történeti |
| [`ux-belso-oldalak-kutatas.md`](ux-belso-oldalak-kutatas.md)         | UX-kutatás a belső oldalak elrendezéséhez (2026-08)                           | történeti |
| [`design-review-2026-08-21.md`](design-review-2026-08-21.md)         | Teljes design review az élő oldalon, öt nézetablakon                          | történeti |
| [`kezdolap-ux-audit-2026-09-07.md`](kezdolap-ux-audit-2026-09-07.md) | A kezdőlap UX/UI-auditja                                                      | történeti |
| [`kc-v1-design-decisions.md`](kc-v1-design-decisions.md)             | KC V1 design-döntések és implementációs kapuk (2026-09-05)                    | történeti |
| [`owner-ui-2026-09-06.md`](owner-ui-2026-09-06.md)                   | Három tulajdonosi felületi javítás                                            | történeti |
| [`owner-ui-2026-09-07.md`](owner-ui-2026-09-07.md)                   | A tulajdonosi „Laptop nézet” levél tételes állapota és a vizuális kör         | történeti |

## SEO, analitika és marketing

| Fájl                                                             | Mi ez                                                                                        | Állapot   |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------- |
| [`seo-geo-llm.md`](seo-geo-llm.md)                               | A technikai SEO-, GEO- és LLM-réteg (meta, JSON-LD, sitemap, llms.txt) és a tartalmi teendők | élő       |
| [`orokolt-url-atiranyitasok.md`](orokolt-url-atiranyitasok.md)   | A régi kineticare.hu URL-ek végleges átirányítás-térképe (308, 410)                          | élő       |
| [`posthog.md`](posthog.md)                                       | PostHog: beállítás, mérési terv, dashboardok                                                 | élő       |
| [`ga4.md`](ga4.md)                                               | Google Analytics 4: beállítás és működés a hozzájárulás-kapu mögött                          | élő       |
| [`ADATOK-mert.md`](ADATOK-mert.md)                               | A kanonikus mért adatréteg: SEO- és Ads-számok csak innen hivatkozhatók (adat: 2026-08-24)   | élő       |
| [`kulcsszavak.md`](kulcsszavak.md)                               | Kulcsszó-célzás mért adatból és oldalterv (2026-08-21)                                       | történeti |
| [`h-ih-kulcsszavak-draft.md`](h-ih-kulcsszavak-draft.md)         | Ínhüvelygyulladás kulcsszólista-vázlat (2026-08-24)                                          | történeti |
| [`adwords-kampany.md`](adwords-kampany.md)                       | Google Ads kampánycsomag mért adatból (2026-08-21)                                           | történeti |
| [`kampanyterv-mert-adatokbol.md`](kampanyterv-mert-adatokbol.md) | Kampányterv mért piaci adatokból (2026-08-21)                                                | történeti |
| [`piaci-strategia.md`](piaci-strategia.md)                       | Piaci stratégia és végrehajtási terv (2026-08-21)                                            | történeti |
| [`vevohang-es-hirdetesszoveg.md`](vevohang-es-hirdetesszoveg.md) | Vevőhang és hirdetésszöveg 362 valódi betegvéleményből (2026-08-21)                          | történeti |
| [`monid-kampany-kutatas.md`](monid-kampany-kutatas.md)           | A Monid-adatgyűjtés futtatási terve                                                          | történeti |
| [`monid-adatok-teljes.md`](monid-adatok-teljes.md)               | Monid: az első kör teljes mért adata (2026-08-21)                                            | történeti |
| [`monid-masodik-kor.md`](monid-masodik-kor.md)                   | Monid második kör                                                                            | történeti |
| [`monid-harmadik-kor.md`](monid-harmadik-kor.md)                 | Monid harmadik kör: hirdetési táj, valódi kérdések, betegek szavai                           | történeti |
| [`monid-negyedik-kor.md`](monid-negyedik-kor.md)                 | Monid negyedik csomag (2026-08-24)                                                           | történeti |
| [`monid-lyukak-2026-08-24.md`](monid-lyukak-2026-08-24.md)       | A mért adat hiányainak pótlása (2026-08-24)                                                  | történeti |

## Tudástár

| Fájl                                                                 | Mi ez                                                                   | Állapot   |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------- | --------- |
| [`tudastar-cikkek-betoltese.md`](tudastar-cikkek-betoltese.md)       | A cikkek és a tünet-hubok betöltése (`import:tudastar`, `import:hubok`) | élő       |
| [`cikkek/`](cikkek/)                                                 | A tíz Tudástár-cikk markdown-forrása, a betöltő script bemenete         | élő       |
| [`tudastar-hangnem-es-technika.md`](tudastar-hangnem-es-technika.md) | A Kineticare hangja és a cikkbevitel technikája (2026-08-21)            | történeti |
| [`orvosi-forrasbazis.md`](orvosi-forrasbazis.md)                     | Ellenőrizhető orvosi forrásgyűjtemény a cikkekhez (2026-08-21)          | történeti |
| [`tudastar-tartalmi-terv.md`](tudastar-tartalmi-terv.md)             | A cikkek tartalmi mesterterve és cikkenkénti kiírása                    | történeti |
| [`tudastar-technikai-terv.md`](tudastar-technikai-terv.md)           | A cikklista és cikkoldal technikai és SEO/GEO-terve                     | történeti |
| [`tudastar-ux-terv.md`](tudastar-ux-terv.md)                         | A cikklista és a cikkoldal UX-terve                                     | történeti |
| [`tudastar-a11y-meres.md`](tudastar-a11y-meres.md)                   | A cikkoldal akadálymentességi és UX-mérése (2026-08-21)                 | történeti |
| [`tudastar-felhasznaloi-seta.md`](tudastar-felhasznaloi-seta.md)     | Felhasználói séta keresőből érkező látogatóval (2026-08-21)             | történeti |
| [`tudastar-zaro-jelentes.md`](tudastar-zaro-jelentes.md)             | A Tudástár-kör záró vezetői jelentése (2026-08-21)                      | történeti |
| [`cikkek-tenyellenorzes.md`](cikkek-tenyellenorzes.md)               | A cikkek adversariális tény- és forrásellenőrzése                       | történeti |
| [`cikkek-javitas-naplo.md`](cikkek-javitas-naplo.md)                 | A tényellenőrzés javításainak tételes naplója                           | történeti |

## Auditok és review-k

| Fájl                                                                                       | Mi ez                                                                       | Állapot   |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- | --------- |
| [`owasp-security-review.md`](owasp-security-review.md)                                     | OWASP Top 10 biztonsági kódvizsgálat (2026-08-04)                           | történeti |
| [`review-2026-08-21-statisztika-bunny.md`](review-2026-08-21-statisztika-bunny.md)         | Biztonsági és kódvizsgálat: statisztika és Bunny                            | történeti |
| [`review-2026-08-22-kritikus-utak.md`](review-2026-08-22-kritikus-utak.md)                 | A kritikus utak logikai és regressziós vizsgálata                           | történeti |
| [`statisztika-audit-2026-08-21.md`](statisztika-audit-2026-08-21.md)                       | A Statisztika nézet auditja és vezetői döntései                             | történeti |
| [`audit-javitasok-20260908.md`](audit-javitasok-20260908.md)                               | Fizetési, hozzáférési, e-mail- és mentési auditjavítások kiadási feltételei | történeti |
| [`e2e-audit-terv-2026-08-27.md`](e2e-audit-terv-2026-08-27.md)                             | Az E2E-audit terve (Bunny, fizetés, számla, Kurzusaim)                      | történeti |
| [`e2e-audit-2026-08-27.md`](e2e-audit-2026-08-27.md)                                       | Az E2E-audit jelentése és találatai                                         | történeti |
| [`oldal-audit-osszefoglalo-2026-09-07.md`](oldal-audit-osszefoglalo-2026-09-07.md)         | A négy oldal-audit közös kivonata, rangsorolt teendőkkel                    | történeti |
| [`oldal-audit-a-belepo-oldalak-2026-09-07.md`](oldal-audit-a-belepo-oldalak-2026-09-07.md) | A belépő oldalak (`/`, `/szolgaltatasok`, `/rolunk`, `/kapcsolat`) auditja  | történeti |
| [`oldal-audit-b-tudastar-2026-09-07.md`](oldal-audit-b-tudastar-2026-09-07.md)             | A Tudástár UX- és láthatósági auditja                                       | történeti |
| [`oldal-audit-c-ertekesites-2026-09-07.md`](oldal-audit-c-ertekesites-2026-09-07.md)       | Az értékesítési út auditja a listától a köszönőoldalig                      | történeti |
| [`oldal-audit-d-fiok-es-jogi-2026-09-07.md`](oldal-audit-d-fiok-es-jogi-2026-09-07.md)     | A fiók-, vásárlás utáni és jogi felületek auditja                           | történeti |
