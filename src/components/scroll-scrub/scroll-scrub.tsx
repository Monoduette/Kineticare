'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'

import './scroll-scrub.css'

export const SCROLL_SCRUB_MOBILE_MEDIA_QUERY =
  '(max-width: 860px), (hover: none) and (pointer: coarse) and (orientation: portrait)'

/**
 * ScrollScrub — görgetéssel vezérelt filmsáv ('use client' sziget).
 * (IntersectionObserver, scroll-listener) NEM indul miattuk.
 */

export interface ScrollScrubScene {
  id: string
  /** A fejezet-navigáció gombfelirata (több jelenetnél látszik). */
  label: string
  /** A desktop klip PONTOS első kockája. */
  poster: string
  /** A mobil klip pontos első kockája; mobileClip mellett kötelező. */
  mobilePoster?: string
  clip: string
  mobileClip?: string
  title: string
  body: string
  kicker?: string
  tags?: string[]
  actions?: ReactNode
  align?: 'left' | 'right'
  /** A jelenetre jutó viewport-magasság. Több távolság = lassabb scrub. */
  scroll?: number
  /** 0..0.6. Lassítja a klip közepét úgy, hogy a két szélső kocka nem mozdul. */
  linger?: number
  objectPosition?: string
  mobileObjectPosition?: string
}

export interface ScrollScrubConnector {
  /** Az összekötő klip pontos első kockája; sosem egy jelenet állóképe. */
  poster: string
  /** A mobil klip pontos első kockája; mobileClip mellett kötelező. */
  mobilePoster?: string
  clip: string
  mobileClip?: string
  scroll?: number
}

export interface ScrollScrubTheme {
  background: string
  ink: string
  muted: string
  accent: string
}

/**
 * Görgetés-pozícióhoz kötött úszó felirat a filmsávon (a 2. és 3. „állás").
 *
 * A `from`/`to` a TELJES scrub 0..1 arányán értendő — ugyanaz a szám, amit a
 * komponens `--ss-progress`-ként is kiír. A felirat a sáv két szélén lágyan
 * úszik be és ki (`CAPTION_FADE`); ha a `to` eléri az 1-et, a kifutó ág elmarad,
 * így a záró felirat a film végéig kint marad.
 */
export interface ScrollScrubCaption {
  id: string
  /** A felirat CÍME: egy tömör mondat, amit a néző egy pillantásra elolvas. */
  text: string
  /**
   * Rövid leírás a cím ALATT. Elhagyva a felirat egyetlen sorból áll (a mező
   * bevezetése előtti viselkedés).
   * néző megáll rajta, és nincs mit olvasnia tovább. Az NN/g eyetracking
   * rétegtorta-mintája szerint a tekintet a címeken ugrál, és AZ ALATTA LÉVŐ
   * törzsszöveget olvassa el, amint egy cím érdekli
   * („The Layer-Cake Pattern of Scanning Content on the Web",
   */
  body?: string
  /** Vízszintes elhelyezés a filmvásznon. */
  align: 'center' | 'right'
  /** A sáv kezdete a teljes scrub arányában (0..1). */
  from: number
  /** A sáv vége a teljes scrub arányában (0..1). */
  to: number
}

export interface ScrollScrubProps {
  scenes: ScrollScrubScene[]
  /** Folytonos, egyfelvonásos filmnél üresen marad. */
  connectors?: (ScrollScrubConnector | null)[]
  theme: ScrollScrubTheme
  className?: string
  /** Horgony-cél a szekció gyökerén (pl. a blokk anchorId mezője). */
  id?: string
  /** Scrub-pozícióhoz kötött úszó feliratok; üres tömbnél semmi nem renderelődik. */
  captions?: ScrollScrubCaption[]
  onActiveSectionChange?: (index: number) => void
}

interface Segment {
  key: string
  kind: 'scene' | 'connector'
  sectionIndex: number
  nextSectionIndex: number
  poster: string
  mobilePoster?: string
  clip: string
  mobileClip?: string
  weight: number
  linger: number
  objectPosition: string
  mobileObjectPosition: string
  scene?: ScrollScrubScene
}

interface RuntimeSegment extends Segment {
  band: HTMLElement
  layer: HTMLElement
  start: number
  end: number
  current: number
  target: number
  visible: boolean
  loading: boolean
  ready: boolean
  failed: boolean
  loadedSource?: string
  video?: HTMLVideoElement
  objectUrl?: string
  abort?: AbortController
}

interface Controller {
  jumpToSection: (index: number) => void
}

type ThemeStyle = CSSProperties & Record<`--ss-${string}`, string | number>

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value))

const smoothstep = (value: number) => {
  const x = clamp(value)
  return x * x * (3 - 2 * x)
}

const lingerEase = (value: number, amount: number) => {
  const x = clamp(value)
  const linger = clamp(amount, 0, 0.6)
  const centered = x - 0.5
  return (1 - linger) * x + linger * (4 * centered ** 3 + 0.5)
}

/** A felirat be- és kiúszásának hossza a scrub 0..1 arányán. */
export const CAPTION_FADE = 0.07

/** A mobil vágat kitöltése a CSS-sel közös media-query döntések alapján. */
export function scrollScrubMediaFit(
  mobileMedia: boolean,
  atLeastTabletWidth: boolean,
  landscapeViewport: boolean,
): 'contain' | 'cover' {
  return mobileMedia && (atLeastTabletWidth || landscapeViewport)
    ? 'contain'
    : 'cover'
}

/** A mobil böngészős magasságzajt csak akkor méri újra, ha a fit is változna. */
export function scrollScrubNeedsLayout(
  coarsePointer: boolean,
  previousWidth: number,
  nextWidth: number,
  previousMediaFit: string | undefined,
  nextMediaFit: 'contain' | 'cover',
): boolean {
  return !coarsePointer || nextWidth !== previousWidth || previousMediaFit !== nextMediaFit
}

/**
 * Egy úszó felirat átlátszatlansága a scrub-pozícióból.
 *
 * A `[from, to]` sávon belül 1, a sáv két szélén `CAPTION_FADE` hosszan
 * smoothstep-pel úszik be/ki. Ha `to >= 1`, a kifutó ág elmarad — a záró
 * felirat a film utolsó kockájáig kint marad. `reduced` esetén nincs átmenet:
 * a felirat a sávon belül azonnal látszik, kívül azonnal eltűnik (állókép).
 */
export function captionOpacity(
  progress: number,
  from: number,
  to: number,
  reduced = false,
): number {
  const p = clamp(progress)
  if (reduced) {
    return p >= from && p <= to ? 1 : 0
  }
  const rise = (p - (from - CAPTION_FADE)) / CAPTION_FADE
  const fall = to >= 1 ? 1 : (to + CAPTION_FADE - p) / CAPTION_FADE
  return smoothstep(Math.min(rise, fall))
}

function buildSegments(
  scenes: ScrollScrubScene[],
  connectors: (ScrollScrubConnector | null)[],
): Segment[] {
  const result: Segment[] = []

  for (const [index, scene] of scenes.entries()) {
    if (scene.mobileClip && !scene.mobilePoster) {
      throw new Error(`A(z) ${scene.id} jelenethez mobilePoster kell a mobileClip mellé`)
    }
    result.push({
      clip: scene.clip,
      key: `scene:${scene.id}`,
      kind: 'scene',
      linger: scene.linger ?? 0,
      mobileClip: scene.mobileClip,
      mobilePoster: scene.mobilePoster,
      mobileObjectPosition: scene.mobileObjectPosition ?? scene.objectPosition ?? '50% 50%',
      nextSectionIndex: index,
      objectPosition: scene.objectPosition ?? '50% 50%',
      poster: scene.poster,
      scene,
      sectionIndex: index,
      weight: scene.scroll ?? 1.4,
    })

    const connector = connectors[index]
    if (index < scenes.length - 1 && connector?.clip) {
      if (connector.mobileClip && !connector.mobilePoster) {
        throw new Error(`A(z) ${scene.id} utáni összekötőhöz mobilePoster kell a mobileClip mellé`)
      }
      const nextScene = scenes[index + 1]
      result.push({
        clip: connector.clip,
        key: `connector:${scene.id}:${nextScene.id}`,
        kind: 'connector',
        linger: 0,
        mobileClip: connector.mobileClip,
        mobilePoster: connector.mobilePoster,
        mobileObjectPosition:
          nextScene.mobileObjectPosition ?? nextScene.objectPosition ?? '50% 50%',
        nextSectionIndex: index + 1,
        objectPosition: nextScene.objectPosition ?? '50% 50%',
        poster: connector.poster,
        sectionIndex: index,
        weight: connector.scroll ?? 0.8,
      })
    }
  }

  return result
}

export function ScrollScrub({
  scenes,
  connectors,
  theme,
  className,
  id,
  captions,
  onActiveSectionChange,
}: ScrollScrubProps) {
  const rootRef = useRef<HTMLElement>(null)
  const controllerRef = useRef<Controller | null>(null)
  const onActiveRef = useRef(onActiveSectionChange)
  const [activeSection, setActiveSection] = useState(0)
  const segments = useMemo(() => buildSegments(scenes, connectors ?? []), [connectors, scenes])
  const captionList = useMemo(() => captions ?? [], [captions])

  // A legfrissebb callback elérhető marad a görgetés-ciklusból anélkül, hogy a
  // vezérlő-effekt függősége lenne. Effektben szinkronizáljuk, sosem renderelés
  // közben — a render-fázisú ref-írást a React Compiler elrontaná.
  useEffect(() => {
    onActiveRef.current = onActiveSectionChange
  }, [onActiveSectionChange])

  useEffect(() => {
    const root = rootRef.current
    if (!root || segments.length === 0) {
      return
    }

    const layerNodes = [...root.querySelectorAll<HTMLElement>('[data-scroll-scrub-layer]')]
    const bandNodes = [...root.querySelectorAll<HTMLElement>('[data-scroll-scrub-band]')]
    if (layerNodes.length !== segments.length || bandNodes.length !== segments.length) {
      throw new Error('A ScrollScrub szegmens-markupja nincs szinkronban')
    }

    const captionNodes = [...root.querySelectorAll<HTMLElement>('[data-scroll-scrub-caption]')]
    if (captionNodes.length !== captionList.length) {
      throw new Error('A ScrollScrub felirat-markupja nincs szinkronban')
    }

    // A jelenet-szöveg (1. „állás") csak akkor úszik ki, ha VAN mit átadnia:
    // felirat nélkül a viselkedés változatlan, a szöveg végig kint marad.
    const copyNodes = captionList.length
      ? [...root.querySelectorAll<HTMLElement>('.scroll-scrub__copy')]
      : []
    // Az 1. állás pontosan ott adja át a helyét, ahol a 2. beúszik: a kifutás
    // vége = az első felirat sávkezdete, tehát a két görbe egymás tükörképe.
    const copyHandoff = captionList[0] ? captionList[0].from - CAPTION_FADE : 1

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const coarsePointer = window.matchMedia('(hover: none) and (pointer: coarse)').matches
    const mobileViewport = window.matchMedia(SCROLL_SCRUB_MOBILE_MEDIA_QUERY)
    const atLeastTabletWidth = window.matchMedia('(min-width: 640px)')
    const landscapeViewport = window.matchMedia('(orientation: landscape)')
    const isMobile = () => mobileViewport.matches
    const mediaFitForViewport = () =>
      scrollScrubMediaFit(
        isMobile(),
        atLeastTabletWidth.matches,
        landscapeViewport.matches,
      )
    const usesMobileVideoTuning = () => coarsePointer || isMobile()
    const sourceFor = (segment: RuntimeSegment) =>
      isMobile() && segment.mobileClip ? segment.mobileClip : segment.clip
    const runtime: RuntimeSegment[] = segments.map((segment, index) => ({
      ...segment,
      band: bandNodes[index],
      current: 0,
      end: 0,
      failed: false,
      layer: layerNodes[index],
      loading: false,
      ready: false,
      start: 0,
      target: 0,
      visible: index === 0,
    }))

    let active = -1
    let destroyed = false
    let dirty = true
    let frame = 0
    let rootTop = 0
    let total = 1
    let viewportHeight = window.innerHeight
    let layoutWidth = window.innerWidth
    let userReady = false

    const unloadClip = (segment: RuntimeSegment) => {
      segment.abort?.abort()
      segment.video?.remove()
      if (segment.objectUrl) {
        URL.revokeObjectURL(segment.objectUrl)
      }
      delete segment.abort
      delete segment.video
      delete segment.objectUrl
      delete segment.loadedSource
      segment.loading = false
      segment.ready = false
      segment.failed = false
      segment.current = segment.target
      delete segment.layer.dataset.videoPainted
      delete segment.layer.dataset.videoFailed
    }

    const layout = () => {
      const pageY = window.scrollY || window.pageYOffset
      rootTop = root.getBoundingClientRect().top + pageY
      viewportHeight = window.innerHeight
      layoutWidth = window.innerWidth
      const mobileMedia = isMobile()
      root.dataset.scrollScrubMobileMedia = mobileMedia ? 'true' : 'false'
      root.dataset.scrollScrubMediaFit = mediaFitForViewport()

      for (const segment of runtime) {
        if (segment.loadedSource && segment.loadedSource !== sourceFor(segment)) {
          unloadClip(segment)
        }
        const rect = segment.band.getBoundingClientRect()
        segment.start = rect.top + pageY - rootTop
        segment.end = segment.start + rect.height
      }
      total = Math.max(runtime.at(-1)?.end ?? viewportHeight, viewportHeight)
      dirty = true
    }

    const primeVideo = async (video?: HTMLVideoElement) => {
      if (!video || !usesMobileVideoTuning()) {
        return
      }
      try {
        await video.play()
        video.pause()
      } catch {
        // Marad a poszter; egy későbbi felhasználói gesztus/seek magától újrapróbálja.
      }
    }

    const loadClip = async (segment: RuntimeSegment) => {
      const source = sourceFor(segment)
      if (
        reduceMotion ||
        destroyed ||
        segment.loading ||
        segment.ready ||
        segment.failed ||
        !source
      ) {
        return
      }

      segment.loading = true
      segment.loadedSource = source
      segment.abort = new AbortController()
      const request = segment.abort

      try {
        const response = await fetch(source, {
          signal: request.signal,
        })
        if (!response.ok) {
          throw new Error(`A klip letöltése nem sikerült: ${response.status}`)
        }
        const blob = await response.blob()
        if (destroyed || request.signal.aborted || segment.loadedSource !== source) {
          return
        }

        const objectUrl = URL.createObjectURL(blob)
        const video = document.createElement('video')
        video.className = 'scroll-scrub__video'
        video.muted = true
        video.playsInline = true
        video.preload = 'auto'
        video.setAttribute('muted', '')
        video.setAttribute('playsinline', '')
        video.src = objectUrl

        video.addEventListener(
          'loadedmetadata',
          () => {
            if (segment.video !== video || segment.loadedSource !== source) {
              return
            }
            segment.ready = true
            segment.loading = false
            dirty = true
          },
          { once: true },
        )
        video.addEventListener(
          'loadeddata',
          () => {
            if (userReady && segment.video === video && segment.loadedSource === source) {
              void primeVideo(video)
            }
          },
          { once: true },
        )
        video.addEventListener(
          'error',
          () => {
            if (segment.video !== video) {
              return
            }
            video.remove()
            URL.revokeObjectURL(objectUrl)
            delete segment.video
            delete segment.objectUrl
            segment.failed = true
            segment.loading = false
            segment.ready = false
            delete segment.layer.dataset.videoPainted
            segment.layer.dataset.videoFailed = 'true'
          },
          { once: true },
        )
        video.addEventListener(
          'seeked',
          () => {
            if (segment.video === video && segment.loadedSource === source) {
              segment.layer.dataset.videoPainted = 'true'
            }
          },
          { once: true },
        )

        segment.layer.append(video)
        segment.objectUrl = objectUrl
        segment.video = video
      } catch (error) {
        if (
          request.signal.aborted ||
          (error instanceof Error && error.name === 'AbortError') ||
          segment.loadedSource !== source
        ) {
          return
        }
        segment.layer.dataset.videoFailed = 'true'
        segment.failed = true
        segment.loading = false
      }
    }

    const readScroll = () => {
      const pageY = window.scrollY || window.pageYOffset
      const y = clamp(pageY - rootTop, 0, total)
      const crossfade = 0.1 * viewportHeight
      let currentIndex = 0

      for (const [index, segment] of runtime.entries()) {
        if (y >= segment.start) {
          currentIndex = index
        }

        const length = Math.max(segment.end - segment.start, 1)
        const local = clamp((y - segment.start) / length)
        segment.target = segment.linger ? lingerEase(local, segment.linger) : local

        let outside = 0
        if (y < segment.start) {
          outside = segment.start - y
        }
        if (y > segment.end) {
          outside = y - segment.end
        }
        let opacity = smoothstep(1 - outside / Math.max(crossfade, 1))
        if (reduceMotion) {
          opacity = outside === 0 ? 1 : 0
        }

        segment.visible = opacity > 0.001
        segment.layer.style.opacity = String(opacity)
        segment.layer.style.zIndex = index === currentIndex ? '2' : '1'

        if (y > segment.start - 1.5 * viewportHeight && y < segment.end + 1.5 * viewportHeight) {
          void loadClip(segment)
        }
      }

      const current = runtime[currentIndex]
      const currentLength = Math.max(current.end - current.start, 1)
      const currentProgress = clamp((y - current.start) / currentLength)
      const nextActive =
        current.kind === 'connector' && currentProgress >= 0.5
          ? current.nextSectionIndex
          : current.sectionIndex

      if (nextActive !== active) {
        active = nextActive
        root.dataset.activeSection = String(active)
        setActiveSection(active)
        onActiveRef.current?.(active)
      }

      const progress = clamp(y / total)
      root.style.setProperty('--ss-progress', String(progress))

      // A 2. és 3. „állás": a felirat láthatósága TISZTÁN a scrub-arányból jön,
      // ugyanabban a ciklusban, ahol a film kockája is mozog. Csökkentett
      // mozgásnál nincs átúszás — a felirat állóképként vált (lásd
      // captionOpacity `reduced` ága).
      for (const [index, caption] of captionList.entries()) {
        const node = captionNodes[index]
        const opacity = captionOpacity(progress, caption.from, caption.to, reduceMotion)
        node.style.opacity = String(opacity)
        node.setAttribute('aria-hidden', opacity < 0.05 ? 'true' : 'false')
      }

      // Az 1. állás kiúszása. Az `aria-hidden` NEM kerül rá: a jelenet címe az
      // oldal H1-e, a dokumentum-vázlatból nem tűnhet el. A kattinthatóságot
      // viszont el kell venni, különben a láthatatlan gombok elfognák az
      // egérmutatót a film fölött.
      if (copyNodes.length > 0) {
        const opacity = captionOpacity(progress, 0, copyHandoff, reduceMotion)
        for (const node of copyNodes) {
          node.style.opacity = String(opacity)
          node.style.pointerEvents = opacity < 0.05 ? 'none' : ''
        }

        // A jelenet-szöveg olvashatósági lejtője (film-hero.css 2. rétege) a
        // szöveggel együtt tűnik el, hogy a film a 2. és 3. állásban a saját
        // erejével látszódjon. SZÁNDÉKOSAN EGY FADE-DEL KÉSŐBB fut ki, mint a
        // szöveg: amíg a szöveg egyáltalán látszik, a lejtő teljes erővel áll,
        // tehát a kontraszt a kiúszás közben sem csökken.
        root.style.setProperty(
          '--ss-copy-scrim',
          String(captionOpacity(progress, 0, copyHandoff + CAPTION_FADE, reduceMotion)),
        )
      }
    }

    const updateVideos = () => {
      for (const segment of runtime) {
        const { video } = segment
        if (!video || !segment.ready || video.seeking) {
          continue
        }
        if (!segment.visible && Math.abs(segment.current - segment.target) < 0.002) {
          continue
        }

        segment.current += (segment.target - segment.current) * 0.2
        const targetTime = clamp(segment.current, 0, 0.999) * (video.duration || 1)
        const epsilon = usesMobileVideoTuning() ? 0.02 : 0.008
        if (Math.abs(video.currentTime - targetTime) > epsilon) {
          try {
            video.currentTime = targetTime
          } catch {
            // Marad az utoljára kirajzolt kocka, amíg a böngésző utoléri magát.
          }
        }
      }
    }

    const tick = () => {
      if (destroyed) {
        return
      }
      if (dirty) {
        dirty = false
        readScroll()
      }
      updateVideos()
      frame = window.requestAnimationFrame(tick)
    }

    const onScroll = () => {
      dirty = true
    }
    const onResize = () => {
      const nextMediaFit = mediaFitForViewport()
      if (
        !scrollScrubNeedsLayout(
          coarsePointer,
          layoutWidth,
          window.innerWidth,
          root.dataset.scrollScrubMediaFit,
          nextMediaFit,
        )
      ) {
        return
      }
      layout()
    }
    const onFirstGesture = () => {
      if (userReady) {
        return
      }
      userReady = true
      for (const segment of runtime) {
        void primeVideo(segment.video)
      }
    }

    controllerRef.current = {
      jumpToSection(index) {
        const segment = runtime.find(
          (candidate) => candidate.kind === 'scene' && candidate.sectionIndex === index,
        )
        if (!segment) {
          return
        }
        const top = rootTop + segment.start + 0.15 * (segment.end - segment.start)
        window.scrollTo({
          behavior: reduceMotion ? 'auto' : 'smooth',
          top,
        })
      },
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onResize)
    window.addEventListener('orientationchange', layout)
    mobileViewport.addEventListener('change', layout)
    window.addEventListener('pointerdown', onFirstGesture, {
      once: true,
      passive: true,
    })
    window.addEventListener('touchstart', onFirstGesture, {
      once: true,
      passive: true,
    })

    layout()
    frame = window.requestAnimationFrame(tick)

    return () => {
      destroyed = true
      controllerRef.current = null
      window.cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('orientationchange', layout)
      mobileViewport.removeEventListener('change', layout)
      window.removeEventListener('pointerdown', onFirstGesture)
      window.removeEventListener('touchstart', onFirstGesture)
      root.style.removeProperty('--ss-progress')
      delete root.dataset.activeSection
      delete root.dataset.scrollScrubMediaFit
      delete root.dataset.scrollScrubMobileMedia

      for (const segment of runtime) {
        unloadClip(segment)
        segment.layer.style.removeProperty('opacity')
        segment.layer.style.removeProperty('z-index')
      }

      for (const node of captionNodes) {
        node.style.removeProperty('opacity')
      }

      for (const node of copyNodes) {
        node.style.removeProperty('opacity')
        node.style.removeProperty('pointer-events')
      }
      root.style.removeProperty('--ss-copy-scrim')
    }
  }, [captionList, segments])

  if (scenes.length === 0) {
    return null
  }

  const themeStyle: ThemeStyle = {
    '--ss-accent': theme.accent,
    '--ss-bg': theme.background,
    '--ss-ink': theme.ink,
    '--ss-muted': theme.muted,
  }

  return (
    <section
      className={['scroll-scrub', className].filter(Boolean).join(' ')}
      id={id}
      ref={rootRef}
      style={themeStyle}
    >
      <div className="scroll-scrub__stage">
        <div aria-hidden="true" className="scroll-scrub__media">
          {segments.map((segment, index) => {
            const layerStyle: ThemeStyle = {
              '--ss-mobile-position': segment.mobileObjectPosition,
              '--ss-object-position': segment.objectPosition,
            }
            return (
              <figure
                className={`scroll-scrub__layer scroll-scrub__layer--${segment.kind}`}
                data-scroll-scrub-layer=""
                key={segment.key}
                style={layerStyle}
              >
                <picture className="scroll-scrub__picture">
                  {segment.mobilePoster ? (
                    <source media={SCROLL_SCRUB_MOBILE_MEDIA_QUERY} srcSet={segment.mobilePoster} />
                  ) : null}
                  {/* Sima <img> a <picture>-ben: a poszter a klip PONTOS első
                      kockája, art-direction <source>-szal (mobil vágat) és
                      object-fit-tel a videóréteg alatt — a next/image wrapper-
                      markupja és átméretezése itt elcsúsztatná a kockát. */}
                  <img
                    alt=""
                    className="scroll-scrub__poster"
                    decoding="async"
                    fetchPriority={index === 0 ? 'high' : 'auto'}
                    loading={index === 0 ? 'eager' : 'lazy'}
                    src={segment.poster}
                  />
                </picture>
              </figure>
            )
          })}
        </div>

        {/* Úszó feliratok (2. és 3. állás). Rendes DOM-szöveg a vásznon: a
            láthatóságot a görgetés adja, de a tartalom végig a fában marad,
            így képernyőolvasóval és kereséssel is elérhető.

            MIÉRT NEM CÍMSOR a felirat címe: a vászon (`__stage`) a DOM-ban
            MEGELŐZI a jelenet-szöveget (`__story`), ahol a lap egyetlen h1-e
            áll. Egy h2-vel a lap első címsora a h1 ELŐTT jönne, tehát a
            dokumentum-vázlat fordítva olvasódna. A cím és a leírás
            összetartozását így az olvasási sorrend és a közös, egyben
            elhalványuló doboz adja; az `aria-hidden` a burkolóra kerül, ezért
            a két bekezdés mindig EGYÜTT jelenik meg a képernyőolvasónak. */}
        {captionList.length > 0 ? (
          <div className="scroll-scrub__captions">
            {captionList.map((caption) => (
              <div
                className={`scroll-scrub__caption scroll-scrub__caption--${caption.align}`}
                data-scroll-scrub-caption=""
                key={caption.id}
              >
                <p className="scroll-scrub__caption-title">{caption.text}</p>
                {caption.body ? <p className="scroll-scrub__caption-body">{caption.body}</p> : null}
              </div>
            ))}
          </div>
        ) : null}

        <div aria-hidden="true" className="scroll-scrub__progress">
          <span />
        </div>

        {scenes.length > 1 ? (
          <nav aria-label="Filmfejezetek" className="scroll-scrub__route">
            {scenes.map((scene, index) => (
              <button
                aria-current={activeSection === index ? 'step' : undefined}
                className="scroll-scrub__route-button"
                key={scene.id}
                onClick={() => controllerRef.current?.jumpToSection(index)}
                type="button"
              >
                <span>{scene.label}</span>
              </button>
            ))}
          </nav>
        ) : null}
      </div>

      <div className="scroll-scrub__story">
        {segments.map((segment) => {
          const bandStyle: CSSProperties = {
            minHeight: `${Math.max(segment.weight, 0.2) * 100}dvh`,
          }

          if (segment.kind === 'connector') {
            return (
              <div
                aria-hidden="true"
                className="scroll-scrub__connector-band"
                data-scroll-scrub-band=""
                key={segment.key}
                style={bandStyle}
              />
            )
          }

          const { scene } = segment
          if (!scene) {
            return null
          }
          const Heading = segment.sectionIndex === 0 ? 'h1' : 'h2'

          return (
            <article
              className="scroll-scrub__chapter"
              data-align={scene.align ?? 'left'}
              data-scroll-scrub-band=""
              id={scene.id}
              key={segment.key}
              style={bandStyle}
            >
              <div className="scroll-scrub__chapter-pin">
                <div className="scroll-scrub__copy">
                  {scene.kicker ? <p className="scroll-scrub__kicker">{scene.kicker}</p> : null}
                  <Heading className="scroll-scrub__title">{scene.title}</Heading>
                  {scene.body ? <p className="scroll-scrub__body">{scene.body}</p> : null}
                  {scene.tags?.length ? (
                    <ul className="scroll-scrub__tags">
                      {scene.tags.map((tag) => (
                        <li key={tag}>{tag}</li>
                      ))}
                    </ul>
                  ) : null}
                  {scene.actions ? (
                    <div className="scroll-scrub__actions">{scene.actions}</div>
                  ) : null}
                </div>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
