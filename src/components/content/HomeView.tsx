import type { Page, Post, Product, Testimonial } from '../../payload-types'
import type { AppointmentSectionContext } from '../../lib/appointment/context'
import { faqPageJsonLd, homeWebPageJsonLd, organizationJsonLd } from '../../lib/seo'
import { HERO_VIDEO_STREAM_ID } from '../../lib/hero-video'
import { SectionReveal } from '../motion/SectionReveal'
import { BarionFizetesJelzes } from '../checkout/BarionFizetesJelzes'
import { RenderBlocks } from '../blocks/RenderBlocks'
import { Container } from '../ui/Container'
import { Section } from '../ui/Section'
import { HeroVideo } from './HeroVideo'
import { JsonLd } from './JsonLd'
import { MediaImage } from './MediaImage'
import { isPubliclyVisibleProduct } from './ProductCard'
import { CourseCards, isPaidProduct } from './home/CourseCards'
import { CredentialsStrip } from './home/CredentialsStrip'
import { FAQ_ITEMS, Faq } from './home/Faq'
import { FreeSos } from './home/FreeSos'
import { HeroCta } from './home/HeroCta'
import { HowItWorks } from './home/HowItWorks'
import { KnowledgeSection } from './home/KnowledgeSection'
import { featuredTestimonials, TestimonialsSection } from './home/TestimonialsSection'
import { hasLexicalContent } from '../lexical/serialize'
import { RichText } from '../lexical/RichText'

/**
 * HomeView — a kezdőlap prezentációs komponense (tiszta, fixture-ből tesztelhető).
 */
export interface HomeViewProps {
  home: Page | null
  products: Product[]
  posts: Post[]
  /**
   * Vélemények (M6). Opcionális, hogy a kizárólag a hero/JSON-LD viselkedést
   * vizsgáló renderek is meghívhassák — hiányzó vagy üres listánál a szekció
   * egyszerűen elmarad.
   */
  testimonials?: Testimonial[]
  /**
   * Az időpontkérő szekció szerver-oldali környezete (űrlap-azonosító,
   * Turnstile site key). Opcionális: a kezdőlapi szekciósorban ritkán van
   * időpontkérő blokk, és hiányában a szekció a rendelő elérhetőségeit akkor is
   * megmutatja, csak az űrlapja renderel letiltva. A `/` route tölti fel.
   */
  appointment?: AppointmentSectionContext
}

function HeroSection({ home }: { home: Page | null }) {
  const title = home?.title?.trim() || 'Hatékony és biztonságos módszerek a kéz és a kar fájdalmai ellen'
  const lead =
    home?.excerpt?.trim() ||
    'Kézrehabilitációs online videókurzusok otthon végezhető gyógytornászati programmal: ínhüvelygyulladás, kéztőalagút-szindróma és teniszkönyök esetén.'
  const heroMedia = home?.heroImage && typeof home.heroImage === 'object' ? home.heroImage : null

  return (
    <Section className="kc-hero" variant="tint">
      <Container>
        <div className="kc-hero__grid">
          <div className="kc-hero__content">
            <h1 className="kc-hero__title">{title}</h1>
            <p className="kc-hero__lead">{lead}</p>
            <HeroCta />
          </div>
          {HERO_VIDEO_STREAM_ID !== null ? (
            <div className="kc-hero__media">
              <HeroVideo streamId={HERO_VIDEO_STREAM_ID} />
            </div>
          ) : heroMedia ? (
            <div className="kc-hero__media">
              <MediaImage media={heroMedia} preferredSize="md" priority sizes="(max-width: 900px) 100vw, 544px" />
            </div>
          ) : null}
        </div>
      </Container>
    </Section>
  )
}

export function HomeView({
  home,
  products,
  posts,
  testimonials = [],
  appointment,
}: HomeViewProps) {
  // Szekció-rendszer: ha a kezdőlap CMS-oldalán VAN összeállított szekciósor
  // (Pages → Szekciók), azt rendereljük — a sorrend és a láthatóság teljes
  // egészében a szerkesztőé. A FAQPage JSON-LD-t ilyenkor a faq blokk adja a
  // saját tételeiből (FaqBlock). Az Organization mellett a WebPage séma viszi
  // a CMS `seoKeywords` mezőt; üresen a `keywords` kulcs kimarad.
  // Üres layout → az alábbi rögzített, audit szerinti M1–M8 kezdőlap.
  const layout = home?.layout ?? []
  if (layout.length > 0) {
    return (
      <>
        <JsonLd data={organizationJsonLd()} />
        <JsonLd data={homeWebPageJsonLd(home)} />
        <RenderBlocks
          appointment={appointment}
          layout={layout}
          posts={posts}
          products={products}
          testimonials={testimonials}
        />
        <BarionFizetesJelzes hely="kezdolap" />
        <SectionReveal />
      </>
    )
  }

  const visibleProducts = products.filter(isPubliclyVisibleProduct)
  // A kurzus-rácsba KIZÁRÓLAG fizetős termék kerül. Az ingyenes lead-magnet
  // helye a lentebbi FreeSos szekció: 2026-08-15-ig mindkét helyen szerepelt,
  // ami duplikáció volt (kezdőlap-audit) — lásd CourseCards fejléce.
  const paidProducts = visibleProducts.filter(isPaidProduct)
  // A FreeSos szekció egyetlen lead-magnetre van tervezve; a viselkedése
  // változatlan marad.
  const freeProduct = visibleProducts.find((product) => !isPaidProduct(product)) ?? null
  const visiblePosts = posts.filter((post) => post.status === 'published' && post.slug)

  // Sávritmus: a kezdőlap fehér és tint (világoskék) szekciókat váltogat. A
  // vélemény-szekció (tint) és a CMS-blokk (fehér) is FELTÉTELES, ezért a
  // tudástár háttere nem lehet fix: CMS-tartalom nélkül a tudástár közvetlenül
  // a vélemények után jönne, és a két tint sáv egyetlen nagy folttá olvadna
  // (elveszne a szekcióhatár). Ilyenkor a tudástár fehérre vált.
  const hasCmsContent = Boolean(home?.content && hasLexicalContent(home.content))
  const testimonialsVisible = featuredTestimonials(testimonials).length > 0
  const previousBandIsTint = testimonialsVisible && !hasCmsContent

  return (
    <>
      <JsonLd data={organizationJsonLd()} />
      <JsonLd data={homeWebPageJsonLd(home)} />
      <JsonLd data={faqPageJsonLd(FAQ_ITEMS)} />
      <HeroSection home={home} />

      <CredentialsStrip />

      <CourseCards products={paidProducts} />

      <FreeSos freeProduct={freeProduct} />

      <HowItWorks />

      <TestimonialsSection testimonials={testimonials} />

      {hasCmsContent && home?.content ? (
        <Section>
          <Container size="narrow">
            <RichText content={home.content} />
          </Container>
        </Section>
      ) : null}

      <KnowledgeSection
        limit={3}
        posts={visiblePosts}
        variant={previousBandIsTint ? 'default' : 'tint'}
      />

      <Faq />

      <BarionFizetesJelzes hely="kezdolap" />

      <SectionReveal />
    </>
  )
}
