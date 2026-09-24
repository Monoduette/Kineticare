import type { OrderFunnelCounts } from '../../../lib/statistics/revenue'
import { StatCard } from './StatCard'
import { cardRowStyle, leadInSectionStyle, noticeStyle, sectionStyle } from './styles'

/**
 * A visszatérítés és a bevétel viszonya — PONTOSAN, ahogy a kód működik.
 * Korábban ez a mondat állt itt: „A visszatérített rendelések nem számítanak
 * bevételnek." Ez a RÉSZLEGES visszatérítésre NEM igaz. A
 * `src/lib/refund/refund-order.ts` csak a TELJES refundnál írja át a rendelést
 * `refunded` státuszra; részlegesnél a státusz `paid` MARAD (és a vevő
 * hozzáférése is megmarad, mert a részrefund tipikusan kártérítés, nem a
 * visszavásárlás). Hogy a részleges visszatérítés levonódik-e, az a nézőtől
 * függ (a `refunds` mező tulajdonosi olvasású), ezért azt a felső kártyák
 * alatti mondat mondja ki (TotalsCards), itt csak a teljes visszatérítés áll.
 */
const VISSZATERITES_MEGJEGYZES =
  'A teljesen visszatérített rendelés nem számít bele a befizetésekbe. A részleges visszatérítés kezelését a felső összesítő alatti mondat írja le.'

/**
 * „Rendelések állapota" szekció: a rendelés-tölcsér operatív oldala.
 * A tölcsér a TELJES állományt számolja (nem a 12 hónapos ablakot), mert a
 * nyitott vagy sikertelen fizetés akkor is teendő, ha régi.
 * A régi cím félrevezető volt: olyan kártyákat is takart, amik NEM kérnek
 * beavatkozást (fizetve, megszakítva). A címsor mondja meg, mit tartalmaz a
 * szekció (WCAG 2.2 SC 2.4.6 Headings and Labels:
 */
export function FunnelSection({ funnel }: { funnel: OrderFunnelCounts }) {
  const needsAttention = funnel.created + funnel.paymentPending + funnel.paymentFailed
  return (
    <section style={sectionStyle}>
      <h2>Rendelések állapota</h2>
      {/* A teendő-mondat a cím alatt, LEAD-ként: ez a szekció lényege, és a
          kártyák fölött olvasva rögtön keretet ad a négy számnak. */}
      <p style={leadInSectionStyle}>
        {needsAttention === 0
          ? 'Nincs nyitott vagy sikertelen fizetés, ami beavatkozást kérne.'
          : `${needsAttention.toLocaleString('hu-HU')} rendelés vár még befejezésre vagy újrakezdésre (leadva, fizetésre vár, vagy a kártya nem ment át).`}
      </p>
      <div style={cardRowStyle}>
        <StatCard label="Fizetve" value={funnel.paid.toLocaleString('hu-HU')} />
        {/* „vagy", nem per-jel: a GOV.UK stílus-szabály szerint a / nem
            helyettesíti az „or"-t (képernyőolvasónak és keresőnek is rossz) —
            https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/style-guides/a-to-z-style-guide/
            (Slashes szócikk); összhangban a ui-sztenderdek §3.1 natív magyar
            mikroszöveg-szabályával. */}
        <StatCard
          label="Folyamatban (leadva vagy várakozik)"
          value={(funnel.created + funnel.paymentPending).toLocaleString('hu-HU')}
        />
        {/* A nullánál nagyobb sikertelen fizetés a márka danger tokenjét
            kapja (--kc-as-danger = #b3261e, a fehér kártyán számolt 6,54:1
            kontraszttal — custom.scss jegyzőkönyv; a Payload --theme-error-500
            a tartalék, ha a márka-CSS nem töltődik be). A jelentést a címke
            szövege hordozza, nem a szín (WCAG 1.4.1). */}
        <StatCard
          label="Sikertelen fizetés"
          value={funnel.paymentFailed.toLocaleString('hu-HU')}
          valueColor={
            funnel.paymentFailed > 0 ? 'var(--kc-as-danger, var(--theme-error-500))' : undefined
          }
        />
        <StatCard label="Megszakítva" value={funnel.cancelled.toLocaleString('hu-HU')} />
      </div>
      {/* A visszatérítés-megjegyzés a kártyák ALATT marad: ez nem teendő,
          hanem a bevétel-számok olvasati szabálya. */}
      <p style={noticeStyle}>{VISSZATERITES_MEGJEGYZES}</p>
    </section>
  )
}
