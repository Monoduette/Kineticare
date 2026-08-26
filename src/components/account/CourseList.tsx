import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ProgressBar, ProgressRing } from '@/components/ui/Progress'

import {
  COMPLETED_GROUP_TITLE,
  CURRENT_GROUP_TITLE,
  EMPTY_BODY,
  EMPTY_CTA_HREF,
  EMPTY_CTA_LABEL,
  EMPTY_TITLE,
  EXPIRED_GROUP_TITLE,
  groupCourseCards,
  type CourseCardView,
} from './course-list-order'

/**
 * CourseList — a „Kurzusaim" képernyő kártyalistája.
 */

export interface CourseListProps {
  /** Kész kártya-nézetek — a sorrendet és a csoportokat ez a komponens képzi. */
  cards: CourseCardView[]
}

/** Egyetlen kurzus kártyája. */
function CourseCard({ card }: { card: CourseCardView }) {
  const expired = card.status === 'expired'
  const complete = card.status === 'completed'

  return (
    <li className="kc-mycourses__item">
      <Card
        as="article"
        className={`kc-mycourse${expired ? ' kc-mycourse--expired' : ''}`}
        interactive
        padded={false}
      >
        <div className="kc-mycourse__media">
          {card.cover ? (
            // eslint-disable-next-line @next/next/no-img-element -- a Payload media méretei kézileg vannak bekötve (width/height a CMS-ből)
            <img
              alt=""
              decoding="async"
              height={card.cover.height ?? undefined}
              loading="lazy"
              src={card.cover.url}
              width={card.cover.width ?? undefined}
            />
          ) : (
            <span aria-hidden="true" className="kc-mycourse__media-placeholder" />
          )}
          {/* A kör DEKORATÍV (aria-hidden a komponensben): ugyanezt az adatot a
              mikro-meta és a sáv `aria-valuetext`-je szövegesen is elmondja. */}
          {card.showProgress ? (
            <span className="kc-mycourse__ring">
              <ProgressRing complete={complete} percent={card.percent} size={44} />
            </span>
          ) : null}
        </div>

        <div className="kc-mycourse__body">
          <h3 className="kc-mycourse__title">{card.title}</h3>
          <p className="kc-mycourse__meta">{card.metaLine}</p>

          {card.showProgress ? (
            <ProgressBar
              className="kc-mycourse__bar"
              label={`${card.title} — haladás`}
              percent={card.percent}
              valueText={card.progressValueText}
            />
          ) : null}

          {expired ? (
            <p className="kc-course-access kc-course-access--expired">{card.expiredMessage}</p>
          ) : card.expiryLabel ? (
            <p className="kc-course-access">{card.expiryLabel}</p>
          ) : null}

          <Button
            className="kc-mycourse__cta"
            href={card.href}
            variant={expired ? 'secondary' : 'primary'}
          >
            {card.ctaLabel}
            {/* Kettőspont, nem kvirtmínusz: a hozzáférhető NÉV is vevői szöveg,
                és a magyar tipográfiában az U+2014 nem írásjel
                (docs/ui-sztenderdek.md §3.1.1). A `CartView` rejtett szövege
                ugyanezt a kettőspontos alakot használja. */}
            <span className="kc-visually-hidden">{`: ${card.ctaContext}`}</span>
          </Button>
        </div>
      </Card>
    </li>
  )
}

/** Kártyarács — a csoportok mindegyike ezt használja, azonos ritmussal. */
function CourseGrid({ cards }: { cards: CourseCardView[] }) {
  return (
    <ul className="kc-mycourses__grid" role="list">
      {cards.map((card) => (
        <CourseCard card={card} key={card.productId} />
      ))}
    </ul>
  )
}

export function CourseList({ cards }: CourseListProps) {
  if (cards.length === 0) {
    return (
      <div className="kc-mycourses__empty" role="status">
        <h2 className="kc-mycourses__empty-title">{EMPTY_TITLE}</h2>
        <p className="kc-mycourses__empty-body">{EMPTY_BODY}</p>
        <Button href={EMPTY_CTA_HREF}>{EMPTY_CTA_LABEL}</Button>
      </div>
    )
  }

  const groups = groupCourseCards(cards)

  return (
    <div className="kc-mycourses">
      {groups.current.length > 0 ? (
        <section aria-labelledby="kc-mycourses-current" className="kc-mycourses__group">
          {/* A vizuális sorrend (folyamatban → el nem kezdett) önmagában
              beszédes, ezért a csoportnak nincs LÁTHATÓ címe — a landmark
              megnevezéséhez viszont kell egy címsor. */}
          <h2 className="kc-visually-hidden" id="kc-mycourses-current">
            {CURRENT_GROUP_TITLE}
          </h2>
          <CourseGrid cards={groups.current} />
        </section>
      ) : null}

      {groups.completed.length > 0 ? (
        <details className="kc-mycourses__collapsible kc-mycourses__group">
          <summary className="kc-mycourses__summary">
            <h2 className="kc-mycourses__group-title">
              {`${COMPLETED_GROUP_TITLE} (${groups.completed.length})`}
            </h2>
          </summary>
          <CourseGrid cards={groups.completed} />
        </details>
      ) : null}

      {groups.expired.length > 0 ? (
        <section aria-labelledby="kc-mycourses-expired" className="kc-mycourses__group">
          <h2 className="kc-mycourses__group-title" id="kc-mycourses-expired">
            {EXPIRED_GROUP_TITLE}
          </h2>
          <CourseGrid cards={groups.expired} />
        </section>
      ) : null}
    </div>
  )
}
