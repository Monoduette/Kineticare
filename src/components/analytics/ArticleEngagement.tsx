'use client'

import { useEffect } from 'react'

import { ANALYTICS_EVENTS, captureAnalyticsEvent } from '@/lib/analytics/posthog'

/**
 * ArticleEngagement — a cikk/hub tartalmi funnel-eseményei egy helyen.
 *
 * ═══ MIÉRT DELEGÁLÁS, ÉS NEM KLIENSKOMPONENS-ERDŐ ═══
 * A cikk alatti híd-rendszer (kurzus-panel, ingyenes sor, időpont-doboz,
 * kapcsolódó kártyák, jegyzék, GYIK) csupa SZERVER-komponens — pont ettől
 * gyors. Ha mindegyiket 'use client'-re váltanánk egy onClick kedvéért, a
 * cikkoldal hidratálandó JS-e nőne meg mérés miatt. Ehelyett EGY láthatatlan
 * kliens-komponens figyel dokumentum-szinten:
 *  - kattintás-delegálás: a `data-cta` jelölt linkek, a `.kc-post-related`
 *    kártyái és a `.kc-post-toc` jegyzék-linkjei;
 *  - `toggle` esemény (capture fázisban, mert nem buborékol) a GYIK natív
 *    `details` elemein;
 *  - IntersectionObserver a cikk végi CTA-szekción: aki odáig görgetett, az
 *    a törzs végére ért (article_read, cikkenként egyszer).
 *
 * A consent-kaput a captureAnalyticsEvent viszi (hozzájárulás nélkül no-op),
 * személyes adat egyik eseményben sincs: slug, CTA-fajta, kérdés-szöveg
 * (saját publikált tartalom) és cél-útvonal megy ki.
 */
export interface ArticleEngagementProps {
  /** A cikk slugja (posts collection) — minden esemény közös kulcsa. */
  articleSlug: string
  /** A megjelenítési útvonal: `/blog/{slug}` vagy a gyökér-hub (`/{hub}`). */
  path: string
}

/** A kattintott link CTA-fajtája, vagy null, ha nem mérendő kattintás. */
export function ctaKindOf(target: Element): { cta: string; href: string } | null {
  const link = target.closest('a')
  if (link === null) return null
  const href = link.getAttribute('href') ?? ''
  const explicit = link.closest('[data-cta]')?.getAttribute('data-cta')
  if (typeof explicit === 'string' && explicit.length > 0) {
    return { cta: explicit, href }
  }
  if (link.closest('.kc-post-related') !== null) return { cta: 'kapcsolodo-cikk', href }
  if (link.closest('.kc-post-toc') !== null) return { cta: 'jegyzek', href }
  return null
}

export function ArticleEngagement({ articleSlug, path }: ArticleEngagementProps): null {
  useEffect(() => {
    captureAnalyticsEvent(ANALYTICS_EVENTS.articleViewed, { articleSlug, path })

    const onClick = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return
      const found = ctaKindOf(event.target)
      if (found === null) return
      captureAnalyticsEvent(ANALYTICS_EVENTS.articleCtaClicked, {
        articleSlug,
        path,
        cta: found.cta,
        target: found.href,
      })
    }

    // A `toggle` nem buborékol — capture fázisban, dokumentum-szinten fogjuk.
    const onToggle = (event: Event) => {
      const details = event.target
      if (!(details instanceof HTMLDetailsElement) || !details.open) return
      if (details.closest('.kc-post-faq') === null) return
      const question = details.querySelector('summary')?.textContent?.trim() ?? ''
      captureAnalyticsEvent(ANALYTICS_EVENTS.faqOpened, { articleSlug, path, question })
    }

    document.addEventListener('click', onClick)
    document.addEventListener('toggle', onToggle, true)

    // article_read: a cikk végi CTA-szekció (minden cikk alatt áll) feltűnése
    // a viewportban = a törzs végigolvasva/végiggörgetve. Egyszeri retesz.
    let readSent = false
    const sentinel = document.querySelector('.kc-post-cta')
    let observer: IntersectionObserver | undefined
    if (sentinel !== null && typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver(
        (entries) => {
          if (readSent || !entries.some((entry) => entry.isIntersecting)) return
          readSent = true
          captureAnalyticsEvent(ANALYTICS_EVENTS.articleRead, { articleSlug, path })
          observer?.disconnect()
        },
        { threshold: 0.1 },
      )
      observer.observe(sentinel)
    }

    return () => {
      document.removeEventListener('click', onClick)
      document.removeEventListener('toggle', onToggle, true)
      observer?.disconnect()
    }
    // Mount-egyszeri bekötés: a slug/path a lap életében nem változik.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [articleSlug, path])
  return null
}
