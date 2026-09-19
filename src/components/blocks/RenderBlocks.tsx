import type { Page, Post, Product, Testimonial } from '../../payload-types'
import {
  EMPTY_APPOINTMENT_CONTEXT,
  type AppointmentSectionContext,
} from '../../lib/appointment/context'
import { showcaseProducts } from '../../lib/course-showcase'
import { resolveCtaBannerCourseCover } from '../../lib/cta-banner-course'
import { isAvailableSosProduct } from '../../lib/sos-offer'
import { RichText } from '../lexical/RichText'
import { hasLexicalContent } from '../lexical/serialize'
import { isPaidProduct } from '../content/home/CourseCards'
import { CourseShowcase } from '../content/home/CourseShowcase'
import { CredentialsStrip } from '../content/home/CredentialsStrip'
import { FreeSos } from '../content/home/FreeSos'
import { HowItWorks } from '../content/home/HowItWorks'
import { KnowledgeSection } from '../content/home/KnowledgeSection'
import { TestimonialsSection } from '../content/home/TestimonialsSection'
import { isPubliclyVisibleProduct } from '../content/ProductCard'
import { Container } from '../ui/Container'
import { Section } from '../ui/Section'
import { About } from './About'
import { Accordion } from './Accordion'
import { Appointment } from './Appointment'
import { CtaBanner } from './CtaBanner'
import { FaqBlock } from './FaqBlock'
import { FilmHero } from './FilmHero'
import { PressLogos } from './PressLogos'
import { Services } from './Services'
import { States } from './States'
import { TeamMembers } from './TeamMembers'
import { Usps } from './Usps'
import { Welcome } from './Welcome'

/**
 * RenderBlocks — a szekció-rendszer renderelője (terv 5. pont, F3).
 * A FAQPage JSON-LD-t a FaqBlock maga adja a saját tételeiből — itt nem
 */

type LayoutBlock = NonNullable<Page['layout']>[number]

/** A szekció-beállítások közös leképezése az örökölt komponensek propjaira. */
function sectionProps(block: LayoutBlock): {
  id: string | undefined
  variant: 'default' | 'tint' | 'dark' | undefined
} {
  const settings = block.sectionSettings
  const anchorId = settings?.anchorId?.trim() || undefined
  const hatter = settings && 'hatter' in settings ? settings.hatter : undefined
  const variant =
    hatter === 'tint' ? 'tint' : hatter === 'sotet' ? 'dark' : hatter === 'feher' ? 'default' : undefined
  return { id: anchorId, variant }
}

/** A CMS link-csoportjának nyers alakja (felirat/url/ujAblakban). */
type CmsLink = { felirat?: string | null; url?: string | null; ujAblakban?: boolean | null }

/** LinkGroup (felirat/url/ujAblakban) → egyszerű link-objektum; hiányos linknél undefined. */
function linkFrom(link: CmsLink | undefined | null): { label: string; href: string; newTab: boolean } | undefined {
  const label = link?.felirat?.trim() ?? ''
  const href = link?.url?.trim() ?? ''
  if (label.length === 0 || href.length === 0) {
    return undefined
  }
  return { label, href, newTab: link?.ujAblakban === true }
}

/**
 * RÉSZLEGES link-felülírás: a mezőket külön-külön adja tovább.
 *
 * A `freeSos` blokk gombjánál a felirat és a cél NEM egy csomag: a célt a
 * komponens számolja az ingyenes termékből, a szerkesztő pedig önmagában a
 * feliratot is átírhatja (`resolveFreeSosCta`). A `linkFrom` itt nem
 * használható, mert az a hiányos linket egészben eldobná, és a szerkesztő
 * felirata némán elveszne.
 */
function partialLinkFrom(
  link: CmsLink | undefined | null,
): { label?: string; href?: string; newTab?: boolean } | undefined {
  const label = link?.felirat?.trim() ?? ''
  const href = link?.url?.trim() ?? ''
  if (label.length === 0 && href.length === 0) {
    return undefined
  }
  return {
    ...(label.length > 0 ? { label } : {}),
    ...(href.length > 0 ? { href } : {}),
    newTab: link?.ujAblakban === true,
  }
}

export interface RenderBlocksProps {
  layout: NonNullable<Page['layout']>
  /** Published termékek — a courseCards (teljes kínálat) és a freeSos (ingyenes) blokk adata. */
  products: Product[]
  /** Legfrissebb posztok a knowledge blokkhoz (lásd KNOWLEDGE_POSTS_FETCH_LIMIT). */
  posts: Post[]
  /** Vélemények a testimonials blokkhoz. */
  testimonials: Testimonial[]
  /**
   * Az időpontkérő szekció szerver-oldali környezete (űrlap-azonosító,
   * Turnstile site key). Elhagyva a szekció megjelenik, de az űrlapja letiltva
   * renderel, magyar magyarázattal — a rendelő elérhetőségei ilyenkor is
   * látszanak, tehát a lap nem lesz zsákutca. A route a
   * `getAppointmentSectionContext`-tel tölti fel.
   */
  appointment?: AppointmentSectionContext
  /**
   * Poszt-slug → KANONIKUS útvonal térkép (`hubUtvonalTerkep`); a
   * `KnowledgeSection` kártyáira megy tovább, hogy a publikált gyökér-hubbal
   * bíró cikkre ne 308-as átirányításon át linkeljünk
   * (`docs/oldal-audit-b-tudastar-2026-09-07.md` 1. találat).
   */
  hubUtvonalak?: Readonly<Record<string, string>>
}

export function RenderBlocks({
  layout,
  products,
  posts,
  testimonials,
  appointment = EMPTY_APPOINTMENT_CONTEXT,
  hubUtvonalak,
}: RenderBlocksProps) {
  const visibleProducts = products.filter(isPubliclyVisibleProduct)
  // A fizetős halmaz a GYIK „SOS vs. teljes program” összevetéséhez kell.
  const paidProducts = visibleProducts.filter(isPaidProduct)
  // A nevesített SOS-sávba csak a kanonikus, publikált és explicit ingyenes
  // SOS kerülhet. Másik ingyenes vagy hiányosan árazott termék nem helyettesíti.
  const freeProduct = visibleProducts.find(isAvailableSosProduct) ?? null
  // A courseCards rács a teljes kínálat: fizetős kurzusok elöl, majd az
  // igazolt ingyenes SOS „Ingyenes” felirattal (WP12, tulajdonosi kérés
  // 2026-09-07; a 2026-08-15-i „csak fizetős” K2-szabály felülvizsgálva,
  // indoklás és források: `showcaseProducts`, src/lib/course-showcase.ts).
  const gridProducts = showcaseProducts(visibleProducts)
  const freeSosBlocks = layout.filter((block) => block.blockType === 'freeSos')
  const visibleFreeSosBlocks = freeSosBlocks.filter(
    (block) => block.sectionSettings?.visible !== false,
  )
  const freeSosAnchorIds = freeSosBlocks.map(
    (block) => sectionProps(block).id ?? `ingyenes-${block.id ?? 'ismetelt'}`,
  )

  // Az adatvezérelt szekciók beépített alap-horgonya (kurzusok, ingyenes,
  // velemenyek) csak a típus ELSŐ példányán érvényesülhet: ha a szerkesztő
  // ugyanabból a blokkból többet tesz a lapra anchorId nélkül, a további
  // példányok nem kaphatják ugyanazt a DOM-id-t (érvénytelen HTML lenne, és a
  // /#horgony linkek mindig az elsőre ugranának).
  const seenTypes = new Set<string>()

  return (
    <>
      {layout.map((block, index) => {
        if (block.sectionSettings?.visible === false) {
          return null
        }
        const isRepeat = seenTypes.has(block.blockType)
        seenTypes.add(block.blockType)
        const key = block.id ?? `${block.blockType}-${index}`
        // WP11: a filmsáv UTÁN közvetlenül álló első About-blokk az
        // alapítók-alak (fotó-fríz a jobb hasábban). A jel a szekciósorból
        // jön, nem a lapból: a /rolunk-on nincs filmsáv, ott a blokk marad.
        const previousVisible = layout
          .slice(0, index)
          .reverse()
          .find((candidate) => candidate.sectionSettings?.visible !== false)
        const afterFilmHero = previousVisible?.blockType === 'filmHero'
        // A „lentebb” ígéretéhez a termék mellett későbbi, látható sáv is kell.
        const nextFreeSos = freeProduct
          ? visibleFreeSosBlocks.find((candidate) => layout.indexOf(candidate) > index)
          : undefined
        const freeSosHref = nextFreeSos
          ? `#${
              sectionProps(nextFreeSos).id ??
              (visibleFreeSosBlocks.indexOf(nextFreeSos) === 0
                ? 'ingyenes'
                : `ingyenes-${nextFreeSos.id ?? 'ismetelt'}`)
            }`
          : null
        return (
          <BlockSwitch
            key={key}
            freeSosHref={freeSosHref}
            freeSosAnchorIds={freeSosAnchorIds}
            {...{
              block,
              isRepeat,
              afterFilmHero,
              paidProducts,
              gridProducts,
              freeProduct,
              posts,
              testimonials,
              appointment,
              hubUtvonalak,
            }}
          />
        )
      })}
    </>
  )
}

function BlockSwitch({
  block,
  isRepeat,
  afterFilmHero,
  paidProducts,
  gridProducts,
  freeProduct,
  freeSosHref,
  freeSosAnchorIds,
  posts,
  testimonials,
  appointment,
  hubUtvonalak,
}: {
  block: LayoutBlock
  /** A típus ismételt példánya-e a lapon — az alap-horgony csak az elsőé. */
  isRepeat: boolean
  /** A megelőző látható blokk a filmsáv — az első About így alapítók-alak. */
  afterFilmHero: boolean
  paidProducts: Product[]
  /** A Kurzusaink rács tételei (fizetős + igazolt ingyenes SOS, ebben a sorrendben). */
  gridProducts: Product[]
  freeProduct: Product | null
  freeSosHref: string | null
  freeSosAnchorIds: string[]
  posts: Post[]
  testimonials: Testimonial[]
  appointment: AppointmentSectionContext
  /** Poszt-slug → kanonikus útvonal (a knowledge blokk kártyáihoz). */
  hubUtvonalak: Readonly<Record<string, string>> | undefined
}) {
  switch (block.blockType) {
    case 'filmHero':
      return (
        <FilmHero
          block={block}
          hasFreeSos={freeProduct !== null}
          freeSosHref={freeSosHref}
          freeSosAnchorIds={freeSosAnchorIds}
        />
      )
    case 'welcome':
      return <Welcome block={block} />
    case 'usps':
      return <Usps block={block} />
    case 'states':
      return <States block={block} />
    case 'services':
      return <Services block={block} />
    case 'about':
      return <About block={block} frieze={afterFilmHero && !isRepeat} />
    case 'pressLogos':
      return <PressLogos block={block} />
    case 'teamMembers':
      return <TeamMembers block={block} />
    case 'faq':
      return (
        <FaqBlock
          block={block}
          hasSosComparison={
            freeProduct !== null &&
            paidProducts.some(
              (product) =>
                product.slug === 'otthoni-kezrehab-program' && product._status === 'published',
            )
          }
        />
      )
    case 'accordion':
      return <Accordion block={block} />
    case 'appointment':
      return (
        <Appointment
          block={block}
          formId={appointment.formId}
          turnstileSiteKey={appointment.turnstileSiteKey}
        />
      )
    case 'ctaBanner':
      // A sáv képe a gomb CÉLJÁBÓL oldódik fel (kurzusoldal vagy kurzuslista →
      // a kurzus meglévő borítója), a lap már lekért, publikált termékeiből:
      // nincs külön lekérdezés, nincs új CMS-mező (src/lib/cta-banner-course.ts).
      return (
        <CtaBanner
          block={block}
          courseCover={resolveCtaBannerCourseCover(block.cta?.url, gridProducts)}
        />
      )
    case 'credsStrip': {
      const { id, variant } = sectionProps(block)
      const items = (block.items ?? [])
        .map((item) => item.text?.trim() ?? '')
        .filter((text) => text.length > 0)
      // Üres link a blokkban = a szerkesztő nem kért linket (nincs beépített pótlás).
      return (
        <CredentialsStrip
          id={id}
          items={items.length > 0 ? items : undefined}
          link={linkFrom(block.link) ?? null}
          variant={variant}
        />
      )
    }
    case 'courseCards': {
      const { id, variant } = sectionProps(block)
      return (
        <Section
          className="kc-course-showcase-band"
          id={id ?? (isRepeat ? `kurzusok-${block.id ?? 'ismetelt'}` : 'kurzusok')}
          variant={variant}
        >
          <Container>
            <CourseShowcase
              eyebrow={block.eyebrow ?? undefined}
              ctaLabel={block.ctaLabel ?? undefined}
              heading={block.heading ?? undefined}
              lead={block.lead ?? undefined}
              products={gridProducts}
            />
          </Container>
        </Section>
      )
    }
    case 'freeSos': {
      const { id, variant } = sectionProps(block)
      const backgroundImage =
        block.backgroundImage && typeof block.backgroundImage === 'object'
          ? block.backgroundImage
          : null
      return (
        <FreeSos
          backgroundImage={backgroundImage}
          body={block.body ?? undefined}
          cta={partialLinkFrom(block.cta)}
          freeProduct={freeProduct}
          id={id ?? (isRepeat ? `ingyenes-${block.id ?? 'ismetelt'}` : undefined)}
          title={block.title}
          variant={variant}
        />
      )
    }
    case 'howItWorks': {
      const { id, variant } = sectionProps(block)
      const steps = (block.steps ?? [])
        .map((step) => ({ title: step.title?.trim() ?? '', text: step.text?.trim() ?? '' }))
        .filter((step) => step.title.length > 0 && step.text.length > 0)
      return (
        <HowItWorks
          id={id}
          steps={steps.length > 0 ? steps : undefined}
          title={block.title ?? undefined}
          variant={variant}
        />
      )
    }
    case 'testimonials': {
      const { id, variant } = sectionProps(block)
      return (
        <TestimonialsSection
          eyebrow={block.eyebrow ?? undefined}
          heading={block.heading ?? undefined}
          headingId={`velemenyek-cim-${block.id ?? 'fo'}`}
          id={id ?? (isRepeat ? `velemenyek-${block.id ?? 'ismetelt'}` : undefined)}
          maxItems={block.maxItems ?? undefined}
          testimonials={testimonials}
          variant={variant}
        />
      )
    }
    case 'knowledge': {
      const { id, variant } = sectionProps(block)
      return (
        <KnowledgeSection
          heading={block.heading ?? undefined}
          hubUtvonalak={hubUtvonalak}
          id={id}
          limit={block.limit ?? undefined}
          posts={posts}
          variant={variant}
        />
      )
    }
    case 'richText': {
      const { id, variant } = sectionProps(block)
      if (!hasLexicalContent(block.content)) {
        return null
      }
      return (
        <Section id={id} variant={variant}>
          <Container size="narrow">
            <RichText content={block.content} />
          </Container>
        </Section>
      )
    }
    default:
      return null
  }
}
