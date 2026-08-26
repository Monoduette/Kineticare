import { resolveCourseCta } from '../../lib/courses'
import type { Product } from '../../payload-types'
import { Button } from '../ui/Button'

/**
 * CourseCta — a kurzus-oldal vásárlási akciója (az értékesítés motorja).
 * komponens NEM dönt, csak megjelenít:
 */
export interface CourseCtaProps {
  /**
   * A `priceInHUF` KÖTELEZŐ: a CTA az ÉRVÉNYES árat kérdezi, nem csak az
   * ár-pipát — enélkül a hiányos konfigurációjú termék megint „Megveszem"
   * gombot kapna, és a checkout 400-zal utasítaná el.
   */
  product: Pick<Product, 'id' | 'slug' | 'status' | 'priceInHUF' | 'priceInHUFEnabled'>
  /** Bejelentkezett felhasználó purchases-listája alapján (csak olvasás). */
  hasPurchased: boolean
  /**
   * A CTA-blokk horgonya. A ragadós vásárlósáv (CourseBuyBar) EZT figyeli
   * IntersectionObserverrel: a sáv pontosan akkor jelenik meg, amikor ez a
   * gomb nem látszik — bármilyen okból (kigörgött, vagy a ragadós doboz
   * belső görgetése levágta).
   */
  id?: string
}

export function CourseCta({ product, hasPurchased, id }: CourseCtaProps) {
  const cta = resolveCourseCta(product, hasPurchased)

  // Az `id` a ragadós vásárlósáv horgonya: az IntersectionObserver ezt a
  // CTA-blokkot figyeli, nem a teljes dobozt — így pontosan akkor gyújt,
  // amikor maga a GOMB nem látszik.
  return (
    <div className="kc-course-cta" id={id}>
      {/* A `label !== null` nem formalitás: a nem cselekvő (archivált, hiányos
          konfigurációjú) állapotoknak SZÁNDÉKOSAN nincs feliratuk (Á-3, §3.2
          #16) — letiltott „Megveszem" helyett a cselekvés eltűnik, és a
          magyarázó mondat mondja meg, miért. */}
      {cta.label !== null ? (
        <Button
          href={cta.href ?? undefined}
          variant={cta.kind === 'purchased' ? 'secondary' : 'primary'}
        >
          {cta.label}
        </Button>
      ) : null}
      {cta.note !== null ? <p className="kc-course-cta__note">{cta.note}</p> : null}
      {cta.kind === 'purchased' ? (
        <p className="kc-course-cta__note kc-course-cta__note--owned">
          Már megvetted ezt a kurzust.
        </p>
      ) : null}
    </div>
  )
}
