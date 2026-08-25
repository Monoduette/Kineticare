# Szekció-rendszer + új kinézet — megvalósíthatósági terv

> **Mi ez?** A kineticare.higgsfield.app landing kinézetének átültetése a fő
> (Next.js 15 + Payload 3) oldalra úgy, hogy **minden kezdőlapi szekció a
> Payload adminból kezelhető** legyen: elrejtés, szövegszerkesztés, új szekció
> felvétele és **sorrend-módosítás** — programozói segítség nélkül. A tervet a
> megrendelői kérés hívta életre („minden szekció össze legyen kötve a
> háttérrendszerrel… tudjuk a modul pozícióját változtatni"). A forrás-kinézet
> teljes leltára a (azóta törölt) Higgsfield koncepció-tükörből készült
> (2026-08-08). A tükör nincs a repóban; a képek forrása `content/home-images/`.

## 1. Architektúra-döntés

**Payload natív `blocks` mező (layout-builder) a Pages collectionön.**

- A kezdőlap CMS-oldala új, opcionális `layout` mezőt kap; minden szekció egy
  blokk-példány. A Payload admin natívan tudja: fogd-és-vidd átrendezés,
  blokk-hozzáadás/-törlés, blokkonkénti űrlapmezők — pont a kért képességek.
- **Elrejtés**: minden blokkon közös `visible` kapcsoló (törlés helyett
  elrejthető, így a tartalom nem vész el).
- **Fallback**: ha egy oldalnak nincs `layout`-ja, a mai kód-szintű renderelés
  fut (kezdőlapon a HomeView-kompozíció) — a bevezetés pillanatában semmi nem
  törik, és a layout kiürítése sem hagy üres oldalt.
- A drafts + autosave + Előnézet gomb (2026-08-08-i fázisban épült) a layoutra
  is érvényes: a lányok piszkozatban átrendezhetnek, előnézetben ellenőriznek,
  és csak a Közzététel gombbal élesítenek.

**Elvetett alternatívák:** külön „Szekciók" collection sorrend-mezővel (nincs
natív drag&drop az oldalon belül, a kapcsolat oldal↔szekció kézi); globals
(nincs verziózás-előnézet ugyanígy); hardcode + feature flagek (nem ad
szerkesztést).

## 2. Blokk-katalógus

Közös mezők MINDEN blokkon (`sectionSettings` group): `visible` (checkbox,
default true), `anchorId` (text, opcionális — lapon belüli hivatkozáshoz),
`hatter` (select: `feher` / `tint` / `sotet`, ahol értelmezett). Minden label
és leírás magyarul, laikusnak.

| Blokk (slug) | Magyar név | Fő mezők | Adatforrás |
|---|---|---|---|
| `filmHero` | Film-hero (kéznyitás) | cím (H1), lead, címke-lista (Kéz/Csukló/Könyök/Váll), CTA-k (felirat+link, 0–2 db) | mezők + statikus film-assetek |
| `credsStrip` | Hitel-csík (szöveges) | tételek listája, link | mezők (mai CredentialsStrip CMS-esítve) |
| `pressLogos` | Sajtó-logósor | felirat, logók (Média-feltöltés + alt + opcionális link) | Media |
| `courseCards` | Kurzuskártyák | felirat-felülírás, bevezető | **automatikus: Webshop → Kurzusok (products, published)** |
| `freeSos` | Ingyenes SOS-sáv | cím, törzs, CTA felirat+link, háttérkép (Média) | mezők |
| `welcome` | Üdvözlő / probléma-blokk | cím, lead, checklist-tételek, oldalsó bekezdések | mezők |
| `usps` | „Erre számíthatsz" kártyák | 1–4 kártya (cím + 2 bekezdés) | mezők |
| `states` | Három állapot | bevezető + 3 kártya (kép [Média], sorszám, cím, szöveg) | mezők + Media |
| `services` | Szolgáltatás-sorok | kép (Média), 1–5 sor (szám, cím, szöveg, link+külső-e) | mezők |
| `about` | Rólunk + statisztikák | bekezdések, kiemelt-blokk, csapatfotó (Média), stat-tételek | mezők |
| `howItWorks` | Így működik (lépések) | felirat + 1–5 lépés (cím, szöveg) | mezők (ma statikus) |
| `testimonials` | Vélemények | felirat, eyebrow, max-darab (1–3) | **automatikus: Vélemények collection (featured+visible)** |
| `knowledge` | Tudástár-ajánló | felirat, darabszám (1–6) | **automatikus: Bejegyzések (legfrissebb publikáltak)** |
| `faq` | GYIK | felirat + kérdés/válasz párok | mezők → **FAQPage JSON-LD ebből generálódik** |
| `richText` | Szabad szöveg | Lexical-tartalom | mezők |
| `ctaBanner` | CTA-sáv | cím, szöveg, gomb felirat+link, háttér | mezők |

**Kurzus-értékesítés kezelése:** új kurzus kirakása továbbra is a Webshop →
Kurzusok adminban történik (termék létrehozás + Közzététel) — a `courseCards`
blokk automatikusan jeleníti meg. Így az árazás/videók/hozzáférés logikája egy
helyen marad, a főoldal sosem tud „elszakadni" a valós kínálattól. Ugyanez a
minta a Vélemények és a Tudástár blokkal (collection = igazságforrás, blokk =
megjelenítés).

## 3. Kinézet-átültetés (a landing-leltár alapján)

### 3.1 Tokenek

- A landing 13 lapos tokenje a fő site teljes token-rendszerére képződik le.
- **Új tokenek a `tokens.css`-be:** `--kc-color-accent: #3d78aa`,
  `--kc-color-accent-deep: #2f6e9f` (a landing közép-kék akcentpárja — a fő
  site-ról eddig hiányzott), `--kc-color-tint-cool: #e6f0f8` (a landing
  hűvösebb tintje; a meglévő `--kc-color-blue-100` marad a régi komponenseknek).
- **Kontraszt-korlát az akcentre (számolt):** `--kc-color-accent` a
  tint-cool háttéren 4,07:1 — normál szövegre AA ALATT. Ezért az `accent`
  kizárólag nagy szövegre (≥ 24 px / 18,66 px félkövér) vagy dekorációra
  használható tinten; szöveg-linkre és normál szövegre `accent-deep`
  (fehéren 5,45:1) vagy navy jár. Ezt a blokk-CSS-ek kommentje is rögzítse.
- A landing `ink #10243e` ↔ fő site `navy-900 #0b243f`: **egységesítés a
  meglévő navy-900-ra** (vizuálisan megkülönböztethetetlen, egy igazságforrás).
- Fontméretek: a landing inline `clamp()`-jei a `--kc-text-*` skálára állnak
  át; a film-hero H1 felső korlátja a skála display-lépcsője (UX-skill 4. pont).
- Töréspontok: a fő site konvenciói; a ScrollScrub belső 860px-e a komponensben
  marad (önhordó).

### 3.2 Fontok — self-hosting végre

A landing kész, subsetelt woff2-ket hoz (Tenor Sans 400 latin+latin-ext,
Nunito Sans variábilis latin+latin-ext, össz. ~91 KB) — pont amit a
`tokens.css` kommentje tervez. Átemelés `public/fonts/` alá, `@font-face` a
`fonts.css`-be a fő site fontneveivel (`'Tenor Sans'`, `'Nunito Sans'`),
`font-display: swap`, preload a kritikus metszetre. A landing Cormorant/Satoshi
külső linkjei NEM jönnek (azok a Higgsfield-sablon maradványai).

### 3.3 Film-hero (ScrollScrub) port

- A `scroll-scrub.tsx` tisztán natív böngésző-API-kat használ, TanStack-hívás
  nincs benne → 1:1 áthozható **`'use client'`** szigetként
  (`src/components/scroll-scrub/`), a hozzá tartozó CSS-sel.
- Egyfelvonásos scrub: EGY folytonos kéznyitás-film `currentTime`-át vezérli a
  görgetés (~460dvh sticky sáv), lingerrel a középső (terapeutás) szakaszon.
- `prefers-reduced-motion`: videó be sem töltődik, a poszter áll — a portban
  ez változatlanul megmarad; billentyűzet/SR-felhasználót nem érint (a szöveg
  normál DOM).
- Fallback: sikertelen videó-letöltés → poszter marad (csendes degradáció).
- Assetek statikusan (nem Media collectionből — a film cseréje fejlesztői
  feladat): `public/media/film/` alá kerül a 4 fájl (~14,7 MB összesen:
  desktop 10,1 MB + mobil 3,7 MB + 2 poszter). Későbbi opció: Cloudflare
  Stream-re költöztetés env-kapcsolóval (staff-feladat, nem blokkol).

### 3.4 Tartalmi képek

A landing képei (három állapot ×3, szolgáltatás-kéz, SOS-tábla, csapatfotó,
6 sajtólogó, logó — össz. ~5,3 MB) a **Media collectionbe** kerülnek seed-del
(`payload.create` + `filePath`, idempotens fájlnév-kulccsal), így a lányok
cserélhetik őket. A blokk-komponensek Media-hivatkozást várnak. A `.scratch/`
nyersanyag és az árva fájlok (`sos-art.png` duplikátum, `katak.jpg`) NEM
jönnek át.

### 3.5 Amit NEM veszünk át a landingről

- A landing fejléc/lábléc (mailto-CTA, menü nélkül) — a fő site fejléce marad
  (CMS-menü + kód-szintű „Kurzusok" gomb: UX-skill 3. pont kötelezi).
- A `kc-rise` betöltés-animáció úgy, ahogy van (nem scroll-triggerelt, alig
  látszik) — helyette without-motion alap; valódi scroll-reveal csak külön
  döntésre.
- Külső kineticare.hu-ra mutató CTA-célok — a blokkok alapértelmezetten belső
  route-okra mutatnak (`/kurzusok`, `/kurzusok/[id]`), a linkmezők szabadok.

## 4. Alapértelmezett sorrend és M1–M8 őrzőkorlátok

A landing sorrendje (hero → üdvözlő → USP → állapotok → szolgáltatások →
rólunk → vélemények → sajtó → SOS) **eltér az értékesítési audittól** (nincs
benne korai kurzuskártya-blokk!). A feloldás:

- **A seed-elt alapsorrend az auditot követi, a landing kinézetével:**
  `filmHero` (M1) → `credsStrip` (M2 — a szakmai hitel-csík, ahogy az audit
  előírja; a sajtólogó-sor NEM helyettesíti) → `courseCards` (M3) →
  `freeSos` (M4) → `pressLogos` → `welcome` → `usps` → `states` → `services` →
  `about` → `howItWorks` (M5) → `testimonials` (M6) → `knowledge` (M7) →
  `faq` (M8).
- A lányok ettől szabadon eltérhetnek (ez a rendszer értelme), de: a blokkok
  admin-leírása jelzi az ajánlott helyet; a szerkesztői útmutató új fejezete
  elmagyarázza a sorrend-logikát; és a PostHog-funnel
  (`$pageview → course_viewed → checkout_started → purchase_confirmed`)
  méri az átrendezések hatását.
- A kód-szintű sorrend-teszt az ALAPÉRTELMEZETT (seed) layoutot asserteli — a
  CMS-beli átrendezés nem teszt-tárgy (az már tartalom).

## 5. Renderelés

- Új `RenderBlocks` komponens: `page.layout` → blokk-típusonként komponens;
  ismeretlen blokk-típus nem dob hibát (dev-warn + kihagyás, a lexical
  serialize mintájára); `visible: false` → kihagyás.
- Adatvezérelt blokkok adatai a `page.tsx`-ben EGYSZER kérdeződnek le
  (`Promise.all`: products, posts, testimonials — ma is így megy), és
  kontextus-objektumként mennek a renderelőnek — blokkonkénti külön query
  nincs (teljesítmény + egyszerűség).
- A `(frontend)` route-group `force-dynamic` marad — nincs cache-invalidálási
  kérdés.
- SEO: a `faq` blokk adja a FAQPage JSON-LD-t (ma statikus); Organization
  JSON-LD marad; sitemap változatlan (a layout nem hoz új URL-t).

## 6. Migráció és seed

- A `pages.layout` blokk-mező táblái (`pages_blocks_*` + verziótáblák) a
  Payload eszközével generált migrációban jönnek létre (`payload migrate:create`
  a bizonyítottan működő helyi Postgresen; kézi migráció-írás tilos).
- Seed (idempotens): Media-képek feltöltése fájlból → kezdőlap-oldal
  `layout`-jának felvétele a 4. pont szerinti alapsorrenddel, a landing VALÓS
  szövegeivel (a 2026-08-08-i landing-szövegek, a koncepció-tükörből);
  csak akkor ír, ha a kezdőlapnak még nincs layoutja.

## 7. Tesztterv

- RenderBlocks: sorrend-hűség, `visible:false` kihagyás, ismeretlen blokk
  túlélése, üres layout → fallback HomeView.
- Blokk-komponensek: render-szintű asserts (renderToStaticMarkup, meglévő
  minta), faq → JSON-LD tartalmi egyezés, courseCards üres terméklista →
  szekció elmarad.
- Seed-layout: az alapsorrend M1–M8-megfelelősége (marker-sorrend teszt a
  seed-fixture-ön), szövegek betűhívsége szúrópróbával.
- Meglévő 472 teszt zöld marad; a kezdőlap-integráció fixture-rel fut.

## 8. Ütemterv az Opus-csapatnak (F-fázisok)

| Fázis | Tartalom | Fájl-tulajdon (fő) |
|---|---|---|
| F1 Backend | blokk-definíciók (`src/blocks/*`), `Pages.layout`, magyar admin, típus-regen | src/blocks/, Pages.ts, payload-types |
| F2a Film+alapok | assetek másolása, fontok self-host, token-bővítés, ScrollScrub-port, filmHero blokk-komponens | public/, styles/tokens+fonts, components/scroll-scrub |
| F2b Szekciók | welcome/usps/states/services/about/pressLogos/faq/ctaBanner komponensek + per-blokk CSS | components/blocks/, styles/blocks/ |
| F3 Bekötés | RenderBlocks, page.tsx layout-ág + fallback, FAQ JSON-LD átállás, meglévő szekciók blokk-változatai (courseCards/freeSos/howItWorks/testimonials/knowledge/credsStrip) | RenderBlocks, page.tsx, HomeView-fallback |
| F4 Tartalom | seed: Media-képek + alap-layout a valós szövegekkel; szerkesztői útmutató új fejezete | seed.ts, docs/ |
| F5 Tesztek | 7. pont szerinti tesztek | src/__tests__/ |
| F6 Review | adverzáriális: tilos-zónák + UX-skill/WCAG/betűhívség | — |
| F7 Javítás | findingok alkalmazása | — |

Zárás (főügynök): migráció generálása, teljes CI-lánc, diff-review, fókuszált
commitok, push, PR-leírás.

## 9. Kockázatok, nyitott kérdések

1. **Repóméret**: +~20 MB asset (film + képek). Elfogadva (a tükör .scratch-a
   már most 46 MB); későbbi Stream-átállás csökkentheti.
2. **Admin-komplexitás**: 16 blokk-típus sok választás a laikusnak → a
   „+ Blokk" lista magyar nevekkel és leírásokkal, az útmutató képernyő-szintű
   fejezettel csökkenti; a seed-elt alap-layout miatt üres lapról indulni
   sosem kell.
3. **Teljesítmény**: 10 MB videó-fetch desktopon a hero betöltésekor — a
   landingen ma is így megy; reduced-motion és mobil külön útvonalon. Mérés
   PostHog-gal (LCP-hatás), szükség esetén később Stream.
4. **A meglévő HomeView-szekciók sorsa**: a blokk-változatok a meglévő
   komponenseket csomagolják (nem duplikálják); a HomeView fallbackként marad,
   amíg a staff élesíti a layoutot — utána is maradhat vészhelyzeti útként.
5. **Egyéb oldalak** (`[slug]`): a layout-mező ott is elérhető lesz (a
   renderer generikus), de a seed csak a kezdőlapra ír layoutot — a többi
   oldal marad richText-alapú, amíg a staff másképp nem dönt.
