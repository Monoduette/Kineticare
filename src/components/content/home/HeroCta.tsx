import { ctaLabel } from '../../../lib/cta-vocabulary'
import { Button } from '../../ui/Button'

/**
 * HeroCta — a kezdőlap hero elsődleges/másodlagos akciói (audit M1/K3).
 */
export function HeroCta() {
  return (
    <div className="kc-hero__actions">
      <Button href="/kurzusok">{ctaLabel('course-list-open')}</Button>
      {/* §3.2 #38 — lapon belüli ugrás az ingyenes sávra. A korábbi „Ingyenes
          SOS gyakorlatok" főnévi alak volt, és nem mondta meg, mi történik
          (M-7). Az „ingyenes" jelző a sávon BADGE-ként jelenik meg, nem a
          gombban (a #3 sor ugyanezt írja elő). */}
      <Button href="#ingyenes" variant="ghost">
        {ctaLabel('free-strip-jump')}
      </Button>
    </div>
  )
}
