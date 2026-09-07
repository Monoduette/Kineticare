# Oldal-audit B: Tudástár (UX + organikus láthatóság), 2026. szeptember 7.

**Mit vizsgáltam.** A Tudástár teljes felületét: a `/blog` listát, a három
kategória-lapot (`/blog/kategoria/<slug>`) és a nyolc tünet-hub cikkét. Csak
audit: kódot nem módosítottam, tesztet nem írtam, nem commitoltam.

**Hol mértem.**

- Élő alkalmazás: `https://kineticare-production.up.railway.app` (HTML-forrás,
  fejlécek, sitemap, robots, strukturált adat). A `www.kineticare.hu` még a régi
  systeme.io oldal, azt nem auditáltam.
- Helyi dev szerver (`http://localhost:3000`) a böngészős mérésekhez: Chromium
  1194 (playwright-core), 320 / 390 / 1440 px, `prefers-reduced-motion: reduce`.
  A helyi és az élő HTML szerkezete azonos (ugyanaz a `PostArticle` komponens,
  címsorfa-összevetéssel ellenőrizve), a tartalmi különbség csak a kapcsolódó
  cikkek száma és a `publishedAt` dátumok.

**Mérőfájlok.** A session-scratchpad `audit-b/` mappájában: `extract.mjs`
(HTML-kivonat), `body.mjs` (törzs-szöveg), `stats.mjs` (cikk-statisztika),
`measure.mjs` (kontraszt, érintőcél, sorhossz, reflow, LCP), `cta.mjs`
(CTA-pozíció), `focus.mjs` / `focus3.mjs` (fókusz), `m-*.json` (mért adatok),
`cikk-*.html`, `lista.html`, `kat-*.html`, `sitemap.xml`, `robots.txt`,
`*.png` (képernyőképek 390 és 1440 px-en).

**Amire támaszkodtam.** `docs/ADATOK-mert.md` (kanonikus mért réteg),
`docs/seo-geo-llm.md`, `docs/cikkek/` (a nyolc lektorált forrás-markdown),
`docs/h-ih-kulcsszavak-draft.md`, `docs/tudastar-a11y-meres.md` (2026-08-21-i
akadálymentességi mérés), `docs/kezdolap-ux-audit-2026-09-07.md` (a kezdőlap
már elkészült auditja), `docs/ui-sztenderdek.md` §3.2 (CTA-szótár),
a `termektervezes` skill és a `digital-marketing-mastery` skill
`keyword-research-and-onpage-seo`, `ai-search-optimization`,
`technical-and-general-seo` moduljai.

**Amit nem ismétlek meg.** A süti-sáv mobil takarását, a mozgás-hosszt és a
kezdőlapi szekciósorrendet a kezdőlap-audit már rögzítette; a cikkoldal
WCAG-alapmérését (1 603 kontraszt-mérés, 35 fókusz-állomás) a
`docs/tudastar-a11y-meres.md` tartalmazza. Én a mai állapotot mértem újra ott,
ahol változás gyanúja merült fel, és az eltéréseket jelzem.

---

## 0. Fontos előzmény: a hub-cutover ÉLESBEN MEGTÖRTÉNT

A kiírás a nyolc cikket a `/blog/<slug>` címen kérte auditálni. A mai élő
állapot ettől eltér, és ez az egész audit kiindulópontja:

| Cím                                  | Élő válasz                                |
| ------------------------------------ | ----------------------------------------- |
| `/blog/keztoalagut-szindroma`        | **308** → `/keztoalagut-szindroma`        |
| `/blog/inhuvelygyulladas`            | **308** → `/inhuvelygyulladas`            |
| `/blog/teniszkonyok`                 | **308** → `/teniszkonyok`                 |
| `/blog/csuklo-es-kezfajdalom`        | **308** → `/csuklo-es-kezfajdalom`        |
| `/blog/miert-zsibbad-a-kezem`        | **308** → `/kez-zsibbadas`                |
| `/blog/pattano-ujj`                  | **308** → `/pattano-ujj`                  |
| `/blog/csuklotores-utani-gyogytorna` | **308** → `/csuklotores-utani-gyogytorna` |
| `/blog/befagyott-vall`               | **308** → `/befagyott-vall`               |

Mind a nyolc gyökér-hub **200**-zal válaszol, szerepel a `sitemap.xml`-ben, és a
`canonical` a gyökér-URL-re mutat. A `src/lib/tudastar/hub-oldalak.ts` kapuja
tehát nyitva van: a Katák publikálták a hub-oldalakat.

**Két következménye van, amit külön kezelek.**

1. A `docs/h-ih-kulcsszavak-draft.md` „Kapu" pontja (`/inhuvelygyulladas` HTTP 200) teljesült, tehát a `docs/adwords-kampany.md` 7.4 szerinti Ads-final
   csere (`/blog/…` → gyökér) most esedékes. Ez tulajdonosi feladat a Google
   Ads fiókban, nem kód (lásd 12. szakasz).
2. A belső linkelés viszont **nem** követte a cutovert. Ez a legsúlyosabb
   találat, lásd 1.1.

---

## 1. Összefoglaló

A Tudástár tartalmi minősége a repó legerősebb eszköze. A nyolc cikk
kérdés-alapú H2-kkel dolgozik, az alcím alatti első mondat a legtöbb helyen
tényleg megadja a választ, a bekezdések rövidek, a GYIK-tételek teljes
válaszokat adnak, és a `FAQPage`, az `Article` + `MedicalWebPage` kettős típus
és a `BreadcrumbList` séma mind ki van írva. A kontraszt, a reflow, a
fókuszjelölés és a mozgáskezelés mérve rendben van.

A baj nem a szövegben van, hanem abban, hogy **a nyolc pénzt hozó oldal
gyakorlatilag el van vágva mindentől**, és hogy az E-E-A-T-jelek, amiket a repó
maga is a legnagyobb versenyelőnyének nevez (`docs/seo-geo-llm.md` 2.3), egyik
lapon sincsenek kiírva.

### Top 5 találat

1. **A nyolc kanonikus hub-URL-re a saját oldalról EGYETLEN belső link sem
   mutat (P1).** Mérve a `/`, `/blog`, `/kurzusok`, `/szolgaltatasok`,
   `/rolunk`, a három kategória-lap és mind a nyolc hub HTML-jén: a cikkekre
   mutató linkek 100%-a a `/blog/<slug>` alakot használja, ami 308-cal
   átirányít. A kanonikus URL-eket így csak a sitemap tartja életben, a belső
   link-értéket pedig minden hivatkozás egy átirányításon keresztül adja át.
   A `/blog` lap `Blog` JSON-LD-je is nyolc átirányító URL-t hirdet.
2. **A cikkeken nincs sem látható, sem gépi szerző (P1).** A
   `kc-post-author` blokk egyetlen élő cikken sem renderel, és az
   `Article` + `MedicalWebPage` JSON-LD-ből hiányzik az `author`, a `reviewedBy`
   és a `lastReviewed` kulcs. YMYL-tartalomnál ez a legdrágább hiány: a mezők
   (`Posts.author`, `reviewedBy`, `reviewedAt`, `nextReviewAt`) készen állnak,
   csak üresek.
3. **A konverziós elemek a cikk utolsó 18%-ában vannak (P1).** Mérve 390 px-en:
   az első kurzusra mutató link a 26 360 px-es lap **21 659. pixelénél (82%)**
   jelenik meg, az első gomb a 93%-nál; 1440 px-en 84% és 95%. A `/blog` lista
   és mind a három kategória-lap pedig **nulla** kurzus-, időpont- és
   kapcsolat-linket tartalmaz.
4. **Nulla kép az egész Tudástárban (P1/P2).** Mind a kilenc vizsgált lapon
   pontosan egy `<img>` van, az is a Barion Pixel `noscript`-je. Nincs
   borítókép a kártyákon, nincs hero-kép a cikkeken, nincs gyakorlat-illusztráció,
   és nincs `og:image` sem, tehát minden megosztás kép nélkül megy ki.
5. **Két hubon duplán jelenik meg a GYIK, egy hubról hiányzik az orvosi
   keret (P1).** A `/befagyott-vall` és az `/inhuvelygyulladas` ugyanazt a hat
   kérdés-válasz párt kétszer mutatja (a törzsben és a komponensben), a
   tartalomjegyzékben két azonos nevű „Gyakori kérdések" tétel áll
   (`#gyakori-kerdesek` és `#gyakori-kerdesek-2`). A `/kez-zsibbadas` hubon
   viszont sem „Kik írták ezt a cikket?", sem „Fontos tudnivaló" szakasz nincs,
   pedig az a cikk stroke-jelekről tanít.

---

## 2. `/blog` (a Tudástár listája)

**Mit lát a felhasználó** (`audit-b/lista-1440-00.png`, `lista-390.png`):
H1 „Tudástár", egy mondat lead, négy szűrő-chip (Összes, Kéz és csukló, Törés
és műtét után, Váll és könyök), majd kéthasábos rácsban nyolc szöveges kártya
(kategória-címke, cím, kivonat, dátum, dekoratív nyíl). Kép sehol.

**Az oldal egy dolga:** a látogatót a saját panaszához tartozó cikkbe vinni.

### 2.1 Mért számok

| Mérés                              | 390 px                             | 1440 px                        |
| ---------------------------------- | ---------------------------------- | ------------------------------ |
| Laphossz                           | 3 862 px                           | 2 286 px                       |
| Dokumentum-szélesség 320 px-en     | 320 px (nincs vízszintes görgetés) |                                |
| LCP-jelölt (első látogatás)        | `P.kc-consent-banner__text`        | nincs jelölt a mérési ablakban |
| Kurzusra / kapcsolatra mutató link | **0**                              | **0**                          |
| Kép a tartalomban                  | **0**                              | **0**                          |

### 2.2 Találatok

**B-L1 (P2, S). A lista nem visz sehova a cikkeken kívül.** Nulla link mutat
kurzusra, ingyenes SOS-re vagy időpontkérésre. Aki a Tudástárba lép be, és nem
kattint cikkre, zsákutcába jut: a lap alján a hírlevél-blokk következik.
_Miért baj:_ a lista-oldal a mért belépési pontok egyike, és a kereskedelmi
szándékot kiszolgáló elem nélkül a látogatás nem hoz semmit
(Semrush, _On-Page SEO_: belső linkelés a felfuttatni kívánt oldalra,
`references/keyword-research-and-onpage-seo.md` 6.8; NN/g, _Better Link Labels_,
https://www.nngroup.com/articles/better-link-labels/).
_Javaslat:_ a rács alá egy halk, egysoros sáv a két kurzussal és az
időpontkéréssel, a CTA-szótár #28 és #24 feliratával (`docs/ui-sztenderdek.md`
§3.2). Új feliratot ne találjunk ki.

**B-L2 (P2, S). A `title` és a H1 egy márkabelső szó.** `<title>Tudástár |
Kineticare</title>` (21 karakter), H1 „Tudástár". A „tudástár" kifejezésre a
`docs/ADATOK-mert.md` egyetlen mért sort sem tartalmaz, a domain pedig
egyetlen fő kifejezésre sem rangsorol.
_Miért baj:_ a cím a keresési szándékot nem szolgálja ki, és a
címhosszból (jellemzően ~60 karakter jelenik meg) 39 karakter kihasználatlan
(Semrush, _Title Tag_: 50-60 karakter, elsődleges kulcsszó elöl; NN/g,
_Page Titles_, https://www.nngroup.com/articles/page-titles/).
_Javaslat:_ a látható H1 maradhat „Tudástár" (a navigáció így nevezi, WCAG 2.2
**2.4.6** és **3.2.4**), de a `seoTitle` mondja ki, mi van itt, például
„Kézrehabilitációs cikkek és gyakorlatok". A pontos kifejezést mérésből kell
venni, ilyen mérés ma nincs, tehát ez a 12. szakasz döntési tétele.

**B-L3 (P2, M). Kép nélküli kártyák.** A `PostCard` tud borítóképet
(`kc-post-card__cover`), de egyetlen poszton sincs `heroImage`, tehát nyolc
azonos felépítésű szöveges doboz áll egymás alatt.
_Miért baj:_ a kártya vizuális azonosítója hiányzik, a beolvasás lassul, és a
lap semmilyen képi jelet nem ad a témáról (NN/g, _Card UI_-elv: a kártya
felismerhető egysége a kép + cím páros; GOV.UK Design System, _Images_:
https://design-system.service.gov.uk/styles/images/ a képet akkor kell
használni, ha információt hordoz).
_Javaslat:_ nyolc egyszerű, egységes stílusú testtájék-illusztráció (kéz,
csukló, könyök, váll), leíró alt-szöveggel. Fotó helyett vonalas rajz is elég,
és orvosilag semlegesebb.

**B-L4 (P3, S). A kártyán nincs olvasási idő.** A cikkek 17-21 percesek
(4.2 táblázat), ezt a lista nem árulja el, a felhasználó vakon lép be.
_Javaslat:_ a dátum mellé „kb. N perc olvasás", ugyanazzal a szöveggel, amit a
cikk fejléce is használ (egy cselekvés, egy szöveg, WCAG 2.2 **3.2.4**).

**B-L5 (P3, S). Nincs lapozás.** A `getPosts` alapértelmezett limitje 60. Nyolc
cikknél ez nem probléma, de a lapozást a bővülés előtt kell megtervezni
(Semrush, _Technical SEO_: pagination az infinite scroll helyett,
`references/technical-and-general-seo.md` 2).

---

## 3. `/blog/kategoria/<slug>` (kategória-lapok)

Három lap: `kez-es-csuklo` (5 cikk), `vall-es-konyok` (2 cikk),
`tores-es-mutet-utan` (**1 cikk**).

**Mit lát a felhasználó** (`audit-b/kat-1440-00.png`): H1 (a téma neve), majd
azonnal a kártyarács. Nincs lead, nincs morzsa, nincs szűrő-sor, nincs
CTA, nincs kép.

### 3.1 Találatok

**B-K1 (P1, S). A morzsa-séma olyan navigációt hirdet, ami nem látszik.** A lap
kiír egy `BreadcrumbList` JSON-LD-t (Tudástár → téma), de látható morzsamenü
nincs: a `Morzsamenü` felirat előfordulása a kategória-lap HTML-jében **0**, a
cikkoldalén 1.
_Miért baj:_ a Google strukturált adat általános irányelve kimondja, hogy a
jelölésnek a felhasználó számára látható tartalmat kell leírnia
(https://developers.google.com/search/docs/appearance/structured-data/sd-policies).
A morzsa emellett az egyik legolcsóbb tájékozódási eszköz (NN/g, _Breadcrumbs:
11 Design Guidelines_, https://www.nngroup.com/articles/breadcrumbs/).
_Javaslat:_ ugyanaz a kétszintű morzsa, ami a cikkoldalon már fut
(`kc-post-breadcrumb`), a séma változatlanul marad.

**B-K2 (P2, S). Nincs átjárás a témák között.** A `/blog` lapon ott a négy
chip, a kategória-lapon egy sincs: a látogató csak a fejléc „Tudástár"
menüpontján át juthat másik témára. Mérve: a `kez-es-csuklo` lapon két `/blog`
link van (fejléc, lábléc) és nulla `/blog/kategoria/…` link.
_Miért baj:_ a szűrt nézetből hiányzó visszaút és oldalirányú váltás a
zsákutca-tilalom megsértése (`termektervezes` skill 5. pont), és eggyel több
kattintás minden témaváltásnál.
_Javaslat:_ a `CategoryFilter` sor renderelése a kategória-lapon is, az aktív
chippel megjelölve, „Összes" visszaúttal. A kód már létezik, a `/blog` route
használja.

**B-K3 (P2, S). Öt kártyán ötször ugyanaz a címke.** A „Kéz és csukló" lapon
mind az öt kártya „Kéz és csukló" jelzést visel.
_Miért baj:_ nulla információt hordoz, viszont a cím elől veszi el a helyet
(NN/g, _Ten Usability Heuristics_ 8., esztétikai és minimalista dizájn:
https://www.nngroup.com/articles/ten-usability-heuristics/).
_Javaslat:_ a kategória-lapon a címke elhagyása (a lap maga a kategória), vagy
csere a „kb. N perc olvasás" jelzésre.

**B-K4 (P2, S). Se lead, se bevezető, se CTA.** A H1 után rögtön a rács jön,
és a lap alja a lábléc. A `generateMetadata` sablon-leírása mindhárom lapon
majdnem azonos („`<téma>`: kézrehabilitációs cikkek és gyakorlatok a Kineticare
Tudástárában."), tehát három közel duplikált meta-leírás megy ki.
_Miért baj:_ duplikált meta description a Semrush on-page hibalistájának 3.
tétele (`references/keyword-research-and-onpage-seo.md` 8.), a tartalom nélküli
gyűjtőlap pedig vékony tartalom.
_Javaslat:_ 2-3 mondatos, témára szabott bevezető a H1 alá (a `categories`
kollekció `description` mezőjéből), és ez legyen a meta-leírás forrása is.

**B-K5 (P2, S). Egyetlen cikkes kategória-lap indexelhető és sitemapben van.**
A `/blog/kategoria/tores-es-mutet-utan` egyetlen kártyát mutat, ami ráadásul
308-cal átirányít.
_Miért baj:_ egy elemű gyűjtőlap gyakorlatilag duplikálja a cikket, és a
Google jellemzően „Crawled, currently not indexed" állapotba teszi
(`references/technical-and-general-seo.md` 5.).
_Javaslat:_ küszöb bevezetése: legalább 3 cikk alatt a kategória-lap
`noindex, follow` legyen (a kód ma csak a NULLA cikkes lapot noindexeli), és a
sitemapből is maradjon ki. A `categoriesWithPosts` szűrő már ott van, csak a
küszöböt kell megemelni.

---

## 4. A nyolc hub-cikk

Mind a nyolc lap ugyanazt a `PostArticle` sablont rendereli, ezért a
találatokat egyszer írom le, és jelzem, hol tér el egy-egy lap.

**Az oldal egy dolga:** a panaszával kereső embert megnyugtatni, eligazítani,
és onnan a kurzus vagy a rendelői időpont felé vinni.

### 4.1 Az oldal felépítése, ahogy a látogató találkozik vele

Mérve 390 px-en (`audit-b/m-cikk-390.json`, `cikk-390-*.png`):

| Elem                 |   Kezdő y |   Magasság |
| -------------------- | --------: | ---------: |
| Ragadós fejléc       |         0 |      56 px |
| Morzsamenü           |    104 px |  **95 px** |
| Kategória-címke      |    216 px |      30 px |
| H1                   |    283 px |     156 px |
| Lead                 |    451 px |      81 px |
| Dátum + olvasási idő |    548 px |      24 px |
| Tartalomjegyzék      |    668 px | **424 px** |
| A törzs első mondata | ~1 092 px |            |

1440 px-en: morzsa 160 px-nél (44 px), H1 288, lead 444, meta 555,
tartalomjegyzék 758 (397 px), törzs ~1 155 px-nél.

### 4.2 Cikk-statisztika (élő HTML-ből mérve)

| Hub                             | `title` (kar.) | `description` (kar.) |  H2 |  H3 | GYIK |   szó | olvasási idő | `meta keywords` |
| ------------------------------- | -------------: | -------------------: | --: | --: | ---: | ----: | -----------: | --------------: |
| `/befagyott-vall`               |             49 |                  126 |  25 |   7 |    6 | 4 401 |      19 perc |              21 |
| `/csuklo-es-kezfajdalom`        |             54 |                  155 |  23 |   3 |    6 | 5 284 |      21 perc |              31 |
| `/csuklotores-utani-gyogytorna` |             55 |                  158 |  24 |   3 |    5 | 4 307 |      17 perc |              16 |
| `/inhuvelygyulladas`            |             54 |                  121 |  23 |   9 |    6 | 4 449 |      20 perc |              41 |
| `/keztoalagut-szindroma`        |             51 |                  157 |  20 |   8 |    6 | 4 544 |      18 perc |              22 |
| `/kez-zsibbadas`                |             59 |                  160 |  19 |  11 |    6 | 4 504 |      18 perc |              43 |
| `/pattano-ujj`                  |             56 |                  157 |  23 |   3 |    6 | 4 557 |      18 perc |               9 |
| `/teniszkonyok`                 |             55 |                  156 |  20 |   3 |    6 | 4 397 |      17 perc |              32 |

### 4.3 Akadálymentesség és tipográfia (ma újramérve)

| Mérés                                                       | Eredmény                                                                                     | Ítélet                                                                                                                                                |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Szövegkontraszt (22 különböző szín/háttér/méret kombináció) | legkisebb **8,05:1** (`kc-post-meta` a tint sávon), folyószöveg 9,30:1, GYIK-válasz 8,80:1   | WCAG 2.2 **1.4.3** teljesül, nagy tartalékkal                                                                                                         |
| Vízszintes görgetés 320 px-en                               | `documentElement.scrollWidth` = 320 px                                                       | **1.4.10** teljesül                                                                                                                                   |
| Sorhossz (karakter/sor, min/medián/max)                     | 320 px: 31/38/39 · 390 px: 40/47/49 · 1440 px: 57/64/66                                      | 1440 px-en a repó Ü6 szabálya (45-85) teljesül; 390 px alatt a kis kijelző adottsága, a `docs/tudastar-a11y-meres.md` 1.4 pontjában elfogadott korlát |
| Sortáv                                                      | 26,72 px / 16 px = **1,67**                                                                  | **1.4.12** felett                                                                                                                                     |
| Érintőcél 24 px alatt                                       | 3 elem, mind mondatba ágyazott szöveglink vagy kártya-overlay                                | **2.5.8** Inline-kivétele áll                                                                                                                         |
| Fókuszjelölés                                               | képernyőképpel ellenőrizve (`audit-b/focus-toc.png`): 3 px tömör gyűrű a jegyzék-linkeken is | **2.4.7** teljesül                                                                                                                                    |
| Mozgás `reduce` alatt                                       | 0 mozgó elem                                                                                 | **2.3.3** teljesül                                                                                                                                    |
| LCP-jelölt                                                  | `H1.kc-page-hero__title` (390 px: 1 276 ms, 1440 px: 1 676 ms, helyi dev szerveren)          |                                                                                                                                                       |

> Megjegyzés a mérésről: a számított `outlineWidth` fejléc nélküli Chromiumban
> a jegyzék-linkeknél 0 px-et ad, a képernyőkép viszont látható gyűrűt mutat.
> A számított érték itt mérési műtermék, nem hiba. Ezt azért írom le, hogy a
> következő audit ne jelentsen belőle fókusz-hibát.

### 4.4 Tartalmi és UX-találatok

**B-C1 (P1, S). Nincs szerző, nincs lektor, nincs ellenőrzési dátum.**
A `kc-post-author` osztály előfordulása mind a nyolc élő cikkben **0**, a
fejléc `kc-post-meta` sora csak dátumot és olvasási időt tartalmaz. A séma
ugyanezt tükrözi: az `Article` + `MedicalWebPage` node kulcsai
`headline, description, inLanguage, mainEntityOfPage, datePublished,
dateModified, keywords, about, publisher`, tehát **nincs `author`, nincs
`reviewedBy`, nincs `lastReviewed`, nincs `image`**.
_Gyökérok:_ a `Posts.author` és `reviewedBy` mező `filterOptions`-a csak
`staff` vagy `owner` szerepű felhasználót fogad el
(`src/lib/admin/relationship-filters.ts`), és az importáló
(`src/scripts/import-tudastar-cikkek.ts` 335-352. sor) feloldatlan névnél
`null`-t ír a mezőbe, warnnal. A két gyógytornász felhasználója tehát vagy
hiányzik, vagy nem `staff` szerepű az éles adatbázisban.
_Miért baj:_ egészségügyi (YMYL) tartalomnál a szerző és a szakmai ellenőrzés
a legerősebb minőségi jel. A Google „Creating helpful, reliable, people-first
content" útmutatója külön kérdésként teszi fel, hogy „Do bylines lead to
further information about the author?"
(https://developers.google.com/search/docs/fundamentals/creating-helpful-content),
az Article strukturált adat dokumentációja pedig az `author` mezőt ajánlott
tulajdonságként sorolja
(https://developers.google.com/search/docs/appearance/structured-data/article).
Az AI-keresésben ugyanez az E-E-A-T-jel a láthatóság egyik fő tényezője
(`references/ai-search-optimization.md` 4.2/6). A repó saját terve is ezt
nevezi „a Kineticare legnagyobb versenyelőnyének" (`docs/seo-geo-llm.md` 2.3),
és a hiányt 2026-08-06 óta nyitva tartja (ugyanott 5.5).
_Javaslat:_ Users → Kocsis Kata és Kiss Kata `staff` szerep, majd
`npm run import:tudastar` újrafuttatása (vagy a négy mező kézi kitöltése az
adminban minden cikken: Szerző, Szakmai ellenőrzést végezte, Utolsó szakmai
ellenőrzés, Következő ellenőrzés). Kód nem kell hozzá, a `PostAuthorBox` és a
séma-réteg azonnal megjelenik. **Ez a legjobb megtérülésű egyetlen lépés az
egész auditban.**

**B-C2 (P1, S). A `/kez-zsibbadas` hubról hiányzik az orvosi keret és a
szerző-szakasz.** Mérve: a „Kik írták ezt a cikket?" és a „Fontos tudnivaló"
szakasz a nyolcból hét cikkben megvan, ebben az egyben **nincs**. A cikk
ugyanakkor stroke-jelekről, mentőhívásról és sürgősségi küszöbökről tanít.
_Miért baj:_ a felelősségi keret („nem diagnózis") és a szerző megnevezése
pont ott a legfontosabb, ahol a szöveg életveszélyes helyzetről beszél. A
következetlenség önmagában is UX-hiba (WCAG 2.2 **3.2.4**, konzisztens
azonosítás).
_Javaslat:_ a hiányzó két szakasz pótlása a `docs/cikkek/1-miert-zsibbad-a-kezem.md`
alapján, a másik hét cikkével azonos szöveggel és sorrenddel.

**B-C3 (P1, S). Dupla GYIK két hubon.** A `/befagyott-vall` és az
`/inhuvelygyulladas` törzsében van egy „Gyakori kérdések" H2 a hat kérdéssel
H3-ként, és utána a `PostFaq` komponens ugyanazt a hat kérdés-válasz párt
újra kiírja `details` elemekben. A tartalomjegyzék emiatt **két azonos nevű
tételt** listáz, `#gyakori-kerdesek` és `#gyakori-kerdesek-2` horgonnyal.
_Miért baj:_ a felhasználó nem tudja megkülönböztetni a két azonos nevű
jegyzék-linket (WCAG 2.2 **2.4.4** Link Purpose in Context), és mintegy ezer
szó ismétlődik a lapon. A `FaqBlock`-elv, hogy a látható lista és a séma egy
forrásból jön, itt megbomlik: a törzsben lévő második példány semmilyen sémát
nem visz.
_Javaslat:_ a törzs GYIK-szakaszának törlése a két érintett cikkből
(a `docs/cikkek/7-inhuvelygyulladas.md` és `8-befagyott-vall.md` markdownból),
így csak a komponens marad. Ha ez tartalmi döntés kérdése, akkor őr-teszt
kellene rá, ami a `posts.faq` kérdéseit összeveti a törzs H3-aival.

**B-C4 (P2, S). A lead szó szerint megismétli a törzs első bekezdését.** Mind a
nyolc cikken az `excerpt` azonos a `content` első bekezdésével, tehát a
látogató ugyanazt a 2-3 mondatot egy képernyőn belül kétszer olvassa. A séma
`description` mezője is ezt a mondatot viszi, nem a jóval erősebb
`seoDescription`-t.
_Miért baj:_ a hajtás fölötti hely a legdrágább, és itt egy teljes bekezdés
elmegy ismétlésre (NN/g, _How Users Read on the Web_,
https://www.nngroup.com/articles/how-users-read-on-the-web/).
_Javaslat:_ a lead legyen összefoglaló, ne ismétlés: egy mondat arról, mit tud
meg az olvasó, plusz a definíció (lásd B-C5). A törzs első bekezdése maradhat
a jelenlegi helyzet-felvezetés.

**B-C5 (P2, M). Az első 60 szóban nincs definíció.** Nyolcból hét cikk
helyzet-képpel indul („Éjjel felébredsz, mert zsibbad a kezed…"), utána a
„jó eséllyel te is beírtad már a keresőbe" mondat, majd a szerzők
bemutatkozása. A tömör, szótárszerű meghatározás csak az első H2 alatt jön
(például „A kéztőalagút-szindróma azt jelenti, hogy a csuklón átfutó
középideg nyomás alá kerül.").
_Miért baj:_ a bekezdés-típusú kiemelt találat 40-50 szavas, definíció-szerű
választ keres, és az AI-válaszok is ilyen darabot vonnak ki
(`references/keyword-research-and-onpage-seo.md` 6.9;
`references/ai-search-optimization.md` 4.1).
_Javaslat:_ a helyzet-felvezetés maradjon (ez a `docs/seo-geo-llm.md` 2.4
CEP-elve, és jól működik), de kerüljön mellé egy 40-50 szavas, dobozolt
összefoglaló a H1 alá: mi ez, mit tehetsz, mikor kell orvos. Ugyanez a doboz
oldja a B-C4 ismétlést, és a hosszú cikkeknél tájékozódási pontot ad.

**B-C6 (P2, M). Mobilon 1 092 px görgetés a törzs első mondatáig.** A
95 px magas morzsa a teljes cikkcímet megismétli közvetlenül a H1 fölött, a
tartalomjegyzék pedig 424 px-et foglal, mielőtt egy mondat is látszana.
_Miért baj:_ a morzsa aktuális eleme a NN/g irányelve szerint rövidíthető, és
sosem kell a teljes címet vinnie
(https://www.nngroup.com/articles/breadcrumbs/); a jegyzék viszont hasznos, ezt
nem venném el.
_Javaslat:_ (a) a morzsa aktuális eleme a kategória neve vagy a cikk rövid
neve legyen, ne a teljes H1; (b) mobilon a jegyzék alapból csukott
`details`-ben, a GOV.UK Details mintája szerint, a nyitó felirat megnevezi, mi
van mögötte (https://design-system.service.gov.uk/components/details/). A
kódban a `PostToc` már használja ezt a mintát a hetedik tételtől, csak a
küszöböt kell nézetablak-függővé tenni.

**B-C7 (P2, S). Nincs kiírva, mikor frissült a cikk.** A fejléc a
`publishedAt` dátumot mutatja (például „2026. augusztus 21."), miközben a séma
`dateModified` értéke 2026-09-07. A látogató 17 napos eltérést nem lát, és
„Utoljára ellenőrizve" sor sincs.
_Miért baj:_ az egészségügyi tartalomnál a frissesség kiírása bevett és elvárt
minta (NHS service manual, _Know that a page is up to date_,
https://service-manual.nhs.uk/design-system/patterns/know-that-a-page-is-up-to-date),
és az AI-idézhetőség egyik tényezője
(`references/ai-search-optimization.md` 4.2/4).
_Javaslat:_ a `PostAuthorBox` már tudja az „Utoljára ellenőrizve" és
„Következő ellenőrzés" sorokat, csak a mezők üresek (B-C1). Ezen felül a
fejléc-metasorba érdemes egy „Frissítve: …" jelzés, ha a `dateModified`
lényegesen későbbi a `publishedAt`-nál.

**B-C8 (P3, S). Sablon-ismétlés a nyolc lap bevezetőjében.** Hat cikk szinte
azonos két mondattal indul („Ha ez ismerős, jó eséllyel te is beírtad már a
keresőbe: X." és „Kiss Kata és Kocsis Kata vagyunk, gyógytornászok, és évek óta
elsősorban a kéz rehabilitációjával foglalkozunk."), a záró szerző-szakasz
pedig szó szerint azonos.
_Miért baj:_ nem büntetendő, de a nyolc pénzt hozó oldal így nagy arányban
azonos sablon-szövegből áll, és a hitelesítő mondat („Ez a szakmai háttér a
szerző hitelességét igazolja.") önmagát kommentálja, ami idegen a natív magyar
mikroszövegtől.
_Javaslat:_ a szerző-szakasz kerüljön ki a törzsből a strukturált
`PostAuthorBox`-ba (ez a B-C1 megoldásának mellékterméke), és a bemutatkozó
mondat cikkenként legyen egy fokkal személyesebb, a témához kötve.

**B-C9 (P3, S). Kép nélküli, 4 300-5 300 szavas cikkek.** Gyakorlatokról,
sínviselésről és mozdulatokról szóló szövegek egyetlen ábra nélkül.
_Miért baj:_ a mozdulat leírása szövegben nehezen követhető, és a képek
hiánya kizár a képkeresésből is (`references/keyword-research-and-onpage-seo.md`
6.7). A GOV.UK képhasználati útmutatója szerint a kép akkor indokolt, ha
információt hordoz, és a gyakorlat-ábra pontosan ilyen.
_Javaslat:_ legalább a „Mikor NE végezd a gyakorlatokat?" és a gyakorlat-leíró
szakaszokhoz egy-egy ábra, leíró alt-szöveggel, plusz egy egységes hero-kép
cikkenként (ez adja az `og:image`-et is, lásd B-S6).

---

## 5. SEO-réteg tételesen

### 5.1 Ami mérve rendben van

- **Címek.** Mind a nyolc `title` 49-59 karakter, az elsődleges kifejezéssel
  kezd, és mind egyedi. Ez pontosan a Semrush ajánlása (50-60 karakter,
  kulcsszó elöl, egyedi cím oldalanként).
- **Meta-leírások.** 121-160 karakter, aktív hangnem, kérdéssel vagy
  helyzetképpel nyit, több helyen kimondja a „Nem diagnózis." keretet.
- **URL-forma.** Rövid, kisbetűs, kötőjeles, ékezet és paraméter nélkül,
  gyökér szinten. Példaértékű.
- **Címsor-szerkezet.** Laponként pontosan egy H1, 19-25 H2, hézagmentes
  hierarchia; a H2-k túlnyomó része kérdés alakú, és a válasz az első
  mondatban áll. Ez a legjobb, ami az AI-idézhetőség szempontjából tehető.
- **GYIK.** Laponként 5-6 kérdés, teljes (nem csonkolt) válaszokkal, és
  ugyanaz a tömb megy a `FAQPage` sémába. A `docs/seo-geo-llm.md` 5.5-ben
  nyitva hagyott tétel tehát azóta elkészült.
- **Séma.** `Article` + `MedicalWebPage` kettős típus, `BreadcrumbList`,
  `FAQPage`, `about` mint `MedicalCondition` / `MedicalSignOrSymptom`,
  `inLanguage: hu-HU` mindenütt. Rich Results Test-tel nem tudtam validálni
  (nincs kimenő elérésem hozzá), de a szerkezet a schema.org szerint helyes.
- **robots.txt.** Tizenhárom AI-crawler név szerint engedve (GPTBot,
  OAI-SearchBot, ChatGPT-User, ClaudeBot, Claude-User, Claude-SearchBot,
  PerplexityBot, CCBot, Google-Extended, Google-Agent, Applebot-Extended,
  Bingbot, meta-externalagent), a `/blog/` és a kategória-útvonalak nincsenek
  tiltva. A `sitemap` és a `host` sor is benne van. Ez a
  `references/ai-search-optimization.md` 3. checklistjének minden pontját
  teljesíti.
- **Kanonikus címek.** A `?kategoria=` szűrt nézet canonicalja a dedikált
  kategória-lapra mutat, az üres kategória-lap `noindex, follow` jelzést kap,
  a sitemap nem tartalmaz átirányított URL-t.

### 5.2 Találatok

**B-S1 (P1, M). A belső link-gráf a régi, átirányító URL-eket használja.**
Mérve, HTML-forrásból:

| Lap                                       | `/blog/<cikk>` linkek | kanonikus gyökér-hub linkek |
| ----------------------------------------- | --------------------: | --------------------------: |
| `/` (kezdőlap)                            |                     3 |                       **0** |
| `/blog`                                   |                     8 |                       **0** |
| `/blog/kategoria/kez-es-csuklo`           |                     5 |                       **0** |
| `/keztoalagut-szindroma`                  |                     5 |                       **0** |
| `/inhuvelygyulladas`                      |                    11 |                       **0** |
| `/teniszkonyok`                           |                     3 |                       **0** |
| `/kurzusok`, `/szolgaltatasok`, `/rolunk` |                     0 |                       **0** |

A forrás a `PostCard` (`src/components/content/PostCard.tsx`), ami fixen
`href={/blog/${post.slug}}`-ot ír, és a törzsben lévő szerkesztői linkek,
amik szintén `/blog/…` alakúak. A `/blog` lap `Blog` JSON-LD-je ugyanezt a
nyolc átirányító URL-t hirdeti `blogPost.url`-ként.
_Miért baj:_ a Google 301/308 útmutatója kifejezetten kéri, hogy a belső
linkek közvetlenül az új címre mutassanak
(https://developers.google.com/search/docs/crawling-indexing/301-redirects), a
Semrush 301-playbookja ugyanígy („frissítsd a belső linkeket közvetlenül az új
URL-re", `references/technical-and-general-seo.md` 6.). Így ma a nyolc
kanonikus oldal belsőleg **árva** (`references/technical-and-general-seo.md` 2.):
csak a sitemap és egy átirányítás vezet rájuk. Minden bejárás egy fölösleges
kört tesz, a link-érték egy áttéten megy át, és a felhasználó minden
cikkre-kattintásnál egy plusz kérést fizet.
_Javaslat:_ egy `postHref(post, publikaltPageSlugok)` segéd a `courseHref`
mintájára, amit a `PostCard`, a kezdőlapi Tudástár-szekció, a kapcsolódó
blokk és a `blogJsonLd` egyaránt használ; a törzsben lévő szerkesztői linkek
átírása a gyökér-alakra a `docs/cikkek/` markdownban, majd újraimportálás.
Őr-teszt: a `/blog` és a hub-lapok HTML-jében ne legyen `/blog/<slug>` alakú
link olyan cikkre, aminek publikált hubja van.

**B-S2 (P2, S). A `meta name="keywords"` él, 9-43 kifejezéssel.** A
`docs/seo-geo-llm.md` 5.3 szó szerint azt írja, hogy ez a tag szándékosan
kimaradt, mert „cargo-cult lenne". Az élő lapokon mégis kimegy, a `/kez-zsibbadas`
hubon 43 kifejezéssel, köztük olyanokkal, mint „kéz zsibbadásra krém",
„kéz zsibbadás b vitamin".
_Miért baj:_ a Google 2009 óta kimondottan nem használja
(https://developers.google.com/search/blog/2009/09/google-does-not-use-keywords-meta-tag),
tehát nulla haszon, viszont a versenytársnak ingyen odaadja a teljes mért
kulcsszólistát, és a kulcsszó-tömés benyomását kelti.
_Javaslat:_ a `<meta name="keywords">` kiírásának megszüntetése
(`src/lib/seo.ts` `buildDocMetadata`), a CMS-mező és a JSON-LD marad.

**B-S3 (P2, S). A séma `keywords` mezője 9-43 kifejezést visz.** Ugyanaz a
lista megy az `Article` node `keywords` kulcsába is.
_Miért baj:_ a `keywords` a schema.org szerint érvényes tulajdonság, de
negyven, egymásból képzett változat (például „ínhüvelygyulladás csukló",
„ínhüvelygyulladás csukló tünetei", „ínhüvelygyulladás csuklórögzítő") már nem
a tartalom leírása, hanem lista. YMYL-lapon külön kockázat, hogy olyan
kifejezések is bekerülnek, amiket a cikk elutasít („befagyott váll homeopátia",
„teniszkönyök csontkovács"): a gépi olvasó ezeket a lap TÉMÁJAKÉNT olvassa,
holott a szöveg éppen azt mondja, hogy nem működnek.
_Javaslat:_ a sémába a mért **elsődleges** kifejezés és legfeljebb 4-6
másodlagos kerüljön (a `CIKK_KULCSSZAVAK.elsodleges` + az első néhány
`masodlagos`), a teljes lista maradjon a mérési dokumentumokban és az
Ads-oldalon. A `resolveSeoKeywords` plafonja ma 48.

**B-S4 (P2, S). A `title` és a H1 nem ugyanaz, és a kötőjel eltér a mért
kifejezéstől.** Példa: `title` „Kéztőalagút szindróma kezelése házilag",
H1 „Kéztőalagút-szindróma: mit tehetsz, mielőtt műtétre kerül a sor?". A mért
kifejezés kötőjel nélküli („kéztőalagút szindróma", Ahrefs 1 200 / KD 5), a H1
viszont a helyesírás szerinti kötőjeles alakot használja.
_Miért baj:_ a Semrush on-page checklistje kifejezetten kéri, hogy a `title`
és a H1 közel álljon egymáshoz („Title ≈ H1", 6.2), és a hibalista 4. tétele
pont a `title` ≠ H1 eltérés. A kötőjel önmagában nem rangsorolási kérdés
(a Google tokenizál), de a látható H1-ben nem szerepel a kereső által beírt
alak, ami a találati kattintás után a „jó helyen járok" visszaigazolást
gyengíti.
_Javaslat:_ a H1-ben szerepeljen egyszer a kötőjel nélküli alak is (például a
lead vagy a definíciós doboz mondatában), a `title` maradjon. Helyesírást ne
rontsunk el a kulcsszó kedvéért.

**B-S5 (P2, S). A publikus cikkoldalak nem gyorstárazhatók.** Az élő válasz
fejléce: `cache-control: private, no-cache, no-store, max-age=0,
must-revalidate`. Ok: `export const dynamic = 'force-dynamic'` a `[slug]`
route-on. Mért TTFB innen: 0,58 s a hub-oldalra, 0,58 s a `/blog`-ra.
_Miért baj:_ minden bejárás és minden látogatás új szerver-renderelést és
adatbázis-kört jelent, holott a nyolc lap ritkán változik. A Core Web Vitals
és a bejárási költségvetés szempontjából ez a legolcsóbban javítható technikai
tétel (`references/technical-and-general-seo.md` 8.3).
_Javaslat:_ a hub- és cikk-útvonalakra ISR (`revalidate`) vagy címke-alapú
újraérvényesítés a Payload `afterChange` hookból. Óvatosan: a `force-dynamic`
a piszkozat-előnézet miatt van ott, tehát a draft-ág maradjon dinamikus.

**B-S6 (P2, M). Nincs `og:image` és nincs `og:type`.** Mérve: a hub-lapok
`og:title`, `og:description`, `og:url` tageket adnak, `og:image` nincs, a
`twitter:card` értéke `summary`. `og:type`, `og:site_name`,
`article:published_time` sincs.
_Miért baj:_ minden Facebook-, Messenger- és LinkedIn-megosztás kép nélküli,
apró kártyaként jelenik meg, holott a mért forgalom ma jellemzően közvetlen és
közösségi (`docs/ADATOK-mert.md` alapján az organikus lábnyom nulla). Ez tehát
pont a ma valóban létező csatornát rontja.
_Javaslat:_ egy 1200×630 px-es márka-alapkép a keret-layout szintjén
(azonnali, S méret), majd cikkenkénti hero-kép (M). Ugyanez tölti fel az
`Article.image` mezőt is.

**B-S7 (P3, S). A sitemap a nyolc pénzt hozó oldalnak 0,6 prioritást ad.**
Ugyanannyit, mint az ÁSZF-nek és az impresszumnak, kevesebbet, mint a `/blog`
listának (0,8). A Google a `priority` mezőt figyelmen kívül hagyja
(`references/technical-and-general-seo.md` 3.2), tehát ez nem rangsor-kérdés,
de a saját dokumentumunk így félrevezető: a nyolc hub a CMS-oldal ágon megy
át, nem kap saját besorolást.
_Javaslat:_ a `sitemap.ts` CMS-oldal ágában a `HUB_OLDALAK` slugjaira 0,8-as
prioritás és `weekly` gyakoriság, vagy a `priority` mező elhagyása mindenütt.

**B-S8 (P3, S). Nincs `Person` / `sameAs` entitás-horgony.** A séma-réteg a
szerzőket (ha lesznek) a `/rolunk` lapra mutató `url`-lel adná meg, de sem az
`Organization`, sem a `Person` node nem visz `sameAs` hivatkozást a valós,
külső profilokra (a `docs/ADATOK-mert.md` 5. szakasza a
`probodystudio.hu/csapatunk` és a `foglaljorvost.hu` horgonyokat már
azonosította).
_Miért baj:_ az AI-rendszerek az entitás egyértelműsítéséhez külső,
független megerősítést keresnek (`references/ai-search-optimization.md` 7-8.),
és a mért backlink-profil gyenge (score 2 / 9 hivatkozó domain, szemben a
gyogytornaszom 36 / 570 értékével).
_Javaslat:_ az `organizationJsonLd`-be `sameAs` tömb a meglévő, valós
profilokkal; a `Person` node-okba ugyanígy, ha van személyes profil-URL.
Kitalált profilt nem szabad felvenni.

---

## 6. Keresési szándék és a mért kulcsszó-réteg

**Amit a Tudástár ma kiszolgál:** informational szándék, nyolc tünet-hubbal.
A `docs/ADATOK-mert.md` 1-2. szakasza szerint ezek a kifejezések 0-18 közötti
nehézségűek, tehát a rés valóban nyitva áll, és a domain ma **egyikre sem**
rangsorol.

**Ami a mért réteghez képest hiányzik:**

| Mért kifejezés                           | Forrás | Ma hol szolgáljuk ki?                                                                                                               |
| ---------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| kéztőalagút szindróma (1 200 / KD 5)     | Ahrefs | `/keztoalagut-szindroma`, cím elöl. Rendben.                                                                                        |
| teniszkönyök (3 500 / KD 13)             | Ahrefs | `/teniszkonyok`, cím elöl. Rendben.                                                                                                 |
| ínhüvelygyulladás (2 200 / KD 18)        | Ahrefs | `/inhuvelygyulladas`. Rendben.                                                                                                      |
| ínhüvelygyulladás tünetei (300 / KD 5)   | Ahrefs | a `title` „tünetek" alakot használ, a mért alak „tünetei". H2 szinten megvan.                                                       |
| ínhüvelygyulladás kezelése (300 / KD 17) | Ahrefs | a címben nincs „kezelése", a `/keztoalagut-szindroma` és a `/teniszkonyok` címében viszont ott a „kezelése házilag". Következetlen. |
| vállfájdalom (1 900 / KD 28, Semrush)    | Monid  | **nincs hub**, a `HUB_OLDALAK` szándékosan kihagyja (nincs lektorált törzs). Döntési tétel.                                         |
| kéz zsibbadás (450 / KD 17)              | Ahrefs | `/kez-zsibbadas`. Rendben.                                                                                                          |

**Kereskedelmi és tranzakciós szándék:** a Tudástárban ma nincs olyan lap, ami
összehasonlítást vagy döntéstámogatást adna („otthoni program vagy rendelői
gyógytorna?"), pedig a `docs/ADATOK-mert.md` 7. szakasza szerint a
kereskedelmi kifejezések SEO-oldalon engedélyezettek. A nyolc hub végén álló
kétpaneles CTA (kurzus + időpont) ezt a döntést egy dobozban próbálja
elintézni, a 93-95%-os görgetési mélységben.

_Javaslat (P2, M):_ egy kilencedik, kereskedelmi szándékú lap a Tudástárban,
ami a két utat őszintén összeveti, és mindkét irányba visz. Ez a
`references/keyword-research-and-onpage-seo.md` 2. táblázata szerint a
„commercial" szándék tartalomtípusa, és a mért helyzetben (nulla organikus
lábnyom, de meglévő közvetlen forgalom) ez a lap belső linkelésből is hasznot
hoz.

---

## 7. AI-keresés (GEO/AEO) és a kiemelt találat esélye

**Erős alapok.** A cikkek szerkezete tankönyvi az AI-kivonatoláshoz: kérdés
alakú alcím, alatta közvetlen válasz, 2-4 mondatos bekezdések, HTML-listák
(nem képek), explicit összefüggések. A GYIK 5-6 teljes válasza `FAQPage`
sémában is kimegy. A robots.txt minden lényeges AI-botot enged.

**Ami hiányzik, és pont a leginkább idézhető réteg:**

**B-G1 (P1, M). Nincs egyetlen hivatkozott forrás sem a publikus lapokon.**
Mérve: a `/keztoalagut-szindroma` törzsében 20 link van, ebből 16 belső
horgony és 4 belső oldal. Külső hivatkozás: **nulla**. Közben a
`docs/cikkek/2-keztoalagut-szindroma.md` **24 tételes forrásjegyzéket** visz
(NHS, AAOS, Cochrane-áttekintések PMID- és DOI-azonosítóval, NIH ODS, BSSH), és
a cikk maga hivatkozik rájuk szövegszerűen („van rá egy 24 hónapig követett
vizsgálat", „kevés bizonyíték szól amellett…"), csak a forrás nélkül.
_Gyökérok:_ a `src/lib/tudastar/markdown-to-lexical.ts` `FORRAS_JELOLESEK`
őre kifejezetten kizárja a forrásokat a nyilvános törzsből, „tulajdonosi
döntés (2026-08-21)" indoklással. Ez tehát nem hiba, hanem döntés, de a
következménye mérhető.
_Miért számít:_ a `references/ai-search-optimization.md` 4.2 pontja szerint
idézetek és forrásmegjelölt adatok hozzáadása akár 40%-kal növelheti az
AI-válaszokban való láthatóságot, és a `docs/seo-geo-llm.md` 2.2-2.3 pontja
maga is kötelező elemként sorolja. Egészségügyi tartalomnál a hiteles forrás
egyben a legfontosabb megbízhatósági jel is
(https://developers.google.com/search/docs/fundamentals/creating-helpful-content).
_Javaslat (tulajdonosi döntést igényel, lásd 12. szakasz):_ nem in-text
lábjegyzetek, hanem egyetlen, alapból csukott „Mire támaszkodtunk" blokk a
cikk végén, 6-10 forrással, a `docs/orvosi-forrasbazis.md` alapján, a
`details` mintát követve. Így a szöveg olvasási élménye nem változik, a
gépi és emberi hitelesítő jel viszont megjelenik.

**B-G2 (P2, S). Nincs a lapon konkrét, számmal alátámasztott állítás.** A
cikkek szándékosan óvatosak („kevés bizonyíték", „a lefolyás egyéni"), ami
YMYL-szempontból helyes, de emiatt nincs egyetlen olyan idézhető adatpont sem,
amit egy AI-válasz átvehetne. A forrás-markdownban ott van a nyersanyag
(„21 vizsgálat, 884 fő", „12 vizsgálat 869 fővel", „napi 100 mg tolerálható
felső beviteli szint").
_Javaslat:_ 2-3 ilyen szám beemelése cikkenként, forrás-azonosítóval, a B-G1
blokkhoz kötve. A klinikai állítás nem változik, csak a mögötte álló mérték
válik láthatóvá.

**B-G3 (P3, S). Nincs prompt-portfólió és baseline.** A `docs/seo-geo-llm.md` 3. szakasza előírja a 25 promptos portfóliót és a havi mérést, de mért
alapvonal nincs (`docs/ADATOK-mert.md` nem tartalmaz AI-láthatósági sort).
_Javaslat:_ a nyolc hub témájára 3-3 valós kérdés ChatGPT-ben, Perplexityben és
a Google AI Overviews-ban, havonta rögzítve. Ez mérés, nem fejlesztés, és a
`docs/ADATOK-mert.md`-be kell kerülnie.

---

## 8. Konverziós út (CRO)

**Honnan jön a látogató.** Ma nem organikusan: a `docs/ADATOK-mert.md` szerint
a domain 15 kifejezésre rangsorol, mind 17-83. helyen, 0,00% forgalommal, és a
nyolc hub egyik fő kifejezésére sem. A belépés jellemzően közvetlen, közösségi
vagy hirdetési.

**Hol vész el.** Mérve, 390 px, `/keztoalagut-szindroma` (26 360 px hosszú lap):

| Elem                               | y (px) | a lap %-a |
| ---------------------------------- | -----: | --------: |
| Első kurzus-hivatkozás (szövegben) | 21 659 |   **82%** |
| Ingyenes SOS szöveglink            | 22 484 |       85% |
| „Nyisd meg a kurzusoldalt" gomb    | 24 425 |   **93%** |
| „Kérj időpontot üzenetben" gomb    | 24 808 |       94% |

1440 px-en ugyanez 84% / 87% / 95% / 95%. A `/blog` listán és mind a három
kategória-lapon nulla ilyen elem van.

**B-R1 (P1, M). Minden ajánlat a lap utolsó ötödében van.** Egy 18 perces
cikkben ez azt jelenti, hogy aki nem olvassa végig, egyetlen ajánlatot sem lát.
_Miért baj:_ a görgetési mélység erősen csökken a lap alja felé (NN/g,
_Scrolling and Attention_,
https://www.nngroup.com/articles/scrolling-and-attention/), a hosszú
tartalomnál pedig a szakaszhatárokon elhelyezett, kontextushoz kötött ajánlat
a bevett minta.
_Javaslat:_ egy halk, szövegközi ajánló-sáv a „Mikor NE végezd a
gyakorlatokat?" szakasz után (körülbelül a lap felénél), ugyanazzal a
felirattal, mint a záró panel (WCAG 2.2 **3.2.4**), és a tartalomjegyzékben is
jelölve. Nem popup, nem ragadós sáv: a `references/ai-search-optimization.md` 9. pontja is kifejezetten kéri a popupok kerülését a konverziós lapokon.

**B-R2 (P2, S). A záró panelen nincs elsődleges gomb.** Mérve: mindkét gomb
`kc-button--secondary` osztályú (`Nyisd meg a kurzusoldalt`,
`Kérj időpontot üzenetben`), tehát a cikk egyetlen döntési pillanatában két
azonos súlyú, körvonalas gomb áll egymás mellett.
_Miért baj:_ a GOV.UK Design System és a Material 3 is azt mondja, hogy egy
nézetben egy elsődleges cselekvés legyen, vizuálisan kiemelve
(https://design-system.service.gov.uk/components/button/,
https://m3.material.io/components/buttons/guidelines). A CTA-szótár
(`docs/ui-sztenderdek.md` §3.2) a #28 és a #24 sorhoz egyaránt `secondary`
stílust rendel, ezért ez nem a megvalósítás hibája, hanem szótár-szintű
kérdés.
_Javaslat:_ a szótárba egy új sor a „cikk végi elsődleges cselekvés"
helyzetre, `primary` stílussal, a kurzusra. Az időpontkérés marad `secondary`.
Ez a 12. szakasz döntési tétele.

**B-R3 (P2, S). A lista és a kategória-lapok kereskedelmileg zsákutcák.**
Lásd B-L1 és B-K4. Egy három kattintásból álló út (kezdőlap → Tudástár →
kategória) ma nulla ajánlatot mutat.

**B-R4 (P3, S). A `/befagyott-vall` hubnak nincs kurzus-útja, és ezt jól is
teszi.** A lap az „Otthoni kézprogramot ehhez a kórképhez nem ajánlunk"
mondattal az időpontkérés felé visz. Ez őszinte és helyes (a termék a kezet, a
csuklót és a könyököt fedi), viszont az egyetlen kimenet a `/kapcsolat`
űrlapja, plusz egy külső link a `probodystudio.hu/kez-workshop/` felé.
_Javaslat:_ nincs változtatási javaslat a tartalomra, de a mérésben külön
szegmensként kell kezelni: ennek a lapnak a KPI-ja az időpontkérés, nem a
kurzus-kattintás.

---

## 9. Indexelhetőség, összefoglalva

| Ellenőrzés                         | Eredmény                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------- |
| `robots.txt` tiltja-e a Tudástárat | nem, és 13 AI-botot név szerint enged                                     |
| `sitemap.xml` tartalma             | 22 URL: 4 statikus, 8 hub, 5 CMS-lap, 3 kategória, 2 kurzus               |
| Átirányított URL a sitemapben      | nincs                                                                     |
| Kanonikus címek                    | minden lapon van, a hubok gyökér-URL-re, a `?kategoria=` a dedikált lapra |
| `noindex`                          | csak az ÜRES kategória-lapon (ma nincs ilyen)                             |
| 404 kezelés                        | `/blog/nincs-ilyen-cikk` → 200 helyett **404**, helyesen                  |
| `html lang`                        | `hu`                                                                      |
| Tömörítés                          | brotli/gzip működik (150 480 → 38 896 bájt)                               |
| Gyorstárazás                       | **nincs** (`no-store`, lásd B-S5)                                         |
| Árva kanonikus oldalak             | **8** (lásd B-S1)                                                         |

---

## 10. Prioritált teendők

Jelölés: P1 = a szerves láthatóságot vagy a bizalmat közvetlenül rontja,
P2 = mérhető veszteség, P3 = higiénia. Méret: S = néhány óra, M = 1-2 nap,
L = ennél több.

| #   | Teendő                                                                                                                                  | Prio | Méret    | Hol                                                                         |
| --- | --------------------------------------------------------------------------------------------------------------------------------------- | ---- | -------- | --------------------------------------------------------------------------- |
| 1   | Szerző, lektor, ellenőrzési dátum kitöltése mind a 8 cikken (Users → `staff` szerep, majd import vagy kézi kitöltés)                    | P1   | S        | CMS                                                                         |
| 2   | A belső linkek átállítása a kanonikus gyökér-hub URL-ekre (`PostCard`, kezdőlapi szekció, kapcsolódó blokk, `blogJsonLd`, törzs-linkek) | P1   | M        | `src/components/content/PostCard.tsx`, `src/lib/seo.ts`, `docs/cikkek/*.md` |
| 3   | A dupla GYIK megszüntetése a `/befagyott-vall` és az `/inhuvelygyulladas` lapon                                                         | P1   | S        | `docs/cikkek/7-…md`, `8-…md` + újraimport                                   |
| 4   | A `/kez-zsibbadas` hubra a hiányzó „Kik írták" és „Fontos tudnivaló" szakasz                                                            | P1   | S        | `docs/cikkek/1-…md`                                                         |
| 5   | Szövegközi ajánló-sáv a cikk felénél                                                                                                    | P1   | M        | `PostArticle` + `PostCourseCta`                                             |
| 6   | 40-50 szavas definíciós összefoglaló a H1 alá, a lead-ismétlés helyett                                                                  | P2   | M        | CMS `excerpt` + törzs                                                       |
| 7   | `og:image` (először egy márka-alapkép), majd cikkenkénti hero-kép                                                                       | P2   | S majd M | layout + CMS                                                                |
| 8   | Morzsa, kategória-szűrő és bevezető a kategória-lapokra; 3 cikk alatti kategória `noindex`                                              | P2   | S        | `blog/kategoria/[slug]/page.tsx`                                            |
| 9   | CTA-sáv a `/blog` és a kategória-lapok aljára                                                                                           | P2   | S        | lista-route-ok                                                              |
| 10  | `meta name="keywords"` megszüntetése; a séma `keywords` 5-7 kifejezésre szűkítése                                                       | P2   | S        | `src/lib/seo.ts`                                                            |
| 11  | Gyorstárazás (ISR + címke-alapú újraérvényesítés) a hub- és cikk-útvonalakra                                                            | P2   | M        | `[slug]`, `blog/[slug]`                                                     |
| 12  | Mobil: rövidebb morzsa-elem, csukott tartalomjegyzék                                                                                    | P2   | S        | `PostArticle`, `PostToc`                                                    |
| 13  | „Frissítve" jelzés, ha a `dateModified` lényegesen későbbi                                                                              | P2   | S        | `PostArticle`                                                               |
| 14  | Gyakorlat-ábrák a mozdulatokat leíró szakaszokhoz                                                                                       | P2   | L        | tartalom                                                                    |
| 15  | Olvasási idő a kártyákon; azonos kategória-címke elhagyása a kategória-lapon                                                            | P3   | S        | `PostCard`                                                                  |
| 16  | `sameAs` az `Organization` és a `Person` node-okba                                                                                      | P3   | S        | `src/lib/seo.ts`                                                            |
| 17  | Sitemap-prioritás a hubokra, vagy a `priority` mező elhagyása                                                                           | P3   | S        | `src/app/sitemap.ts`                                                        |
| 18  | AI-láthatósági alapvonal (25 prompt) felvétele a `docs/ADATOK-mert.md`-be                                                               | P3   | M        | mérés                                                                       |

---

## 11. Tulajdonosi döntést igénylő tételek

1. **Forrásjegyzék a publikus lapokon.** A 2026-08-21-i döntés kizárja a
   forrásokat a nyilvános törzsből (`markdown-to-lexical.ts` `FORRAS_JELOLESEK`),
   és ezt az őr be is tartatja. A nyolc cikk mögött viszont 20-24 tételes,
   ellenőrzött forrásjegyzék áll (NHS, AAOS, Cochrane, NIH, BSSH). Kérdés:
   megjelenhet-e ez egy alapból csukott, „Mire támaszkodtunk" feliratú blokkban
   a cikk végén? Az olvasási élmény nem változik, a hitelesség jele viszont
   láthatóvá válik. Ha nem, akkor a `docs/seo-geo-llm.md` 2.2 és 2.3
   checklistjének „hiteles forrás megjelölve" pontját tudatosan feladjuk, és
   ezt ott is át kell vezetni.
2. **Google Ads finalok cseréje.** A hub-cutover megtörtént, tehát a
   `docs/adwords-kampany.md` 7.4 és a `docs/h-ih-kulcsszavak-draft.md` „Kapu"
   pontja szerint a hirdetések végső URL-jeit a `/blog/…` alakról a gyökér-hubra
   kell állítani, különben a hirdetés átirányítást hirdet. Ez a Google Ads
   fiókban kézi vagy tömeges feladat.
3. **Vállfájdalom hub.** A mérés megvan (Semrush HU 1 900 / KD 28), lektorált
   orvosi törzs nincs, ezért a `HUB_OLDALAK` szándékosan kihagyja. Írja meg a
   két gyógytornász, vagy marad ez a klaszter fedetlenül?
4. **Elsődleges gomb a cikk végén.** A CTA-szótár ma mindkét záró cselekvéshez
   `secondary` stílust rendel, ezért a cikk döntési pillanatában nincs
   vizuálisan kiemelt cselekvés. Felvegyünk-e a szótárba egy „cikk végi
   elsődleges cselekvés" sort `primary` stílussal?
5. **A `/blog` lista címe.** A `seoTitle` ma nincs kitöltve, tehát a cím
   „Tudástár". Ha keresésre optimalizált címet akarunk, mérni kell, milyen
   gyűjtő-kifejezésre érdemes célozni. Ilyen mérés ma nincs a
   `docs/ADATOK-mert.md`-ben, tehát ez új Monid-kör (költséggel).
6. **Kép-készlet.** Nyolc hero-kép és a gyakorlat-ábrák elkészítése tartalmi és
   költség-kérdés: saját fotó, vásárolt illusztráció vagy vonalas rajz? Az
   `og:image` márka-alapkép ettől függetlenül azonnal megcsinálható.

---

## 12. Nyitott kérdések és amit nem tudtam mérni

- **Rich Results Test és Search Console.** A strukturált adatot csak
  szerkezetileg ellenőriztem, a Google validátorát nem tudtam futtatni. A
  `docs/seo-geo-llm.md` 4. szakasza szerint a Search Console bekötése (B8) még
  nyitott, tehát valós indexelési adat nincs.
- **Élő böngészős mérés.** A playwright a proxyn keresztül nem érte el az élő
  Railway-hostot, ezért a geometriai és kontraszt-méréseket a helyi dev
  szerveren végeztem. A HTML-szerkezetet és a fejléceket viszont az élő
  válaszokból vettem, és a kettő címsorfáját összevetettem.
- **Valós látogatói adat.** A cikkek görgetési mélységéről és a
  cikk→kurzus átkattintásról a PostHog `ArticleEngagement` események
  adhatnának képet (`article_viewed`, `article_read`, CTA-kattintás), de ezeket
  most nem kérdeztem le. Az 5. teendő (szövegközi ajánló) hatását pontosan
  ezekkel az eseményekkel kell visszamérni.
- **A hub-cutover időpontja.** A `dateModified` mind a nyolc lapon
  2026-09-07, tehát a publikálás mai. Nem tudom, mikor indexelte be a Google a
  régi `/blog/…` címeket, és így azt sem, mennyi átirányítás-érték mozog.
  Ezt a Search Console bekötése után lehet megnézni.
- **A `csuklo-es-kezfajdalom` mért volumene.** A
  `src/lib/tudastar/seo-kulcsszavak.ts` 150-et és KD 0-t rögzít, a
  `docs/ADATOK-mert.md` 2. szakasza „csukló fájdalom" 1 000 (Semrush) és 800
  (Ahrefs) értéket. Nem oldottam fel, mert nem mérés nélkül nem szabad.
  Jelezni kell a mérési dokumentumban.

---

## 13. Források

**Kutatás és tervezési rendszerek**

- NN/g, _Breadcrumbs: 11 Design Guidelines for Desktop and Mobile_: https://www.nngroup.com/articles/breadcrumbs/
- NN/g, _Scrolling and Attention_: https://www.nngroup.com/articles/scrolling-and-attention/
- NN/g, _How Users Read on the Web_: https://www.nngroup.com/articles/how-users-read-on-the-web/
- NN/g, _Better Link Labels_: https://www.nngroup.com/articles/better-link-labels/
- NN/g, _10 Usability Heuristics for User Interface Design_: https://www.nngroup.com/articles/ten-usability-heuristics/
- NN/g, _Unique, Short Page Titles_: https://www.nngroup.com/articles/page-titles/
- GOV.UK Design System, _Details_: https://design-system.service.gov.uk/components/details/
- GOV.UK Design System, _Button_: https://design-system.service.gov.uk/components/button/
- GOV.UK Design System, _Images_: https://design-system.service.gov.uk/styles/images/
- Material Design 3, _Buttons, guidelines_: https://m3.material.io/components/buttons/guidelines
- NHS service manual, _Know that a page is up to date_: https://service-manual.nhs.uk/design-system/patterns/know-that-a-page-is-up-to-date

**Kereső- és AI-oldali irányelvek**

- Google Search Central, _Creating helpful, reliable, people-first content_: https://developers.google.com/search/docs/fundamentals/creating-helpful-content
- Google Search Central, _Article (Article, NewsArticle, BlogPosting) structured data_: https://developers.google.com/search/docs/appearance/structured-data/article
- Google Search Central, _Structured data general guidelines_: https://developers.google.com/search/docs/appearance/structured-data/sd-policies
- Google Search Central, _Redirects and Google Search_: https://developers.google.com/search/docs/crawling-indexing/301-redirects
- Google Search Central Blog, _Google does not use the keywords meta tag in web ranking_: https://developers.google.com/search/blog/2009/09/google-does-not-use-keywords-meta-tag
- schema.org, _lastReviewed_: https://schema.org/lastReviewed · _reviewedBy_: https://schema.org/reviewedBy · _keywords_: https://schema.org/keywords

**Szabvány**

- WCAG 2.2 hivatkozott sikerkritériumok: 1.3.1, 1.4.3, 1.4.10, 1.4.12, 2.3.3,
  2.4.4, 2.4.6, 2.4.7, 2.5.8, 3.2.4.

**Skill-modulok (a repóban)**

- `digital-marketing-mastery/references/keyword-research-and-onpage-seo.md`
  (2., 6.2, 6.3, 6.7, 6.8, 6.9, 8. szakasz)
- `digital-marketing-mastery/references/ai-search-optimization.md`
  (3., 4.1, 4.2, 5., 7-9., 10. szakasz)
- `digital-marketing-mastery/references/technical-and-general-seo.md`
  (2., 3.2, 5., 6., 8. szakasz)
- `.claude/skills/termektervezes/SKILL.md` (1., 2., 3., 5., 7. pont)

**Repó-anyagok**

- `docs/ADATOK-mert.md`, `docs/seo-geo-llm.md`, `docs/h-ih-kulcsszavak-draft.md`,
  `docs/cikkek/` (8 lektorált markdown a forrásjegyzékekkel),
  `docs/cikkek-tenyellenorzes.md`, `docs/orvosi-forrasbazis.md`,
  `docs/tudastar-a11y-meres.md`, `docs/ui-sztenderdek.md` §3.2,
  `docs/kezdolap-ux-audit-2026-09-07.md`, `docs/adwords-kampany.md` 7.4.
