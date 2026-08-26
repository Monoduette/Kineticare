'use client'

import { useEffect, useRef } from 'react'

import { trackVideoMilestone, trackVideoStarted } from '../../../lib/analytics/course-events'
import { createBunnyPlayerBridge } from '../../../lib/stream/playerjs-client'
import { loadBunnyPlayerJs, type PlayerJsLibraryPlayer } from '../../../lib/stream/playerjs-loader'
import { createWatchTracker } from '../../../lib/stream/watched-coverage'

import {
  createVideoDepthTracker,
  type VideoDepthEvents,
  type VideoDepthTracker,
} from './analytics'

/**
 * Automatikus „megnézett" jelölés a Bunny-lejátszó tényleges nézettsége alapján (90%).
 * Tartalék híd indul azonnal; hivatalos player.js megérkezése után lebomlik.
 * iframeSrc kulcs: lecke-váltáskor új követő; token-frissítés nem cseréli (pozícióvesztés).
 */
export interface WatchTrackingInput {
  /**
   * A kurzus adatbázis-azonosítója a videó-mélység eseményekhez. `null`, ha
   * ismeretlen — ilyenkor mérföldkő NEM megy ki (azonosító nélkül a riport
   * nem köthető kurzushoz). Személyes adat nem kerül az eseményekbe.
   */
  courseId: number | null
  /** Az iframe elem — erre iratkozik fel a hivatalos könyvtár és a tartalék híd is. */
  iframeRef: React.RefObject<HTMLIFrameElement | null>
  /** Az iframe által BETÖLTÖTT embed-URL; változása = új lecke indult. */
  iframeSrc: string | null
  /** A JELENLEG lejátszott lecke stabil refje. */
  lessonRef: string | null
  /** A lecke CMS-ben rögzített hossza (a lejátszótól kapott hossz pontosabb). */
  durationSec: number | null
  /** Jelentés a lejátszónak: hányad része ment le a leckének (0–1). */
  report: (lessonRef: string, watchedRatio: number) => void
}

export function useWatchTracking({
  courseId,
  durationSec,
  iframeRef,
  iframeSrc,
  lessonRef,
  report,
}: WatchTrackingInput): void {
  // A jelentő MINDIG a legfrissebb változatra mutat, hogy az effekt ne
  // iratkozzon fel újra minden renderben (a lejátszó pozíciója így nem ugrik).
  const reportRef = useRef(report)
  useEffect(() => {
    reportRef.current = report
  }, [report])

  /**
   * Lecke → mélység-követő (a RETESZ tárolója). Azért ref és azért LECKÉNKÉNT,
   * mert a reteszt nem az effekt lefutásához, hanem a leckéhez kell kötni: az
   * effekt lecke-váltáskor és `iframeSrc`-változáskor újraindul, a már
   * elküldött mérföldköveket viszont ilyenkor sem szabad újraküldeni.
   */
  const melysegRef = useRef(new Map<string, VideoDepthTracker>())

  useEffect(() => {
    const iframe = iframeRef.current
    if (iframe === null || iframeSrc === null || lessonRef === null) {
      return
    }

    const tracker = createWatchTracker(durationSec)
    // Leckénként EGY követő: a meglévő retesz megmarad, új leckéhez új követő.
    const melyseg = melysegRef.current.get(lessonRef) ?? createVideoDepthTracker()
    melysegRef.current.set(lessonRef, melyseg)
    let eldobva = false
    let utoljaraJelentett = -1
    let tartalekHid: { dispose(): void } | null = null
    let hivatalosPlayer: PlayerJsLibraryPlayer | null = null

    /**
     * A mélység-események KIKÜLDÉSE. A követő már csak az ÚJ (még nem küldött)
     * eseményeket adja vissza, itt tehát nincs több szűrés — csak a védőháló,
     * hogy a mérés hibája ne érje el a nézőt.
     */
    const melysegetKuld = (events: VideoDepthEvents): void => {
      if (courseId === null) {
        return
      }
      try {
        if (events.started) {
          trackVideoStarted({ courseId, lessonRef })
        }
        for (const percent of events.milestones) {
          trackVideoMilestone({ courseId, lessonRef, percent })
        }
      } catch {
        // A mérés hibája nem akaszthatja meg a lejátszást.
      }
    }

    /** Egy időpont rögzítése és — érdemi változásnál — jelentés a lejátszónak. */
    const rogzit = (seconds: number, duration: number | null): void => {
      if (eldobva) {
        return
      }
      // A MÉLYSÉG a lejátszófej pozíciójából számol, a lefedettségtől
      // függetlenül (a kettő szándékosan más mérőszám — ./analytics.ts).
      melysegetKuld(melyseg.position({ seconds, duration: duration ?? durationSec }))
      tracker.setDuration(duration ?? durationSec)
      // A falióra-időbélyeg a tekerés-védelem második rétege: a valós időnél
      // gyorsabb média-előrehaladás tekerésnek számít, a megtanult küszöbtől
      // függetlenül (watched-coverage.ts, falióra-szabály).
      tracker.record(
        seconds,
        typeof performance === 'undefined' ? undefined : performance.now(),
      )
      const arany = tracker.coverage()
      // A `timeupdate` másodpercenként többször is érkezhet; csak 1
      // százalékpontonként (és a 100%-nál) terheljük a lejátszó állapotát.
      if (arany - utoljaraJelentett >= 0.01 || arany >= 1) {
        utoljaraJelentett = arany
        reportRef.current(lessonRef, arany)
      }
    }

    /** A videó vége: a MÉRT arányt jelentjük (a szkippelt rész nem számít bele). */
    const vegetErt = (): void => {
      if (!eldobva) {
        melysegetKuld(melyseg.ended())
        reportRef.current(lessonRef, tracker.coverage())
      }
    }

    /** A saját postMessage-híd felépítése — ha még nincs. */
    const tartalekotEpit = (): void => {
      if (eldobva || tartalekHid !== null) {
        return
      }
      tartalekHid = createBunnyPlayerBridge({
        iframe,
        onTimeUpdate: ({ seconds, duration }) => rogzit(seconds, duration),
        onEnded: vegetErt,
        // Csendes: egy hibás üzenet nem akaszthatja meg a lejátszást.
        onError: () => {},
      })
    }

    // A tartalék AZONNAL hallgat — a hivatalos könyvtár betöltése alatt (max
    // 8 mp) sem veszhet el nézettség (lásd a fejkomment indoklását).
    tartalekotEpit()

    void loadBunnyPlayerJs()
      .then((library) => {
        if (eldobva || library === null) {
          return
        }
        try {
          const player = new library.Player(iframe)
          player.on('timeupdate', (data) => {
            const seconds = typeof data.seconds === 'number' ? data.seconds : Number.NaN
            const duration = typeof data.duration === 'number' ? data.duration : null
            rogzit(seconds, duration)
          })
          player.on('ended', vegetErt)
          hivatalosPlayer = player
          // A hivatalos út él: a tartalék lebomlik, hogy sose fusson kettő.
          tartalekHid?.dispose()
          tartalekHid = null
        } catch {
          // A könyvtár váratlan alakja sem viheti el a lejátszást — a tartalék
          // híd már fut, nincs teendő.
        }
      })
      .catch(() => {
        // A tartalék híd már fut — a betöltési hiba nem igényel váltást.
      })

    return () => {
      eldobva = true
      tartalekHid?.dispose()
      // A player.js `off`-ja opcionális a könyvtár verziójától függően; ha
      // nincs, az `eldobva` kapu akkor is elnémítja a kései eseményeket.
      try {
        hivatalosPlayer?.off?.('timeupdate')
        hivatalosPlayer?.off?.('ended')
      } catch {
        // A leiratkozás hibája nem érdekes: a kapu már zárva.
      }
      tracker.reset()
    }
    // Az `iframeSrc` a lecke-váltás kulcsa: a token-frissítés NEM változtatja,
    // az explicit betöltés igen — pontosan ekkor kell új követő.
  }, [courseId, durationSec, iframeRef, iframeSrc, lessonRef])
}
