import Link from 'next/link'

import { ctaLabel } from '../../lib/cta-vocabulary'
import { Button } from '../ui/Button'

import '../../app/(frontend)/styles/blocks/empty-state.css'

/**
 * PostsEmptyState — a Tudástár ÉRTELMES üres állapota (bloglista és
 */

export type PostsEmptyStateVariant = 'tudastar' | 'kategoria'

export interface PostsEmptyStateProps {
  /**
   * 'tudastar' — a teljes Tudástár üres (még egy cikk sincs);
   * 'kategoria' — csak a szűrt nézet üres, máshol VAN olvasnivaló.
   * A kettő más mondatot és más továbbvezetést kíván: az elsőnél a lap
   * jövőjét kell elmagyarázni, a másodiknál vissza kell vinni a teljes
   * listához (NN/g: a „no results" és a „first use" nem ugyanaz az állapot).
   */
  variant: PostsEmptyStateVariant
  /**
   * A tudatosan ingyenes kurzus kanonikus útvonala, ha van ilyen published
   * termék. Hiányában az ingyenes út NEM jelenik meg.
   */
  freeCourseHref?: string | null
  /** A cím id-je — ez adja a szekció hozzáférhető nevét (aria-labelledby). */
  headingId?: string
}

const HEADING_ID = 'tudastar-ures-cim'

export function PostsEmptyState({
  variant,
  freeCourseHref,
  headingId = HEADING_ID,
}: PostsEmptyStateProps) {
  const isHub = variant === 'tudastar'
  const freeHref = typeof freeCourseHref === 'string' && freeCourseHref.length > 0 ? freeCourseHref : null

  return (
    <section aria-labelledby={headingId} className="kc-empty-panel">
      <h2 className="kc-empty-panel__title" id={headingId}>
        {isHub ? 'Hamarosan érkeznek az első cikkek' : 'Ebben a témában még nincs cikk'}
      </h2>

      <p className="kc-empty-panel__lead">
        {isHub
          ? 'A Tudástárba kézrehabilitációs cikkek kerülnek: otthon végezhető gyakorlatok, a felépülés szakaszai és a rendelőben szerzett tapasztalataink.'
          : 'A többi témában viszont már találsz olvasnivalót a Tudástárban.'}
      </p>

      <p className="kc-empty-panel__hint">
        {isHub
          ? 'Amíg az első cikkek elkészülnek, innen tudsz továbbindulni:'
          : 'Innen tudsz továbbindulni:'}
      </p>

      <ul className="kc-empty-panel__actions">
        {isHub ? null : (
          <li>
            <Button href="/blog" variant="primary">
              Vissza a Tudástárba
            </Button>
          </li>
        )}
        <li>
          <Button href="/kurzusok" variant={isHub ? 'primary' : 'secondary'}>
            {ctaLabel('course-list-open')}
          </Button>
        </li>
        {isHub && freeHref !== null ? (
          <li>
            <Button href={freeHref} variant="secondary">
              {ctaLabel('free-course-claim')}
            </Button>
          </li>
        ) : null}
      </ul>

      {/* §3.2 #33: a /kapcsolat oldalra vivő CSELEKVÉS felirata mindenhol
          „Írj nekünk". A puszta „Kapcsolat" menücímke (N-3), és gombként nem
          mondja meg, mi történik (M-7). */}
      <p className="kc-empty-panel__contact">
        Ha kérdésed van a felépülésről,{' '}
        <Link className="kc-empty-panel__contact-link" href="/kapcsolat">
          {ctaLabel('contact-open')}
        </Link>{' '}
        a kapcsolati oldalon.
      </p>
    </section>
  )
}
