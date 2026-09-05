import Image from 'next/image'

import { RenderBlocks } from '@/components/blocks/RenderBlocks'
import { MediaImage } from '@/components/content/MediaImage'
import { Button } from '@/components/ui/Button'
import { Container } from '@/components/ui/Container'
import { ctaLabel } from '@/lib/cta-vocabulary'
import {
  DEMO_COURSE_EXCERPT,
  DEMO_COURSE_HERO_IMAGE,
  DEMO_COURSE_TITLE,
  demoCourseLayout,
} from '@/lib/demo-course-content'
import type { Page } from '@/payload-types'

import './demo-course.css'

export interface DemoCourseLandingProps {
  page?: Page | null
}

type Layout = NonNullable<Page['layout']>
type FaqBlock = Extract<Layout[number], { blockType: 'faq' }>

function faqAsAccordion(block: FaqBlock): Extract<Layout[number], { blockType: 'accordion' }> {
  return {
    id: block.id,
    blockType: 'accordion',
    eyebrow: 'Kérdések és válaszok',
    title: block.heading,
    items: (block.items ?? []).map((item) => ({
      id: item.id,
      cim: item.question,
      tartalom: {
        root: {
          type: 'root',
          direction: null,
          format: '',
          indent: 0,
          version: 1,
          children: [
            {
              type: 'paragraph',
              direction: null,
              format: '',
              indent: 0,
              version: 1,
              children: [
                {
                  type: 'text',
                  text: item.answer,
                  detail: 0,
                  format: 0,
                  mode: 'normal',
                  style: '',
                  version: 1,
                },
              ],
            },
          ],
        },
      },
    })),
    sectionSettings: block.sectionSettings,
  }
}

function renderableLayout(layout: ReturnType<typeof demoCourseLayout>): Layout {
  const hasVisibleModules = layout.some(
    (block) =>
      block.sectionSettings?.anchorId === 'modulok' && block.sectionSettings.visible !== false,
  )

  return layout.map((block) => {
    if (block.blockType === 'faq') {
      return faqAsAccordion(block)
    }
    if (block.blockType === 'ctaBanner' && block.cta?.url === '#modulok' && !hasVisibleModules) {
      return { ...block, cta: undefined }
    }
    return block
  })
}

export function DemoCourseLanding({ page }: DemoCourseLandingProps) {
  const title = page?.title?.trim() || DEMO_COURSE_TITLE
  const excerpt = page?.excerpt?.trim() || DEMO_COURSE_EXCERPT
  const heroMedia = page?.heroImage && typeof page.heroImage === 'object' ? page.heroImage : null
  const layout = demoCourseLayout(page)
  const blocks = renderableLayout(layout)
  const hasVisibleModules = blocks.some(
    (block) =>
      block.sectionSettings?.anchorId === 'modulok' && block.sectionSettings.visible !== false,
  )

  return (
    <article className="kc-demo-course">
      <section aria-labelledby="demo-course-title" className="kc-demo-hero">
        <div className="kc-demo-hero__media" aria-hidden="true">
          {heroMedia ? (
            <MediaImage
              className="kc-demo-hero__image"
              decorative
              media={heroMedia}
              preferredSize="lg"
              priority
              sizes="100vw"
            />
          ) : (
            <Image
              alt=""
              className="kc-demo-hero__image"
              fill
              priority
              sizes="100vw"
              src={DEMO_COURSE_HERO_IMAGE.src}
            />
          )}
        </div>
        <div className="kc-demo-hero__veil" aria-hidden="true" />
        <Container className="kc-demo-hero__inner">
          <div className="kc-demo-hero__copy">
            <p className="kc-demo-hero__disclosure">Demókurzus, jelenleg nem vásárolható.</p>
            <h1 className="kc-demo-hero__title" id="demo-course-title">
              {title}
            </h1>
            <p className="kc-demo-hero__lead">{excerpt}</p>
            <div className="kc-demo-hero__actions">
              {hasVisibleModules ? (
                <Button className="kc-demo-hero__cta" href="#modulok" variant="secondary">
                  {ctaLabel('course-modules-jump')}
                </Button>
              ) : null}
              <Button className="kc-demo-hero__cta" href="/kapcsolat" variant="secondary">
                {ctaLabel('contact-open')}
              </Button>
            </div>
          </div>
        </Container>
      </section>

      <RenderBlocks layout={blocks} posts={[]} products={[]} testimonials={[]} />
    </article>
  )
}

export default DemoCourseLanding
