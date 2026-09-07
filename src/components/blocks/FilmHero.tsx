import type { BlockFilmHero } from '../../payload-types'
import { buildOriginAllowlist } from '../../env'
import { COURSE_BASE_PATH, parseCourseRouteParam } from '../../lib/course-url'
import { COURSE_SOS_KEZRELAX, LEGACY_REDIRECTS } from '../../lib/legacy-redirects'
import { SOS_COURSE_FALLBACK_PATH } from '../../lib/menu-seed'
import { sanitizeCmsUrl } from '../../lib/safe-url'
import { PRODUCTION_HOSTS } from '../../lib/security/live-environment'
import { Button } from '../ui/Button'
import { PhotoFrieze } from './PhotoFrieze'
import { ScrollScrub } from '../scroll-scrub/scroll-scrub'
import type {
  ScrollScrubCaption,
  ScrollScrubScene,
  ScrollScrubTheme,
} from '../scroll-scrub/scroll-scrub'

import '../../app/(frontend)/styles/blocks/film-hero.css'

/**
 * FilmHero — a kezdőlap nyitó filmsávja (szekció-rendszer terv 2. és 3.3, M1).
 * A `sectionSettings.visible` szűrése NEM itt történik: a blokk-renderelő
 */

/** A jóváhagyott egykezes film verziózott desktop/mobil klipje és posztere. */
const FILM_CLIP = '/media/film/one-hand-header-v1.mp4'
const FILM_CLIP_MOBILE = '/media/film/one-hand-header-v1-mobile.mp4'
const FILM_POSTER = '/media/film/one-hand-header-v1-poster.webp'
const FILM_POSTER_MOBILE = '/media/film/one-hand-header-v1-mobile-poster.webp'

/**
 * A film scrub-hossza viewport-magasságban (~460dvh) és a középső, terapeutás
 * szakasz lassítása — a landingen bevált értékek (terv 3.3).
 */
const FILM_SCROLL = 4.6
const FILM_LINGER = 0.16

/**
 * A filmsáv színei a fő site tokenjeiről. Az akcent a `accent-deep`: a
 * folyamatjelzőn kívül a fókuszgyűrűt is ez adja, ott pedig 3:1 feletti
 * kontraszt kell (a világosabb `accent` fehéren/tinten AA alatt lenne normál
 * szövegre — lásd a tokens.css kontraszt-jegyzetét).
 *
 * A `muted` szándékosan NEM a halvány `text-muted`, hanem a teljes erejű `ink`:
 * a bevezető szöveg FILMKOCKÁN áll, ahol a hierarchiát a méret adja, nem a
 * halványítás. A film legsötétebb foltján (rgb(1,0,0)) a `text-muted` a
 * stage-lejtő 64%-os fátylával is csak 3,4:1 lenne — AA-bukás; az `ink`
 * ugyanott 6,0:1. Lásd a kontraszt-levezetést a film-hero.css fejlécében.
 */
const FILM_THEME: ScrollScrubTheme = {
  accent: 'var(--kc-color-accent-deep)',
  background: 'var(--kc-color-bg)',
  ink: 'var(--kc-color-navy-900)',
  muted: 'var(--kc-color-navy-900)',
}

/**
 * A vászon a képernyőre TŰZÖTT szakasza a teljes scrub arányában.
 *
 * A színpad `position: sticky` és egy képernyőnyi magas, a görgetési sáv pedig
 * FILM_SCROLL képernyőnyi — a vászon tehát addig áll a képernyőn, amíg a sáv
 * alja el nem éri a képernyő alját: (FILM_SCROLL - 1) / FILM_SCROLL ≈ 0,78.
 * A film utolsó ~22%-a már KIFELÉ görögve játszik le (ez a tükör viselkedése
 * is), ezért feliratot oda tenni értelmetlen lenne: sosem látnánk állva.
 */
const PINNED = (FILM_SCROLL - 1) / FILM_SCROLL

/**
 * A 2. és 3. „állás" sávja. A megrendelő „~50%" és „~90%" kérése a LÁTHATÓ
 * (tűzött) szakaszra értendő, ezért a PINNED-del skálázunk — különben a záró
 * felirat akkor úszna be, amikor a film már félig kigörgött a képből.
 *
 * A záró felirat `to: 1` értéke szándékos: nincs kifutó ága (lásd
 * captionOpacity), így a film végéig kint marad, és nem villan el a vászon
 * távozása közben.
 */
const CAPTION_MID = { from: 0.44 * PINNED, to: 0.62 * PINNED } as const
const CAPTION_END = { from: 0.84 * PINNED, to: 1 } as const

/**
 * A 2. és 3. állás SZÖVEGE — kódban rögzített érték.
 * A filmsáv feliratai szándékosan NEM CMS-mezők: a blokk sémája nem bővült,
 */
const CAPTION_MID_TEXT = 'Minden alkalommal egy mozdulattal több'
const CAPTION_MID_BODY =
  'Napi néhány perc otthon, a saját tempódban. A gyakorlatok lépésről lépésre épülnek egymásra, ahogy a kéz bírja.'
const CAPTION_END_TEXT = 'A következő mozdulat a tiéd'
const CAPTION_END_BODY =
  'Lentebb megtalálod a kurzusokat és a rendelői kezeléseket. Ha előbb kipróbálnád, ott vannak az ingyenes SOS gyakorlatok.'
const CAPTION_END_BODY_WITHOUT_FREE_SOS =
  'Ismerd meg a kurzusainkat és a rendelői kezeléseinket. Válaszd ki a neked megfelelő segítséget.'

/** A fejezet-navigáció felirata — egyetlen jelenetnél nem is jelenik meg. */
const FILM_LABEL = 'A kéz nyílása'

export interface FilmHeroProps {
  block: BlockFilmHero
  /** A kanonikus, publikált és explicit ingyenes kurzus elérhető, szekciótól függetlenül. */
  hasFreeSos?: boolean
  /** Csak publikált, explicit ingyenes termék későbbi, látható sávjának célja. */
  freeSosHref?: string | null
  /** A rejtett SOS-blokkok egyedi horgonyai is ide tartoznak. */
  freeSosAnchorIds?: readonly string[]
}

export function FilmHero({
  block,
  hasFreeSos = false,
  freeSosHref = null,
  freeSosAnchorIds = [],
}: FilmHeroProps) {
  const title = block.title?.trim()
  if (!title) {
    return null
  }

  const tags = (block.tags ?? [])
    .map((tag) => tag.label?.trim() ?? '')
    .filter((label) => label.length > 0)

  // P1: hiányzó adatból nem lesz ajánlat; a CMS felirata sem bizonyít elérhetőséget.
  // NN/g Better Link Labels; WCAG 2.4.4: a felirat és a tényleges cél összetartozik.
  // https://www.nngroup.com/articles/better-link-labels/
  // https://www.w3.org/WAI/WCAG22/Understanding/link-purpose-in-context.html
  const sosAnchors = new Set(['ingyenes', ...freeSosAnchorIds])
  // DNS-cutover alatt a Railway-primer mellett a két ismert éles HTTPS-origin
  // konfigurált kivétele is saját site. Tetszőleges CORS-kivétel nem az.
  const primaryOrigins = buildOriginAllowlist(process.env.NEXT_PUBLIC_SERVER_URL)
  const liveOrigins = PRODUCTION_HOSTS.map((host) => `https://${host}`)
  const siteOrigins = buildOriginAllowlist(
    process.env.NEXT_PUBLIC_SERVER_URL,
    process.env.EXTRA_ALLOWED_ORIGINS,
  ).filter((origin) => primaryOrigins.includes(origin) || liveOrigins.includes(origin))
  function sosTarget(rawUrl: string): 'anchor' | 'course' | null {
    const safeUrl = sanitizeCmsUrl(rawUrl)
    if (!safeUrl) return null
    try {
      const url = new URL(safeUrl, `${siteOrigins[0]}/`)
      if (!siteOrigins.includes(url.origin)) return null
      const pathname = url.pathname.replace(/\/+$/, '') || '/'
      const coursePrefix = `${COURSE_BASE_PATH}/`
      const segment = pathname.startsWith(coursePrefix) ? pathname.slice(coursePrefix.length) : ''
      // Ugyanaz az egy dinamikus szegmens és parser, mint a kurzusoldalon.
      const course =
        segment && !segment.includes('/')
          ? parseCourseRouteParam(decodeURIComponent(segment))
          : null
      const coursePath = course
        ? `${coursePrefix}${course.kind === 'id' ? course.id : course.slug}`
        : null
      if (
        coursePath === COURSE_SOS_KEZRELAX ||
        coursePath === SOS_COURSE_FALLBACK_PATH ||
        LEGACY_REDIRECTS.some(
          (redirect) =>
            redirect.source.toLowerCase() === pathname.toLowerCase() &&
            redirect.destination === COURSE_SOS_KEZRELAX,
        )
      )
        return 'course'
      if (pathname === '/' && sosAnchors.has(decodeURIComponent(url.hash.slice(1)))) {
        return 'anchor'
      }
    } catch {
      // Hibás URL/kódolás nem válik igazolt SOS-céllá.
    }
    return null
  }
  const ctas = (block.ctas ?? [])
    .filter((cta) => Boolean(cta.felirat?.trim()) && Boolean(cta.url?.trim()))
    .flatMap((cta) => {
      const target = sosTarget(cta.url)
      if (target === 'anchor') return freeSosHref ? [{ ...cta, url: freeSosHref }] : []
      if (target === 'course' && !hasFreeSos) return []
      return [cta]
    })
    .slice(0, 2)

  const actions =
    ctas.length > 0
      ? ctas.map((cta, index) => (
          <Button
            className={`kc-film-hero__cta${index === 0 ? '' : ' kc-film-hero__cta--quiet'}`}
            href={cta.url.trim()}
            key={cta.id ?? `${cta.url}-${index}`}
            openInNewTab={cta.ujAblakban ?? false}
            variant={index === 0 ? 'primary' : 'secondary'}
          >
            {cta.felirat.trim()}
          </Button>
        ))
      : null

  const anchorId = block.sectionSettings?.anchorId?.trim()

  // Üres szövegnél NEM renderelünk helykitöltőt: az adott állás egyszerűen
  // kimarad. (A szövegek kódban élnek — lásd CAPTION_*_TEXT.)
  const captions: ScrollScrubCaption[] = []
  const midText = CAPTION_MID_TEXT.trim()
  if (midText) {
    captions.push({
      align: 'right',
      body: CAPTION_MID_BODY.trim() || undefined,
      id: 'film-scrub-kozep',
      text: midText,
      ...CAPTION_MID,
    })
  }
  const endText = CAPTION_END_TEXT.trim()
  if (endText) {
    captions.push({
      align: 'center',
      body: freeSosHref ? CAPTION_END_BODY : CAPTION_END_BODY_WITHOUT_FREE_SOS,
      id: 'film-scrub-vege',
      text: endText,
      ...CAPTION_END,
    })
  }

  const scene: ScrollScrubScene = {
    actions,
    align: 'left',
    body: block.lead?.trim() ?? '',
    clip: FILM_CLIP,
    id: 'film-hero',
    label: FILM_LABEL,
    linger: FILM_LINGER,
    mobileClip: FILM_CLIP_MOBILE,
    mobilePoster: FILM_POSTER_MOBILE,
    poster: FILM_POSTER,
    scroll: FILM_SCROLL,
    tags,
    title,
  }

  // A fotó-fríz a scrub-színpad UTÁN, a film testvéreként áll a <main>-ben:
  // így a `.kc-film-hero:first-of-type` fejléc-alá-húzása változatlan, a fríz
  // pedig `.kc-section`-ként megkapja a SectionReveal belépőjét. A fotólista
  // kódban él, mint a feliratok (CAPTION_*): a séma nem bővül.
  return (
    <>
      <ScrollScrub
        captions={captions}
        className="kc-film-hero"
        id={anchorId || undefined}
        scenes={[scene]}
        theme={FILM_THEME}
      />
      <PhotoFrieze />
    </>
  )
}
