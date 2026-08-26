import { Fragment, type CSSProperties } from 'react'

import { AUDIENCE_LABELS } from '../../../lib/course-audience'
import { NO_LESSONS_LABEL } from '../../../lib/curriculum/progress'
import { courseProgressHref } from '../../../lib/statistics/course-links'
import {
  NOT_STARTED_NAME_LIMIT,
  type CourseEngagementReport,
  type CourseEngagementRow,
} from '../../../lib/statistics/engagement'
import {
  captionStyle,
  noticeStyle,
  numericStyle,
  rowHeaderStyle,
  rowLinkStyle,
  sectionStyle,
  tableStyle,
  tableWrapStyle,
  tdStyle,
  thNumericStyle,
  thStyle,
} from './styles'

/**
 * „Ki hol tart a kurzusokban" szekció — eladás × haladás kurzusonként: hányan
 * Darabszámnál a csonkolás elfogadható alsó becslés. NÉVSORNÁL NEM AZ: egy
 */

/* A 8 oszlop + linkszöveg miatt szélesebb minimum, mint a bevétel-tábláké:
   keskeny viewporton a wrap görget, nem a lap (WCAG 1.4.10 / G225). */
const engagementTableStyle: CSSProperties = {
  ...tableStyle,
  minWidth: 'calc(832 * var(--kc-as-px, 1px))',
}

/*
 * A „Nem kezdte el" kiemelt száma OSZTÁLYT kap, nem inline színt.
 *
 * MÉRVE: az inline `color` a `.kc-adminstat a:hover` szabálynál erősebb (a
 * style-attribútum minden szelektort ver), ezért a link hover-visszajelzése —
 * amit a repó link-nyelve előír — ezen az EGY linken sosem érvényesült. A
 * szín ezért a custom.scss `.kc-adminstat` scope-jába került (világos és sötét
 * ág is), ahol a hover-szabály nagyobb specifikusságú, tehát felül tudja írni.
 * A vastagítás maradhatna inline, de egy helyen tartva a kettőt nem tud
 * szétcsúszni.
 */
const EMPHASIZED_COUNT_CLASS = 'kc-adminstat__count-danger'

/* A számot LINKKÉ tesszük, ezért a cél-méret rá is vonatkozik: a repó
   célértéke 44 × 44 CSS px (a WCAG 2.2 SC 2.5.8 minimuma 24 × 24:
   https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).
   Egy két karakteres szám doboza magától ~12 px széles lenne, ezért a
   szélességet is kimondjuk; a `flex-end` tartja a számoszlop jobbra
   igazítását (GOV.UK, Table: a számok jobbra igazítva hasonlíthatók össze). */
const countLinkStyle: CSSProperties = {
  ...rowLinkStyle,
  justifyContent: 'flex-end',
  minWidth: 'max(44px, calc(44 * var(--kc-as-px, 1px)))',
}

/* A nyitható blokk SAJÁT SORBAN, mind a nyolc oszlopon átérve ül: így a nevek
   a tábla teljes szélességét kapják, nem szorulnak egy keskeny oszlopba. Ez a
   bevett „kinyitható táblasor" minta (IBM Carbon, Data table expansion:
   https://carbondesignsystem.com/components/data-table/usage/). A natív
   <details>/<summary> azért jó választás, mert a nyitott/csukott állapotot a
   böngésző maga közli a segítő technológiával, ARIA nélkül (GOV.UK, Details:
   https://design-system.service.gov.uk/components/details/). */
const disclosureCellStyle: CSSProperties = {
  ...tdStyle,
  paddingRight: 0,
}

/*
 * A nyitott blokk TARTALMÁNAK mértéke.
 *
 * A blokk a görgethető táblán BELÜL ül (a tábla min-widthje 832 px), tehát a
 * benne futó folyószöveg 320 px-en kilógna a látható sávból, és a munkatársnak
 * SORONKÉNT kellene oldalra görgetnie az olvasáshoz. A táblázat számainál ez
 * megengedett (WCAG 2.2 SC 1.4.10 Reflow, G225 technika: az adattábla a saját
 * konténerében görögjön), de egy MONDAT nem igényel kétdimenziós elrendezést,
 * tehát rá nem vonatkozik a kivétel.
 * Ezért a mérték a szokásos 480 px-es érték ÉS a látható sávszélesség
 * kisebbike. A 68 px a lap oldal-margója (2 × 16) plusz a tábla-konténer
 * belső térköze és kerete (2 × 17) 320 px-en MÉRVE.
 */
const disclosureMeasure =
  'min(var(--kc-as-measure, calc(480 * var(--kc-as-px, 1px))), calc(100vw - 68px))'

/* A summary a kattintható felület: a cél-magasság ezért rá is vonatkozik.
   A `display` szándékosan marad az alapértelmezett `list-item`, hogy a
   böngésző nyíl-jelölője (a nyitott/csukott állapot vizuális jele) megmaradjon
   — flexre váltva eltűnne, és a jelzés csak a segítő technológiának maradna. */
const summaryStyle: CSSProperties = {
  cursor: 'pointer',
  fontWeight: 600,
  maxWidth: disclosureMeasure,
  minHeight: 'max(44px, calc(44 * var(--kc-as-px, 1px)))',
  paddingBlock: 'calc(10 * var(--kc-as-px, 1px))',
}

/* A névsor listaelem, nem bekezdés: a felsorolás számát a képernyőolvasó
   kimondja („lista, 4 elem"), tehát a hallgató tudja, mennyit hall
   (WCAG 2.2 SC 1.3.1 Info and Relationships). */
const nameListStyle: CSSProperties = {
  marginTop: 0,
  marginBottom: 'var(--kc-as-space-3, calc(var(--base) * 0.75))',
  maxWidth: disclosureMeasure,
  paddingInlineStart: 'calc(20 * var(--kc-as-px, 1px))',
}

const noticeInDisclosureStyle: CSSProperties = {
  ...noticeStyle,
  marginBottom: 'var(--kc-as-space-3, calc(var(--base) * 0.75))',
  maxWidth: disclosureMeasure,
}

const sectionNoticeStyle: CSSProperties = {
  ...noticeStyle,
  marginBottom: 'var(--kc-as-space-4, calc(var(--base) * 1))',
}

/** Magyar ezres tagolás — egy helyen, hogy a link felirata és a szám egyezzen. */
function szam(value: number): string {
  return value.toLocaleString('hu-HU')
}

/**
 * A HIÁNYOSSÁGOT kimondó mondatok — a nyitható blokktól FÜGGETLENÜL.
 *
 * Két külön ok, két külön mondat, és mindkettő megjelenhet EGYSZERRE. Korábban
 * `else if` kötötte őket: az `omitted` elnyomta a `truncated` mondatát, holott
 * a kettő mást állít (az egyik ISMERT veszteséget nevez meg darabszámmal, a
 * másik azt, hogy a lista a felső korlátba ütközött, tehát a veszteség
 * mértékét sem tudjuk).
 */
function hianyMondatok(course: CourseEngagementRow, targy: 'nevsor' | 'szamok'): string[] {
  // A záró tagmondat magyar egyeztetés miatt kétféle: a névsorról egyes, a
  // számokról többes számban beszélünk.
  const zaras = targy === 'nevsor' ? 'ezért ez a névsor hiányos.' : 'ezért ezek a számok hiányosak.'
  const mondatok: string[] = []
  if (course.omitted > 0) {
    mondatok.push(
      `Ebből a kurzusból ${szam(course.omitted)} hozzáférő adata nem fért bele a lekérdezésbe, ${zaras}`,
    )
  }
  if (course.truncated) {
    mondatok.push(`A kurzusnak a megjeleníthetőnél több adata van, ${zaras}`)
  }
  return mondatok
}

/**
 * A névsor alatti magyarázó mondatok, a KIHAGYÁS kimondásával.
 *
 * A sorrend szándékos: előbb derüljön ki, hogy a lista hiányos, és csak utána
 * jöjjön a technikai részlet. Aki csak az első mondatot olvassa el, az is a
 * lényeget kapja (NN/g, F-mintázatú olvasás).
 */
function nevsorMagyarazat(course: CourseEngagementRow): string {
  const mondatok = hianyMondatok(course, 'nevsor')
  const megnevezheto = course.notStarted - course.notStartedWithoutName
  if (megnevezheto > course.notStartedNames.length) {
    mondatok.push(
      `A lista az első ${szam(course.notStartedNames.length)} nevet mutatja betűrendben.`,
    )
  }
  if (course.notStartedWithoutName > 0) {
    mondatok.push(
      `${szam(course.notStartedWithoutName)} hallgató neve nincs megadva, ezért nem szerepel a listán.`,
    )
  }
  mondatok.push('A teljes névsor a kurzus lapján van.')
  return mondatok.join(' ')
}

/** Van-e a kurzusnak elindítható leckéje (lásd `CourseEngagementRow.totalLessons`). */
function vanTananyag(course: CourseEngagementRow): boolean {
  return course.totalLessons > 0
}

/** Megjelenik-e a nyitható névsor ennél a kurzusnál. */
function vanNevsorBlokk(course: CourseEngagementRow): boolean {
  return vanTananyag(course) && course.notStarted > 0
}

/**
 * A kurzus MÁSODIK táblasora: a nyitható névsor, vagy — ha névsor nincs — a
 * hiányosságot kimondó mondat.
 * A kihagyás-mondat eddig KIZÁRÓLAG a nyitható blokkban élt, az pedig csak
 * `notStarted > 0` esetén jelent meg. Vagyis pont akkor volt láthatatlan,
 * amikor a tábla azt állítja, hogy MINDENKI elkezdte — holott a kimaradt
 * hozzáférők között lehet olyan, aki nem. A figyelmeztetés ezért a névsortól
 */
function CourseNoteRow({ course }: { course: CourseEngagementRow }) {
  const nevsor = vanNevsorBlokk(course)
  const hiany = hianyMondatok(course, 'szamok')
  // Nincs se névsor, se kimondanivaló hiány: a sor el sem készül. A döntés
  // ITT él, nem a hívónál — így a feltétel nem tud két helyen szétcsúszni.
  if (!nevsor && hiany.length === 0) {
    return null
  }
  return (
    <tr>
      <td style={disclosureCellStyle} colSpan={8}>
        {nevsor ? (
          <details>
            <summary style={summaryStyle}>{`Kik nem kezdték el (${szam(course.notStarted)})`}</summary>
            {course.notStartedNames.length > 0 ? (
              <ul style={nameListStyle}>
                {course.notStartedNames.map((name, index) => (
                  // A kulcs a névhez az INDEXET is hozzáveszi: két hallgatót
                  // hívhatnak ugyanúgy, és a puszta név ilyenkor ütköző kulcs
                  // lenne (a React a második elemet eldobná).
                  <li key={`${name}-${String(index)}`}>{name}</li>
                ))}
              </ul>
            ) : null}
            <p style={noticeInDisclosureStyle}>{nevsorMagyarazat(course)}</p>
          </details>
        ) : (
          <p style={noticeInDisclosureStyle}>{hiany.join(' ')}</p>
        )}
      </td>
    </tr>
  )
}

export function CourseEngagementSection({
  engagement,
}: {
  engagement: CourseEngagementReport | null | undefined
}) {
  return (
    <section style={sectionStyle}>
      <h2>Ki hol tart a kurzusokban</h2>
      {engagement === null || engagement === undefined ? (
        <p style={noticeStyle}>
          A haladás adatai most nem tölthetők be. A bevételi számok ettől függetlenül érvényesek.
          Próbáld újra később.
        </p>
      ) : engagement.courses.length === 0 ? (
        <p style={noticeStyle}>Még nincs kurzus, amiről haladást lehetne mutatni.</p>
      ) : (
        <>
          {engagement.truncated ? (
            <p style={sectionNoticeStyle}>
              A kurzusoknak a megjeleníthetőnél több adata van, ezért ezek a számok a valóságnál
              kisebbek lehetnek. A pontos, hallgatónkénti lista a kurzus lapján van.
            </p>
          ) : null}
          {/* A hibára kimaradt kurzusokat KIMONDJUK. Egy csendben eltűnt sor
              rosszabb, mint egy hiányt jelző mondat: a munkatárs azt hinné,
              hogy az a kurzus nem is létezik. A részleteket (melyik kurzus,
              milyen hiba) a szerveroldali napló őrzi. */}
          {engagement.skipped > 0 ? (
            <p style={sectionNoticeStyle}>
              {engagement.skipped === 1
                ? 'Egy kurzus adata technikai hiba miatt kimaradt ebből a táblából. A többi sor teljes.'
                : `${szam(engagement.skipped)} kurzus adata technikai hiba miatt kimaradt ebből a táblából. A többi sor teljes.`}
            </p>
          ) : null}
          {/* role="region" + aria-labelledby + tabIndex: a keskeny viewporton
              görgethető táblát billentyűzetről is lehessen görgetni (WCAG
              2.1.1; axe: scrollable-region-focusable; a minta Adrian Roselli
              Under-Engineered Responsive Tables cikkéből —
              https://adrianroselli.com/2020/11/under-engineered-responsive-tables.html;
              a fókuszgyűrűt a custom.scss adja). */}
          <div
            style={tableWrapStyle}
            role="region"
            aria-labelledby="kc-stat-kurzushatas-cim"
            tabIndex={0}
          >
            <table style={engagementTableStyle}>
              {/* Oszlopnevek: SZÓRÓL SZÓRA a kurzuslap Kurzus-haladás
                  paneljének címkéi („Hozzáfér", „Nem kezdte el"), mert a kettő
                  ugyanazt a közös összesítőt mutatja: egy fogalom egy szó
                  (WCAG 2.2 SC 3.2.4; NN/g 4. heurisztika, Consistency and
                  Standards: https://www.nngroup.com/articles/consistency-and-standards/).
                  A szóhasználat indoklása a fájl fejkommentjében. */}
              <caption style={captionStyle} id="kc-stat-kurzushatas-cim">
                Hozzáférés és haladás kurzusonként: hányan férnek hozzá, kezdték el, fejezték be
              </caption>
              <thead>
                <tr>
                  <th style={thStyle} scope="col">
                    Kurzus
                  </th>
                  <th style={thStyle} scope="col">
                    Kinek szól
                  </th>
                  <th style={thNumericStyle} scope="col">
                    Hozzáfér
                  </th>
                  <th style={thNumericStyle} scope="col">
                    Elkezdte
                  </th>
                  <th style={thNumericStyle} scope="col">
                    Befejezte
                  </th>
                  <th style={thNumericStyle} scope="col">
                    Nem kezdte el
                  </th>
                  <th style={thNumericStyle} scope="col">
                    Átlagos haladás
                  </th>
                  <th style={thStyle} scope="col">
                    Névsor
                  </th>
                </tr>
              </thead>
              <tbody>
                {engagement.courses.map((course) => (
                  <Fragment key={course.productId}>
                    <tr>
                      <th style={rowHeaderStyle} scope="row">
                        {course.title}
                      </th>
                      <td style={tdStyle}>{AUDIENCE_LABELS[course.audience]}</td>
                      <td style={numericStyle}>{szam(course.enrolled)}</td>
                      {/* ═══ „MÉG NINCS TANANYAG" — KÜLÖN MEGJELENÉSI ÁLLAPOT ═══
                          A lecke `status` mezőjének alapértelmezése `processing`,
                          ezért egy frissen feltöltött kurzusnál NULLA az
                          elindítható leckék száma. A közös összesítő ilyenkor
                          — helyesen — mindenkit `nem-kezdte` állapotba sorol, a
                          tábla viszont ebből azt állította, hogy a hozzáférők
                          egyike sem kezdte el, sőt NÉV SZERINT fel is sorolta
                          őket, piros kiemeléssel és mély linkkel. Ez konkrét
                          emberekről tett hamis állítás — köztük olyanokról, akik
                          a kurzust korábban végignézték. A négy haladás-cella
                          ezért a TÉNYT mondja ki; a „Hozzáfér" darabszám marad,
                          az igaz. A szöveg a vevői felület felirata
                          (`NO_LESSONS_LABEL`), hogy egy fogalomra egy szó jusson
                          (WCAG 2.2 SC 3.2.4). */}
                      {vanTananyag(course) ? (
                        <>
                          <td style={numericStyle}>{szam(course.started)}</td>
                          <td style={numericStyle}>{szam(course.completed)}</td>
                          <td style={numericStyle}>
                            {/* A SZÁM MAGA a link: ma három lépés kell a válaszig
                                (kurzuslap → „Haladás betöltése" → szűrő), ez egyre
                                csökkenti. A linkfelirat egy puszta szám, ezért az
                                aria-label mondja ki a célt, és TARTALMAZZA a
                                látható szöveget (WCAG 2.2 SC 2.4.4 Link Purpose és
                                SC 2.5.3 Label in Name). Nullánál nem linkelünk:
                                egy üres szűrt lista zsákutca lenne. */}
                            {course.notStarted > 0 ? (
                              <a
                                href={courseProgressHref(course.productId, 'nem-kezdte')}
                                className={EMPHASIZED_COUNT_CLASS}
                                style={countLinkStyle}
                                aria-label={`${szam(course.notStarted)} hallgató nem kezdte el, névsor a kurzus lapján: ${course.title}`}
                              >
                                {szam(course.notStarted)}
                              </a>
                            ) : (
                              szam(course.notStarted)
                            )}
                          </td>
                          <td style={numericStyle}>{`${String(course.averagePercent)}%`}</td>
                        </>
                      ) : (
                        <td style={tdStyle} colSpan={4}>
                          {NO_LESSONS_LABEL}
                        </td>
                      )}
                      <td style={tdStyle}>
                        {/* A link színét a custom.scss `.kc-adminstat a` szabálya
                            adja (ink + aláhúzás, hover accent-deep — a landing
                            link-nyelve); a márka-CSS nélkül a Payload saját
                            link-stílusa érvényesül. A `rowLinkStyle` a 44 px-es
                            cél-magasságot tartja akkor is, amikor a széles lapon
                            a felirat egyetlen sorba fér (indoklás: styles.ts). */}
                        <a href={courseProgressHref(course.productId)} style={rowLinkStyle}>
                          Névsor és szűrés a kurzus lapján
                        </a>
                      </td>
                    </tr>
                    <CourseNoteRow course={course} />
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <p
            style={{
              ...noticeStyle,
              marginTop: 'var(--kc-as-space-3, calc(var(--base) * 0.75))',
            }}
          >
            {`A nyitható blokkok kurzusonként legfeljebb ${String(NOT_STARTED_NAME_LIMIT)} nevet mutatnak. A teljes név szerinti lista a kurzus szerkesztőlapján, a Tananyag alatti Kurzus-haladás panelben van: ott állapot szerint szűrhetsz (mind, nem kezdte el, folyamatban, befejezte), név vagy e-mail alapján kereshetsz, és látod a leckénkénti lemorzsolódást is. A táblázat soraiból egy kattintással odajutsz.`}
          </p>
        </>
      )}
    </section>
  )
}
