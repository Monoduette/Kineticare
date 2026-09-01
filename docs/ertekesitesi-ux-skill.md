# Értékesítési UX-skill — kötelező szabályrendszer a felületi munkához

> **Mi ez?** Verziózott projekt-„skill": minden ügynök és fejlesztő ezt tölti
> be, MIELŐTT a kezdőlaphoz, a navigációhoz, a termék-megjelenítéshez vagy a
> tipográfiához nyúl. A CLAUDE.md hivatkozik rá. Forrása a
> `docs/ux-hierarchia-audit.md` (Kimi-kutatás, 2026-08) + WCAG 2.2 + a
> megrendelői igények (`docs/igeny-valtozas-pontok.md`).
> **Miért itt él és nem `.claude/skills/`-ben?** A repóban a `.claude/`
> szándékosan nem verziózható (a `.gitignore:25` tiltja), ez a fájl viszont a
> projekt tudása — a `docs/` alatt marad, git-ben.

## 1. Az üzleti cél sorrendje (ebből vezethető le minden döntés)

1. **Kurzus-értékesítés** (Barion) — a lányok értékesítésből élnek.
2. Bizalom / szakmai hitel.
3. Kapcsolatfelvétel.
4. Másodlagos: tudástár (SEO, hosszútáv).

A hüvelykujj-szabály: **ami pénzt hoz, az előrébb és hangsúlyosabban jelenik
meg, mint ami „csak" leadet** — de a kiemelés soha nem erőszakos: ár + világos
CTA + őszinte leírás, nem sürgetés, nem dark pattern (nincs visszaszámláló,
nincs kamu-készlethiány, nincs bűntudatkeltő elutasító gomb).

## 2. A kezdőlap cél-hierarchiája (M1–M8)

| #   | Modul                                                                                            | Súly       | Szabály                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------ | ---------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | Hero + **EGY elsődleges CTA** („Megnézem a kurzusokat") + egy másodlagos (ingyenes SOS)          | elsődleges | A hero-ban pontosan 1+1 CTA. Az elsődleges a fizetős irányba mutat.                                                                     |
| M2  | Hitel-csík (gyógytornász · manuálterapeuta · sportolók/olimpikonok · egyesületi tagságok, 1 sor) | támogató   | A hero ALATT, tömören. Nem külön oldalra zárva.                                                                                         |
| M3  | **Fizetős kurzus-kártyák: név + ÁR + CTA**                                                       | elsődleges | Az értékesítés motorja. Minden élő fizetős termék látszik: otthoni program ÉS szakmai képzés is. Ár mindig forintban, rejtett ár nincs. |
| M4  | Ingyenes SOS KézRelax (lead-magnet)                                                              | másodlagos | A fizetős blokk UTÁN vagy azzal egy blokkban, de VIZUÁLISAN másodlagos súllyal (a K2-hiba: az ingyenes nem uralhatja el az oldalt).     |
| M5  | „Így működik az online kurzus" (3 lépés)                                                         | támogató   | Ellenérv-csökkentés: megveszem → azonnal nézem → otthon gyakorlok.                                                                      |
| M6  | Vélemények                                                                                       | támogató   | **Max 2–3, RÖVID (1–2 mondat), a termék UTÁN** (K4-hiba: nem 3 képernyőnyi, nem a termék előtt).                                        |
| M7  | Tudástár (3 friss poszt)                                                                         | másodlagos | SEO; sosem előzi meg a termékblokkot.                                                                                                   |
| M8  | FAQ / kapcsolat-sáv                                                                              | támogató   | Vásárlási kételyek kezelése a lap alján.                                                                                                |

**Tartalom vs. kód határvonal:** a modul-SZERKEZET (komponensek, sorrend,
kártyák) kód; a modul-SZÖVEGEK CMS-tartalmak (Lexical) — szöveget a staff ír,
az ügynök szerkezetet épít. Kódban hardcode-olt marketingszöveg csak
fallbackként megengedett.

## 3. Navigáció (sticky) — kötelező viselkedés

- Menüpontok **jobb felül**; a „Kurzusok" menüpont KÖTELEZŐ (az értékesítés
  fő útja nem hiányozhat a navból), plusz egy vizuálisan elkülönülő CTA.
- Görgetésre az oldal tetején áttetszőbb, legörgetve **sticky** és **nem
  teljesen átlátszó** háttérű — a váltás folyamatos (scroll-küszöb + átmenet),
  nem ugrás.
- **WCAG 2.2 AA kontraszt a sáv MINDEN állapotában**: normál szöveg ≥ 4,5:1,
  nagy szöveg (≥ 24 px, vagy ≥ 18,66 px félkövér) ≥ 3:1, UI-komponens határok
  ≥ 3:1. Áttetsző háttérnél a kontrasztot a LEGROSSZABB eset (legvilágosabb
  mögöttes tartalom) ellen kell méretezni — ha ez nem garantálható, a háttér
  nem lehet áttetsző.
- Billentyűzettel bejárható, látható fókuszgyűrű, `prefers-reduced-motion`
  esetén átmenetek nélkül.
- Mobilon ugyanez lenyíló menüként; az érintési célfelület min. 44×44 px.

## 4. Tipográfiai skála — NN/g három token, folytonos méret (L / M / S)

- Fontméret CSAK a három közös tokenről jöhet. Elemre írt egyedi px/rem
  érték tilos. Őr: `src/__tests__/tipografia-harom-meret.test.ts`.
- **Három token, nem három befagyott pixel.** Az NN/g Visual Hierarchy
  _tartományokat_ ad (törzs 14–16, alcím 18–22, címsor 32 px-ig), és
  a hierarchiát színnel, súllyal, csoportosítással is építi, nem csak
  mérettel. https://www.nngroup.com/articles/visual-hierarchy-ux-definition/
  Ugyanez a három-méretes szabály: https://www.nngroup.com/articles/good-visual-design/
  Relatív egység, reasonably big alap: https://www.nngroup.com/articles/let-users-control-font-size/
- **A méret a képernyővel nő** (GOV.UK type scale v6+: kis vs. nagy
  képernyő, 640 px fölött a large lépcső; heading-xl 32→48, heading-l
  27→36, törzs 19 px). Relatív `rem`. A technika: CSS `clamp()` + `vw`
  a 320–1440 px sávon (Utopia-képlet).
  https://design-system.service.gov.uk/styles/type-scale/
  Apple HIG Typography: a szövegstílusok a Dynamic Type-pal és a size
  class-szal skálázódnak, nem egyetlen px-re zárva.
  https://developer.apple.com/design/human-interface-guidelines/typography
- A live tokenek (`src/app/(frontend)/styles/tokens.css`), 320→1440 px:
  `--kc-font-l` = 32–40 px (címsor; a 40 a GOV.UK heading-l 36 és
  heading-xl 48 között, mert a H1 és a H2 közös L, 48 minden szekciócímet
  display-méretűvé tenne; a 46,4 px-es 2,9rem plafon öt soros címeket
  adott), `--kc-font-m` = 16–19 px (iOS 16 px padló, 19 a GOV.UK body),
  `--kc-font-s` = 14–16 px (NN/g padló, nagy képernyőn GOV.UK body-s).
- **A hero/videó címsor az L tokenen áll**; a számított px a nézetablakkal
  nő, 40 px fölé a clamp nem engedi.
- Sortáv: címsor 1,2 · törzs 1,55–1,7. Sorhossz törzsnél 45–75 karakter
  (`max-width` ch-ban).
- A look & feel (fontcsaládok, színek, hangulat) NEM változik a skálára
  igazítástól, csak a méretek. A hierarchia súlyból, színből, betűcsaládból
  és elhelyezésből is jön, nem csak méretből.
  WCAG 2.2 1.4.4 (Resize Text), 1.4.10 (Reflow, C33 a `body`-n).

## 5. Mérés — a kör lezárása

Minden hierarchia-változtatás hatását a PostHog funnel méri:
`$pageview(/) → course_viewed → checkout_started → purchase_confirmed`.
Új CTA/kártya bevezetésekor ellenőrizd, hogy a meglévő eseményláncba esik-e
(kattintás → `course_viewed` a kurzusoldalon), és a változást jegyezd fel a
PR-leírásban, hogy az előtte/utána összevethető legyen.

## 6. Tilos (a repó TILOS ZÓNÁI felett, erre a területre)

- Dark pattern (ál-sürgetés, rejtett költség, megtévesztő gomb).
- Az ingyenes lead-magnet vizuális túlsúlya a fizetős ajánlat felett (K2).
- Fontméret a skálán kívül; AA alá eső kontraszt bármely nav-állapotban.
- Access-control vagy checkout-logika módosítása UX-munka címén (ezek külön,
  emberi jóváhagyású változtatások).
