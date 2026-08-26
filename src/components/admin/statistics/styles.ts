import type { CSSProperties } from 'react'

/**
 * Statisztika nézet közös stílus-tokenjei — minden szekció innen importál.
 * Márka-tokenek: custom.scss `.kc-adminstat`, fallback Payload-theme-re.
 * Méret: `--kc-as-px` (rem/13); táblák saját overflow-x konténerben.
 */

/** Lap-héj: paper-föld széltől szélig, tartalom plafonnal középre zárva. */
export const pageStyle: CSSProperties = {
  background: 'var(--kc-as-bg, transparent)',
  paddingBottom: 'var(--kc-as-space-7, calc(var(--base) * 2))',
  paddingInline:
    'max(var(--kc-as-gutter, var(--gutter-h, calc(32 * var(--kc-as-px, 1px)))), calc((100% - var(--kc-as-page-max, calc(1584 * var(--kc-as-px, 1px)))) / 2))',
  paddingTop: 'var(--kc-as-space-6, calc(var(--base) * 1.5))',
  width: '100%',
}

/**
 * A lap fejrésze (eyebrow + h1 + lead) alatt hairline zár — a landing
 * elválasztó-nyelve (tokens.css 215–222. sor: a felületeket 1px-es vonal
 * határolja, nem árnyék). A vonal itt CSOPORTOSÍT: elválasztja a lap
 * azonosítóját az adattól, ami a szélesebb lapon fontosabb, mint eddig
 * (NN/g, Visual Hierarchy — a szint jelölése nem csak méret dolga:
 * https://www.nngroup.com/articles/visual-hierarchy-ux-definition/,
 * hozzáférés: 2026-08-21).
 */
export const pageHeaderStyle: CSSProperties = {
  borderBottom: '1px solid var(--kc-as-hairline, var(--theme-elevation-100))',
  marginBottom: 'var(--kc-as-space-6, calc(var(--base) * 1.5))',
  paddingBottom: 'var(--kc-as-space-5, calc(var(--base) * 1.25))',
}

/**
 * A folyószöveg-mérték KÖZÖS értéke — ugyanaz a logika, mint a storefronton
 * (tokens.css „Mérték" szakasz): nem elemre írt egyedi szám, hanem token.
 * A fallback az érték px-ben, hogy a márka-CSS nélkül se szaladjon el a sor.
 */
const MEASURE = 'var(--kc-as-measure, calc(480 * var(--kc-as-px, 1px)))'

/* Eyebrow a h1 fölé — a landing prémium felvezető-sora: verzál CSS-ből
   (a DOM-szöveg mondatkezdő marad, ui-sztenderdek §3.1 M-4), 0.24em
   betűköz, ink-soft (tokens.css 195–196. sor; paperen 8,80:1). A 13px az
   S lépcső alsó határa (tokens.css 180. sor: 0.8125rem 16px-es alapon). */
export const eyebrowStyle: CSSProperties = {
  color: 'var(--kc-as-eyebrow, var(--theme-elevation-650))',
  fontSize: 'calc(13 * var(--kc-as-px, 1px))',
  fontWeight: 600,
  letterSpacing: 'var(--kc-as-tracking-eyebrow, 0.24em)',
  marginTop: 0,
  marginBottom: 'var(--kc-as-space-2, 0.5rem)',
  textTransform: 'uppercase',
}

export const headingStyle: CSSProperties = {
  marginTop: 0,
  marginBottom: 'var(--kc-as-space-2, calc(var(--base) * 0.5))',
}

/* A lead a mérték-tokenre hivatkozik. A korábbi, elemre írt 528px MÉRVE
   68–76 karaktert adott (magyar szöveg, 16px Nunito Sans, Range API-s
   soronkénti karakterszámlálás) — a 45–85-ös tűrésen belül, de a Baymard
   50–75-ös optimumának a tetején. A közös 480px-es mérték MÉRVE: 768 px-től
   58–69 karakter/sor, 390 px-en 44–56, 320 px-en 30–45. A 320 px-es alsó
   érték a kis kijelző adottsága, nem a mérték hibája: 45 karakterhez 16 px-es
   törzsméretnél ~320 px-es szövegdoboz kellene, a Payload 16 px-es
   oldal-margói mellett viszont 288 px áll rendelkezésre. */
export const leadStyle: CSSProperties = {
  color: 'var(--kc-as-text-muted, var(--theme-elevation-650))',
  marginTop: 0,
  marginBottom: 0,
  maxWidth: MEASURE,
}

/*
 * Szekción BELÜLI felvezető mondat (a `h2` alatt, az adat fölött). Ugyanaz a
 * mérték és halkított szín, mint a lap leadjénél, csak alul kap térközt: így
 * a mondat a címhez tartozik, nem az adathoz tapad. A cím leíró, a lead
 * cselekvésre késztető — a kettő szétválasztása a WCAG 2.2 SC 2.4.6 (Headings
 * and Labels) és a GOV.UK „egy dolgot mond egy elem" elvének a következménye.
 */
export const leadInSectionStyle: CSSProperties = {
  color: 'var(--kc-as-text-muted, var(--theme-elevation-650))',
  marginTop: 0,
  marginBottom: 'var(--kc-as-space-4, calc(var(--base) * 1))',
  maxWidth: MEASURE,
}

export const cardRowStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 'var(--kc-as-space-3, calc(var(--base) * 0.5))',
  marginBottom: 'var(--kc-as-space-6, calc(var(--base) * 1.5))',
}

/* Kártya = emelt felület: fehér + 1px hairline + 12px radius, árnyék nélkül
   (a landing kártya-nyelve, tokens.css 113–124. sor). A kártya kerete csak
   dekorál, nem azonosít — az információt a szöveg hordozza, ezért elég a
   halk hairline (tokens.css 118–121. sor).
   A LEKEREKÍTÉS és a BELSŐ TÉRKÖZ 2026-08-21-én igazodott a storefronthoz: a
   böngészőben mért összevetés szerint a vevői `.kc-card` 12 px-es sarkot
   (`--kc-radius-lg`) és 24 px-es belső térközt (`--kc-card--padded`,
   `--kc-space-5`) visz, az admin-kártya viszont 8-at és 16-ot vitt — ugyanaz
   a komponens, két különböző arány. (ui.css .kc-card / .kc-card--padded) */
export const cardStyle: CSSProperties = {
  background: 'var(--kc-as-surface-raised, var(--theme-elevation-50))',
  border: '1px solid var(--kc-as-hairline, var(--theme-elevation-100))',
  borderRadius: 'var(--kc-as-radius-lg, 4px)',
  flex: '1 1 calc(128 * var(--kc-as-px, 1px))',
  minWidth: 'calc(128 * var(--kc-as-px, 1px))',
  padding: 'var(--kc-as-space-5, calc(var(--base) * 0.75))',
}

/* Érték FELÜL, nagyban — a szám a lényeg, a címke a kontextus (a dashboard
   kártyáin az adat vezet, a leírás követ; NN/g, Clutter-Free charts:
   https://www.nngroup.com/articles/clutter-charts/). A súly 700: a márka a
   kiemelt számot súllyal jelöli, nem mérettel (tokens.css 168–169. sor). */
export const cardValueStyle: CSSProperties = {
  display: 'block',
  fontSize: 'calc(24 * var(--kc-as-px, 1px))',
  fontVariantNumeric: 'tabular-nums',
  fontWeight: 700,
  lineHeight: 1.2,
}

export const cardLabelStyle: CSSProperties = {
  color: 'var(--kc-as-text-muted, var(--theme-elevation-650))',
  display: 'block',
}

/* Szekció-ritmus: hairline vonal FÖLÖTTE + 32px belső térköz. A széles lapon
   a puszta függőleges térköz kevés a csoportosításhoz — a landing ugyanezt
   1px-es vonallal oldja meg (tokens.css 215–222. sor), és a szekció-határ
   jelölése a hierarchia egyik hordozója a méret mellett (NN/g, Visual
   Hierarchy: https://www.nngroup.com/articles/visual-hierarchy-ux-definition/,
   hozzáférés: 2026-08-21). A vonal DEKORATÍV (hairline, nem hairline-strong):
   a szekciót a `h2` nevezi meg, nem a vonal. */
export const sectionStyle: CSSProperties = {
  borderTop: '1px solid var(--kc-as-hairline, var(--theme-elevation-100))',
  marginBottom: 'var(--kc-as-space-7, calc(var(--base) * 1.75))',
  paddingTop: 'var(--kc-as-space-6, calc(var(--base) * 1.5))',
}

/*
 * A LAP ELSŐ szekciója (összesítő kártyák). Ugyanaz a szekció, csak felül
 * NINCS hairline és nincs belső térköz: a fejrész saját záróvonala már
 * elválasztja a laptól, két egymás alatti vonal pedig zajt csinálna. Az alsó
 * térközt a kártyasor saját `marginBottom`-ja adja, ezért itt 0 — így a
 * függőleges ritmus pontosan annyi marad, amennyi a `h2` bevezetése előtt
 * volt.
 */
export const sectionTopStyle: CSSProperties = {
  marginBottom: 0,
  paddingTop: 0,
}

/* A diagram KERETE. A RevenueChart SVG-je a saját, természetes felső
   szélességén (832 tervezési px) áll meg — ez tudatos: egy 12 oszlopos
   idősort nem a nyújtás tesz olvashatóbbá, a túl lapos arány éppen rontja az
   oszlopok összevetését (IBM Carbon, Chart anatomy:
   https://carbondesignsystem.com/data-visualization/chart-anatomy/; NN/g,
   Clutter-Free charts: https://www.nngroup.com/articles/clutter-charts/ —
   hozzáférés: 2026-08-21). A lap kiszélesedésével viszont a diagram KÁRTYÁJA
   is nőne, és félig üres dobozként állna a széles sávban; ezért a kártya a
   diagram természetes szélességéhez igazodik.
   A szám: 832 (SVG) + 2 × 16 (kártya-belsőtérköz) + 2 × 1 (keret) = 866. */
export const chartFrameStyle: CSSProperties = {
  maxWidth: 'calc(866 * var(--kc-as-px, 1px))',
}

/* Tábla-konténer = emelt felület ÉS görgetőkonténer egyben: a kerete
   azonosítja a (keskeny viewporton) görgethető adatterületet, ezért
   hairline-strong jár neki (tokens.css 118–121. sor: „ahol a keret
   azonosít… border-strong"; fehéren 4,13:1 ≥ 3:1, WCAG 1.4.11). */
export const tableWrapStyle: CSSProperties = {
  background: 'var(--kc-as-surface-raised, transparent)',
  border: '1px solid var(--kc-as-hairline-strong, transparent)',
  borderRadius: 'var(--kc-as-radius-lg, 0)',
  overflowX: 'auto',
  padding: 'var(--kc-as-space-4, 0)',
  width: '100%',
}

/* A minWidth garantálja, hogy az oszlopok sose préselődjenek olvashatatlanra:
   keskeny viewporton a tableWrap görget, nem a lap (WCAG 1.4.10 / G225,
   ugyanaz a minta, mint a CourseProgressPanel táblája). A 15px admin-
   adaptáció a 16px-es törzs alá: az adatsűrű tábla egy fokkal kisebb, de a
   12,4px-es (mért) korábbi rendernél jóval olvashatóbb; kontrasztja mérve
   9,3:1 / 6,61:1 (jegyzőkönyv a custom.scss-ben). */
export const tableStyle: CSSProperties = {
  width: '100%',
  minWidth: 'calc(576 * var(--kc-as-px, 1px))',
  borderCollapse: 'collapse',
  fontSize: 'calc(15 * var(--kc-as-px, 1px))',
}

export const captionStyle: CSSProperties = {
  color: 'var(--kc-as-text-muted, inherit)',
  textAlign: 'left',
  captionSide: 'top',
  paddingBottom: 'var(--kc-as-space-2, 0.5rem)',
}

/* A fejléc-sor alatti vonal a táblatest határát azonosítja → hairline-strong;
   a sorelválasztó csak dekorál → hairline (tokens.css 118–121. sor). */
export const thStyle: CSSProperties = {
  textAlign: 'left',
  borderBottom: '1px solid var(--kc-as-hairline-strong, var(--theme-elevation-250))',
  padding:
    'var(--kc-as-space-2, 0.5rem) var(--kc-as-space-3, 0.75rem) var(--kc-as-space-2, 0.5rem) 0',
  color: 'var(--kc-as-text-muted, var(--theme-elevation-650))',
  fontWeight: 600,
}

export const tdStyle: CSSProperties = {
  borderBottom: '1px solid var(--kc-as-hairline, var(--theme-elevation-100))',
  padding:
    'var(--kc-as-space-2, 0.5rem) var(--kc-as-space-3, 0.75rem) var(--kc-as-space-2, 0.5rem) 0',
}

/* Sor-fejléc (<th scope="row">): a böngésző alapértelmezése középre igazítana
   és félkövérezne — explicit balra igazítás kell, hogy a cella a bal-igazított
   oszlopfejléce alá essen (WCAG 2.2 SC 1.3.1 Info and Relationships mellett a
   vizuális oszloprend is maradjon konzisztens; a kiemelés súllyal történik,
   mérettel nem — tokens.css 168–169. sor). */
export const rowHeaderStyle: CSSProperties = {
  ...tdStyle,
  fontWeight: 600,
  textAlign: 'left',
}

/* A számoszlop JOBBRA igazít és tabuláris számjegyet használ (GOV.UK, Table:
   „When comparing columns of numbers, align the numbers to the right in table
   cells" — https://design-system.service.gov.uk/components/table/; ugyanez
   Materialnál: https://m2.material.io/components/data-tables — hozzáférés:
   2026-08-21).
   A `white-space: nowrap` a széles lap miatt került ide: az összeg egyetlen
   érték, nem tördelhető szöveg — enélkül a „3 600 000 Ft" a magyar ezres
   szóközöknél két sorba törhet, és két külön számnak látszik.
   Oszlopszélességet SZÁNDÉKOSAN nem írunk elő: a böngésző automatikus
   tábla-algoritmusa a szabad helyet a tartalom arányában osztja szét. MÉRVE
   1920 px-en a havi táblán: Hónap 403 px, a négy számoszlop 259–298 px. A
   kipróbált alternatíva (`width: 1%` a számoszlopokon, hogy a maradék a
   címkeoszlopba menjen) MÉRVE 1125 px-es Hónap-oszlopot adott, a számokat
   pedig a lap jobb szélére szorította — pont az ellen, amit az NN/g kér:
   „related columns should be adjacent so users don't have to move their eyes
   between distant columns" (https://www.nngroup.com/articles/data-tables/,
   hozzáférés: 2026-08-21). */
export const numericStyle: CSSProperties = {
  ...tdStyle,
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
}

export const thNumericStyle: CSSProperties = {
  ...thStyle,
  textAlign: 'right',
  whiteSpace: 'nowrap',
}

/* Sorbeli navigációs link. A cél-méret azért kap külön szabályt, mert a széles
   lapon a linkszöveg EGY sorba fér, és a beágyazott `<a>` doboza a sormagasságra
   (mérve 22,5 px) esne vissza — keskeny lapon két sorosan még 45 px volt. A
   repó célértéke 44 × 44 CSS px (a WCAG 2.2 SC 2.5.8 minimuma 24 × 24:
   https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html,
   hozzáférés: 2026-08-21; a nagyobb célt a docs/ui-sztenderdek.md írja elő).
   A `max()` alsó korlátja azért kell, mert a Payload 1024 px alatt 12 px-re
   viszi a gyökeret, és a puszta rem-alak ott 40,6 px-et adna — a cél-méret
   viszont CSS px-ben van kimondva, nem a betűmérethez kötve. (Ugyanaz a minta,
   mint a RevenueChart min-widthjénél.) */
export const rowLinkStyle: CSSProperties = {
  alignItems: 'center',
  display: 'inline-flex',
  minHeight: 'max(44px, calc(44 * var(--kc-as-px, 1px)))',
}

/* A notice ugyanolyan folyószöveg, mint a lead, ezért UGYANAZ a mérték-token
   jár neki. Mérték nélkül a tölcsér-megjegyzés sora a lap teljes szélességét
   vinné: 1920 px-en 1525 px, ami magyar szöveggel 200 karakter fölötti sor —
   a 85-ös tűréshatár két és félszerese. */
export const noticeStyle: CSSProperties = {
  color: 'var(--kc-as-text-muted, var(--theme-elevation-650))',
  margin: 0,
  maxWidth: MEASURE,
}
