/**
 * Tartalmi funnel-mérés őrei.
 *
 *  1. Az esemény-katalógus tartalmazza a négy tartalmi eseményt — a
 *     funnel-riportok név szerint hivatkoznak rájuk.
 *  2. A cikk alatti híd-rendszer linkjei hordozzák a `data-cta` jelölést,
 *     különben a delegált kattintás-figyelő (ArticleEngagement.ctaKindOf)
 *     nem tudja őket megnevezni. A repo tesztkörnyezete node (nincs jsdom),
 *     ezért a delegálás DOM-logikáját nem itt, hanem a renderelt HTML
 *     jelölésein keresztül őrizzük — a ctaKindOf maga csak closest()
 *     hívások sora, a jelölés a törékeny fele.
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { PostCourseCta } from '../components/content/PostCourseCta'
import { ANALYTICS_EVENTS } from '../lib/analytics/posthog'

describe('tartalmi esemény-katalógus', () => {
  it('a négy tartalmi esemény neve rögzített', () => {
    expect(ANALYTICS_EVENTS.articleViewed).toBe('article_viewed')
    expect(ANALYTICS_EVENTS.articleRead).toBe('article_read')
    expect(ANALYTICS_EVENTS.articleCtaClicked).toBe('article_cta_clicked')
    expect(ANALYTICS_EVENTS.faqOpened).toBe('faq_opened')
  })
})

describe('PostCourseCta data-cta jelölések', () => {
  const course = {
    id: 1,
    slug: 'otthoni-kezrehab-program',
    title: 'Otthoni KézRehab Program',
    shortDescription: null,
    priceInHUFEnabled: true,
    priceInHUF: 79500,
    status: 'published',
  } as never

  const freeCourse = {
    id: 2,
    slug: 'sos-kezrelax-villamkurzus',
    title: 'SOS Kézrelax villámkurzus',
    shortDescription: null,
    priceInHUFEnabled: false,
    status: 'published',
  } as never

  it('kurzus-változat: kurzus + ingyenes sor + időpont jelölve', () => {
    const html = renderToStaticMarkup(
      <PostCourseCta course={course} freeCourse={freeCourse} variant="kurzus" />,
    )
    expect(html).toContain('data-cta="kurzus"')
    expect(html).toContain('data-cta="ingyenes-kurzus"')
    expect(html).toContain('data-cta="idopont"')
  })

  it('időpont-változat: időpont jelölve, kurzus gomb nincs', () => {
    const html = renderToStaticMarkup(
      <PostCourseCta course={null} freeCourse={freeCourse} variant="idopont" />,
    )
    expect(html).toContain('data-cta="idopont"')
    expect(html).not.toContain('data-cta="kurzus"')
  })
})


