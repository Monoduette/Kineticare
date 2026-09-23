import type { BlockCtaBanner } from '../../payload-types'
import { ctaBannerFigura, type CtaBannerCourseCover } from '../../lib/cta-banner-course'
import { MediaImage } from '../content/MediaImage'
import { mediaAlt } from '../content/media-url'
import { Button } from '../ui/Button'
import { Container } from '../ui/Container'
import { Section } from '../ui/Section'

import '../../app/(frontend)/styles/blocks/cta-banner.css'

/**
 * CtaBanner — CTA-sáv egyetlen gombbal (szekció-rendszer terv 2. katalógus).
 *
 * Cím + rövid szöveg + egy gomb. A gomb a közös Button primitívet használja
 * (egységes fókusz-, méret- és állapotkezelés); felirat vagy webcím hiányában a
 * sáv gomb nélkül jelenik meg — kitalált CTA-t nem teszünk ki.
 *
 * Értékesítési UX-skill: a sáv NEM sürget és nem tartalmaz dark patternt, a
 * gomb szövege a szerkesztőé. Több CTA-sáv egy oldalon gyengíti egymást — erre
 * a blokk admin-leírása figyelmeztet.
 *
 * KURZUS-BORÍTÓ (tulajdonosi kérés, 2026-09-19): ha a gomb egy kurzusra (vagy
 * a kurzuslistára) mutat, a sáv a kurzus meglévő borítóképét mutatja kicsiben
 * a szöveg mellett. A feloldást a RenderBlocks végzi a lap termékeiből
 * (src/lib/cta-banner-course.ts), a komponens csak a kész képet kapja; kép
 * nélkül a sáv a régi, kétoszlopos alakjában marad. A kép MÁSODLAGOS elem:
 * nem link, nem gomb, a cím és a gomb súlyát nem éri el (NN/g, Visual
 * Hierarchy: https://www.nngroup.com/articles/visual-hierarchy-ux-definition/;
 * Material 3, Cards: a média a tartalom kísérője, nem önálló cselekvés,
 * https://m3.material.io/components/cards/guidelines). Alt-szöveg: a média
 * saját alt-ja, hiányában „<kurzus címe> borítóképe" (WCAG 2.2 SC 1.1.1).
 *
 * FELTÖLTÖTT KÉP (H28, 2026-09-23): a blokk „Kép” mezője (`block.kep`)
 * megelőzi a számított képet; a komponens maga olvassa, a RenderBlocks
 * változatlanul a számított `courseCover`-t adja át. Üres mezőnél a kimenet
 * bájtra a korábbi (src/__tests__/cta-sav-feltoltott-kep.test.tsx). A
 * szabály és a forrásai: src/lib/cta-banner-course.ts `ctaBannerFigura`.
 */
export interface CtaBannerProps {
  block: BlockCtaBanner
  /** A gomb céljából feloldott kurzus-borító; null vagy elhagyva: nincs kép. */
  courseCover?: CtaBannerCourseCover | null
}

/**
 * A sáv képének alt-ja: a média alt-ja, hiányában a kurzus címéből képezve.
 * Feltöltött képnél csak a média saját alt-ja (üresen dekoratív), lásd
 * `ctaBannerFigura`.
 */
export function ctaBannerCoverAlt(cover: CtaBannerCourseCover): string {
  const own = mediaAlt(cover.media).trim()
  if (cover.feltoltott) {
    return own
  }
  return own.length > 0 ? own : `${cover.title} borítóképe`
}

export function CtaBanner({ block, courseCover: szamitott = null }: CtaBannerProps) {
  const title = block.title?.trim() ?? ''
  if (title.length === 0) {
    return null
  }
  const courseCover = ctaBannerFigura(block.kep, szamitott)
  const coverAlt = courseCover ? ctaBannerCoverAlt(courseCover) : ''

  const settings = block.sectionSettings
  const anchorId = settings?.anchorId?.trim() || undefined
  const variant =
    settings?.hatter === 'tint' ? 'tint' : settings?.hatter === 'sotet' ? 'dark' : 'default'
  const headingId = `cta-cim-${block.id ?? 'fo'}`

  const text = block.text?.trim() ?? ''
  const ctaLabel = block.cta?.felirat?.trim() ?? ''
  const ctaUrl = block.cta?.url?.trim() ?? ''
  const hasCta = ctaLabel.length > 0 && ctaUrl.length > 0
  const innerClassName = courseCover
    ? 'kc-cta-banner__inner kc-cta-banner__inner--illustrated'
    : 'kc-cta-banner__inner'

  return (
    <Section aria-labelledby={headingId} className="kc-cta-banner" id={anchorId} variant={variant}>
      <Container>
        <div className={innerClassName}>
          {courseCover ? (
            // A figure a DOM-ban a szöveg ELŐTT áll (mobilon fölötte, a hasáb
            // legfeljebb 40%-án), asztali nézetben a CSS-rács a jobb oszlopba
            // teszi. A kép lusta (next/image alapértelmezése priority nélkül);
            // a `sizes` a mért megjelenítési szélességet adja: 320-on 40vw,
            // fölötte a 240 px-es oszlop.
            <figure className="kc-cta-banner__figure">
              <MediaImage
                className="kc-cta-banner__image"
                decorative={coverAlt.length === 0}
                media={{ ...courseCover.media, alt: coverAlt }}
                preferredSize="sm"
                sizes="(max-width: 599px) 40vw, 240px"
              />
            </figure>
          ) : null}
          <div className="kc-cta-banner__copy">
            <h2 className="kc-cta-banner__title" id={headingId}>
              {title}
            </h2>
            {text.length > 0 ? <p className="kc-cta-banner__text">{text}</p> : null}
          </div>
          {hasCta ? (
            <div className="kc-cta-banner__action">
              <Button href={ctaUrl} openInNewTab={block.cta?.ujAblakban === true}>
                {ctaLabel}
              </Button>
            </div>
          ) : null}
        </div>
      </Container>
    </Section>
  )
}
