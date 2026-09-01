import { AUDIENCE_LABELS } from '../../../lib/course-audience'
import { formatHuf, type RevenueTotals } from '../../../lib/statistics/revenue'
import { StatCard } from './StatCard'
import { cardRowStyle } from './styles'

/** A nézet felső kártyasora: 12 havi bevétel összesen és áganként. */
export function TotalsCards({ totals }: { totals: RevenueTotals }) {
  return (
    <div className="kc-as-card-row" style={cardRowStyle}>
      <StatCard label="Összes bevétel (12 hónap)" value={formatHuf(totals.totalHuf)} />
      <StatCard label={AUDIENCE_LABELS.laikus} value={formatHuf(totals.laikusHuf)} />
      <StatCard label={AUDIENCE_LABELS.szakember} value={formatHuf(totals.szakemberHuf)} />
      <StatCard label="Fizetett rendelések" value={totals.orderCount.toLocaleString('hu-HU')} />
    </div>
  )
}
