# KC V1: szeptember 5-i folytatas

## Hatoskor es felelosseg

A tulajdonos a jelenlegi orchestratorra bizta a fennmarado KC V1 feladatok
integraciojat es a felteteles main merge-et. Az ugynokok GPT-5.6 Sol / medium
beallitassal, elkulonitett fajltulajdonlassal dolgoznak es ide jelentenek.
A korabban elfogadott header, footer, hero-meret es KC-design nem ujratervezesi feladat.

## Munkacsomagok

| Felelos | Feladat | Elfogadas |
| --- | --- | --- |
| Hubble | LogoRail es sajat CSS/tesztek | Egy folytonos sor, content szelesseg, ketoldali lagy atmenet; megallitas, billentyuzet, reduced motion |
| Pascal | Hivatalos logoassetek es forrasjegyzek | Azonosithato szervezet, eredeti logo, dokumentalt forras; nincs utanrajzolas vagy kitalalt partner |
| Boyle | S06/A06 es CMS-kapcsolatok felterkepezese | Pontos lefedettseg, konkret hianyok; bizonytalan nev/foto/parositas nem talalgathato |
| Beauvoir | Fuggetlen teljes kiadasi review | Fagyasztott diff, pontos head/base, kodkiadas es CMS-publikalas kulon kapu |
| Fermat | Fuggetlen media/CLI megbizhatosagi review | Ismeretlen szerkesztoi kepek megorzese, fokuszpont, utkozesek, irasmentes elonezet |
| Orchestrator | Integracio es kiadas | Osszes kapu, fuggetlen review, majd exact-SHA CI es automatikus deploy kovetese |

## Mozgo logosor

A szeptember 5-i uj pontositas felulirja a korabbi, csak kezzel indithato,
veges logosor-mozgast. Normal mozgaspreferencianal folyamatos CSS-animacio
kell, egyetlen vizualis sorban. Alapertelmezett szelesseg a jelenlegi
content-kontener; a ket szelen finom elhalvanyitas, nem uj hatter vagy kartya.
A meglevo logok megmaradnak. A valodi uj assetek ugyanazt a kepkezelesi
stilust kovetik. A szuneteltetes tartos, a hover/fokusz csak kiegeszites;
reduced motion es JS nelkul minden eredeti logo hozzaferheto.

Meres: 320/390/768/1024/1440 px; nincs dokumentumszintu tulcsordulas;
normal allapotban idobeli elmozdulas, szuneteltetve es reduce modban nincs;
nincs lathato ures ciklus vagy dupla hozzaferheto lista; a fokuszcel lathato.

## Hatarok es fuggosegek

### P02: demo kampanyoldal, uj tulajdonosi pontositas

A kert oldal neve: Kepzeletbeli akcios kurzus. Stabil cime `/akcios-kurzus`,
a menubeli megjelenese ettol fuggetlen CMS-beallitas. A mostani feladat nem
valodi kedvezmeny vagy fizetesi folyamat. A veglegeshez hasonlo hosszusagu
szoveg, modulok, tananyagminta, GYIK es kepes nyito sav keszul.

Godel a forraskutatast es tartalmat, McClintock az uj kampanykomponenseket,
az orchestrator a route-ot, metaadatot, sitemap-vedelmet es CMS-integraciot
kezeli. Boyle fuggetlen vizualis ellenor, Hypatia kodreviewt vegez.
Mindegyik uj ugynok GPT-5.6 Sol / medium beallitassal dolgozik.

Elfogadas: meglevo KC-tokenek es komponensek, egy h1, 320 px-en sincs
tulcsordulas, mukodo es billentyuzettel elerheto tananyagminta/lenyitok,
valos horgonyok, valos sajat kepassetek, ertheto demo-jeloles. Nincs kitalalt
ar, visszaszamlalo, eredmenyigeret, velemeny vagy vasarlasi muvelet.
A Pages meglevo title/excerpt/heroImage/layout/SEO mezoi hasznalhatok,
hitelesitett draft elonezettel; nincs adatbazis-schema valtozas.

A demo route mindig noindex, a sitemapbol CMS-publikalt allapotban is kimarad.
A robots.txt nem zarja el a feltérkepezest, mert a Google csak igy latja
a noindexet. Ez nem hozzaferes-vedelem, csak indexelesi utasitas.
Forras: https://developers.google.com/search/docs/crawling-indexing/block-indexing
Az AI-keresesi megjeleneshez is a normal SEO-alapok, elerheto szoveg es
valos strukturalt adatok tartoznak; kulon rangsorolasi igeret nincs.
Forras: https://developers.google.com/search/docs/appearance/ai-features

### Megorzott korlatok

- Nincs uj dependency, migracio, fizetesi/arlogika vagy jogosultsagvaltozas.
- A meglevo CMS pressLogos blokk es Mediatar hasznalhato uj schema nelkul.
- A kedvezmeny kurzusa, merteke es lejarata tulajdonosi adat; nem talaljuk ki.
- Az uj portrek nev szerinti azonositasa es a kulon kert sajat logo pontos
  valtozata csak igazolhato forras alapjan valaszthato.
- Az SOS piszkozat kozzetetele nem kovetkezik a kod merge engedelyebol.
- A kod merge nem egyenlo a CMS-tartalom eles alkalmazasaval. Az eles
  alkalmazashoz friss elonezet, mentheto/visszaallithato allapot, szerkesztoi
  egyeztetes es a konkret muvelet jovahagyasa szukseges.

## Kiadasi kapu

Fagyasztott osszeallitason Node 24 teljes teszt, typecheck, lint es build,
alkalmazhato security kapuk, majd fuggetlen review. Push utan az uj head
CI-ja es review-kommentjei iranyadok. Csak minden alkalmazhato HOLD lezartaval
lehet normal PR-merge; nincs admin bypass, force push vagy direkt main push.
Merge utan csak automatikus CI/deploy kovetese, ugyanazon merge SHA-val.
CMS alkalmazas es rollback a kc-v1-owner-review.md szerinti kulon lepes.

## Fagyasztott helyi ellenorzes - 2026-09-05

Alap: main `3f3f9c473db5d775ba5244683d92a39aba5e2a97`, PR212 korabbi
head `7b3a12d4e4ae82de3967d903862368f78aefbfaf` plusz a reviewzott diff.
Az izolalt release-masolat 29 futasido/teszt/asset fajljanak hash-e megegyezik
a kiadasra varo fajlokkal; csak a kesobbi bizonyitekdokumentacio kulonbozik.

- Node 24 teljes Vitest: 7125/7125 PASS, nulla kihagyott vagy hibas teszt.
- Typecheck es Next production build PASS; `/akcios-kurzus` dinamikus route.
- Teljes ESLint: nulla hiba, harom meglevo warning (consent-reopen teszt
  unused valtozo; CoursePlayer ket set-state-in-effect figyelmeztetes).
- Build warning: regi middleware elnevezes; media-restore harom dinamikus
  fajlrendszer-tracing figyelmeztetes. Ezek nem kaptak elnyomo kivetelt.
- Audit high kapu PASS: nulla high/critical, hat meglevo moderate talalat;
  dependency javitas vagy kockazatmentessegi allitas nincs.
- Hypatia fuggetlen komponens/route/CMS/CLI/CTA/kontraszt review APPROVED.
- Boyle tamogatott bongeszoben 320/390/768/1024/1440 px-en vizualis PASS:
  kep es lathato bevezeto, kovetkezo szekcio, tulcsordulasmentesseg,
  billentyuzetes mintalecke, menu es direkt URL, canonical es noindex.
- A logo-sav illesztesi merese PASS. Elo reduced-motion/hover emulacio
  ehhez az uj savhoz nem volt elerheto; komponens- es CSS-orok fedik.
- Helyi CMS: demo oldal 5, menu 6; masodik alkalmazas duplikacio es feluliras
  nelkul. Eles CMS-iras nem tortent. A fejlesztoi bongeszo CSP/eval issue
  jelzese helyi diagnosztikai warning; a CSP nem lett gyengitve.

A feltoltes utani exact-head GitHub CI/security es a merge utani automatikus
production deploy kulon kapu, a fenti helyi PASS nem helyettesiti oket.
A CMS-publikacio es a hianyzo tulajdonosi anyagok kulon maradnak.

## Tartosan megorzendo tanulsag

A helyi vizualis keszultseg, a tesztelt kod, a main merge es az eles CMS
publikalas negy kulon bizonyitek. Egyik szazalek vagy zold reszteszt sem
helyettesitheti a tobbit. A logok megtalalasa nem igazol uj partneri kapcsolatot.

A kampany reviewja megmutatta: CMS-szekciot nem szabad a kozos renderelo
lathatosag- es sorrendkezeleset megkerulve kiemelni. A mintalecke es GYIK
ugyanabban az egy szekciosorban marad; a rejtett/allapotvaltozott elemeket
regresszios tesztek vedik. A kep fajlneve nem kepleiras-bizonyitek: a teljes
forraskeppel es a mobil/asztali kivagassal is ossze kell vetni az altot.
Uj CTA-nal az action tipusa, a szotar, mindket normativ/leltar dokumentum
es a tipusteszt egyutt tartozik a valtozashoz.
