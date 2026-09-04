import type { BlockFilmHero } from '../../payload-types'
import { Button } from '../ui/Button'
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
 * a bevezető szöveg változó filmkockán áll, ahol a hierarchiát a méret adja,
 * az olvashatóságot pedig a papírmosás és a stage célzott fátylai biztosítják.
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

/** A fejezet-navigáció felirata — egyetlen jelenetnél nem is jelenik meg. */
const FILM_LABEL = 'A kéz nyílása'

export interface FilmHeroProps {
  block: BlockFilmHero
}

export function FilmHero({ block }: FilmHeroProps) {
  const title = block.title?.trim()
  if (!title) {
    return null
  }

  const tags = (block.tags ?? [])
    .map((tag) => tag.label?.trim() ?? '')
    .filter((label) => label.length > 0)

  const ctas = (block.ctas ?? [])
    .filter((cta) => Boolean(cta.felirat?.trim()) && Boolean(cta.url?.trim()))
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
      body: CAPTION_END_BODY.trim() || undefined,
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
    mobileObjectPosition: '50% 50%',
    mobilePoster: FILM_POSTER_MOBILE,
    objectPosition: '50% 50%',
    poster: FILM_POSTER,
    scroll: FILM_SCROLL,
    tags,
    title,
  }

  return (
    <ScrollScrub
      captions={captions}
      className="kc-film-hero"
      id={anchorId || undefined}
      scenes={[scene]}
      theme={FILM_THEME}
    />
  )
}
