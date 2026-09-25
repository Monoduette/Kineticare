import { AUDIENCE_LABELS } from '../../../lib/course-audience'
import { formatHuf, type RevenueTotals } from '../../../lib/statistics/revenue'
import { StatCard } from './StatCard'
import { cardRowStyle, noticeStyle } from './styles'

/**
 * A kártyák címkéje: tájékoztató, bruttó (áfás) befizetés, nem könyvelési
 * bevétel (a-egyeztetes-8). A régi „Összes bevétel” címke könyvelési számnak
 * látszott, pedig a lap nem ismeri a díjakat, a teljes visszatérítés utólag
 * kiveszi a rendelést az eredeti hónapjából, és a hónap a számla
 * teljesítéséből jön. Az adó- és keret-döntés forrása a Számlázz.hu és a
 * Barion havi kivonata; ezt a kártyák alatti mondat kimondja.
 */
export const BRUTTO_BEFIZETES_CIMKE = 'Bruttó befizetések (tájékoztató)'

export const KONYVELES_MEGJEGYZES =
  'Tájékoztató szám a vevők bruttó befizetéseiről. A könyveléshez és az adóhoz a Számlázz.hu számlái és a Barion havi kivonata az irányadó.'

export const RESZLEGES_LEVONVA = 'A részleges visszatérítést a visszatérítés hónapjában levontuk.'

/**
 * A levonás hatóköre (PR #305, Codex P2): a visszatérítés-bejegyzés csak
 * összeget és időpontot hordoz (`refunds`: transactionId, amountHuf, status,
 * refundedAt, type), tételt nem. Az ág- és a kurzusbontás ezért teljes
 * összeggel számol; találgatott szétosztás helyett ezt a lap kimondja.
 * A mondat a levonás mondata után áll; az indoklás csak itt szerepel, mert
 * csak a tulajdonosi nézetre igaz. A kurzustábla alatti jegyzet
 * (`KURZUS_TELJES_OSSZEG`) indoklás nélkül ismétli a tényt, így a munkatársi
 * nézetben sem ad a lap két különböző okot ugyanarra a számra.
 */
export const RESZLEGES_AGAK_NEM_LEVONVA =
  'Az otthoni és a szakmai ág összegéből, valamint a kurzusonkénti bevételből nem vontuk le, mert a visszatérítésnél nincs rögzítve, melyik kurzusra szólt.'

export const RESZLEGES_NINCS_LEVONVA =
  'A részlegesen visszatérített rendelés itt a teljes összegével szerepel, mert a visszatérítések ezen a nézeten nem olvashatók.'

/** A nézet felső kártyasora: 12 havi bruttó befizetés összesen és áganként. */
export function TotalsCards({ totals }: { totals: RevenueTotals }) {
  return (
    <>
      <div className="kc-as-card-row" style={cardRowStyle}>
        <StatCard label={BRUTTO_BEFIZETES_CIMKE} value={formatHuf(totals.totalHuf)} />
        <StatCard label={AUDIENCE_LABELS.laikus} value={formatHuf(totals.laikusHuf)} />
        <StatCard label={AUDIENCE_LABELS.szakember} value={formatHuf(totals.szakemberHuf)} />
        {totals.refundsDeducted === true ? (
          <StatCard
            label="Levont részleges visszatérítés"
            value={formatHuf(totals.refundHuf ?? 0)}
          />
        ) : null}
        <StatCard label="Fizetett rendelések" value={totals.orderCount.toLocaleString('hu-HU')} />
      </div>
      <p style={{ ...noticeStyle, marginTop: 'var(--kc-as-space-3, calc(var(--base) * 0.75))' }}>
        {KONYVELES_MEGJEGYZES}{' '}
        {totals.refundsDeducted === true
          ? `${RESZLEGES_LEVONVA} ${RESZLEGES_AGAK_NEM_LEVONVA}`
          : RESZLEGES_NINCS_LEVONVA}
      </p>
    </>
  )
}
