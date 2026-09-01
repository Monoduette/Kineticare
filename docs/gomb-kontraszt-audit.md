# Gomb-kontraszt és -állapot audit (WCAG 2.2 AA)

**Készült:** 2026-08-16 · **Hatókör:** a teljes ügyféloldali felület (storefront) minden
gombja, gomb-jellegű eleme és linkje, minden állapotban és minden háttéren.
**Módszer:** statikus CSS-elemzés + a WCAG 2.2 relatív luminancia-képletével SZÁMOLT
kontraszt-arányok (nem becslés) + az élőben kiszolgált CSS ellenőrzése.
**Csak olvasás:** ez a dokumentum kódot nem módosít; minden javaslat javaslat marad
a vezetői jóváhagyásig.

---

## 0. Vezetői összefoglaló

A tulajdonos kérdése — „a gombok különböző állapotában az előtér és a háttér, a gombnak a
betűtípusa, betűszíne és a kijelölés — megvannak-e dupla A (AA) szín-kontrasztban" — a
mérés szerint **az esetek túlnyomó többségében IGEN**. A `tokens.css` fejlécében álló
kontraszt-jegyzőkönyv **minden egyes számát újraszámoltam, és mind a 23 érték pontos**
(lásd 3. fejezet). A gomb-nyelv alapja (elsődleges, másodlagos, szöveges, sötét sávos,
tint sávos, kártyán álló változat) minden állapotban AA felett van.

**Ugyanakkor 12 valós hiányosságot találtam**, ebből **4 normatív WCAG 2.2 AA bukás**,
**3 határeset**, és **5 nem-normatív, de a terméket érdemben rontó hiba**. A négy
normatív bukás közül **kettő minden oldalt érint** (süti-sáv), egy pedig **pontosan a
kezdőlap első Tab-lenyomását** (fejléc a filmsávon).

| # | Súly | Bukás | SC | Mért | Kell | Hol |
|---|---|---|---|---|---|---|
| B1 | **P1** | Fejléc fókuszgyűrűje a filmsávon (fátyol 0…0,44) | 1.4.11 + 2.4.7 | **1,79:1** | 3:1 | kezdőlap, lap teteje |
| B2 | **P1** | Süti-sáv gombjainak fókuszgyűrűje | 1.4.11 + 2.4.7 | **2,87:1** | 3:1 | minden oldal |
| B3 | **P1** | `/kapcsolat` hozzájárulási link (szín ÉS aláhúzás nélkül) | 1.4.1 | **1,00:1** | 3:1 | `/kapcsolat` |
| B4 | **P1** | Süti-sáv eltakarhatja a fókuszált elemet | 2.4.11 | — | — | minden oldal |
| B5 | **P2** | `.kc-auth-alt a` — link csak színnel jelölve | 1.4.1 / G183 | **1,71:1** | 3:1 | `/belepes`, `/regisztracio` |
| B6 | **P2** | `.kc-account__course` — ugyanez | 1.4.1 / G183 | **1,71:1** | 3:1 | `/fiok` |
| B7 | **P2** | Film-hero CTA fókuszgyűrűjének KÜLSŐ éle a filmen | 1.4.11 | **2,06:1** | 3:1 | kezdőlap hero |
| B8 | **P1\*** | Letiltott / „folyamatban" gombok olvashatatlansága | (mentesített) | **2,00–2,16:1** | — | pénztár, minden űrlap |
| B9 | **P2\*** | `--kc-color-info` nincs definiálva → állapotdoboz elveszti a keretét | 1.4.1 közeli | — | — | `/kosar`, `/penztar`, köszönő |
| B10 | **P3** | `.kc-progress-bar--sm` sínje láthatatlan | 1.4.11 | **1,31:1** | 3:1 | lejátszó fejléc |
| B11 | **P3** | `.kc-cart__title` link-affordancia | 1.4.1 | — | — | `/kosar` |
| B12 | **P3** | Kétféle chip-anatómia (44px vs. 36px célfelület) | 2.5.5 (AAA) | — | — | `/kurzusok` |

`*` = a WCAG kifejezetten MENTESÍTI (lásd 7. fejezet), de a szakmai gyakorlat és a saját
UX-skillünk szerint javítandó. A B8 üzleti súlya a legnagyobb az egész listán: **a pénztár
fizetőgombjának felirata addig 2,12:1, amíg a vevő nem pipálja ki az elállási
nyilatkozatot** — és semmi nem mondja meg neki, miért nem működik a gomb.

Ami **NEM bukik** és ezért nem kell hozzányúlni (ellenőrizve, számmal): az összes
`kc-button` variáns alap/hover/aktív állapota minden háttéren, a sötét sávok teljes
gomb-nyelve, a FreeSos akcentsáv gombja, a `cta-banner` inverz gombja, a chipek/pillek,
az űrlapmezők és letiltott mezőik, a badge-ek, a lejátszó alsó akciósávja (beleértve a
`--done` és `--inactive` állapotot), a lábléc és a `::selection`.

---

## 1. Módszer, küszöbök és forráshivatkozások

### 1.1 A számítás

Relatív luminancia és kontraszt-arány a WCAG 2.2 normatív definíciója szerint
(<https://www.w3.org/TR/WCAG22/#dfn-relative-luminance>,
<https://www.w3.org/TR/WCAG22/#dfn-contrast-ratio>). A számoló szkript a scratchpadben
él (a repóba szándékosan nem került be), a `color-mix()` és az `opacity` értékeket
egyszerű sRGB alfa-kompozittal oldottam fel — pontosan úgy, ahogy a böngésző rajzol.

**Önellenőrzés:** a modellem a `layout.css` és a `film-hero.css` fejlécében álló,
korábban filmkockákból mért értékeket **jegyre reprodukálja** (fejlécsáv `veil=0`:
ink 5,13:1; hero-doboz: ink 6,00:1 ≈ 5,90:1 a legsötétebb blokkon). Ez adja a bizalmat a
rétegzett (film + lejtő + fátyol) számokhoz is.

### 1.2 A küszöbök és a pontos sikerkritériumok

| Küszöb | Sikerkritérium | Szint | URL |
|---|---|---|---|
| Szöveg ≥ 4,5:1 (nagy szöveg ≥ 3:1) | **1.4.3 Contrast (Minimum)** | AA | <https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html> |
| Nem-szöveges (UI-komponens, állapot, grafika) ≥ 3:1 | **1.4.11 Non-text Contrast** | AA | <https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html> |
| A jelentést nem csak szín hordozza | **1.4.1 Use of Color** | A | <https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html> |
| Látható fókusz-jelzés | **2.4.7 Focus Visible** | AA | <https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html> |
| A fókuszált elemet nem takarja el a szerzői tartalom | **2.4.11 Focus Not Obscured (Min.)** | AA (2.2 ÚJ) | <https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html> |
| A fókusz-jelzés MÉRETE és kontrasztja | **2.4.13 Focus Appearance** | **AAA** (2.2 ÚJ) | <https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html> |
| Célfelület ≥ 24×24 CSS px | **2.5.8 Target Size (Minimum)** | AA (2.2 ÚJ) | <https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html> |
| Célfelület ≥ 44×44 CSS px | **2.5.5 Target Size (Enhanced)** | AAA | <https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html> |
| Link szín + 3:1 a környező szöveghez + hover/fókusz-jel | **G183 technika** | — | <https://www.w3.org/WAI/WCAG22/Techniques/general/G183> |

> **Pontosítás a feladatkiíráshoz.** A kiírás a „2.4.11 fókusz-megjelenés"-t említi. A
> WCAG 2.2-ben a **2.4.11 neve _Focus Not Obscured (Minimum)_** (a fókuszált elem ne
> legyen eltakarva) — a fókuszgyűrű **megjelenését** a **2.4.13 Focus Appearance** írja
> le, és az **AAA** szintű. A fókuszgyűrű **kontrasztjának AA-szintű követelménye** a
> **1.4.11**-ből jön: az Understanding dokumentum szó szerint kimondja, hogy még ha egy
> vezérlőnek nem is kell látható határa, *„it will still need to have a sufficiently
> contrasting focus indication"*. Ezért az alábbi fókusz-bukásokat **1.4.11 + 2.4.7**
> alatt jelentem, nem 2.4.11 alatt; a 2.4.11-et külön, a takarásra (B4) alkalmazom.

### 1.3 Két W3C-kikötés, ami az audit eredményét érdemben alakítja

**(a) A gombnak nem kell látható HATÁR.** A 1.4.11 Understanding „Boundaries" szakasza:

> *„This success criterion does not require that controls have a visual boundary
> indicating the hit area. If a control has visible content (such as text or a
> sufficiently contrasting icon), which helps users identify the presence of the control,
> then a border or other indication of the overall boundary of the hit area is not
> required… Having a visual boundary indicating the hit area is only required when there
> is no other visual way to identify the presence of the control."*

Ezért a filmsávon álló elsődleges CTA kitöltésének 2,06:1-es aránya a filmkockához
**nem normatív bukás** (a fehér felirat a saját kitöltésén 5,45:1, tehát azonosítja a
vezérlőt) — a W3C ugyanott hozzáteszi, hogy kognitív akadályozottság esetén a határ
kirajzolása **best practice**. Így is jelentem: ajánlás, nem bukás.

**(b) A letiltott komponens mentesített.** 1.4.3 „Incidental": *„Text or images of text
that are part of an inactive user interface component… have no contrast requirement."*
1.4.11: *„User Interface Components that are not available for user interaction (e.g., a
disabled control in HTML) are not required to meet contrast requirements."* Ezért a B8
formálisan nem WCAG-bukás — a 7. fejezetben mutatom meg, miért javítandó mégis.

---

## 2. A vizsgált gomb- és link-készlet (teljes leltár)

| # | Elem | Osztály / forrás | Hol fordul elő |
|---|---|---|---|
| 1 | Elsődleges gomb | `.kc-button--primary` (`styles/ui.css`) | hero, kártya, buybox, űrlapok, pénztár |
| 2 | Másodlagos gomb | `.kc-button--secondary` | hero, hibaoldal, „megvetted" CTA |
| 3 | Szöveges (ghost) gomb | `.kc-button--ghost` | másodlagos utak |
| 4 | Fejléc CTA-pirula | `.kc-site-header__cta` (`styles/layout.css`) | minden oldal, sticky sáv |
| 5 | Fejléc wordmark + akcent-tag | `.kc-site-header__brand(-accent)` | minden oldal |
| 6 | Desktop menülink + lenyitó | `.kc-nav-desktop__link/__toggle/__sublink` | ≥ 900px |
| 7 | Hamburger + drawer-linkek | `.kc-nav-mobile__toggle/__link/__sublink` | < 900px |
| 8 | Film-hero CTA-k | `.kc-film-hero__cta`, `--quiet` (`blocks/film-hero.css`) | kezdőlap |
| 9 | ScrollScrub fejezet-gombok | `.scroll-scrub__route-button` | csak > 1 jelenetnél (ma nem renderelődik) |
| 10 | FreeSos sáv-CTA | `.kc-free-sos__cta` (`blocks/free-sos.css`) | kezdőlap ingyenes sáv |
| 11 | CTA-sáv gomb | `.kc-cta-banner__action .kc-button--primary` (`blocks/cta-banner.css`) | CMS-szekció |
| 12 | Kurzuskártya CTA (dekoráció) | `.kc-product-card__cta` (`blocks/course-cards.css`) | kezdőlap kártyák |
| 13 | Mobil vásárlósáv | `.kc-course-buybar` + `.kc-button` (`kurzusok/kurzusok.css`) | kurzusoldal < 1024px |
| 14 | Kurzus-buybox CTA + szöveglink | `.kc-course-cta`, `.kc-course-textlink` | kurzusoldal |
| 15 | Chip / pill (2 anatómia) | `.kc-category-filter__chip`, `.kc-course-filter__chip`, `.kc-course-jump__chip` | blog, kurzusok |
| 16 | Badge (részben link) | `.kc-badge--*` (`styles/ui.css`) | kártya, poszt-fej |
| 17 | Űrlapgombok + mezők | `.kc-field__*` + `Button` | `/belepes` (admin-belépés), `/regisztracio`, `/kapcsolat`, `/penztar`, hírlevél |
| 18 | Süti-sáv gombjai | `ConsentBanner.tsx` (inline stílus) | minden oldal, első látogatás + visszavonás |
| 19 | Süti-beállítások gomb | `.kc-site-footer__legal button` | lábléc |
| 20 | Előnézeti sáv kilépője | `.kc-preview-bar__exit` (`styles/content.css`) | draft mód |
| 21 | Lejátszó akciósáv | `.kc-player-actions__previous/__primary(--done/--inactive)` | `/kurzusaim/[id]` |
| 22 | Lejátszó rail gombjai | `.kc-player-rail__module-button/__lesson-button` | lejátszó |
| 23 | Lejátszó panel-gombok | `.kc-player__rail-toggle/__rail-close/__back` | lejátszó mobil |
| 24 | Szöveges linkek | `.kc-text-link`, `.kc-richtext a`, `.kc-site-footer__legal a`, `.kc-auth-alt a` | mindenhol |
| 25 | Kijelölés | `::selection` (`styles/base.css`) | mindenhol |
| 26 | Haladás-jelzők | `.kc-progress-bar(--sm)`, `.kc-progress-ring` (`styles/progress.css`) | lejátszó, kurzusaim |

**Payload admin felület (`/admin`):** kívül esik ezen az auditon — nem a mi vizuális
rendszerünk (a `tipografia-harom-meret` őr-teszt is kizárja). Külön, saját kör kell hozzá.

---

## 3. A token-jegyzőkönyv hitelesítése

A `tokens.css` 57–94. sorában álló kontraszt-jegyzőkönyv **mind a 23 értéke helyes**
(saját újraszámolás, kerekítési eltérés nélkül):

| Párosítás | Jegyzőkönyv | Újraszámolt | Egyezik |
|---|---|---|---|
| ink `#10243e` / paper `#f6f9fc` | 14,79:1 | 14,79:1 | ✓ |
| ink / fehér | 15,63:1 | 15,63:1 | ✓ |
| ink / tint `#e6f0f8` | 13,53:1 | 13,53:1 | ✓ |
| ink-soft `#33495f` / paper · fehér · tint | 8,80 · 9,30 · 8,05 | 8,80 · 9,30 · 8,05 | ✓ |
| accent-deep `#2f6e9f` / paper · fehér · tint | 5,16 · 5,45 · 4,72 | 5,16 · 5,45 · 4,72 | ✓ |
| fehér / accent-deep (elsődleges gomb) | 5,45:1 | 5,45:1 | ✓ |
| fehér / accent-deeper `#275c87` (hover) | 7,08:1 | 7,08:1 | ✓ |
| accent-deeper / paper | 6,70:1 | 6,70:1 | ✓ |
| fehér / ink (sötét szekció) | 15,63:1 | 15,63:1 | ✓ |
| accent-quiet `#9ec4df` / ink | 8,49:1 | 8,49:1 | ✓ |
| hairline-strong `#6b7f94` / fehér · paper · tint | 4,13 · 3,91 · 3,57 | 4,13 · 3,91 · 3,57 | ✓ |
| **AKCENT-KORLÁT:** accent `#3d78aa` / tint · paper · fehér | 4,07 · 4,45 · 4,70 | 4,07 · 4,45 · 4,70 | ✓ |
| accent-deep / ink (miért vált fehérre a gyűrű) | 2,87:1 | 2,87:1 | ✓ |

**Az akcent-korlát betartva.** Végigellenőriztem az összes `var(--kc-color-accent)`
használatot: `.kc-eyebrow::after` (vonal), `.kc-product-card__tick` (redundáns pipa-ikon
szöveg mellett), `.kc-card--interactive:hover` és `.kc-course-module:hover` keret,
`.kc-player-rail__lesson-button--active` csík, `.kc-creds__dot`, film-hero gradiens.
**Egyik sem hordoz szöveget**, és a nem-szöveges küszöböt mind teljesíti (a legszorosabb
az aktív lecke csíkja a tinten: **4,07:1** ≥ 3:1 ✓).

**Állapotszínek (mind AA):** danger 5,72 · success 6,35 · warning 5,38 a saját
felületén; a paperen 6,19 / 6,75 / 5,61. A színes dobozok FELÜLETE önmagában halk
(1,04–1,08:1 a paperhez), de mindegyik **1px-es, telített keretet visel** (5,61–6,75:1),
tehát a doboz határa érzékelhető ✓ — kivéve, ahol a keret elveszik (**B9**).

---

## 4. Teljes állapot-mátrix

Jelmagyarázat: **T** = szöveg-küszöb (1.4.3, 4,5:1), **N** = nem-szöveges küszöb
(1.4.11, 3:1). A gomb-felirat MINDIG az M lépcső (16–18,16 px), tehát **sosem minősül
„nagy szövegnek"** — a 3:1-es könnyítés a gombokra sehol nem áll (lásd 8. fejezet).

### 4.1 `kc-button` — a három alapváltozat, minden állapot × minden háttér

| Elem | Állapot | Előtér | Háttér | Arány | Küszöb | ✓ |
|---|---|---|---|---|---|---|
| primary | alap | fehér `#ffffff` | accent-deep `#2f6e9f` | **5,45:1** | T 4,5 | ✓ |
| primary | hover | fehér | accent-deeper `#275c87` | **7,08:1** | T 4,5 | ✓ |
| primary | active (= hover) | fehér | accent-deeper | **7,08:1** | T 4,5 | ✓ |
| primary | kitöltés / paper (határ) | accent-deep | paper | **5,16:1** | N 3 | ✓ |
| primary | kitöltés / fehér kártyán | accent-deep | fehér | **5,45:1** | N 3 | ✓ |
| primary | kitöltés / tint sávon | accent-deep | tint | **4,72:1** | N 3 | ✓ |
| primary | kitöltés / danger-doboz | accent-deep | `#fdecea` | **4,77:1** | N 3 | ✓ |
| primary | kitöltés / success-doboz | accent-deep | `#e8f5ec` | **4,86:1** | N 3 | ✓ |
| primary | **disabled** (opacity .5, paperen) | `#fafcfe` | `#92b4ce` | **2,12:1** | — (mentes) | ⚠ B8 |
| primary | **disabled** (fehér kártyán) | `#ffffff` | `#97b6cf` | **2,12:1** | — (mentes) | ⚠ B8 |
| primary | **disabled** (tint sávon) | `#f2f8fc` | `#8aafcc` | **2,16:1** | — (mentes) | ⚠ B8 |
| primary | **disabled** (sötét sávon) | — | — | **2,97:1** | — (mentes) | ⚠ B8 |
| primary | fókusz (gyűrű / paper) | accent-deep | paper | **5,16:1** | N 3 | ✓ |
| secondary | alap (felirat + 2px keret) | ink | paper | **14,79:1** | T 4,5 / N 3 | ✓ |
| secondary | hover (invertál) | fehér | ink | **15,63:1** | T 4,5 | ✓ |
| secondary | hover kitöltés / paper | ink | paper | **14,79:1** | N 3 | ✓ |
| secondary | **disabled** (paperen) | `#838e9d` | paper | **3,14:1** | — (mentes) | ⚠ B8 |
| secondary | sötét sáv, alap | fehér | ink | **15,63:1** | T 4,5 / N 3 | ✓ |
| secondary | sötét sáv, hover | ink | fehér | **15,63:1** | T 4,5 | ✓ |
| secondary | sötét sáv, disabled | `#88929e` | ink | **4,95:1** | — (mentes) | ✓ (véletlen) |
| ghost | alap | accent-deep | paper | **5,16:1** | T 4,5 | ✓ |
| ghost | alap tint sávon | accent-deep | tint | **4,72:1** | T 4,5 | ✓ |
| ghost | hover | ink | paper | **14,79:1** | T 4,5 | ✓ |
| ghost | sötét sáv, alap | fehér | ink | **15,63:1** | T 4,5 | ✓ |
| ghost | sötét sáv, hover | accent-quiet | ink | **8,49:1** | T 4,5 | ✓ |
| ghost | **disabled** (paperen) | `#92b4ce` | paper | **2,06:1** | — (mentes) | ⚠ B8 |
| ghost | aláhúzás (1.4.1 jelölő) | — | — | van | 1.4.1 | ✓ |

A ghost gomb kiemelendő pozitívum: **az aláhúzás a formája**, tehát a linkjellegét nem
csak a szín hordozza (1.4.1 ✓), és `.kc-richtext a.kc-button:not(.kc-button--ghost)`
kifejezetten megőrzi ezt a kivételt.

### 4.2 Fejléc — a fátyol (`--kc-header-veil`) MINDEN állásában, a filmsáv fölött

A kezdőlapon a sticky fejléc alatt a film gördül. A legsötétebb filmblokk a fejlécsávban
`rgb(34,49,62)`; a film-hero felső lejtője legalább 0,50 lap-háttér-fedést ad, erre jön a
fejléc saját fátyla. **veil = 1 nem szolid paper:** a `::before` 72% lap-fedés plusz
`backdrop-filter` (fagyott üveg). A korábbi réteg-`opacity` a blurrt is kifakította.

| veil | kompozit háttér | ink szöveg (T) | wordmark-tag (T) | CTA-pirula határa (N) | CTA-felirat (T) | **fókuszgyűrű (N)** |
|---|---|---|---|---|---|---|
| 0,00 | `#8c959d` | 5,13 ✓ | 5,13 ✓ | 5,13 ✓ | 15,63 ✓ | kevert gyűrű 5,13 ✓ |
| 0,25 | `#9fa7ae` | 6,41 ✓ | 5,36 ✓ | 5,06 ✓ | 12,35 ✓ | 5,06 ✓ |
| 0,50 | `#b2b9bf` | 7,88 ✓ | 5,40 ✓ | 4,73 ✓ | 9,38 ✓ | 4,73 ✓ |
| 0,75 | `#c5cbd0` | 9,54 ✓ | 5,32 ✓ | 4,32 ✓ | 7,08 ✓ | 4,32 ✓ |
| 1,00 | `#d8dde1` | 11,42 ✓ | 5,17 ✓ | 3,98 ✓ | 5,45 ✓ | 3,98 ✓ |

A fókuszgyűrű a fátyollal arányos `color-mix(focus, veil, ink)`: veil = 0-nál ink
(`#10243e`) a filmsávon 5,13:1. A **fix** `accent-deep` gyűrű továbbra is bukna a
lap tetején (1,79:1); ezt a G-K2 őr tartja. Belső oldalon a sáv paper fölött ül
(ink 14,79:1); a fagyás ott a mögöttes tartalom blurrjából látszik.

*A 4.2 táblázat 2026-09-01-jén a 72%-os fagy-fedésre lett újraszámolva.*

### 4.3 Film-hero gombok (kezdőlap, a filmkockán)

A hero-szövegdoboz alatti legsötétebb blokk `rgb(1,0,0)`, a bal lejtő 0,64 fedéssel →
kompozit `#9e9fa1`.

| Elem | Állapot | Előtér | Háttér | Arány | Küszöb | ✓ |
|---|---|---|---|---|---|---|
| CTA #1 (primary) | felirat | fehér | accent-deep kitöltés | **5,45:1** | T 4,5 | ✓ |
| CTA #1 | kitöltés / film | accent-deep | `#9e9fa1` | **2,06:1** | N 3 (határ) | ⚠ ajánlás (1.3a) |
| CTA #2 (`--quiet`) | felirat | ink | fehér lap | **15,63:1** | T 4,5 | ✓ |
| CTA #2 | 2px ink keret / film | ink | `#9e9fa1` | **5,90:1** | N 3 | ✓ |
| CTA #2 | hover lap (tint) / film | tint | `#9e9fa1` | 2,29:1 | N 3 (határ) | ✓ (a keret azonosít) |
| mindkettő | fókuszgyűrű BELSŐ éle | accent-deep | fehér haló | **5,45:1** | N 3 | ✓ |
| mindkettő | fókuszgyűrű KÜLSŐ éle | accent-deep | `#9e9fa1` | **2,06:1** | N 3 | ⚠ **B7** |
| hero cím / bevezető | — | ink | `#9e9fa1` | **5,90:1** | T 4,5 | ✓ |
| tag-pirulák | felirat | navy-900 | 60% fehér pirula | **11,09:1** | T 4,5 | ✓ (nem interaktív) |
| ScrollScrub route-gomb | alap | navy-900 | `#a2aab1` | 4,72:1 | T 4,5 | ✓ (latens) |
| ScrollScrub route-gomb | **fókuszgyűrű** | accent-deep | `#a2aab1` | **1,64:1** | N 3 | ⚠ latens (lásd 9.) |

A `--quiet` gomb tömör fehér lapja + 2px ink kerete **mintapéldás megoldás**: a keret
5,90:1-gyel azonosítja a vezérlőt a legrosszabb filmkockán is. A fehér haló
(`box-shadow: 0 0 0 6px white`) szintén tudatos és jó — csak a rétegsorrend hagyja a
gyűrű külső élét fedetlenül (B7).

### 4.4 Sáv- és szekció-gombok

| Elem | Állapot | Előtér | Háttér | Arány | Küszöb | ✓ |
|---|---|---|---|---|---|---|
| FreeSos CTA | alap (2px fehér keret) | fehér | accent-deep sáv | **5,45:1** | T 4,5 / N 3 | ✓ |
| FreeSos CTA | hover (invertál) | accent-deep | fehér | **5,45:1** | T 4,5 | ✓ |
| FreeSos CTA | fókuszgyűrű (felülírva fehérre) | fehér | accent-deep sáv | **5,45:1** | N 3 | ✓ |
| FreeSos badge | alap | fehér | átlátszó + fehér keret | **5,45:1** | T 4,5 | ✓ |
| FreeSos CTA | **disabled** | `#97b6cf`-szerű | sáv | **2,57:1** | — (mentes) | ⚠ B8 |
| CTA-sáv (sötét) | gomb | navy-900 | fehér kitöltés | **15,69:1** | T 4,5 | ✓ |
| CTA-sáv (sötét) | gomb hover | navy-900 | blue-100 `#ebf7ff` | **14,41:1** | T 4,5 | ✓ |
| CTA-sáv (sötét) | gomb / sáv (határ) | fehér | navy-900 | **15,69:1** | N 3 | ✓ |
| CTA-sáv (sötét) | fókuszgyűrű (felülírva) | fehér | navy-900 | **15,69:1** | N 3 | ✓ |
| CTA-sáv (világos) | cím | navy-900 | paper | **14,85:1** | T 3 (nagy) | ✓ |
| Kurzuskártya CTA | alap / hover | fehér | accent-deep / -deeper | **5,45 / 7,08** | T 4,5 | ✓ |
| Mobil vásárlósáv | CTA | fehér | accent-deep | **5,45:1** | T 4,5 | ✓ |
| Mobil vásárlósáv | ár | ink | fehér sáv | **15,63:1** | T 4,5 | ✓ |
| Mobil vásárlósáv | felső keret | hairline | fehér | 1,31:1 | N 3 (dekor) | ✓ (árnyék + pozíció azonosít) |
| Kurzus szöveglink | alap / hover | accent-deep / ink | paper | **5,16 / 14,79** | T 4,5 | ✓ |

`cta-banner.css` megjegyzés: ez az egyetlen lap, amely még **legacy nyers tokeneket**
(`--kc-color-navy-900`, `--kc-color-blue-100/200`) használ SZEREPBEN, szemben a
`tokens.css` 17–20. sorának tiltásával. Kontraszt szempontból mind AA felett (12,54–15,69:1),
tehát **nem bukás** — de arculati adósság, egy külön körben visszavezetendő
`ink` / `surface-tint` / `on-dark` szerep-tokenekre.

### 4.5 Navigáció, chipek, badge-ek

| Elem | Állapot | Előtér | Háttér | Arány | Küszöb | ✓ |
|---|---|---|---|---|---|---|
| Desktop menülink | alap | ink | paper (veil=1) | **14,79:1** | T 4,5 | ✓ |
| Desktop menülink | hover / focus-within | accent-deeper | paper | **6,70:1** | T 4,5 | ✓ |
| Desktop menülink | hover jelölő | aláhúzás 2px | — | van | 1.4.1 | ✓ |
| Almenü-link | hover | accent-deeper | tint | **6,13:1** | T 4,5 | ✓ |
| Almenü panel | határ | hairline | fehér | 1,31:1 | N 3 | ⚠ dekor (árnyék `--kc-shadow-md` azonosít) |
| Lenyitó nyíl | nyitva/csukva | forgatás 180° | — | alak | 1.4.1 | ✓ |
| Hamburger | hover | accent-deeper | tint korong | **6,13:1** | T 4,5 | ✓ |
| Drawer-link | alap / hover | ink / accent-deeper | fehér / tint | **15,63 / 6,13** | T 4,5 | ✓ |
| Drawer fátyol | — | `rgb(16 36 62 / .5)` | — | — | — | ✓ |
| Chip (blog) | alap | ink | fehér + `#6b7f94` keret | **15,63 / 4,13** | T / N | ✓ |
| Chip | hover | accent-deep felirat + keret | fehér | **5,45:1** | T 4,5 | ✓ |
| Chip | **aktív** | fehér | accent-deep kitöltés | **5,45:1** | T 4,5 | ✓ |
| Chip | aktív kitöltés / paper | accent-deep | paper | **5,16:1** | N 3 | ✓ |
| Chip | aktív jelölő | `aria-current` + kitöltés | — | szemantika + alak | 1.4.1 | ✓ |
| Ugrás-chip | hover | ink | tint + accent-deep keret | **13,53 / 4,72** | T / N | ✓ |
| Badge neutral / info | — | ink | tint / accent-quiet | **13,53 / 8,49** | T 4,5 | ✓ |
| Badge success / warning / danger | — | saját szín | saját felület | **6,35 / 5,38 / 5,72** | T 4,5 | ✓ |

### 4.6 Űrlapok (`/belepes` = admin-belépés, `/regisztracio`, `/kapcsolat`, `/penztar`, hírlevél)

| Elem | Állapot | Előtér | Háttér | Arány | Küszöb | ✓ |
|---|---|---|---|---|---|---|
| Mező | alap keret | hairline-strong `#6b7f94` | fehér | **4,13:1** | N 3 | ✓ |
| Mező | keret a paperen / tinten | hairline-strong | paper / tint | **3,91 / 3,57** | N 3 | ✓ |
| Mező | hover keret | accent-deep | fehér | **5,45:1** | N 3 | ✓ |
| Mező | fókusz (keret + 3px halo) | accent-deep + `rgb(47 110 159 / .3)` | fehér | **5,45:1** | N 3 | ✓ |
| Mező | placeholder (opacity .8) | tényleges `#5c6d7f` | fehér | **5,32:1** | T 4,5 | ✓ |
| Mező | **disabled** | ink felirat | tint háttér | **13,53:1** | T 4,5 | ✓ |
| Mező | disabled keret | hairline-strong | tint | **3,57:1** | N 3 | ✓ |
| Mező | hiba keret | danger | fehér | **6,54:1** | N 3 | ✓ |
| Mező | hiba jelölő | ikon + szöveg + `aria-invalid` | — | nem csak szín | 1.4.1 | ✓ |
| Hibaüzenet | — | danger | paper | **6,19:1** | T 4,5 | ✓ |
| Hiba-összefoglaló doboz | keret | danger | paper | **6,19:1** | N 3 | ✓ |
| Címke `.kc-field__label` | — | ink | paper | **14,79:1** | T 4,5 | ✓ |
| Súgó `.kc-field__hint` | — | ink-soft | paper | **8,80:1** | T 4,5 | ✓ |
| Checkbox | accent-color | accent-deep | — | (natív) | N 3 | ✓ |
| Checkbox | fókusz | accent-deep 2px | paper | **5,16:1** | N 3 | ✓ |
| Submit gomb | alap | fehér | accent-deep | **5,45:1** | T 4,5 | ✓ |
| Submit gomb | **„folyamatban" (`disabled`)** | `#fafcfe` | `#92b4ce` | **2,12:1** | — (mentes) | ⚠ **B8** |
| Submit gomb | **letiltott, míg nincs pipa (pénztár)** | `#fafcfe` | `#92b4ce` | **2,12:1** | — (mentes) | ⚠ **B8** |

### 4.7 Süti-sáv (`ConsentBanner`) — minden oldalon, minden első látogatónál

| Elem | Állapot | Előtér | Háttér | Arány | Küszöb | ✓ |
|---|---|---|---|---|---|---|
| Sáv törzsszöveg | — | fehér | ink sáv | **15,63:1** | T 4,5 | ✓ |
| „adatvédelmi tájékoztató" link | — | accent-quiet + aláhúzás | ink sáv | **8,49:1** | T 4,5 / 1.4.1 | ✓ |
| „Elfogadom" | alap | ink | fehér kitöltés | **15,63:1** | T 4,5 | ✓ |
| „Elfogadom" | kitöltés / sáv | fehér | ink | **15,63:1** | N 3 | ✓ |
| „Elutasítom" | alap | fehér | átlátszó + 2px fehér keret | **15,63:1** | T 4,5 / N 3 | ✓ |
| mindkettő | hover | (nincs hover-stílus) | — | — | — | ⚠ apró (lásd 9.) |
| **mindkettő** | **fókusz** | **accent-deep** | **ink sáv** | **2,87:1** | N 3 | ✗ **B2** |
| a sáv maga | takarás | fixed, `z-index: 1000`, nincs `scroll-padding-bottom` | — | — | 2.4.11 | ✗ **B4** |

### 4.8 Lejátszó (`/kurzusaim/[id]`) — a legjobban megoldott felület

| Elem | Állapot | Előtér | Háttér | Arány | Küszöb | ✓ |
|---|---|---|---|---|---|---|
| „Előző" gomb | alap | ink | paper + `#6b7f94` keret | **14,79 / 3,91** | T / N | ✓ |
| „Előző" | hover | ink | tint | **13,53:1** | T 4,5 | ✓ |
| Elsődleges | alap / hover | fehér | accent-deep / -deeper | **5,45 / 7,08** | T 4,5 | ✓ |
| Elsődleges | **`--inactive`** (aria-disabled) | ink-soft | fehér + `#6b7f94` keret | **9,30 / 3,91** | T 4,5 / N 3 | ✓ **kiváló** |
| Elsődleges | **`--done`** | success | success-surface + success keret | **6,35 / 6,75** | T 4,5 / N 3 | ✓ **kiváló** |
| Rail modul-gomb | alap / hover | ink | fehér / tint | **15,63 / 13,53** | T 4,5 | ✓ |
| Rail lecke | **aktív** | ink 700 + accent csík + `aria-current` | tint | **13,53 / 4,07** | T / N / 1.4.1 | ✓ **kiváló** |
| Rail lecke | **disabled** (natív) | ink-soft | fehér | **9,30:1** | — | ✓ **kiváló** |
| Rail állapotjel | nincs kész / kész | `#6b7f94` / success | fehér | **4,13 / 7,13** | N 3 | ✓ |
| Videó felett | fókuszgyűrű (felülírva) | fehér | ink | **15,63:1** | N 3 | ✓ |
| Videó-hibaüzenet | — | fehér / accent-quiet | sötét felület | **15,63 / 8,49** | T 4,5 | ✓ |
| Panel-nyitó / bezáró | alap | ink | fehér + `#6b7f94` keret | **15,63 / 4,13** | T / N | ✓ |
| Haladás-sáv (nagy) | kitöltés / sín | accent-deep | hairline sín | **4,15:1** | N 3 | ✓ |
| Haladás-sáv (nagy) | sín kerete | hairline-strong | paper | **3,91:1** | N 3 | ✓ |
| **Haladás-sáv `--sm`** | **sín / fehér fejléc** | hairline | fehér | **1,31:1** | N 3 | ✗ **B10** |
| Haladás-kör | kitöltés / sín | accent-deep | hairline | **4,15:1** | N 3 | ✓ |
| Haladás-kör tokja | keret | hairline-strong | fehér | **4,13:1** | N 3 | ✓ **kiváló** (kiszámíthatatlan fotón is) |

A `PlayerActions` `aria-disabled` + kattintás-kapu megoldása (nem natív `disabled`) a
**helyes minta**: a fókusz nem esik le a gombról, a felirat olvasható marad, és a
`--done` állapot pozitív visszajelzés, nem „elromlott" szürke gomb. **Ezt kell a
`kc-button` letiltott állapotára is átvinni** (lásd 7.4).

### 4.9 Sötét szekciók — a `color-mix()`-szel előálló futásidejű színek

Ezeket ténylegesen kikevertem (nem becslés):

| Réteg | Kikevert érték | Kontrasztja | Küszöb | ✓ |
|---|---|---|---|---|
| `states__text` (on-dark 78% + ink) | `#cacfd5` | 9,97:1 az inken | T 4,5 | ✓ |
| közös elválasztó vonal (on-dark 35%) | `#647182` | 3,14:1 az inken | N 3 | ✓ |
| `services` akcentvonal (on-dark 55%) | `#939ca8` | 5,63:1 | N 3 | ✓ |
| `testimonials` idézőjel (on-dark 45%) | `#7c8795` | 4,28:1 | N 3 | ✓ |
| `usps` korong (on-dark 14%) | `#314359` | 1,55:1 a sávhoz | N 3 | ⚠ felület, nem UI-komponens — felirat rajta 5,49:1 ✓ |
| `about` feature-korong (on-dark 10%) | `#283a51` | 1,35:1 | N 3 | ⚠ ua.; felirat 6,29:1 ✓ |
| `team` kártya (on-dark 8%) | `#23364d` | 1,27:1 | N 3 | ✓ (a 35%-os keret azonosít) |
| `accordion` hover-sáv (on-dark 8%) | `#23364d` | 1,27:1 | — | ⚠ gyenge hover-jelzés (nem SC-bukás) |

**Sötét sávon a fókusz mindenhol felül van írva fehérre** (`.kc-section--dark
:focus-visible`, `.kc-preview-bar__exit`, `.kc-player__media`, `.kc-free-sos`,
`.kc-cta-banner`) — **egyetlen kimaradt hely a süti-sáv (B2)**, mert az nem
`.kc-section--dark` leszármazottja, hanem a `layout.tsx` közvetlen gyereke.

### 4.10 Kijelölés és egyéb

| Elem | Előtér | Háttér | Arány | Küszöb | ✓ |
|---|---|---|---|---|---|
| `::selection` (globális) | ink | accent-quiet `#9ec4df` | **8,49:1** | T 4,5 | ✓ |
| `::selection` sötét sávon (ua. szabály) | ink | accent-quiet | **8,49:1** | T 4,5 | ✓ |
| `::selection` a filmsávon | ink | accent-quiet | **8,49:1** | T 4,5 | ✓ |
| Előnézeti sáv kilépő | fehér + aláhúzás | ink / accent-deeper | **15,63 / 7,08** | T 4,5 | ✓ |
| Lábléc jogi linkek | ink + aláhúzás | paper | **14,79:1** | T 4,5 / 1.4.1 | ✓ |
| „Süti-beállítások" gomb | ink + aláhúzás | paper | **14,79:1** | T 4,5 / 1.4.1 | ✓ |
| Lábléc óriás link | ink + 2px aláhúzás | paper | **14,79:1** | T 3 (nagy) | ✓ |
| Hírlevél consent-link | ink + aláhúzás | paper | **14,79:1** | T 4,5 / 1.4.1 | ✓ |

A `::selection` **egyetlen, globális szabály**, és mindhárom földön (paper, fehér, ink)
8,49:1-et ad, mert a kijelölés a saját hátterét is átfesti. **Ez helyes** — de azt
jelenti, hogy a sötét sávon kijelölt szöveg világos alapra vált; szándékos, jelezni való
tervezői döntés, nem hiba.

---

## 5. A BUKÓ esetek — okok és konkrét javítások

### B1 · P1 — A fejléc fókuszgyűrűje a filmsávon (1,79:1)

**SC:** 1.4.11 (a fókusz-jelzésnek kontrasztosnak kell lennie) + 2.4.7.
**Fájl:** `src/app/(frontend)/styles/base.css:130` (globális gyűrű) ×
`src/app/(frontend)/styles/layout.css:80` (átlátszó fejléc).
**Miért történt:** a `layout.css` levezetése helyesen ismerte fel, hogy a KÖZÉPTÓNUSÚ
akcentszínek a részleges fátylon beesnek, és a wordmark-tagot meg a CTA-pirulát
`color-mix()`-szel a fátyolhoz kötötte. **A fókuszgyűrű ugyanilyen középtónus, de fix
maradt.** A gyűrű `accent-deep` = `#2f6e9f`, a kompozit `veil=0`-n `#8c959d` — a kettő
világossága majdnem azonos.

**Javaslat (a meglévő minta kiterjesztése, arculati változás nélkül):**

```css
/* styles/layout.css — a fejléc saját fókusz-színe, a fátyollal ARÁNYOSAN.
   veil = 0 → ink (a filmen 5,13:1) · veil = 1 → accent-deep (a paperen 5,16:1). */
.kc-site-header :focus-visible {
  outline-color: color-mix(
    in srgb,
    var(--kc-color-focus) calc(var(--kc-header-veil, 0) * 100%),
    var(--kc-color-ink)
  );
}
```

**Mért eredmény a javítás után:** veil 0,00 → **5,13:1** · 0,25 → 5,49 · 0,50 → 5,50 ·
0,75 → 5,33 · 1,00 → 5,16. **Minden állásban ≥ 3:1**, és a lap többi részén semmi nem
változik. (Elvetett alternatíva: fix fehér gyűrű — az a `veil ≥ 0,25`-nél 2,25:1-re esik.)

### B2 · P1 — A süti-sáv gombjainak fókuszgyűrűje (2,87:1)

**SC:** 1.4.11 + 2.4.7. **Fájl:** `src/components/analytics/ConsentBanner.tsx:31–91`.
**Miért történt:** a sáv `--kc-color-surface-dark` (ink) hátterű, de NEM
`.kc-section--dark` — a `ui.css:62` fehérre váltó felülírása így nem éri el. A globális
`accent-deep` gyűrű az inken pontosan az az 2,87:1, amiről a `tokens.css:112` sora
maga írja, hogy „az accent-deep az inken csak 2,87:1".

**Javaslat:** a sávnak adjunk osztályt (vagy a meglévő inline-stílus mellé egy
`consent-banner.css`-t), és írjuk felül a gyűrűt:

```css
/* A sáv ink felületén az akcent-mély gyűrű 2,87:1 — fehérre vált (15,63:1). */
.kc-consent-banner :focus-visible {
  outline-color: var(--kc-color-focus-on-dark);
  outline-offset: 2px;
}
/* Az „Elfogadom" gomb FEHÉR kitöltésű: a fehér gyűrű ott elveszne,
   ezért a 2px-es offset ink-sávja adja az elválasztást (ink/fehér 15,63:1). */
```

**Mért eredmény:** fehér gyűrű az ink sávon **15,63:1** ✓. A fehér gombon a gyűrű és a
gomb közt a 2px offset az ink sávot mutatja (15,63:1 mindkét oldalon) ✓.

**Ugyanez a hiányzó felülírás fenyeget** minden jövőbeli sötét, `kc-section`-ön kívüli
rétegnél — ezért javaslom az őr-teszt **G-K3** szabályát (11. fejezet).

### B3 · P1 — `/kapcsolat`: a hozzájárulási link láthatatlan (1,00:1)

**SC:** 1.4.1 (és gyakorlatilag 2.4.4 is sérül: a link nem azonosítható).
**Fájl:** `src/app/(frontend)/kapcsolat/_components/ContactForm.tsx:263` +
`kapcsolat/kapcsolat.css` (nincs link-szabály).
**Mit mértem:** a `.kc-contact-form__consent-label` szín nélkül örökli az `ink`-et; a
`base.css:116` `a { color: var(--kc-color-link) }` szintén `ink`, `text-decoration: none`.
Tehát az „Adatkezelési és adatvédelmi szabályzatban" link **azonos színű, azonos
metszetű, aláhúzatlan** a körülötte lévő mondattal → **megkülönböztetés 1,00:1**, semmilyen
nem-szín jelölő nélkül. GDPR-szempontból is rossz: a jogi tájékoztató elérhetetlen.

**Javaslat** (a hírlevél-űrlapon már MEGLÉVŐ mintát másolja — `layout.css:797`):

```css
/* kapcsolat/kapcsolat.css */
.kc-contact-form__consent-label a {
  color: var(--kc-color-text);          /* ink — 14,79:1 a paperen */
  text-decoration: underline;
  text-underline-offset: 0.25em;
}
.kc-contact-form__consent-label a:hover {
  color: var(--kc-color-link-hover);    /* accent-deep — 5,16:1 */
}
```

### B4 · P1 — A süti-sáv eltakarhatja a fókuszált elemet

**SC:** 2.4.11 Focus Not Obscured (Minimum) — WCAG 2.2 ÚJ, AA.
**Fájl:** `ConsentBanner.tsx:31` (`position: fixed; bottom: 0; z-index: 1000`).
**Mit találtam:** a repó példásan kezeli a sticky fejlécet (`base.css`
`scroll-padding-top`) és a mobil vásárlósávot (`.kc-has-buybar` →
`scroll-padding-bottom`), **de a süti-sávra nincs semmilyen kompenzáció**. A sáv
mobilon 2–3 sornyi szöveg + két gomb → 120–180 px magas; Tab-bal a lap alja felé haladva
egy 44 px-es vezérlő **teljesen eltűnhet** mögötte. Ráadásul a `z-index: 1000` a mobil
vásárlósáv (40) és a lejátszó akciósávja (10) FÖLÉ kerül, tehát a kurzusoldal
fizetőgombját is takarja.

**Javaslat (a `.kc-has-buybar` mintája szerint):**

```css
/* amíg a süti-sáv látszik, a gyökér kap alsó görgetési párnát */
.kc-has-consent-banner { scroll-padding-bottom: 12rem; }
.kc-has-consent-banner body { padding-bottom: 12rem; }
```

A `kc-has-consent-banner` osztályt a `ConsentBanner` teszi a `documentElement`-re,
ugyanúgy, ahogy a `MobileBuyBar` teszi a `kc-has-buybar`-t. Kiegészítés: a sáv kapjon
`role="dialog"` + fókusz-elvitelt megnyitáskor (a GDPR-döntés modális jellegű), így a
takarás kérdése el is tűnik.

### B5 / B6 · P2 — Link csak színnel jelölve (1,71:1)

**SC:** 1.4.1, G183 technika. **Fájl:** `auth.css` (`.kc-auth-alt a { color: primary }`),
`account.css` (`.kc-account__course { color: primary; font-weight: bold }`).
**Mit mértem:** az `accent-deep` (#2f6e9f) és a környező `ink-soft` (#33495f) szöveg
között **1,71:1** — a G183 3:1-es küszöbe alatt. Aláhúzás alapállapotban nincs (csak
hoveren, a `base.css` `a:hover` szabályából). Érintett mondatok: „Már van fiókod? **Lépj
be**", „Még nincs fiókod? **Regisztrálj** · **Elfelejtetted a jelszavad?**".

**Javaslat (a lap többi részével egységes, a landing linknyelve):**

```css
/* auth.css */
.kc-auth-alt a {
  color: var(--kc-color-primary);   /* marad: 5,16:1 a paperen */
  text-decoration: underline;       /* ← EZ hiányzik (1.4.1) */
  text-underline-offset: 0.25em;
}
/* account.css */
.kc-account__course { text-decoration: underline; text-underline-offset: 0.25em; }
```

Az aláhúzással a G183 3:1-es feltétele **tárgytalanná válik** (a nem-szín jelölő
megvan), és a link-szín kontrasztja a HÁTTÉRHEZ mérve továbbra is 5,16:1 ✓.

### B7 · P2 — A film-hero fókuszgyűrűjének külső éle (2,06:1)

**SC:** 1.4.11. **Fájl:** `blocks/film-hero.css:182`.
**Mit mértem:** `outline: 3px accent-deep; outline-offset: 3px; box-shadow: 0 0 0 6px
white`. A fehér haló 0–6 px-en, a gyűrű 3–6 px-en fut → a jelzés **belső** éle a fehér
halón ül (5,45:1 ✓), a **külső** éle közvetlenül a filmnek megy (2,06:1). Feltételes
megfelelés: a jelzés a fókuszált és fókuszálatlan állapot között így is jól látható,
de a szigorú „adjacent colors" olvasat mindkét oldalt kéri.

**Javaslat — egy token-csere, mindkét él megfelel:**

```css
.kc-film-hero .kc-film-hero__cta:focus-visible {
  outline: 3px solid var(--kc-color-ink);   /* accent-deep helyett */
  outline-offset: 3px;
  box-shadow: 0 0 0 6px var(--kc-color-white);
}
```

**Mért eredmény:** ink a fehér halón **15,63:1** ✓, ink a legsötétebb filmkompoziton
**5,90:1** ✓. Az arculat nem sérül: a hero másodlagos gombjának kerete már ma is ink.

### B8 · P1 (gyakorlati) — A letiltott és a „folyamatban" gombok

**Normatív státusz:** **NEM WCAG-bukás** — 1.4.3 „Incidental" és 1.4.11 „Inactive User
Interface Components" kifejezetten mentesíti. Ennek ellenére ez a lista legnagyobb üzleti
súlyú tétele. Részletes indoklás és iparági hivatkozások: 7. fejezet.

**Fájl:** `styles/ui.css:250` — `opacity: 0.5` a TELJES gombra.
**Mit mértem** (az `opacity` a kitöltést ÉS a feliratot egyszerre keveri a lappal):

| Változat | Lap | Felirat | Kitöltés | Arány |
|---|---|---|---|---|
| primary | paper | `#fafcfe` | `#92b4ce` | **2,12:1** |
| primary | fehér kártya | `#ffffff` | `#97b6cf` | **2,12:1** |
| primary | tint | `#f2f8fc` | `#8aafcc` | **2,16:1** |
| primary | sötét sáv | — | — | **2,97:1** |
| secondary | paper | `#838e9d` | paper | **3,14:1** |
| ghost | paper | `#92b4ce` | paper | **2,06:1** |
| FreeSos CTA | akcentsáv | fehér 50% | sáv | **2,57:1** |

**Hol fáj ez ténylegesen:**

1. **`/penztar` fizetőgomb.** `CheckoutForm.tsx:359`: `disabled={submitting ||
   alreadyPurchased || !waiverComplete}`. A „Megrendelés és fizetés" felirat **2,12:1**,
   amíg a vevő nem pipálja ki a két elállási jelölőt — és **semmi nem mondja meg neki,
   miért nem működik a gomb**. A gomb ráadásul natív `disabled`, tehát **kiesik a Tab-
   sorrendből**: a billentyűzetes vevő nem is találja meg, hogy megnézze.
2. **Minden űrlap „folyamatban" állapota.** `LoginForm`, `RegisterForm`,
   `ForgotPasswordForm`, `ResetPasswordForm`, `AccountView`, `NewsletterForm`,
   `ContactForm`, `CheckoutForm` mind `disabled={submitting}`-ot ad. A felirat ilyenkor
   „Küldés…" / „Feldolgozás…" — **pontosan az az információ, amit a felhasználónak
   olvasnia kellene**, 2,12:1-en. Egyszerre veszti el a fókuszt (natív `disabled`) és az
   olvashatóságot.
3. **CMS-ből érkező tiltott URL.** `Button.tsx:103`: a kiszűrt `javascript:` séma miatt a
   gomb `<span aria-disabled>`-ként, `kc-button--disabled`-del jelenik meg — a szerkesztő
   nem látja, mi a felirat.

**Pozitív ellenpélda a saját repóból:** a `CourseCta` archivált kurzusnál letiltott
gombot ad **plusz egy `warning` badge-et, ami kimondja, miért** („Ez a kurzus jelenleg
nem vásárolható"). A `PlayerActions` pedig `aria-disabled`-et használ natív `disabled`
helyett, olvasható felirattal. **Ez a két minta a megoldás mintája.**

**Javaslat — az `opacity` lecserélése explicit token-párokra:**

```css
/* styles/ui.css — a letiltott állapotot LAPOS FELÜLET + ERŐS HATÁR jelzi,
   nem áttetszőség. A felirat olvasható marad; a „letiltott" jelentést a
   kurzor, az aria-disabled és a hover-visszajelzés hiánya hordozza. */
.kc-button:disabled,
.kc-button--disabled {
  cursor: not-allowed;
  background-color: var(--kc-color-border);        /* #d8e2eb */
  border-color: var(--kc-color-border-strong);     /* #6b7f94 */
  color: var(--kc-color-text-muted);               /* #33495f */
}

.kc-section--dark .kc-button:disabled,
.kc-section--dark .kc-button--disabled {
  background-color: transparent;
  border-color: var(--kc-color-on-dark-muted);
  color: var(--kc-color-on-dark-muted);            /* #9ec4df */
}

.kc-free-sos .kc-button:disabled,
.kc-free-sos .kc-button--disabled {
  background-color: transparent;
  border-color: var(--kc-color-on-primary);
  color: var(--kc-color-on-primary);
}
```

**Mért eredmény a javítás után:**

| Változat | Felirat | Küszöb | Határ (keret / lap) | Küszöb |
|---|---|---|---|---|
| világos lap (paper / fehér / tint) | **7,08:1** | T 4,5 ✓ | **3,91 / 4,13 / 3,57** | N 3 ✓ |
| sötét sáv | **8,49:1** | T 4,5 ✓ | **8,49:1** | N 3 ✓ |
| FreeSos akcentsáv | **5,45:1** | T 4,5 ✓ | **5,45:1** | N 3 ✓ |

**Kísérő, kód-oldali javaslatok** (külön ticketbe, mert komponens-viselkedés):

- **A „folyamatban" NE natív `disabled` legyen**, hanem `aria-disabled="true"` +
  kattintás-kapu (a `PlayerActions.tsx:68` mintája), hogy a fókusz a gombon maradjon.
- **A `/penztar` fizetőgomb mellé kerüljön magyarázó szöveg**, amíg letiltott: „A
  fizetéshez pipáld ki mindkét nyilatkozatot." (`aria-describedby`-jal a gombra kötve).
  A W3C ARIA APG szerint a letiltott vezérlőhöz mindig tartozzon magyarázat:
  <https://www.w3.org/WAI/ARIA/apg/patterns/button/>

### B9 · P2 — `--kc-color-info` nincs definiálva → az állapotdoboz elveszti a keretét

**Fájl:** `src/app/(frontend)/checkout.css:85–86, 240–241`.
**Mit találtam** (statikusan ÉS az élő, kiszolgált CSS-ben is ellenőrizve): a
`--kc-color-info` és a `--kc-color-info-surface` **sehol nincs definiálva** a repóban.
A CSS ilyenkor „invalid at computed-value time"-ot alkalmaz: a deklaráció a tulajdonság
**kezdőértékére** áll vissza, NEM az előző szabályra. Következmények:

- `.kc-cart-notice` — a korábbi szabály tint hátterét **`transparent`-re** cseréli, a
  keret `currentColor`-ra (ink) esik. Kontrasztban nem bukik (ink keret 14,79:1), de a
  doboz **nem az, aminek szánták**, és a tint felület elveszett. Érinti: `/kosar`,
  `/penztar` értesítő-doboza.
- `.kc-thankyou--timeout` — itt a `border` **rövidítés** tartalmazza a hibás `var()`-t,
  ezért a TELJES rövidítés érvénytelen → `border-style: none`. A „fizetés folyamatban"
  köszönő-állapot **keret és háttér nélkül**, csupasz szövegként jelenik meg, miközben a
  `--paid` (zöld) és a `--failed` (piros) testvére színes dobozt kap. A három kimenetel
  vizuális megkülönböztetése így féloldalas.

**Javaslat — vagy pótoljuk a tokent, vagy szerep-tokenre írjuk át:**

```css
/* tokens.css — az állapot-hármas kiegészítése (a hűvös paletta része) */
--kc-color-info: var(--kc-color-accent-deep);      /* #2f6e9f */
--kc-color-info-surface: var(--kc-color-tint-cool);/* #e6f0f8 */
```

**Mért eredmény:** info keret a paperen **5,16:1** (N 3 ✓), ink szöveg a tint dobozon
**13,53:1** (T 4,5 ✓), a doboz felülete a laphoz 1,09:1 — de a keret azonosít ✓.
Ez pontosan ugyanaz a szerkezet, mint a danger/success/warning hármasnál.

*Ez a hiba az őr-teszt **G-K1** szabályával örökre kizárható (11. fejezet).*

### B10 · P3 — `.kc-progress-bar--sm` sínje láthatatlan (1,31:1)

**SC:** 1.4.11 (információt hordozó grafika). **Fájl:** `styles/progress.css:28`.
A `--sm` változat `border: 0`-t állít, így a 4 px-es sáv `hairline` (#d8e2eb) sínje a
lejátszó **fehér** fejlécén 1,31:1 — a sín kiterjedése nem érzékelhető, tehát a
„mennyi van hátra" a sávról nem olvasható le. (Enyhítő: a `%`-os szöveg mellette áll —
mobilon viszont a `.kc-player__progress-text` `display: none`, és a számok a
rail-gombra kerülnek át.)

**Javaslat — külső 1px-es gyűrű, a sáv magasságának megtartásával:**

```css
.kc-progress-bar--sm {
  border: 0;
  border-radius: 0;
  block-size: 0.25rem;
  box-shadow: 0 0 0 1px var(--kc-color-border-strong); /* kívülre rajzol */
}
```

**Mért:** a gyűrű a fehér fejlécen **4,13:1** ✓, a kitöltés a sínen **4,15:1** ✓
(mindkettő megmarad). *Elvetett alternatíva: a sínt `hairline-strong`-ra állítani — akkor
a kitöltés/sín arány 1,32:1-re esne.*

### B11 · P3 — `.kc-cart__title` link-affordancia

`checkout.css:30` — a kosárban a kurzus címe link, `ink` színnel, aláhúzás nélkül, a
címsor-betűvel. Alapállapotban semmi nem jelzi, hogy kattintható (hoveren aláhúzódik).
Nem szigorú 1.4.1-bukás (nem mondaton belüli link, a kontextus árulkodó), de a
`.kc-text-link` nyelvét érdemes ráhúzni. **Javaslat:** `text-decoration: underline;
text-underline-offset: 0.25em` — a kontraszt 14,79:1 marad.

### B12 · P3 — Kétféle chip-anatómia

`content.css:515` (`.kc-category-filter__chip`) 44 px-es célfelületet ad;
`kurzusok/kurzusok.css:41` (`.kc-course-filter__chip`) ugyanarra a szerepre `padding:
4px 12px`-et → ~36 px magasság. **2.5.8 (AA, 24 px) ✓, de a 2.5.5 (AAA, 44 px) és a saját
UX-skillünk 3. pontja sérül.** Javaslat: a kurzus-chip vegye át a `min-height: 2.75rem`-et
és az `inline-flex` anatómiát, vagy egyszerűen használja a közös osztályt.

---

## 6. Célméret (2.5.8 AA = 24×24 px · 2.5.5 AAA = 44×44 px)

A repó **kimagaslóan jól** áll ezen a ponton: **36 helyen** szerepel explicit
`min-height: 2.75rem` / `min-block-size: 44px` (illetve `48px`) deklaráció a kattintható
elemeken.

| Elem | Deklarált méret | 24×24 (AA) | 44×44 (AAA) | Megjegyzés |
|---|---|---|---|---|
| `.kc-button` (mind) | `min-height: 2.75rem`, `--sm` is | ✓ | ✓ | a `--sm` csak a belső margót szűkíti |
| Fejléc CTA-pirula, wordmark | 2,75rem | ✓ | ✓ | |
| Desktop menülink / lenyitó / almenü | 2,75rem / 2,75×2,75rem | ✓ | ✓ | a −8px margó csak optikai |
| Hamburger, drawer-linkek | 2,75rem | ✓ | ✓ | |
| `.kc-text-link`, `.kc-course-textlink` | 2,75rem | ✓ | ✓ | önálló link → nincs „inline" kivétel |
| Lábléc jogi linkek + süti-gomb | 2,75rem | ✓ | ✓ | |
| Chip (blog), ugrás-chip | 2,75rem | ✓ | ✓ | |
| Lejátszó: minden gomb, rail-sor | 44 px / 48 px | ✓ | ✓ | |
| Süti-sáv gombjai | ~46,7 px (számolt) | ✓ | ✓ | 8px padding + 26,7px sor + 4px keret |
| Előnézeti sáv kilépő | 2,75rem | ✓ | ✓ | |
| Film-hero CTA-k | 2,75rem + `min-width` | ✓ | ✓ | |
| `.kc-course-filter__chip` | ~36,7 px (számolt) | ✓ | ✗ | **B12** |
| `.kc-auth-form__billing summary` | ~26,7–30 px (sortávból) | ✓ | ✗ | apró |
| Checkbox (hírlevél / kapcsolat / pénztár) | **20×20 px** | ✓* | ✗ | *a kötött `<label>` a célfelület része, így az egyesített doboz ≥ 24 px; a VIZUÁLIS jelölő mégis 20 px |
| `.kc-cart__title`, `.kc-course-card__title a`, `.kc-post-card` cím, `.kc-account__course` | **nincs min-height** — inline link | **böngészős mérés kell** | ✗ | lásd lent |

**Amit statikusan nem lehet eldönteni:** az inline `<a>` elemek tényleges befoglaló doboza
a betű ascent+descent metrikájából jön, nem a `line-height`-ból. Az M lépcsőn (16–18,16 px)
ez tipikusan **19–24 px** közé esik, tehát **a 24 px-es AA-küszöb határán**. Ezeknél
**böngészős mérés kell** (`getBoundingClientRect()`); a listát a 10. fejezet tartalmazza.
Egyszerű, biztonságos megoldás mindegyikre: `display: inline-flex; min-height: 1.5rem`
(24 px), ami a szövegfolyamot nem bontja meg.

**Kiemelendő pozitívum:** a `kurzusok.css:387–389` kommentje explicit módon indokolja,
hogy a buybox szöveglinkjére miért NEM alkalmazható a 2.5.8 „inline" kivétele. Ez a fajta
indoklás a repó erőssége.

---

## 7. A letiltott gomb — mit ír elő a szabvány, és mit az ipar

### 7.1 A szabvány: mentesít

- **WCAG 2.2, 1.4.3 „Incidental"** — *„Text or images of text that are part of an
  inactive user interface component… have no contrast requirement."*
  <https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html>
- **WCAG 2.2, 1.4.11 „Inactive User Interface Components"** — *„User Interface Components
  that are not available for user interaction (e.g., a disabled control in HTML) are not
  required to meet contrast requirements."*
  <https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html>

Tehát a mi 2,06–2,16:1-es letiltott gombjaink **formálisan megfelelnek az AA-nak**.
Ezt tisztán ki kell mondani, mert ez határozza meg, hogy a B8 megfelelőségi kockázat-e
(nem az) vagy termékminőségi hiba (az).

### 7.2 Az ipar: mégis olvashatóra tervezi

| Rendszer | Amit előír / dokumentál | URL |
|---|---|---|
| **Material Design 3** | A letiltott állapotot dokumentált „state layer" + tartalom-átlátszóság rendszer adja, egységesen minden komponensre — nem ad hoc `opacity` a gombon. | <https://m3.material.io/foundations/interaction/states/state-layers> |
| **IBM Carbon** | **Nevesített `disabled` tokenek** (`text-disabled`, `border-disabled`, `icon-disabled`, `layer-selected-disabled`) — a letiltott állapot saját, tervezett paletta, nem az aktív állapot áttetsző változata. (Ellenőriztem a Carbon kiszolgált token-készletében.) | <https://carbondesignsystem.com/components/button/style/> · <https://carbondesignsystem.com/components/button/usage/> |
| **Shopify Polaris** | A gomb-komponens dokumentációja a letiltott állapotot külön, jelentéssel bíró állapotként kezeli, és a „miért letiltott" közlését várja el. | <https://polaris.shopify.com/components/actions/button> |
| **Apple HIG** | A gombok fejezete a letiltott állapotot a vizuális hierarchia részeként tárgyalja (a szándék közlése a felirattal együtt). | <https://developer.apple.com/design/human-interface-guidelines/buttons> |
| **GOV.UK Design System** | A gomb-komponens a `disabled` mellé automatikusan `aria-disabled`-et is állít — a letiltás szemantikus, nem csak vizuális. | <https://design-system.service.gov.uk/components/button/> |
| **W3C ARIA APG** | A gomb-minta a letiltott állapothoz szemantikus jelölést és magyarázatot vár. | <https://www.w3.org/WAI/ARIA/apg/patterns/button/> |
| **W3C, 1.4.11 Understanding** | *„For people with cognitive disabilities, it is a best practice to delineate the boundary of all controls."* | (fent) |

*A táblázat összes URL-jét lekértem, mind 200-as választ adott 2026-08-16-án. Az idézetek
a W3C-oldalakról szó szerintiek; a design-rendszereknél a jellemzést adom, nem idézetet —
a részletekért a hivatkozott oldal az irányadó.*

### 7.3 Amit ebből a Kineticare-re le kell fordítani

1. A letiltás **szemantikus jelzése kötelező** (`disabled` vagy `aria-disabled`) — ez ma
   megvan.
2. A letiltás **vizuális jelzése ne az olvashatóság feláldozásával** történjen — ez ma
   nincs meg (B8 javaslat).
3. **A „miért" mindig legyen kimondva.** Ma egy helyen példás (`CourseCta` archivált
   badge-e), egy kritikus helyen hiányzik (`/penztar` fizetőgomb).
4. **A „folyamatban" nem letiltás.** Külön vizuális állapot, `aria-disabled` +
   `aria-busy`, megtartott fókusszal.

---

## 8. Tipográfia: hol áll a küszöb a mi skálánkon

A `tokens.css` három clamp-lépcsőjét kiszámoltam a kért nézetablak-szélességeken:

| Nézetablak | L (címek) | M (törzs, **gomb**) | S (kiegészítő) |
|---|---|---|---|
| 360 px | **32,04 px** | **16,00 px** | **13,00 px** |
| 768 px | **38,98 px** | **16,82 px** | **13,48 px** |
| 1440 px | **46,40 px** | **18,00 px** | **14,00 px** |

A WCAG „nagy szöveg" határa: **≥ 24 px (18 pt)** normál, vagy **≥ 18,66 px (14 pt)
félkövér**.

- **L lépcső (32–46,4 px): nagy szöveg** → 3:1 elég. Ezért felel meg a `cta-banner`
  világos változatának navy címe és a lábléc óriás linkje bőven.
- **M lépcső: NEM nagy szöveg.** A felső végén (1440 px-en) 18,00 px, ami a `--kc-font-l`
  clamp plafonjával együtt is **18,16 px alatt marad** — a 700-as súly ellenére **sem
  éri el a 18,66 px-es félkövér küszöböt**. **Következmény: a gomb-feliratra MINDIG a
  szigorúbb 4,5:1 vonatkozik, minden nézetablakon.** Ez fontos, mert az `accent`
  (#3d78aa) tint sávon 4,07:1-es értéke így SEMMILYEN gomb-feliratnál nem menthető meg
  „nagy szöveg" címén — a `tokens.css` akcent-korlátja tehát nem óvatoskodás, hanem
  szükségszerűség.
- **S lépcső (13–14 px): normál szöveg**, 4,5:1. A badge-ek és a meta-sorok ezért
  mérendők a szigorú küszöbhöz — mind meg is felelnek (5,38–13,53:1).

**Betűtípus és metszet.** A gomb `--kc-font-body` (Nunito Sans, variábilis 400–700) —
valódi 700-as metszet, nem szintetikus vastagítás. A címsor-betű (Tenor Sans) egyetlen
400-as metszettel érkezik, ezért a repó helyesen NEM kér tőle 700-at (`ui.css:422–428`
levezetése). A `base.css:35–37` szürkeárnyalatos élsimítása optikailag valamivel
vékonyabb vonalat ad, mint a subpixeles — ez a mért kontraszt-arányt nem változtatja meg
(a WCAG a szín-párost méri, nem a rasztert), de **határeseti (4,5–5,0:1) pároknál
gyakorlati kockázat**. A mi legszorosabb szöveg-párosunk az `accent-deep` a tinten
(4,72:1) — ez ma csak a ghost gomb feliratánál fordul elő, ott elfogadható.

---

## 9. Latens kockázatok (ma nem aktívak, de egy tartalmi változás előhozza őket)

| # | Kockázat | Mikor aktiválódik | Mért érték |
|---|---|---|---|
| L1 | `.scroll-scrub__route-button` fókuszgyűrűje a filmen | ha a film-heróba **egynél több jelenet** kerül (`scenes.length > 1`) | **1,64:1** (kell 3) |
| L2 | `.scroll-scrub__route-button` aláhúzása aktív állapotban | ua. | **1,64:1** (kell 3) |
| L3 | Sötét szekció a lap LEGTETEJÉN | ha egy CMS-oldal első blokkja `hatter: 'sotet'` és a fejléc ott átlátszó marad | a `layout.css:74–78` maga figyelmeztet rá |
| L4 | Süti-sáv hover-visszajelzés hiánya | ma nincs `:hover` stílus a két gombon | (nem SC-bukás, de szokatlan) |
| L5 | `.kc-course-preview` / `.kc-richtext__video` iframe fókusza | a sötét konténeren az `accent-deep` gyűrű 2,87:1 lenne | **2,87:1** |
| L6 | `accordion` hover-sáv sötét szekcióban | 1,27:1 — a hover gyakorlatilag nem látszik | (nem SC-bukás) |

Az L1–L2 javítása most egy sor: a `film-hero.css`-ben a route-gombra is ki kell terjeszteni
az ink-alapú fókuszgyűrűt és aláhúzást (a B7 javítással azonos logika). Az L5 javítása:
`.kc-course-preview :focus-visible, .kc-richtext__video :focus-visible { outline-color:
var(--kc-color-focus-on-dark) }` → 15,63:1.

**Ellenőrzött NEM-kockázat:** a globális `:focus-visible { border-radius:
var(--kc-radius-sm) }` elvileg elronthatná a pirula alakú gombok sarkát fókusz közben.
Végigvettem a kaszkádot: a `styles.css` importsorrendjében a `ui.css`, `layout.css` és
`content.css` mind a `base.css` UTÁN jön, tehát a saját `border-radius`-uk nyer.
**Nincs vizuális ugrás** — a szabály csak a rádiusz nélküli elemeket kerekíti le enyhén.

---

## 10. Amit statikusan nem lehetett eldönteni — böngészős mérés kell

Nem találgatok; ezek a tételek mérőeszközt kérnek (Playwright + `getBoundingClientRect()`,
illetve `html2canvas`/képernyőkép-mintavétel):

1. **Inline linkek tényleges célfelülete** — `.kc-cart__title`, `.kc-course-card__title a`,
   `.kc-post-card__title a`, `.kc-account__course`, `.kc-post-hero__categories a`.
   Mérendő: `getBoundingClientRect().height` 360 / 768 / 1440 px-en. Küszöb: 24 px.
2. **A fejléc-fátyol TÉNYLEGES értéke görgetés közben** — a `--kc-header-veil`-t JS írja;
   a 4.2 táblázat a végpontokat és a negyedeket adja, de a valós görgetési görbét
   érdemes leképezni (mely görgetési pozíciónál lépi át a 0,44-et).
3. **A filmkockák pillanatnyi világossága** — a méréseim a repó saját, filmkockákból vett
   „legsötétebb blokk" értékeire épülnek. Ha a `scene-02.mp4` cserélődik, **az egész
   film-hero kontraszt-levezetést újra kell futtatni**.
4. **A `backdrop-filter: saturate(1.2)`** hatása: a telítettség-emelés a luminanciát
   érdemben nem mozdítja, de a határeseteknél (kijelentkezés-keret 3,02:1 a fagyott
   filmsávon) képernyőképből ellenőrizendő.
5. **A `-webkit-font-smoothing: antialiased`** optikai hatása a 4,5–5,0:1 közötti
   pároknál — szubjektív, felhasználós próbát kér.

---

## 11. Javasolt ŐR-TESZT

A repóban a kontraszt-protokoll ma **kommentekben** él (`tokens.css`, `ui.css`,
`layout.css`, `blocks/course-cards.css` fejléce, `progress.css`, `player.css`,
`kurzusaim.css`). Ez értékes — de a mostani audit három olyan hibát talált, amit
**semmilyen komment nem tudott megakadályozni**: egy nem létező tokenre hivatkozó
`var()` (B9), egy sötét felület, amiről lemaradt a fókusz-felülírás (B2), és egy
`opacity`, ami az egész gombot elmossa (B8). Ezekre **végrehajtható szabály** kell —
pontosan az az érv, amivel a `tipografia-harom-meret.test.ts` is született.

Javasolt fájl: **`src/__tests__/gomb-kontraszt.test.ts`** (vitest, hálózat nélkül, a
`tipografia-harom-meret.test.ts` bejáró segédfüggvényeit mintázva).

### 11.1 Váz

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const REPO = fileURLToPath(new URL('..', import.meta.url))

/* ---- 1. Kontraszt-motor (tiszta függvények, a WCAG 2.2 definíciója) ---- */
const csatorna = (c: number): number =>
  c / 255 <= 0.04045 ? c / 255 / 12.92 : (((c / 255) + 0.055) / 1.055) ** 2.4
const luminancia = ([r, g, b]: RGB): number =>
  0.2126 * csatorna(r) + 0.7152 * csatorna(g) + 0.0722 * csatorna(b)
export const arany = (a: RGB, b: RGB): number => {
  const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}
/** Alfa-kompozit — az `opacity` és a `color-mix()` feloldásához. */
const keverek = (elo: RGB, hatter: RGB, alfa: number): RGB => …

/* ---- 2. A tokenek beolvasása a tokens.css-ből (alias-feloldással) ---- */
const TOKEN = olvasTokenek(join(REPO, 'app/(frontend)/styles/tokens.css'))

/* ---- 3. A MÁTRIX — ennek a dokumentumnak a gépi párja ---- */
const PAROK: Array<{
  elem: string; allapot: string; elo: string; hatter: string
  kuszob: 4.5 | 3; sc: '1.4.3' | '1.4.11'
}> = [
  { elem: 'kc-button--primary', allapot: 'alap',  elo: 'on-primary', hatter: 'primary',       kuszob: 4.5, sc: '1.4.3' },
  { elem: 'kc-button--primary', allapot: 'hover', elo: 'on-primary', hatter: 'primary-hover', kuszob: 4.5, sc: '1.4.3' },
  { elem: 'kc-button--primary', allapot: 'hatar/paper', elo: 'primary', hatter: 'bg',         kuszob: 3,   sc: '1.4.11' },
  … /* a 4.1–4.10 táblázatok minden sora */
]
```

### 11.2 A hat végrehajtható szabály

| Őr | Mit fog meg | Miért kell |
|---|---|---|
| **G-K1** | Minden `var(--kc-*)` hivatkozás **létező** tokenre mutat (a `(frontend)` és `components` alatti CSS-ekben + a TSX-ek inline stílusaiban). | **Ez fogta volna el a B9-et.** Némán, keret nélkül maradt egy fizetési állapotdoboz. |
| **G-K2** | A `PAROK` mátrix minden sora eléri a küszöbét. Ha egy token értéke változik, a teszt **azonnal** megmondja, melyik gomb melyik állapota bukott el. | Ma egy `#2f6e9f` → `#3d78aa` elgépelés csak vizuálisan derülne ki. |
| **G-K3** | **Sötét-felület regiszter:** minden olyan szabály/komponens, amely `--kc-color-surface-dark`, `--kc-color-ink`, `--kc-color-navy-900` vagy `--kc-color-primary` háttérre tesz fókuszálható tartalmat, KÖTELEZŐEN definiál `:focus-visible { outline-color: … }` felülírást — és a felülírt szín a `PAROK` szerint ≥ 3:1 azon a felületen. A regiszter allowlist-je a tesztben él. | **Ez fogta volna el a B2-t.** A süti-sáv az egyetlen sötét felület a lapon, ahonnan a felülírás hiányzik. |
| **G-K4** | Letiltott állapot jelölésére **`opacity` nem használható**: a `:disabled`, `[aria-disabled]`, `--disabled` szelektorokat tartalmazó szabályblokkban tilos az `opacity` deklaráció. | **Ez fogta volna el a B8-at**, és megakadályozza a visszacsúszást. |
| **G-K5** | Minden interaktív osztály (`a`, `button`, `summary`, `[role=button]`, `cursor: pointer`) vagy hordoz `min-height`/`min-block-size` ≥ 1.5rem-et, vagy szerepel egy indoklással ellátott **kivétel-listán** (pl. „mondaton belüli link — 2.5.8 inline kivétel"). | A 24 px-es AA-küszöb nem szemre ellenőrizhető; a lista rákényszeríti az indoklást. |
| **G-K6** | A `tokens.css` fejlécében álló kontraszt-jegyzőkönyv **minden számát** újraszámolja, és eltérésnél bukik. | A jegyzőkönyv ma is pontos — de ha valaki átszínez egy tokent és a kommentet nem írja át, a dokumentáció némán hazudni kezd. |

### 11.3 Második szint: futásidejű (böngészős) mérés

A G-K1…G-K6 statikus, tehát gyors és CI-blokkoló lehet. Amit **nem** tud megfogni:
a rétegzett kompozit (film + lejtő + fátyol), az `opacity` szülő-lánc és a valós
célfelület-méret. Ezekre külön, **nem CI-blokkoló** Playwright-ellenőrzést javaslok
(`npm run a11y:kontraszt`), amely:

1. betölti a kulcsoldalakat (kezdőlap, `/kurzusok`, kurzusoldal, `/penztar`, `/belepes`,
   `/kapcsolat`, lejátszó) 360 / 768 / 1440 px-en;
2. minden fókuszálható elemre Tab-bal rááll, és képernyőképből mintavételezi a
   fókuszgyűrű és a szomszédos pixelek színét;
3. `getBoundingClientRect()`-tel méri a célfelületeket;
4. a kezdőlapon több görgetési pozíciónál is fut (hogy a `--kc-header-veil` teljes
   tartományát bejárja).

Ez a második szint az egyetlen, ami a B1-hez hasonló, **rétegzésből fakadó** hibát
képes önállóan megtalálni.

---

## 12. Élő ellenőrzés

A kiszolgált CSS-t 2026-08-16-án lekértem az élő telepítésről
(`https://kineticare-production.up.railway.app`, 6 CSS-köteg, 130 707 bájt; a
`kineticare.hu` ma még a régi oldalt szolgálja ki, 301 → `www`).

| Ellenőrzött érték | Repó | Élő | Egyezik |
|---|---|---|---|
| 17 nyers színtoken (`--kc-color-*`) | lásd 3. fejezet | bitre azonos (a `#ffffff` `#fff`-re minifikálva) | ✓ |
| `--kc-font-l/m/s` clamp-ek | `clamp(2rem, 1.62rem + 1.7vw, 2.9rem)` stb. | azonos | ✓ |
| `:focus-visible` szabályok (6 variáns) | 3px accent-deep + offset 2px; felülírások sötét sávon, film-herón, mezőn, lejátszón | azonos | ✓ |
| `.kc-button:disabled, .kc-button--disabled` | `opacity:.5; cursor:not-allowed` | azonos | ✓ (**B8 élőben is**) |
| `--kc-color-info` / `-surface` **definíció** | nincs | **nincs** | ✓ (**B9 élőben is**) |
| `.kc-cart-notice`, `.kc-thankyou--timeout` | hibás `var()` | azonos | ✓ (**B9 élőben is**) |
| Fejléc CTA `color-mix()` a veil-lel | van | van | ✓ |
| `.kc-progress-bar--sm { border: 0 }` | van | van | ✓ (**B10 élőben is**) |
| `.kc-auth-alt a { color: primary }` (aláhúzás nélkül) | van | van | ✓ (**B5 élőben is**) |
| `.kc-contact-form__consent-label` (link-szabály nélkül) | van | van | ✓ (**B3 élőben is**) |

**Következtetés: nincs eltérés a repó és az élő között** — minden itt leírt bukás
élesben is jelen van, és minden javítás a repóból deployolható.

---

## 13. Javasolt sorrend

| Kör | Tétel | Fájl | Becsült méret |
|---|---|---|---|
| **1.** | B2 (süti-sáv fókusz) + B3 (kapcsolat-link) | `ConsentBanner.tsx` + új `consent-banner.css`, `kapcsolat.css` | 2 fájl, ~15 sor |
| **1.** | B1 (fejléc fókusz a filmen) | `styles/layout.css` | 1 szabály |
| **1.** | B9 (`--kc-color-info` pótlása) | `styles/tokens.css` | 2 sor |
| **2.** | B8 (letiltott gomb palettája) | `styles/ui.css` (+ `free-sos.css`) | 1 szabály-blokk |
| **2.** | B8 kísérő: `aria-disabled` a „folyamatban"-hoz + magyarázat a pénztárgomb mellé | `Button.tsx`, `CheckoutForm.tsx` | komponens-ticket |
| **2.** | B5, B6, B11 (link-aláhúzások) | `auth.css`, `account.css`, `checkout.css` | 4 deklaráció |
| **3.** | B7 + L1/L2/L5 (fókuszgyűrűk sötét/filmes felületeken) | `film-hero.css`, `content.css`, `kurzusok.css` | 3 szabály |
| **3.** | B10, B12 | `progress.css`, `kurzusok.css` | 2 szabály |
| **4.** | Őr-teszt (G-K1…G-K6) | új `src/__tests__/gomb-kontraszt.test.ts` | ~250 sor |
| **4.** | `cta-banner.css` legacy tokenek visszavezetése szerep-tokenekre | `blocks/cta-banner.css` | arculati adósság |

Az 1. kör **egyetlen színt sem változtat meg az arculatban** — csak fókuszgyűrűket ír
felül és aláhúzásokat pótol. A 2. kör a letiltott gomb kinézetét változtatja: ez tervezői
jóváhagyást kér, ezért került külön körbe.

---

## Függelék — a mért anyag reprodukálása

A számoló szkript a scratchpadben él (a repóba szándékosan nem került):
`contrast.py` (10 szakasz: token-jegyzőkönyv, állapotszínek, disabled-mátrix,
fókuszgyűrűk, fejléc-fátyol, film-hero, gomb-/link-állapotok, 1.4.1, `color-mix()`
feloldás, tipográfia) és `fixes.py` (a javaslatok utólagos ellenőrzése). Mindkettő
tiszta Python, függőség nélkül; a WCAG-képlet a
<https://www.w3.org/TR/WCAG22/#dfn-relative-luminance> definícióját követi. A 11.
fejezet őr-teszt-váza ugyanezt a motort viszi TypeScriptbe, hogy a mérés a CI-ban
ismételhető legyen.
