/**
 * CTA-forrásbejáró — a G-UI2 őr adatforrása: a termékből gyűjti a vevői
 * cselekvés-feliratokat (JSX gyerekszöveg, aria-label, CTA-objektumok,
 * konstansok). TypeScript AST-tal dolgozik; konstansokat fájlhatáron át követ.
 * CMS-felülírás (`cmsFelulirhato`) és statikusan nem oldható helyek külön
 * jelölve. A kurzusoldal ugró-szakasz-objektumok szándékos vakfolt.
 */
import { readFileSync, readdirSync, type Dirent } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'

import { CTA_PROGRESS_LABELS, CTA_VOCABULARY } from '@/lib/cta-vocabulary'

/** A `src/` könyvtár abszolút útja (záró perjel nélkül). */
export const SRC_ROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/u, '')

/**
 * A bejárás gyökerei — a `src/`-hez képest.
 *
 * A `components` és az `app` a vevői felület, a `lib` pedig azért kell, mert a
 * CTA-feliratok egy része állapotgépben él (`src/lib/courses.ts`
 * `resolveCourseCta`), és onnan kerül a gombra. A hatókör SZŰKÜLÉSE önmagában
 * hiba: az őr `hatokor` blokkja méri, hogy mindhárom gyökér él-e, és hogy a
 * bejárt fájlok száma nem esett-e a küszöb alá.
 */
export const BEJARASI_GYOKEREK = ['components', 'app', 'lib'] as const

/**
 * Kihagyott részfák, INDOKKAL. A `§3.2` CTA-szótár a VEVŐI felületre szól; a
 * Payload adminfelülete más közönség, más szótár (a Payload sajátja), ezért nem
 * mérhető ugyanazzal a mércével. A kihagyás listája versenyzett: az őr méri,
 * hogy minden felsorolt előtaghoz tartozik-e valódi fájl, tehát egy elavult
 * kivétel HANGOSAN kidől, nem némán tágít.
 */
export const KIHAGYOTT_RESZFAK: readonly { readonly eloTag: string; readonly indok: string }[] = [
  {
    eloTag: 'components/admin/',
    indok:
      'A Payload adminfelületének paneljei — szerkesztői közönség, a §3.2 vevői CTA-szótár nem rájuk szól.',
  },
  {
    eloTag: 'app/(payload)/',
    indok: 'A Payload admin route-csoportja — nem vevői felület.',
  },
  {
    eloTag: 'components/preview/',
    indok: 'Az élő előnézet szerkesztői sávja — csak bejelentkezett szerkesztő látja.',
  },
  {
    eloTag: 'lib/cta-vocabulary.ts',
    indok:
      'MAGA A SZÓTÁR. A §3.2 bejegyzései CTA-alakú objektumok, de nem hívóhelyek: ' +
      'ha bejárnánk, a szótár megint önmagát mérné — épp ezt a hibát javítja a G-UI2 őr.',
  },
]

/** Azok az elemnevek, amelyek gyerekszövege cselekvés-feliratnak számít. */
const CSELEKVO_ELEMEK = new Set(['Button', 'FooterPageLink', 'Link', 'a', 'button'])

/** Egy CTA-alakú objektumhoz a `label` mellett legalább ezek egyikének állnia kell. */
const CTA_ALAKU_TARSMEZOK = new Set([
  'href',
  'action',
  'onClick',
  'kind',
  'variant',
  'weight',
  'to',
  'disabled',
])

/** A `ctaLabel('…')` hívások feloldásához: cselekvés-kulcs → jóváhagyott felirat. */
const SZOTAR_FELIRAT_KULCS_SZERINT = new Map<string, string>(
  CTA_VOCABULARY.map((entry) => [entry.action, entry.label]),
)

/**
 * A `ctaProgressLabel('…')` hívások feloldásához: cselekvés-kulcs → L-1 felirat.
 *
 * MIÉRT KELL (2026-08-18): a hívóhelyek a folyamatban-feliratot is a szótárból
 * veszik (`{submitting ? ctaProgressLabel('sign-in') : ctaLabel('sign-in')}`).
 * A `ctaLabel` nélkül ez a bejáró számára DINAMIKUS ág lenne, vagyis a
 * rendezettebbé tett kódtól veszítené el a látását az őr — pontosan az a hiba,
 * amit ez a modul a fejlécében kimond („a mérés éppen ott vakulna meg, ahol a
 * kód a legrendezettebb"). A `null`-t adó cselekvéseket (nincs
 * folyamatban-állapotuk) SZÁNDÉKOSAN kihagyjuk: ott a hívás sem ad feliratot.
 */
const L1_FELIRAT_KULCS_SZERINT = new Map<string, string>(
  CTA_VOCABULARY.flatMap((entry) =>
    entry.progress === null ? [] : [[entry.action, CTA_PROGRESS_LABELS[entry.progress]] as const],
  ),
)

export interface CtaTalalat {
  /** A vevőnek megjelenő felirat, whitespace-re normalizálva. */
  readonly felirat: string
  /** A `src/`-hez képest relatív fájlút, pl. `components/checkout/CartView.tsx`. */
  readonly fajl: string
  /** 1-alapú sorszám — a beszámolóban visszakereshető legyen. */
  readonly sor: number
  readonly forras: 'jsx-szoveg' | 'aria-label' | 'objektum-label' | 'cta-nevu-konstans'
  /** A hordozó kattintható elem neve vagy objektumnál a mezőnevek. */
  readonly elem: string
  /** A statikusan feloldható cél; `null`, ha futásidőben dől el. */
  readonly href: string | null
  /** `true`, ha CMS-mező felülírhatja (`cmsErtek ?? KODBELI` alak). */
  readonly cmsFelulirhato: boolean
}

/** Egy hely, ahol a felirat statikusan NEM oldható fel — az őr kiírja, nem nyeli le. */
export interface DinamikusHely {
  readonly fajl: string
  readonly sor: number
  readonly elem: string
  /** A kifejezés forráskódja, egy sorba tömörítve, levágva. */
  readonly kifejezes: string
  readonly cmsFelulirhato: boolean
}

export interface BejarasEredmeny {
  readonly talalatok: readonly CtaTalalat[]
  readonly dinamikusHelyek: readonly DinamikusHely[]
  /** A `src/`-hez képest relatív, ténylegesen bejárt fájlutak. */
  readonly bejartFajlok: readonly string[]
  /** A kihagyott részfák miatt kimaradt fájlutak. */
  readonly kihagyottFajlok: readonly string[]
}

// ---------------------------------------------------------------------------
// Fájlrendszer és elemzés
// ---------------------------------------------------------------------------

const forrasGyorsitotar = new Map<string, ts.SourceFile | null>()

function elemez(absUt: string): ts.SourceFile | null {
  const meglevo = forrasGyorsitotar.get(absUt)
  if (meglevo !== undefined) return meglevo
  let sf: ts.SourceFile | null = null
  try {
    const szoveg = readFileSync(absUt, 'utf8')
    sf = ts.createSourceFile(absUt, szoveg, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  } catch {
    sf = null
  }
  forrasGyorsitotar.set(absUt, sf)
  return sf
}

function fajlokatGyujt(relativGyoker: string): string[] {
  const talalatok: string[] = []
  const bejar = (relativUt: string): void => {
    let bejegyzesek: Dirent[]
    try {
      bejegyzesek = readdirSync(join(SRC_ROOT, relativUt), { withFileTypes: true })
    } catch {
      return
    }
    for (const bejegyzes of bejegyzesek) {
      const ut = `${relativUt}/${bejegyzes.name}`
      if (bejegyzes.isDirectory()) {
        bejar(ut)
      } else if (bejegyzes.name.endsWith('.ts') || bejegyzes.name.endsWith('.tsx')) {
        talalatok.push(ut)
      }
    }
  }
  bejar(relativGyoker)
  return talalatok
}

/** A `@/…` és a relatív importok feloldása fájlútra; csomag-import → `null`. */
function modulUt(honnanAbs: string, specifikacio: string): string | null {
  let alap: string
  if (specifikacio.startsWith('@/')) {
    alap = join(SRC_ROOT, specifikacio.slice(2))
  } else if (specifikacio.startsWith('.')) {
    alap = join(dirname(honnanAbs), specifikacio)
  } else {
    return null
  }
  for (const jelolt of [
    `${alap}.ts`,
    `${alap}.tsx`,
    `${alap}/index.ts`,
    `${alap}/index.tsx`,
    alap,
  ]) {
    if (elemez(jelolt) !== null) return jelolt
  }
  return null
}

// ---------------------------------------------------------------------------
// Kifejezés-feloldás
// ---------------------------------------------------------------------------

interface Feloldas {
  /** A lehetséges statikus értékek (elágazásnál több is). */
  readonly ertekek: readonly string[]
  /** `true`, ha van olyan ág, amely futásidőben dől el. */
  readonly dinamikus: boolean
  /** `true`, ha CMS-mező felülírhatja a kódbeli feliratot. */
  readonly cmsFelulirhato: boolean
}

const DINAMIKUS: Feloldas = { ertekek: [], dinamikus: true, cmsFelulirhato: false }

/**
 * „Itt SZÁNDÉKOSAN nincs felirat" — a `label: null` ágak (pl. az archivált
 * kurzus §3.2 #16 szerinti, gomb nélküli állapota). Nem érték és nem is
 * bizonytalanság, ezért sem találat, sem dinamikus hely nem lesz belőle.
 */
const SEMMI: Feloldas = { ertekek: [], dinamikus: false, cmsFelulirhato: false }

function statikus(ertek: string): Feloldas {
  return { ertekek: [ertek], dinamikus: false, cmsFelulirhato: false }
}

function unio(...reszek: readonly Feloldas[]): Feloldas {
  return {
    ertekek: reszek.flatMap((resz) => resz.ertekek),
    dinamikus: reszek.some((resz) => resz.dinamikus),
    cmsFelulirhato: reszek.some((resz) => resz.cmsFelulirhato),
  }
}

/** Egy másik fájlban élő kifejezésre mutató hivatkozás (a kontextus is kell hozzá). */
interface Hivatkozas {
  readonly sf: ts.SourceFile
  readonly kifejezes: ts.Expression
}

function utkoztetlenNev(nev: ts.BindingName): string | null {
  return ts.isIdentifier(nev) ? nev.text : null
}

/**
 * Egy azonosító deklarációjának megkeresése: előbb a befoglaló blokkokban
 * (helyi `const`), majd a fájl tetején, végül az importokon át a másik fájlban.
 */
function kovetAzonositot(sf: ts.SourceFile, honnan: ts.Node, nev: string): Hivatkozas | null {
  const allomanyban = (allitasok: readonly ts.Statement[]): ts.Expression | null => {
    for (const allitas of allitasok) {
      if (!ts.isVariableStatement(allitas)) continue
      for (const dekl of allitas.declarationList.declarations) {
        if (utkoztetlenNev(dekl.name) === nev && dekl.initializer) return dekl.initializer
      }
    }
    return null
  }

  for (let szint: ts.Node | undefined = honnan; szint; szint = szint.parent) {
    if (ts.isBlock(szint) || ts.isSourceFile(szint)) {
      const talalat = allomanyban(szint.statements)
      if (talalat) return { sf, kifejezes: talalat }
    }
  }

  const tetejen = allomanyban(sf.statements)
  if (tetejen) return { sf, kifejezes: tetejen }

  for (const allitas of sf.statements) {
    if (!ts.isImportDeclaration(allitas)) continue
    const kotesek = allitas.importClause?.namedBindings
    if (!kotesek || !ts.isNamedImports(kotesek)) continue
    const talalt = kotesek.elements.find((elem) => elem.name.text === nev)
    if (!talalt) continue
    if (!ts.isStringLiteral(allitas.moduleSpecifier)) continue
    const cel = modulUt(sf.fileName, allitas.moduleSpecifier.text)
    if (cel === null) continue
    const celSf = elemez(cel)
    if (celSf === null) continue
    const eredetiNev = (talalt.propertyName ?? talalt.name).text
    return kovetAzonositot(celSf, celSf, eredetiNev)
  }

  return null
}

/** A dekoráló burkok (`as const`, zárójel, `!`) lehántása. */
function maghoz(kifejezes: ts.Expression): ts.Expression {
  let mag = kifejezes
  while (
    ts.isParenthesizedExpression(mag) ||
    ts.isAsExpression(mag) ||
    ts.isSatisfiesExpression(mag) ||
    ts.isNonNullExpression(mag)
  ) {
    mag = mag.expression
  }
  return mag
}

/** A kifejezés mögötti objektum-literál megkeresése (azonosítón/importon át is). */
function objektumLiteralig(
  sf: ts.SourceFile,
  kifejezes: ts.Expression,
  melyseg: number,
): { sf: ts.SourceFile; objektum: ts.ObjectLiteralExpression } | null {
  if (melyseg > 8) return null
  const mag = maghoz(kifejezes)
  if (ts.isObjectLiteralExpression(mag)) return { sf, objektum: mag }
  if (ts.isIdentifier(mag)) {
    const hivatkozas = kovetAzonositot(sf, mag, mag.text)
    if (!hivatkozas) return null
    return objektumLiteralig(hivatkozas.sf, hivatkozas.kifejezes, melyseg + 1)
  }
  return null
}

/**
 * Egy kifejezés statikusan feloldható szövegértéke(i).
 *
 * A `melyseg` korlát nem díszlet: körkörös `const a = b; const b = a` alakon a
 * követés különben végtelen ciklusba futna, és a teszt csendben lefagyna.
 */
function feloldSzoveget(sf: ts.SourceFile, kifejezes: ts.Expression, melyseg = 0): Feloldas {
  if (melyseg > 12) return DINAMIKUS
  const mag = maghoz(kifejezes)

  if (ts.isStringLiteral(mag) || ts.isNoSubstitutionTemplateLiteral(mag)) {
    return statikus(mag.text)
  }

  if (
    mag.kind === ts.SyntaxKind.NullKeyword ||
    (ts.isIdentifier(mag) && mag.text === 'undefined')
  ) {
    return SEMMI
  }

  if (ts.isConditionalExpression(mag)) {
    return unio(
      feloldSzoveget(sf, mag.whenTrue, melyseg + 1),
      feloldSzoveget(sf, mag.whenFalse, melyseg + 1),
    )
  }

  if (
    ts.isBinaryExpression(mag) &&
    (mag.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
      mag.operatorToken.kind === ts.SyntaxKind.BarBarToken)
  ) {
    const bal = feloldSzoveget(sf, mag.left, melyseg + 1)
    const jobb = feloldSzoveget(sf, mag.right, melyseg + 1)
    // EZ a CMS-felülírás alakja: a bal oldal futásidőben dől el (szerkesztői
    // mező), a jobb oldal a kódbeli tartalék. Ilyenkor a kódbeli javítás
    // ÉLESBEN HATÁSTALAN, ha a szerkesztő kitöltötte a mezőt.
    // A `?? ''` alak NEM felülírás, csak üres-védelem, ezért a tartalék
    // feliratnak valódi szövegnek kell lennie.
    const cms =
      bal.dinamikus &&
      bal.ertekek.length === 0 &&
      jobb.ertekek.some((ertek) => ertek.trim().length > 0)
    return { ...unio(bal, jobb), cmsFelulirhato: cms || bal.cmsFelulirhato || jobb.cmsFelulirhato }
  }

  if (ts.isIdentifier(mag)) {
    const hivatkozas = kovetAzonositot(sf, mag, mag.text)
    if (!hivatkozas) return DINAMIKUS
    return feloldSzoveget(hivatkozas.sf, hivatkozas.kifejezes, melyseg + 1)
  }

  if (ts.isPropertyAccessExpression(mag) || ts.isElementAccessExpression(mag)) {
    const mezoNev = ts.isPropertyAccessExpression(mag)
      ? mag.name.text
      : ts.isStringLiteral(mag.argumentExpression)
        ? mag.argumentExpression.text
        : null
    if (mezoNev === null) return DINAMIKUS
    const cel = objektumLiteralig(sf, mag.expression, melyseg + 1)
    if (!cel) return DINAMIKUS
    for (const tulajdonsag of cel.objektum.properties) {
      if (ts.isPropertyAssignment(tulajdonsag) && nevSzovegge(tulajdonsag.name) === mezoNev) {
        return feloldSzoveget(cel.sf, tulajdonsag.initializer, melyseg + 1)
      }
      if (
        ts.isShorthandPropertyAssignment(tulajdonsag) &&
        tulajdonsag.name.text === mezoNev
      ) {
        return feloldSzoveget(cel.sf, tulajdonsag.name, melyseg + 1)
      }
    }
    return DINAMIKUS
  }

  if (ts.isCallExpression(mag)) {
    // `ctaLabel('…')` – a szótárból dolgozó hívóhely önmagában helyes.
    if (ts.isIdentifier(mag.expression) && mag.expression.text === 'ctaLabel') {
      const elso = mag.arguments[0]
      if (elso && ts.isStringLiteral(elso)) {
        const felirat = SZOTAR_FELIRAT_KULCS_SZERINT.get(elso.text)
        if (felirat !== undefined) return statikus(felirat)
      }
      return DINAMIKUS
    }
    // `ctaProgressLabel('…')` – a ZÁRT L-1 listából dolgozó folyamatban-felirat.
    if (ts.isIdentifier(mag.expression) && mag.expression.text === 'ctaProgressLabel') {
      const elso = mag.arguments[0]
      if (elso && ts.isStringLiteral(elso)) {
        const felirat = L1_FELIRAT_KULCS_SZERINT.get(elso.text)
        if (felirat !== undefined) return statikus(felirat)
        // Ismert cselekvés, de nincs folyamatban-állapota → a hívás `null`-t ad.
        if (SZOTAR_FELIRAT_KULCS_SZERINT.has(elso.text)) return SEMMI
      }
      return DINAMIKUS
    }
    // `VALAMI.trim()` – a körítés nem változtat a feliraton.
    if (
      ts.isPropertyAccessExpression(mag.expression) &&
      mag.expression.name.text === 'trim' &&
      mag.arguments.length === 0
    ) {
      return feloldSzoveget(sf, mag.expression.expression, melyseg + 1)
    }
    return DINAMIKUS
  }

  return DINAMIKUS
}

function nevSzovegge(nev: ts.PropertyName): string | null {
  if (ts.isIdentifier(nev) || ts.isStringLiteral(nev)) return nev.text
  return null
}

// ---------------------------------------------------------------------------
// JSX-gyerekszöveg
// ---------------------------------------------------------------------------

function elemNeve(node: ts.JsxElement | ts.JsxSelfClosingElement): string {
  const nev = ts.isJsxElement(node) ? node.openingElement.tagName : node.tagName
  return nev.getText()
}

function attributumok(
  node: ts.JsxElement | ts.JsxSelfClosingElement,
): readonly ts.JsxAttributeLike[] {
  return ts.isJsxElement(node)
    ? node.openingElement.attributes.properties
    : node.attributes.properties
}

function attributum(
  node: ts.JsxElement | ts.JsxSelfClosingElement,
  nev: string,
): ts.JsxAttribute | null {
  for (const attr of attributumok(node)) {
    if (ts.isJsxAttribute(attr) && attr.name.getText() === nev) return attr
  }
  return null
}

/** `aria-hidden="true"` – a dekoratív gyerek (nyíl, ikon) nem része a feliratnak. */
function dekorativ(node: ts.JsxElement | ts.JsxSelfClosingElement): boolean {
  const attr = attributum(node, 'aria-hidden')
  if (!attr) return false
  const ertek = attr.initializer
  if (!ertek) return true
  if (ts.isStringLiteral(ertek)) return ertek.text === 'true'
  if (ts.isJsxExpression(ertek) && ertek.expression) {
    return ertek.expression.kind === ts.SyntaxKind.TrueKeyword
  }
  return false
}

/**
 * A JSX-gyerekek szövegszegmensei. Minden szegmens külön `Feloldas`, mert egy
 * gomb felirata állhat több darabból (`Megnyitom: {lesson.title}`).
 */
function gyerekSzegmensek(
  sf: ts.SourceFile,
  gyerekek: readonly ts.JsxChild[],
  szegmensek: Feloldas[],
): void {
  for (const gyerek of gyerekek) {
    if (ts.isJsxText(gyerek)) {
      const szoveg = gyerek.text.replace(/\s+/gu, ' ').trim()
      if (szoveg.length > 0) szegmensek.push(statikus(szoveg))
    } else if (ts.isJsxExpression(gyerek)) {
      // A `{/* komment */}` és a `{null}` nem szöveg.
      if (!gyerek.expression) continue
      if (gyerek.expression.kind === ts.SyntaxKind.NullKeyword) continue
      // Ez a wrapper csak továbbadja a Footer hívóhelyén külön megmért feliratot.
      if (
        sf.fileName.endsWith(join('components', 'layout', 'FooterPageLink.tsx')) &&
        ts.isIdentifier(gyerek.expression) &&
        gyerek.expression.text === 'children'
      ) {
        continue
      }
      szegmensek.push(feloldSzoveget(sf, gyerek.expression))
    } else if (ts.isJsxElement(gyerek)) {
      if (dekorativ(gyerek)) continue
      gyerekSzegmensek(sf, gyerek.children, szegmensek)
    } else if (ts.isJsxFragment(gyerek)) {
      gyerekSzegmensek(sf, gyerek.children, szegmensek)
    } else if (ts.isJsxSelfClosingElement(gyerek)) {
      // Önzáró elem (ikon, kép) nem visz szöveget.
      continue
    }
  }
}

/** A szegmensekből előálló feliratok. Több bizonytalan szegmens → nem mérhető. */
function szegmensekbolFeliratok(szegmensek: readonly Feloldas[]): Feloldas {
  if (szegmensek.length === 0) return { ertekek: [], dinamikus: false, cmsFelulirhato: false }
  const cms = szegmensek.some((szegmens) => szegmens.cmsFelulirhato)
  if (szegmensek.length === 1) return { ...szegmensek[0], cmsFelulirhato: cms }
  if (szegmensek.some((szegmens) => szegmens.dinamikus || szegmens.ertekek.length !== 1)) {
    return { ertekek: [], dinamikus: true, cmsFelulirhato: cms }
  }
  return {
    ertekek: [szegmensek.map((szegmens) => szegmens.ertekek[0]).join(' ')],
    dinamikus: false,
    cmsFelulirhato: cms,
  }
}

// ---------------------------------------------------------------------------
// A bejárás
// ---------------------------------------------------------------------------

/**
 * A feloldott értékek közül a valódi feliratok.
 *
 * Az üres szöveg nem felirat: a `cmsErtek?.trim() ?? ''` alak üres ága csak
 * „nincs mit kiírni"-t jelent, és felirat-találatként hamis riasztás volna.
 */
function ertelmesFeliratok(feloldva: Feloldas): readonly string[] {
  const egyediek = new Set<string>()
  for (const ertek of feloldva.ertekek) {
    const tisztitott = ertek.replace(/\s+/gu, ' ').trim()
    if (tisztitott.length > 0) egyediek.add(tisztitott)
  }
  return [...egyediek]
}

function tomorit(szoveg: string): string {
  const egySorban = szoveg.replace(/\s+/gu, ' ').trim()
  return egySorban.length > 90 ? `${egySorban.slice(0, 90)}…` : egySorban
}

let gyorsitotarazottEredmeny: BejarasEredmeny | null = null

/**
 * Végigméri a felületet, és visszaadja a vevőnek megjelenő cselekvés-feliratokat.
 *
 * Az eredmény modul-szinten gyorsítótárazott: a bejárás fájlrendszert olvas, és
 * ugyanabban a futásban több `describe` blokk is kéri.
 */
export function gyujtsCtaFeliratokat(): BejarasEredmeny {
  if (gyorsitotarazottEredmeny) return gyorsitotarazottEredmeny

  const talalatok: CtaTalalat[] = []
  const dinamikusHelyek: DinamikusHely[] = []
  const bejartFajlok: string[] = []
  const kihagyottFajlok: string[] = []

  const osszesFajl = BEJARASI_GYOKEREK.flatMap((gyoker) => fajlokatGyujt(gyoker)).sort()

  for (const relativUt of osszesFajl) {
    if (KIHAGYOTT_RESZFAK.some(({ eloTag }) => relativUt.startsWith(eloTag))) {
      kihagyottFajlok.push(relativUt)
      continue
    }
    bejartFajlok.push(relativUt)

    const sf = elemez(join(SRC_ROOT, relativUt))
    if (sf === null) continue
    const sorSzam = (node: ts.Node): number =>
      sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1

    /** A `href` attribútum statikusan feloldott értéke, ha egyértelmű. */
    const hrefAttributumbol = (node: ts.JsxElement | ts.JsxSelfClosingElement): string | null => {
      const attr = attributum(node, 'href')
      if (!attr || !attr.initializer) return null
      if (ts.isStringLiteral(attr.initializer)) return attr.initializer.text
      if (ts.isJsxExpression(attr.initializer) && attr.initializer.expression) {
        const feloldva = feloldSzoveget(sf, attr.initializer.expression)
        if (!feloldva.dinamikus && feloldva.ertekek.length === 1) return feloldva.ertekek[0]
      }
      return null
    }

    const jar = (node: ts.Node): void => {
      // 1. `<Button>SZÖVEG</Button>`, `<Link>SZÖVEG</Link>`, `<a>`, `<button>`
      if (ts.isJsxElement(node) && CSELEKVO_ELEMEK.has(elemNeve(node))) {
        const szegmensek: Feloldas[] = []
        gyerekSzegmensek(sf, node.children, szegmensek)
        const feloldva = szegmensekbolFeliratok(szegmensek)
        const elem = elemNeve(node)
        const href = hrefAttributumbol(node)
        for (const felirat of ertelmesFeliratok(feloldva)) {
          talalatok.push({
            felirat,
            fajl: relativUt,
            sor: sorSzam(node),
            forras: 'jsx-szoveg',
            elem,
            href,
            cmsFelulirhato: feloldva.cmsFelulirhato,
          })
        }
        if (feloldva.dinamikus) {
          dinamikusHelyek.push({
            fajl: relativUt,
            sor: sorSzam(node),
            elem,
            kifejezes: tomorit(
              node.children.map((gyerek) => gyerek.getText(sf)).join(''),
            ),
            cmsFelulirhato: feloldva.cmsFelulirhato,
          })
        }
      }

      // 2. `aria-label` a kattintható elemeken (hozzáférhető név – WCAG 4.1.2)
      if (ts.isJsxAttribute(node) && node.name.getText() === 'aria-label') {
        const nyito = node.parent.parent
        const hordozo =
          ts.isJsxSelfClosingElement(nyito) || ts.isJsxOpeningElement(nyito)
            ? nyito.tagName.getText()
            : null
        if (hordozo !== null && CSELEKVO_ELEMEK.has(hordozo) && node.initializer) {
          const feloldva = ts.isStringLiteral(node.initializer)
            ? statikus(node.initializer.text)
            : ts.isJsxExpression(node.initializer) && node.initializer.expression
              ? feloldSzoveget(sf, node.initializer.expression)
              : DINAMIKUS
          for (const felirat of ertelmesFeliratok(feloldva)) {
            talalatok.push({
              felirat,
              fajl: relativUt,
              sor: sorSzam(node),
              forras: 'aria-label',
              elem: hordozo,
              href: null,
              cmsFelulirhato: feloldva.cmsFelulirhato,
            })
          }
          if (feloldva.dinamikus) {
            dinamikusHelyek.push({
              fajl: relativUt,
              sor: sorSzam(node),
              elem: `${hordozo}[aria-label]`,
              kifejezes: tomorit(node.initializer.getText(sf)),
              cmsFelulirhato: feloldva.cmsFelulirhato,
            })
          }
        }
      }

      // 3. CTA-alakú objektum `label:` mezője (állapotgépek, tartalom-modulok)
      if (ts.isObjectLiteralExpression(node)) {
        const mezoNevek = node.properties
          .map((tulajdonsag) =>
            ts.isPropertyAssignment(tulajdonsag)
              ? nevSzovegge(tulajdonsag.name)
              : ts.isShorthandPropertyAssignment(tulajdonsag)
                ? tulajdonsag.name.text
                : null,
          )
          .filter((nev): nev is string => nev !== null)
        const ctaAlaku =
          mezoNevek.includes('label') && mezoNevek.some((nev) => CTA_ALAKU_TARSMEZOK.has(nev))
        if (ctaAlaku) {
          for (const tulajdonsag of node.properties) {
            const nev = ts.isPropertyAssignment(tulajdonsag)
              ? nevSzovegge(tulajdonsag.name)
              : ts.isShorthandPropertyAssignment(tulajdonsag)
                ? tulajdonsag.name.text
                : null
            if (nev !== 'label') continue
            const ertek = ts.isPropertyAssignment(tulajdonsag)
              ? tulajdonsag.initializer
              : ts.isShorthandPropertyAssignment(tulajdonsag)
                ? tulajdonsag.name
                : null
            if (ertek === null) continue
            const feloldva = feloldSzoveget(sf, ertek)
            const href = hrefMezoBol(sf, node)
            for (const felirat of ertelmesFeliratok(feloldva)) {
              talalatok.push({
                felirat,
                fajl: relativUt,
                sor: sorSzam(tulajdonsag),
                forras: 'objektum-label',
                elem: `objektum{${mezoNevek.join(',')}}`,
                href,
                cmsFelulirhato: feloldva.cmsFelulirhato,
              })
            }
            if (feloldva.dinamikus) {
              dinamikusHelyek.push({
                fajl: relativUt,
                sor: sorSzam(tulajdonsag),
                elem: `objektum{${mezoNevek.join(',')}}`,
                kifejezes: tomorit(ertek.getText(sf)),
                cmsFelulirhato: feloldva.cmsFelulirhato,
              })
            }
          }
        }
      }

      ts.forEachChild(node, jar)
    }

    jar(sf)

    // 4. CTA-NEVŰ KONSTANSOK.
    //
    // Az `src/components/account/course-list-order.ts` `CTA_LABELS` objektuma öt
    // ÉLŐ vevői gombfeliratot tárol („Kezdés", „Folytatás", „Újranézés"…), de a
    // hívóhelye `{card.ctaLabel}` — futásidőben dől el, tehát a JSX felől
    // láthatatlan, az objektum pedig nem CTA-alakú (nincs `href` mellette).
    // Enélkül a bejáró egy egész feliratcsalád fölött vakon siklana el.
    //
    // A szabály SZŰK és névre megy: a konstans nevében a `CTA` és a `LABEL`
    // egyszerre álljon. Így a `CTA_ID` (horgony-azonosító) nem kerül be, a
    // `DEFAULT_CTA_LABEL` és a `CTA_LABELS` igen.
    for (const allitas of sf.statements) {
      if (!ts.isVariableStatement(allitas)) continue
      for (const dekl of allitas.declarationList.declarations) {
        const nev = utkoztetlenNev(dekl.name)
        if (nev === null || !dekl.initializer) continue
        const nagyBetus = nev.toUpperCase()
        if (!nagyBetus.includes('CTA') || !nagyBetus.includes('LABEL')) continue

        const mag = maghoz(dekl.initializer)
        const mezok: { nev: string; ertek: ts.Expression }[] = ts.isObjectLiteralExpression(mag)
          ? mag.properties.flatMap((tulajdonsag) =>
              ts.isPropertyAssignment(tulajdonsag) && nevSzovegge(tulajdonsag.name) !== null
                ? [
                    {
                      nev: `${nev}.${nevSzovegge(tulajdonsag.name) ?? ''}`,
                      ertek: tulajdonsag.initializer,
                    },
                  ]
                : [],
            )
          : [{ nev, ertek: dekl.initializer }]

        for (const mezo of mezok) {
          const feloldva = feloldSzoveget(sf, mezo.ertek)
          for (const felirat of ertelmesFeliratok(feloldva)) {
            talalatok.push({
              felirat,
              fajl: relativUt,
              sor: sorSzam(mezo.ertek),
              forras: 'cta-nevu-konstans',
              elem: mezo.nev,
              href: null,
              cmsFelulirhato: feloldva.cmsFelulirhato,
            })
          }
          if (feloldva.dinamikus) {
            dinamikusHelyek.push({
              fajl: relativUt,
              sor: sorSzam(mezo.ertek),
              elem: mezo.nev,
              kifejezes: tomorit(mezo.ertek.getText(sf)),
              cmsFelulirhato: feloldva.cmsFelulirhato,
            })
          }
        }
      }
    }
  }

  gyorsitotarazottEredmeny = {
    talalatok,
    dinamikusHelyek,
    bejartFajlok,
    kihagyottFajlok,
  }
  return gyorsitotarazottEredmeny
}

/** A CTA-alakú objektum `href` mezőjének statikus értéke, ha egyértelmű. */
function hrefMezoBol(sf: ts.SourceFile, objektum: ts.ObjectLiteralExpression): string | null {
  for (const tulajdonsag of objektum.properties) {
    const nev = ts.isPropertyAssignment(tulajdonsag)
      ? nevSzovegge(tulajdonsag.name)
      : ts.isShorthandPropertyAssignment(tulajdonsag)
        ? tulajdonsag.name.text
        : null
    if (nev !== 'href') continue
    const ertek = ts.isPropertyAssignment(tulajdonsag)
      ? tulajdonsag.initializer
      : ts.isShorthandPropertyAssignment(tulajdonsag)
        ? tulajdonsag.name
        : null
    if (ertek === null) return null
    const feloldva = feloldSzoveget(sf, ertek)
    if (!feloldva.dinamikus && feloldva.ertekek.length === 1) return feloldva.ertekek[0]
    return null
  }
  return null
}
