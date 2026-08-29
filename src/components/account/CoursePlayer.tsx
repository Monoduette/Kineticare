'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'

import {
  trackCourseCompleted,
  trackCourseStarted,
  trackLessonCompleted,
  trackModuleCompleted,
} from '@/lib/analytics/course-events'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ProgressBar } from '@/components/ui/Progress'
import { markVideoWatched } from '@/lib/course-progress/client'
import {
  TOKEN_REFRESH_RETRY_SEC,
  keepPlayingOnRefreshFailure,
  mergePlayingSession,
  nextRefreshDelaySec,
  type PlayingSession,
} from '@/lib/course-player-refresh'
import { courseHref } from '@/lib/course-url'
import { ctaLabel } from '@/lib/cta-vocabulary'
import { myCoursePlayerHref } from '@/lib/courses'
import { ACCESS_NOT_PURCHASED_MESSAGE, type PlayerGateKind } from '@/lib/course-access'
import { findLessonByRef, type Curriculum } from '@/lib/curriculum/curriculum'
import { summarizeCurriculum } from '@/lib/curriculum/progress'
import { bunnyProtectedLibraryId } from '@/lib/stream/bunny-site-config'
import { streamIframeSrc } from '@/lib/stream/contract'
import { fetchStreamToken, STREAM_SIGN_IN_REQUIRED_MESSAGE } from '@/lib/stream-token-client'
import { signInHref } from '@/lib/return-url'

import { eventsForLessonCompletion } from './player/analytics'
import { useWatchTracking } from './player/useWatchTracking'
import { CurriculumRail } from './player/CurriculumRail'
import { LessonBody } from './player/LessonBody'
import { PlayerActions } from './player/PlayerActions'
import { ArrowIcon, CloseIcon } from './player/icons'
import {
  completionAnnouncement,
  elativeSuffix,
  formatLessonDuration,
  initialOpenModuleIds,
  mergeModuleState,
  moduleStateKey,
  previousAction,
  primaryAction,
  readModuleState,
  shouldAutoMarkWatched,
  writeModuleState,
} from './player/navigation'

/**
 * COURSEPLAYER — a Kineticare kurzus-lejátszója.
 * 1. A TOKEN-FRISSÍTÉS NEM MOUNTOLJA ÚJRA AZ IFRAME-ET. A lejárat előtt 5
 * ÉLŐ BEJELENTÉS ÉS FÓKUSZ — MIÉRT NEM EGYSZERRE
 */

export interface CoursePlayerProduct {
  id: number
  /** A nyilvános kurzusoldalra mutató link slugja; hiányában a régi id-s cím. */
  slug?: string | null
  title: string
}

/**
 * A lejátszó felé BEFELÉ jövő haladás-jelentés alakja: melyik lecke, és
 * mekkora hányada ment le (0–1).
 */
export type LessonProgressReporter = (lessonRef: string, watchedRatio: number) => void

export interface CoursePlayerProps {
  product: CoursePlayerProduct
  /** A kurzus tananyaga — a SZERVER építi (`buildCurriculum`). */
  curriculum: Curriculum
  hasAccess: boolean
  /**
   * Lejárt hozzáférés esetén a kész, magyar üzenet (A1 — a szöveget a szerver
   * állítja elő az src/lib/course-access.ts-ből). null = nem lejárat miatt nincs
   * hozzáférés (pl. sosem vette meg).
   */
  expiredMessage?: string | null
  /**
   * Miért zár a kapu. Alap: lejárat, ha van `expiredMessage`, különben
   * „nem vásárolta meg". A lookup-hiba és a hiányzó purchases NEM lejárat.
   */
  gateKind?: PlayerGateKind
  /**
   * A már késznek jelölt leckék STABIL refjei — a szerver-komponens tölti be a
   * course-progress collectionből. Az orphan ref (időközben törölt lecke) itt is
   * előfordulhat: a tananyag egyszerűen nem talál hozzá leckét.
   */
  watchedRefs?: readonly string[]
  /**
   * A nézettség-alapú, automatikus jelölést a Bunny player.js kliens
   * (`src/lib/stream/playerjs-client.ts`, külön körben készül) fogja hajtani.
   * A lejátszó mountkor MEGHÍVJA ezt a feliratkozót, és átadja neki a saját
   * jelentés-visszahívását; a feliratkozó a leiratkozó függvényt adhatja vissza.
   * Így a jövőbeli kliens EGYETLEN vékony burkolóval bekapcsolható, és a
   * jelölés útvonala UGYANAZ marad, mint a kézi gombé — a kettő nem tud
   */
  bindLessonProgress?: (report: LessonProgressReporter) => (() => void) | void
}

/**
 * Ennyi sikertelen mentés után az AUTOMATIKUS jelölés feladja az adott leckét.
 * A kézi gomb korlátlan marad — a vevő a látható hibaüzenetből tudja, mi van.
 */
export const MAX_AUTO_MARK_ATTEMPTS = 3

type PlayerState =
  | { kind: 'idle' }
  | { kind: 'loading'; lessonRef: string }
  | {
      kind: 'playing'
      lessonRef: string
      videoIndex: number
      token: string
      expiresAtEpochSec: number
      /** Az iframe által TÉNYLEGESEN betöltött embed-URL — token-frissítéskor NEM változik. */
      loadedSrc: string | null
      /** A `loadedSrc`-be égetett jegy lejárata; ettől függ a csere. */
      loadedExpiresAtEpochSec: number | null
    }
  | { kind: 'unauthenticated'; message: string | null }
  | { kind: 'forbidden'; message: string | null }
  | { kind: 'unavailable' }
  | { kind: 'error'; message: string }

/** A lecke-betöltő szignatúrája (a token-frissítés önhivatkozásához kell). */
type LoadLesson = (lessonRef: string, isRefresh?: boolean) => Promise<void>

/**
 * A `localStorage` biztonságos elérése. Privát módban maga a PROPERTY-olvasás
 * dobhat `SecurityError`-t, ezért a try nem a művelet, hanem a hozzáférés köré
 * kell hogy kerüljön.
 */
function safeLocalStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

/**
 * A kezdetben nyitott lecke: a FOLYTATÁSHOZ ajánlott (első még nem kész)
 * lecke. Determinisztikus — a szerver- és a kliens-oldali első render azonos,
 * tehát nincs hidratálási eltérés.
 */
function initialLessonRef(curriculum: Curriculum, watchedRefs: readonly string[]): string | null {
  return summarizeCurriculum(curriculum, watchedRefs).resumeLesson?.ref ?? null
}

export function CoursePlayer({
  bindLessonProgress,
  curriculum,
  expiredMessage = null,
  gateKind,
  hasAccess,
  product,
  watchedRefs,
}: CoursePlayerProps) {
  const initialRefs = useMemo(() => watchedRefs ?? [], [watchedRefs])

  const [state, setState] = useState<PlayerState>({ kind: 'idle' })
  const [activeRef, setActiveRef] = useState<string | null>(() =>
    initialLessonRef(curriculum, initialRefs),
  )
  /**
   * A kész leckék KLIENS-oldali állapota. A kezdőérték a szerverről jön; az
   * optimista jelölés ezt bővíti, hiba esetén pedig visszavesz belőle. Minden
   * változásnál ÚJ Set készül — a meglévő állapotot sosem mutáljuk.
   */
  const [watched, setWatched] = useState<ReadonlySet<string>>(() => new Set(initialRefs))
  /** Épp mentés alatt lévő refek — a gomb ilyenkor letiltva, dupla kattintás ellen. */
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set<string>())
  /** A legutóbbi sikertelen jelölés magyar üzenete (látható `role="alert"`). */
  const [markError, setMarkError] = useState<string | null>(null)
  /** Az élő régió szövege — csak ott íródik, ahol NINCS egyidejű fókuszmozgás. */
  const [announcement, setAnnouncement] = useState('')
  const [openModuleIds, setOpenModuleIds] = useState<ReadonlySet<string>>(
    () => new Set(initialOpenModuleIds(curriculum, initialLessonRef(curriculum, initialRefs))),
  )
  /** Mobilon a tananyag-panel nyitva van-e. Asztali nézetben mindig false. */
  const [railOpen, setRailOpen] = useState(false)

  const refreshTimerRef = useRef<number | null>(null)
  /**
   * Betöltés-generáció: minden FELHASZNÁLÓI lecke-váltás (nem-refresh hívás)
   * növeli. A repülőben lévő token-kérés a saját generációját őrzi; ha a válasz
   * megérkezésekor a számláló már eltér, a válasz KÉSÉS — eldobjuk (se
   * állapotváltás, se új időzítő).
   */
  const loadGenerationRef = useRef(0)
  /** A frissítő-időzítő MINDIG a legfrissebb betöltő-függvényt hívja. */
  const loadLessonRef = useRef<LoadLesson | null>(null)
  /**
   * A legutóbbi „playing" állapot tükre. Azért ref és nem a state, mert a
   * token-válasz feldolgozásakor az összefésült állapotra SZINKRON van szükség
   * (a következő időzítő késleltetése a betöltött jegy lejáratától is függ),
   * a setState updaterben pedig mellékhatás — időzítő-állítás — nem futhat.
   */
  const playingRef = useRef<{ lessonRef: string; session: PlayingSession } | null>(null)
  /** A lecke címe — váltáskor ide megy a fókusz. */
  const headingRef = useRef<HTMLHeadingElement | null>(null)
  /**
   * A legutóbb FÓKUSZÁLT lecke refje. Nem egyszerű „első render" jelző: a
   * React fejlesztői módban (StrictMode) kétszer futtatja az effekteket, és egy
   * eldobható logikai jelző a második futáskor már ellopná a fókuszt az oldal
   * betöltésekor. Az utolsó fókuszált ref TÁROLÁSA idempotens.
   */
  const focusedLessonRef = useRef<string | null>(initialLessonRef(curriculum, initialRefs))
  /** A mobil panelt megnyitó gomb — záráskor IDE tér vissza a fókusz. */
  const railToggleRef = useRef<HTMLButtonElement | null>(null)
  const railPanelRef = useRef<HTMLDivElement | null>(null)
  /** A Bunny-lejátszó iframe-je — a nézettség-követő híd erre iratkozik fel. */
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  /**
   * A késznek jelölt (és az épp mentés alatt lévő) leckék SZINKRON pillanatképe.
   * Lásd a `markWatched` fejkommentjét: ez a duplikált szerverhívás és a
   * duplikált funnel-esemény szerkezeti védelme.
   */
  const keszLeckekRef = useRef<ReadonlySet<string>>(new Set(initialRefs))
  /**
   * A SIKERESEN mentett leckék könyvelése — kizárólag a mérföldkő-pillanatképek
   * forrása. Szándékosan külön a `keszLeckekRef`-től: az optimista zár
   * visszagördülhet, ez viszont csak sikernél lép előre, így a funnel-átmenet
   * sosem számolódik bukott jelölésből (lásd a `markWatched` fejkommentjét).
   */
  const analitikaRef = useRef<ReadonlySet<string>>(new Set(initialRefs))
  /**
   * Sikertelen jelölési kísérletek leckénként. Az AUTOMATIKUS jelölés
   * `MAX_AUTO_MARK_ATTEMPTS` bukás után leáll az adott leckére — a code review
   * mérte, hogy enélkül a rollback + a következő `timeupdate` végtelen
   * kérés-hurkot ad tartósan hibázó szervernél. A kézi gombot nem korlátozza.
   */
  const autoJelolesHibakRef = useRef(new Map<string, number>())

  const storageKey = useMemo(() => moduleStateKey(product.id), [product.id])
  const idPrefix = useMemo(() => `kc-player-${product.id}`, [product.id])
  const railTitleId = `${idPrefix}-tananyag-cim`

  const progress = useMemo(() => summarizeCurriculum(curriculum, watched), [curriculum, watched])
  const activeLesson = useMemo(
    () => (activeRef === null ? null : findLessonByRef(curriculum, activeRef)),
    [curriculum, activeRef],
  )
  const primary = useMemo(
    () => primaryAction(curriculum, activeRef, watched),
    [curriculum, activeRef, watched],
  )
  const previous = useMemo(() => previousAction(curriculum, activeRef), [curriculum, activeRef])

  const clearRefreshTimer = useCallback(() => {
    if (refreshTimerRef.current !== null) {
      window.clearTimeout(refreshTimerRef.current)
      refreshTimerRef.current = null
    }
  }, [])

  /**
   * Optimista jelölés: a pipa azonnal látszik, a szerverhívás hibája esetén
   */
  const markWatched = useCallback(
    async (lessonRef: string, announce: boolean) => {
      // SZERKEZETI zár: a ref már tartalmazza a késznek jelölt és az épp
      // mentés alatt lévő leckéket is.
      if (keszLeckekRef.current.has(lessonRef)) {
        return
      }
      keszLeckekRef.current = new Set(keszLeckekRef.current).add(lessonRef)

      setMarkError(null)
      setPending((current) => new Set(current).add(lessonRef))
      // FUNKCIONÁLIS frissítés: két, egymást átfedő jelölés (pl. az automatikus
      // és a kézi) így nem írja felül egymás eredményét.
      setWatched((current) => new Set(current).add(lessonRef))

      const result = await markVideoWatched({ productId: product.id, videoRef: lessonRef })

      setPending((current) => {
        const next = new Set(current)
        next.delete(lessonRef)
        return next
      })

      if (result.kind !== 'ok') {
        // A zárat is oldjuk: a vevő újrapróbálhatja a jelölést. A hibaszámláló
        // az AUTOMATIKUS újrapróbálkozást fékezi (lásd reportLessonProgress) —
        // a kézi gombot nem.
        autoJelolesHibakRef.current.set(
          lessonRef,
          (autoJelolesHibakRef.current.get(lessonRef) ?? 0) + 1,
        )
        const vissza = new Set(keszLeckekRef.current)
        vissza.delete(lessonRef)
        keszLeckekRef.current = vissza
        setWatched((current) => {
          const next = new Set(current)
          next.delete(lessonRef)
          return next
        })
        setMarkError(result.message)
        return
      }

      autoJelolesHibakRef.current.delete(lessonRef)

      // Ha egy párhuzamos hívás már sikerre vitte ugyanezt a leckét, a
      // bejelentés és a funnel nem futhat le még egyszer.
      if (analitikaRef.current.has(lessonRef)) {
        return
      }
      const lesson = findLessonByRef(curriculum, lessonRef)
      const before = summarizeCurriculum(curriculum, analitikaRef.current)
      analitikaRef.current = new Set(analitikaRef.current).add(lessonRef)
      const after = summarizeCurriculum(curriculum, analitikaRef.current)

      if (announce) {
        setAnnouncement(
          completionAnnouncement({
            lessonTitle: lesson?.title ?? 'A lecke',
            completed: after.completed,
            total: after.total,
          }),
        )
      }

      // Tanulási funnel (PostHog). A küldők hozzájárulás nélkül csendben
      // no-opok, ezért itt nincs külön consent-kapu. A mérföldkövek az
      // ÁTMENETRE szólnak, nem az állapotra — enélkül minden oldalbetöltés
      // újraküldené a „course_completed"-et (./player/analytics.ts).
      if (lesson !== null) {
        trackLessonCompleted({
          courseId: product.id,
          lessonRef,
          lessonKind: lesson.kind,
          moduleIndex: lesson.moduleIndex,
          percent: after.percent,
        })
        const milestones = eventsForLessonCompletion({
          before,
          after,
          moduleIndex: lesson.moduleIndex,
        })
        if (milestones.courseStarted) {
          trackCourseStarted({ courseId: product.id })
        }
        if (milestones.completedModuleIndex !== null) {
          trackModuleCompleted({
            courseId: product.id,
            moduleIndex: milestones.completedModuleIndex,
            percent: after.percent,
          })
        }
        if (milestones.courseCompleted) {
          trackCourseCompleted({ courseId: product.id, lessonCount: after.total })
        }
      }
    },
    [curriculum, product.id],
  )

  /**
   * A haladás-jelentés feldolgozása (a `bindLessonProgress` bekötési pont
   * túloldala). A döntés küszöbe tiszta függvényben él
   * (`shouldAutoMarkWatched`), a jelölés pedig UGYANAZ az útvonal, amit a gomb
   * hív — így az automatikus és a kézi jelölés nem tud eltérni egymástól.
   *
   * Bejelentés NÉLKÜL fut: a videó vége nem felhasználói kérés, a hangos
   * közbeszólás ott zavaró lenne (a pipa a railben látható visszajelzés).
   */
  const reportLessonProgress = useCallback<LessonProgressReporter>(
    (lessonRef, watchedRatio) => {
      // A ref, nem az állapot: a `timeupdate` sűrűbben érkezik, mint ahogy a
      // React újrarendel, tehát az állapot itt elavult lenne.
      // A hibaszámláló-kapu a végtelen újrapróbálkozást zárja: tartósan hibázó
      // szervernél az automatika feladja, a kézi gomb (és a látható hibaüzenet)
      // viszont végig ott marad a vevőnek.
      if ((autoJelolesHibakRef.current.get(lessonRef) ?? 0) >= MAX_AUTO_MARK_ATTEMPTS) {
        return
      }
      if (shouldAutoMarkWatched(watchedRatio, keszLeckekRef.current.has(lessonRef))) {
        void markWatched(lessonRef, false)
      }
    },
    [markWatched],
  )
  /**
   * A jelentés-visszahívás STABIL példánya: a feliratkozó (a jövőbeli player.js
   * kliens) egyszer kapja meg, és nem kell újra-feliratkoznia minden
   * állapotváltozásnál — a ref mindig a legfrissebb feldolgozóra mutat.
   */
  const reportRef = useRef<LessonProgressReporter>(reportLessonProgress)
  useEffect(() => {
    reportRef.current = reportLessonProgress
  }, [reportLessonProgress])

  const stableReport = useCallback<LessonProgressReporter>((lessonRef, watchedRatio) => {
    reportRef.current(lessonRef, watchedRatio)
  }, [])

  useEffect(() => {
    if (bindLessonProgress === undefined) {
      return
    }
    return bindLessonProgress(stableReport) ?? undefined
  }, [bindLessonProgress, stableReport])

  /**
   * AUTOMATIKUS nézettség-követés a Bunny-lejátszóból (hibrid jelölés). A híd,
   * a 90%-os küszöb és a szkippelés-ellenes intervallum-számítás a
   * ./player/useWatchTracking.ts-ben él; a DÖNTÉST és a szerverhívást
   * változatlanul a fenti `reportLessonProgress` hozza meg, tehát az
   * automatikus és a kézi jelölés ugyanazt az utat járja.
   *
   * UGYANEZ a hook küldi a videó-MÉLYSÉG eseményeit (video_started,
   * video_milestone 25/50/75/100%-nál) — leckénként és mérföldkövenként
   * egyszer, retesszel (./player/analytics.ts). A `lesson_completed` a lecke
   * VÉGÉT jelzi, a mélység-események a KÖZTES lemorzsolódást mutatják meg.
   */
  useWatchTracking({
    // A videó-mélység eseményekhez (video_started / video_milestone) a kurzus
    // azonosítója kell — a lecke refjét a hook a lejátszott leckéből tudja.
    courseId: product.id,
    durationSec: activeLesson?.durationSec ?? null,
    iframeRef,
    iframeSrc: state.kind === 'playing' ? state.loadedSrc : null,
    lessonRef: state.kind === 'playing' ? state.lessonRef : null,
    report: stableReport,
  })

  const loadLesson = useCallback<LoadLesson>(
    async (lessonRef, isRefresh = false) => {
      if (!hasAccess) {
        // A korai hibaágakon is meg kell halnia az ELŐZŐ lecke időzítőjének:
        // különben a kapu/hibaképernyő fölött a régi lecke frissítője később
        // magától „visszaélesztené" a lejátszót (mérve a review-körben).
        loadGenerationRef.current += 1
        clearRefreshTimer()
        setState({ kind: 'forbidden', message: null })
        return
      }
      const lesson = findLessonByRef(curriculum, lessonRef)
      if (lesson === null || !lesson.playable) {
        loadGenerationRef.current += 1
        clearRefreshTimer()
        setState({ kind: 'error', message: 'Ez a lecke jelenleg nem érhető el.' })
        return
      }

      if (!isRefresh) {
        // Felhasználói váltás: az ELŐZŐ lecke frissítő-időzítője itt hal meg — egy
        // sikertelen váltás után sem kapcsolhat vissza a régi lecke. A
        // generáció-növelés a már REPÜLŐBEN lévő kérések válaszát is érvényteleníti.
        loadGenerationRef.current += 1
        clearRefreshTimer()
        setActiveRef(lessonRef)
        setMarkError(null)
      }

      // Szöveges lecke és külső link: NINCS jegykiadás és NINCS iframe. A
      // jegykérés videó-azonosító nélkül hibát adna, a felület pedig fölöslegesen
      // mutatna „nem érhető el" üzenetet egy tökéletesen olvasható leckén.
      if (lesson.kind !== 'video') {
        if (!isRefresh) {
          setState({ kind: 'idle' })
        }
        return
      }

      if (!isRefresh) {
        setState({ kind: 'loading', lessonRef })
      }
      const generation = loadGenerationRef.current

      // A STABIL ref megy ki, sosem sorszám (lásd a komponens fejlécét, 3. pont).
      const result = await fetchStreamToken({ productId: product.id, videoId: lesson.ref })

      if (generation !== loadGenerationRef.current) {
        // Kései válasz: a felhasználó időközben másik leckét nyitott.
        return
      }

      if (result.kind !== 'token') {
        // Háttér-frissítés átmeneti hibája NEM bontja le a futó lejátszást: a
        // betöltött jegy még ~5 percig él, a state-váltás viszont azonnal
        // unmountolná az iframe-et (pozícióvesztés), és új időzítő híján a
        // frissítő-lánc végleg meghalna — a fekete-lejátszó osztály a hibaágon
        // át. Rövid újrapróba megy helyette (a szabály a tiszta modulban).
        if (
          keepPlayingOnRefreshFailure(result.kind, isRefresh) &&
          playingRef.current?.lessonRef === lessonRef
        ) {
          clearRefreshTimer()
          refreshTimerRef.current = window.setTimeout(() => {
            void loadLessonRef.current?.(lessonRef, true)
          }, TOKEN_REFRESH_RETRY_SEC * 1000)
          return
        }
        if (result.kind === 'unauthenticated') {
          setState({ kind: 'unauthenticated', message: result.message })
          return
        }
        if (result.kind === 'forbidden') {
          setState({ kind: 'forbidden', message: result.message })
          return
        }
        if (result.kind === 'unavailable') {
          setState({ kind: 'unavailable' })
          return
        }
        setState({ kind: 'error', message: result.message })
        return
      }

      clearRefreshTimer()
      const expiresAtEpochSec = result.expiresAtEpochSec
      const nowSec = Math.floor(Date.now() / 1000)

      const nextSrc = streamIframeSrc({
        libraryId: bunnyProtectedLibraryId(),
        streamAssetId: lesson.streamAssetId,
        token: result.token,
        expiresAtEpochSec,
      })
      // A token-frissítés NEM cseréli az iframe src-jét (nincs újramount, nincs
      // pozícióvesztés) — a szabály a tiszta, tesztelt segédfüggvényé. Az
      // időzítő az ÖSSZEFÉSÜLT állapotból számol: ha a src megmaradt, a
      // következő kör a BETÖLTÖTT jegy csere-határidejére áll, nem az új token
      // lejáratára — különben a betöltött jegy a két kör között lejárna, és a
      // vevő fekete lejátszót nézne (nextRefreshDelaySec fejléce a mért esettel).
      const previousPlaying = playingRef.current
      const merged = mergePlayingSession(
        previousPlaying !== null && previousPlaying.lessonRef === lessonRef
          ? previousPlaying.session
          : null,
        {
          videoIndex: lesson.flatIndex,
          token: result.token,
          expiresAtEpochSec,
          src: nextSrc,
        },
        isRefresh,
        nowSec,
      )
      refreshTimerRef.current = window.setTimeout(() => {
        void loadLessonRef.current?.(lessonRef, true)
      }, nextRefreshDelaySec(merged, nowSec) * 1000)
      playingRef.current = { lessonRef, session: merged }
      setState({ kind: 'playing', lessonRef, ...merged })
    },
    [clearRefreshTimer, curriculum, hasAccess, product.id],
  )

  // A ref mindig a legutóbbi renderben létrejött loadLesson-t tartja.
  useEffect(() => {
    loadLessonRef.current = loadLesson
  }, [loadLesson])

  // Mountkori automatikus indítás. A react-hooks/set-state-in-effect ezt a
  // hívást megjelöli (a `loadLesson` tranzitíven setState-et hív) — a szabály
  // erre a fájlra warn-ra van állítva az eslint.config.mjs-ben, indoklással.
  useEffect(() => {
    if (hasAccess && activeRef !== null && state.kind === 'idle') {
      void loadLesson(activeRef)
    }
    return () => {
      // Unmountkor a REPÜLŐBEN lévő token-válasz is érvénytelen. A code review
      // mérte: enélkül a válasz a leszerelés UTÁN új frissítő-időzítőt ütemez,
      // amit már semmi nem töröl, és a sikeres frissítés örökké újraütemez —
      // a háttérben percenként token-kérések mennek egy nem létező lejátszónak.
      // A generáció-növelés pontosan azt a kaput zárja, amit a lecke-váltás is
      // használ: a kései válasz eldobódik, időzítő fel sem áll.
      loadGenerationRef.current += 1
      clearRefreshTimer()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasAccess])

  // A megőrzött modul-nyitottság csak a HIDRATÁLÁS UTÁN kerül be: a
  // localStorage a szerveren nem létezik, így a kezdőállapotba építve
  // hidratálási eltérést okozna.
  useEffect(() => {
    const stored = readModuleState(safeLocalStorage(), storageKey)
    if (stored === null) {
      return
    }
    setOpenModuleIds(new Set(mergeModuleState(curriculum, stored, activeRef)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey])

  /**
   * Lecke-váltáskor a fókusz a lecke címére ugrik. Az ELSŐ renderen nem: az
   * oldal betöltése nem lecke-váltás, és a fókusz elrablása ott a
   * billentyűzetes és a képernyőolvasós navigációt is elrontaná.
   */
  useEffect(() => {
    if (focusedLessonRef.current === activeRef) {
      return
    }
    focusedLessonRef.current = activeRef
    headingRef.current?.focus()
  }, [activeRef])

  // A mobil panel nyitva: a fókusz a panelre kerül, és a háttér nem görög.
  useEffect(() => {
    if (!railOpen) {
      return
    }
    railPanelRef.current?.focus()
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [railOpen])

  // Asztali szélességre váltva a modális panelnek nincs értelme: a rail ott
  // amúgy is látszik, a `role="dialog"` viszont ott maradna a DOM-ban.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return
    }
    const query = window.matchMedia('(min-width: 1024px)')
    const handleChange = () => {
      if (query.matches) {
        setRailOpen(false)
      }
    }
    query.addEventListener('change', handleChange)
    return () => query.removeEventListener('change', handleChange)
  }, [])

  const closeRail = useCallback(() => {
    setRailOpen(false)
    railToggleRef.current?.focus()
  }, [])

  const handleToggleModule = useCallback(
    (moduleId: string) => {
      const next = new Set(openModuleIds)
      if (next.has(moduleId)) {
        next.delete(moduleId)
      } else {
        next.add(moduleId)
      }
      setOpenModuleIds(next)
      writeModuleState(safeLocalStorage(), storageKey, next)
    },
    [openModuleIds, storageKey],
  )

  const handleSelectLesson = useCallback(
    (lessonRef: string) => {
      /**
       * Mobilon a választás zárja a panelt. A fókusz ilyenkor NEM a megnyitó
       * gombra tér vissza, hanem a lecke címére — azt a lecke-váltás effektje
       * intézi.
       * KIVÉTEL: ha a MÁR AKTÍV leckére kattint a felhasználó (tájékozódott a
       * panelen, és ott hagyta a kijelölést az `aria-current` során), nincs
       * lecke-váltás, tehát a váltás-effekt korán kilép, és a cím sem
       */
      if (lessonRef === activeRef) {
        closeRail()
        return
      }
      setRailOpen(false)
      void loadLesson(lessonRef)
    },
    [activeRef, closeRail, loadLesson],
  )

  const handlePrimary = useCallback(() => {
    if (primary === null || primary.disabled) {
      return
    }
    const currentRef = activeRef
    if (primary.marksWatched && currentRef !== null) {
      // Bejelentés CSAK akkor, ha nem lépünk tovább (lásd a fejléc utolsó blokkját).
      void markWatched(currentRef, primary.targetRef === null)
    }
    if (primary.targetRef !== null) {
      void loadLesson(primary.targetRef)
    }
  }, [activeRef, loadLesson, markWatched, primary])

  /** Fókusz-csapda + Escape a modális tananyag-panelen. */
  const handleRailKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (!railOpen) {
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        closeRail()
        return
      }
      if (event.key !== 'Tab') {
        return
      }
      const panel = railPanelRef.current
      if (panel === null) {
        return
      }
      /**
       * A csukott modulok panelje `hidden` (→ `display: none`), a bennük lévő
       * lecke-gombokat viszont a szelektor visszaadná: az csak a `disabled`-re
       * szűr, a láthatóságra nem. A csapda így egy `display: none` elemet
       * tartana „utolsónak", és a fókusz előre KISZIVÁROGNA a dialogból,
       * visszafelé pedig beragadna. Mivel az `initialOpenModuleIds` csak az
       * aktív lecke modulját nyitja ki, ez a TÖBBMODULOS kurzus
       */
      const focusable = [
        ...panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((element) => element.getClientRects().length > 0)
      if (focusable.length === 0) {
        event.preventDefault()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement
      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    },
    [closeRail, railOpen],
  )

  if (!hasAccess) {
    const resolvedGate: PlayerGateKind =
      gateKind ?? (expiredMessage === null ? 'not-purchased' : 'expired')
    const isRecovery = resolvedGate === 'lookup-failed' || resolvedGate === 'grant-pending'
    const title =
      resolvedGate === 'expired'
        ? 'Lejárt a hozzáférésed'
        : isRecovery
          ? 'A kurzus most nem nyitható meg'
          : 'Nincs hozzáférésed ehhez a kurzushoz'
    const body =
      expiredMessage ?? (resolvedGate === 'not-purchased' ? ACCESS_NOT_PURCHASED_MESSAGE : null)
    return (
      <Card className="kc-player-gate">
        <h1 className="kc-player-gate__title">{title}</h1>
        {body === null ? null : <p>{body}</p>}
        {isRecovery ? (
          <>
            <Button href={myCoursePlayerHref(product.id)}>{ctaLabel('retry')}</Button>
            <Button href="/kapcsolat" variant="secondary">
              {ctaLabel('contact-open')}
            </Button>
          </>
        ) : (
          <Button href={courseHref(product)}>{ctaLabel('course-sales-open')}</Button>
        )}
      </Card>
    )
  }

  if (progress.total === 0) {
    // Nincs elindítható lecke (üres tananyag vagy még feldolgozás alatt).
    // A visszaút a listára visz (#15 mintázat); a kapcsolat a zsákutca ellen
    // (NN/g: mondd meg a következő lépést; GOV.UK: don’t drop people off;
    // WCAG 2.2 · 3.3.3 Error Suggestion).
    return (
      <Card className="kc-player-gate">
        <h1 className="kc-player-gate__title">{product.title}</h1>
        <p>
          A tananyag feltöltése és feldolgozása folyamatban van. Nézz vissza hamarosan. Ha már
          régóta így van, írj nekünk.
        </p>
        <Button href="/kurzusaim" variant="secondary">
          Vissza a kurzusaimhoz
        </Button>
        <Button href="/kapcsolat" variant="secondary">
          {ctaLabel('contact-open')}
        </Button>
      </Card>
    )
  }

  const progressValueText = `${progress.completed} lecke kész a ${progress.total}-${elativeSuffix(progress.total)}`
  // Az iframe src-je a BETÖLTÉSKORI embed-URL (`loadedSrc`): a token-frissítés
  // a jegyet megújítja, az src-t csak akkor cseréli, ha a betöltött jegy a
  // küszöb alá esik (lásd mergePlayingSession).
  const playingSrc =
    state.kind === 'playing' && state.lessonRef === activeRef ? state.loadedSrc : null
  const isVideoLesson = activeLesson?.kind === 'video'
  const activeDuration = formatLessonDuration(activeLesson?.durationSec ?? null)
  const busy = activeRef !== null && pending.has(activeRef)

  return (
    <div className="kc-player">
      {/* ── STICKY KURZUS-FEJLÉC ─────────────────────────────────────────────
          Nem rejtőzik el görgetéskor (a rejtőzködő fejléc a visszatéréskor
          „elveszett" érzést kelt), explicit háttérszínt visel, és a magassága
          CSS-változó: a rail sticky-topja és a fókusz scroll-margója EBBŐL
          származik (WCAG 2.2 2.4.11 — a sticky sáv nem takarhatja el a
          fókuszált elemet). */}
      <header className="kc-player__header">
        <div className="kc-player__header-row">
          <Link className="kc-player__back" href="/kurzusaim">
            <ArrowIcon direction="vissza" />
            <span>Kurzusaim</span>
          </Link>
          <p className="kc-player__course-title">{product.title}</p>
          {/* WAI-ARIA APG Dialog: a nyitó gomb aria-expanded + aria-haspopup.
              https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
              WCAG 2.2 · 4.1.2 Name, Role, Value */}
          <button
            aria-expanded={railOpen}
            aria-haspopup="dialog"
            className="kc-player__rail-toggle"
            /* aria-expanded: WAI-ARIA APG Dialog (Modal) Pattern,
               https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
               WCAG 2.2 · 4.1.2 Name, Role, Value
               https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html */
            onClick={() => setRailOpen(true)}
            ref={railToggleRef}
            type="button"
          >
            Tananyag
            <span aria-hidden="true">
              {' '}
              · {progress.completed}/{progress.total}
            </span>
            <span className="kc-sr-only">, {progressValueText}</span>
          </button>
          <p className="kc-player__progress-text">
            <span aria-hidden="true">
              {progress.label} · {progress.percent}%
            </span>
            <span className="kc-sr-only">{progressValueText}</span>
          </p>
        </div>
        <ProgressBar
          className="kc-player__progress-bar"
          label="A kurzus haladása"
          percent={progress.percent}
          size="sm"
          valueText={progressValueText}
        />
      </header>

      <div className="kc-player__layout">
        {/* ── SZÍNPAD ───────────────────────────────────────────────────────
            A DOM-sorrend a mobil fontossági sorrend: videó → cím → akciósáv →
            tartalom. Asztali nézetben ugyanez a sorrend marad (a rail CSS-sel
            kerül balra), tehát a fókusz-sorrend és a vizuális sorrend nem
            válik szét (WCAG 1.3.2). */}
        <div className="kc-player__stage">
          {progress.complete ? (
            <p className="kc-player__done-banner">
              <span>
                Elvégezted a kurzust. {progress.total} lecke kész. Bármikor visszatérhetsz bármelyik
                leckéhez.
              </span>
              <Link href="/kurzusaim">Vissza a kurzusaimhoz</Link>
            </p>
          ) : null}

          {isVideoLesson ? (
            <div className="kc-player__media">
              {state.kind === 'loading' ? (
                <p aria-live="polite" className="kc-player__media-note" role="status">
                  A videó betöltése…
                </p>
              ) : null}
              {playingSrc !== null && activeLesson !== null ? (
                <iframe
                  allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture"
                  allowFullScreen
                  className="kc-player__frame"
                  key={playingSrc}
                  ref={iframeRef}
                  src={playingSrc}
                  title={`${product.title}: ${activeLesson.title}`}
                />
              ) : null}
              {state.kind === 'unauthenticated' ? (
                <p className="kc-player__media-error" role="alert">
                  {state.message ?? STREAM_SIGN_IN_REQUIRED_MESSAGE}
                  <Button
                    href={signInHref(myCoursePlayerHref(product.id))}
                    size="sm"
                    variant="secondary"
                  >
                    {ctaLabel('sign-in')}
                  </Button>
                </p>
              ) : null}
              {state.kind === 'forbidden' ? (
                <p className="kc-player__media-error" role="alert">
                  {state.message ?? 'Nincs hozzáférésed ehhez a videóhoz.'}
                  {activeRef === null ? null : (
                    <Button
                      onClick={() => void loadLesson(activeRef)}
                      size="sm"
                      variant="secondary"
                    >
                      {ctaLabel('retry')}
                    </Button>
                  )}
                  <Button href="/kapcsolat" size="sm" variant="secondary">
                    {ctaLabel('contact-open')}
                  </Button>
                </p>
              ) : null}
              {/* A hiányzó library-id (playingSrc === null) ugyanide fut be:
                  érvényes jegy mellett is némán törött iframe jönne belőle. */}
              {state.kind === 'unavailable' ||
              (state.kind === 'playing' && state.loadedSrc === null) ? (
                <p className="kc-player__media-error" role="alert">
                  A videólejátszás ideiglenesen nem érhető el. Próbáld később.
                  {activeRef === null ? null : (
                    <Button
                      onClick={() => void loadLesson(activeRef)}
                      size="sm"
                      variant="secondary"
                    >
                      {ctaLabel('retry')}
                    </Button>
                  )}
                  <Button href="/kapcsolat" size="sm" variant="secondary">
                    {ctaLabel('contact-open')}
                  </Button>
                </p>
              ) : null}
              {state.kind === 'error' ? (
                <p className="kc-player__media-error" role="alert">
                  {state.message}
                  {activeRef === null ? null : (
                    <Button
                      onClick={() => void loadLesson(activeRef)}
                      size="sm"
                      variant="secondary"
                    >
                      {ctaLabel('retry')}
                    </Button>
                  )}
                  <Button href="/kapcsolat" size="sm" variant="secondary">
                    {ctaLabel('contact-open')}
                  </Button>
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="kc-player__lesson-head">
            <h1 className="kc-player__lesson-title" ref={headingRef} tabIndex={-1}>
              {activeLesson?.title ?? product.title}
            </h1>
            <p className="kc-player__lesson-meta">
              {activeLesson === null
                ? null
                : `${activeLesson.moduleIndex + 1}. modul · ${activeLesson.indexInModule + 1}. lecke`}
              {activeDuration === null ? null : ` · ${activeDuration}`}
            </p>
            {activeLesson?.summary ? (
              <p className="kc-player__lesson-summary">{activeLesson.summary}</p>
            ) : null}
          </div>

          <PlayerActions
            busy={busy}
            onPrevious={(lessonRef) => void loadLesson(lessonRef)}
            onPrimary={handlePrimary}
            previous={previous}
            primary={primary}
          />

          {markError === null ? null : (
            <p className="kc-player__mark-error" role="alert">
              {markError}
            </p>
          )}

          {activeLesson === null ? null : <LessonBody lesson={activeLesson} />}
        </div>

        {/* ── TANANYAG-RAIL ────────────────────────────────────────────────
            Egyetlen példány: asztali nézetben oldalsáv, mobilon (a `railOpen`
            állapottal) teljes képernyős, modális panel. A `role="dialog"` CSAK
            nyitott állapotban kerül rá — asztali nézetben a `railOpen` sosem
            igaz, mert a megnyitó gomb ott nincs megjelenítve. */}
        {railOpen ? (
          <div aria-hidden="true" className="kc-player__scrim" onClick={closeRail} />
        ) : null}
        <div
          className={['kc-player__rail-panel', railOpen ? 'kc-player__rail-panel--open' : null]
            .filter(Boolean)
            .join(' ')}
          onKeyDown={handleRailKeyDown}
          ref={railPanelRef}
          {...(railOpen
            ? { role: 'dialog', 'aria-modal': true, 'aria-labelledby': railTitleId, tabIndex: -1 }
            : {})}
        >
          <div className="kc-player__rail-head">
            <h2 className="kc-player__rail-title" id={railTitleId}>
              Tananyag
            </h2>
            <button className="kc-player__rail-close" onClick={closeRail} type="button">
              <CloseIcon />
              <span className="kc-sr-only">Tananyag bezárása</span>
            </button>
          </div>
          <CurriculumRail
            activeRef={activeRef}
            curriculum={curriculum}
            idPrefix={idPrefix}
            onSelectLesson={handleSelectLesson}
            onToggleModule={handleToggleModule}
            openModuleIds={openModuleIds}
            progress={progress}
            watched={watched}
          />
        </div>
      </div>

      {/* EGYETLEN, MINDIG jelen lévő élő régió — feltételes rendereléssel a
          képernyőolvasó nem venné észre a szöveg megjelenését. */}
      <div aria-live="polite" className="kc-sr-only" role="status">
        {announcement}
      </div>
    </div>
  )
}
