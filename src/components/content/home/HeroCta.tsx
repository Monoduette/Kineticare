import { ctaLabel } from '../../../lib/cta-vocabulary'
import { Button } from '../../ui/Button'

/**
 * HeroCta — a kezdőlap hero elsődleges/másodlagos akciói (audit M1/K3).
 */
export function HeroCta({ hasFreeSos = false }: { hasFreeSos?: boolean } = {}) {
  return (
    <div className="kc-hero__actions">
      <Button href="/kurzusok">{ctaLabel('course-list-open')}</Button>
      {/* §3.2 #38: a szótári ingyenes ajánlat csak igazolt, elérhető SOS-sávra visz. */}
      {hasFreeSos ? (
        <Button href="#ingyenes" variant="ghost">
          {ctaLabel('free-strip-jump')}
        </Button>
      ) : null}
    </div>
  )
}
