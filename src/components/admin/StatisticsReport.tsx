import type { CourseEngagementReport } from '../../lib/statistics/engagement'
import { STATISTICS_ACCESS_DENIED_MESSAGE, type RevenueReport } from '../../lib/statistics/revenue'
import { CourseEngagementSection } from './statistics/CourseEngagementSection'
import { CourseRevenueTable } from './statistics/CourseRevenueTable'
import { FunnelSection } from './statistics/FunnelSection'
import { MonthlyRevenueSection } from './statistics/MonthlyRevenueSection'
import {
  eyebrowStyle,
  headingStyle,
  leadStyle,
  noticeStyle,
  pageHeaderStyle,
  pageStyle,
  sectionStyle,
  sectionTopStyle,
} from './statistics/styles'
import { TotalsCards } from './statistics/TotalsCards'

/**
 * A Statisztika nézet KOMPOZÍCIÓS GYÖKERE — a lekérdezés és a jogosultság a
 */

export function StatisticsAccessDenied() {
  return (
    <div className="kc-adminstat" style={pageStyle}>
      <h1 style={headingStyle}>Statisztika</h1>
      <p>{STATISTICS_ACCESS_DENIED_MESSAGE}</p>
    </div>
  )
}

export function StatisticsUnavailable() {
  return (
    <div className="kc-adminstat" style={pageStyle}>
      <h1 style={headingStyle}>Statisztika</h1>
      <p>A kimutatás most nem tölthető be. Próbáld újra később.</p>
    </div>
  )
}

/**
 * A teljes kimutatás. Az `engagement` hiánya (null/undefined) NEM dönti el az
 * oldalt: a bevételi szekciók változatlanul megjelennek, a haladás-szekció
 * helyén magyar magyarázat áll — a részleges adat is több, mint a semmi.
 */
export function StatisticsReport({
  report,
  engagement,
}: {
  report: RevenueReport
  engagement?: CourseEngagementReport | null
}) {
  return (
    <div className="kc-adminstat" style={pageStyle}>
      {/* A fejrész saját blokk, hairline zárással: a lap azonosítója (eyebrow +
          cím + magyarázat) elválik az adattól. A magyarázó bekezdés mérték-
          korláttal fut, míg a kártyák és a táblák teljes szélességűek — a
          szélességi rendszer indoklása a styles.ts fejkommentjében. */}
      <header style={pageHeaderStyle}>
        {/* A `kc-adminstat__eyebrow` osztály adja a landing felvezető-sorának
            akcent-színét és az alatta futó rövid akcent-vonalat (custom.scss);
            a márka-CSS nélkül csak az inline stílus marad, a sor akkor is
            olvasható. */}
        <p className="kc-adminstat__eyebrow" style={eyebrowStyle}>
          Kimutatások
        </p>
        <h1 style={headingStyle}>Statisztika</h1>
        <p style={leadStyle}>
          Havi bevétel a számla teljesítési dátuma szerint (ha nincs számla, a rendelés leadásának
          hónapja, magyar idő szerint). Csak a kifizetett rendelések számítanak. Az otthoni és a
          szakmai ág tételenként válik szét, mert egy kosárban mindkettő lehet.
        </p>
        {report.truncated ? (
          <p style={{ ...noticeStyle, marginTop: 'var(--kc-as-space-3, calc(var(--base) * 0.75))' }}>
            Sok a rendelés, ezért csak a legutóbbiakat számoltuk össze. A számok emiatt kisebbek a
            valóságosnál.
          </p>
        ) : null}
      </header>
      {/* Az összesítő kártyák MOST kaptak `h2`-t. Fejléc nélkül a lap első
          adatblokkja kimaradt a címsorfából, tehát képernyőolvasóval nem
          lehetett ráugrani, és a „mit mutat ez a négy szám" kérdésre sem volt
          válasz a kártyák fölött (WCAG 2.2 SC 2.4.6 Headings and Labels:
          https://www.w3.org/WAI/WCAG22/Understanding/headings-and-labels.html).
          A szekció felül NEM kap hairline-t: a fejrész zárása már elválasztja,
          két egymás alatti vonal fölösleges lenne. */}
      <section style={sectionTopStyle}>
        <h2>Bevétel az elmúlt 12 hónapban</h2>
        <TotalsCards totals={report.totals} />
      </section>
      <FunnelSection funnel={report.funnel} />
      {/* A haladás-szekció a nevekkel: a „nem kezdte el" szám maga is link, ami
          a kurzus lapján rögtön a szűrt névsorra visz. */}
      <CourseEngagementSection engagement={engagement} />
      <MonthlyRevenueSection rows={report.months} />
      <section style={sectionStyle}>
        <h2>Bevétel kurzusonként</h2>
        <CourseRevenueTable rows={report.courses} />
      </section>
    </div>
  )
}
