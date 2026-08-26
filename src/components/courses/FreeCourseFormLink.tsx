import { ctaLabel } from '../../lib/cta-vocabulary'

/**
 * FreeCourseFormLink — ISMÉTELT belépő az ingyenes kurzus igénylő űrlapjához,
 */

/**
 * Az igénylő űrlap horgonya elé írt magyarázat. Tegező.
 * szöveg azt írta, hogy „a neved és az e-mail-címed kell hozzá" — az űrlapnak
 * viszont HÁROM kötelező eleme van: név, e-mail-cím ÉS az adatkezelési
 * jelölőnégyzet (`FreeCourseRequestForm`, mindhárom `required`, a
 * jelölőnégyzet címkéje maga is „(kötelező)"-t ír ki). A kettőt említő mondat
 * tehát ALULMONDTA a tényleges ráfordítást, ami az NN/g szerint pont az a
 */
export const FREE_COURSE_FORM_LINK_TEXT =
  'Az igénylő űrlap a lap tetején van. Rövid, és fizetned nem kell érte.'

export interface FreeCourseFormLinkProps {
  /** Az igénylő űrlap horgonya a lapon (a vásárlódoboz CTA-blokkjának id-je). */
  formId: string
}

export function FreeCourseFormLink({ formId }: FreeCourseFormLinkProps) {
  return (
    <div className="kc-course-recall">
      <p className="kc-course-recall__text">{FREE_COURSE_FORM_LINK_TEXT}</p>
      <a className="kc-button kc-button--secondary kc-course-recall__cta" href={`#${formId}`}>
        {ctaLabel('free-course-request-link')}
      </a>
    </div>
  )
}
