import { describe, expect, it } from 'vitest'

import {
  CAPTION_END as END,
  CAPTION_MID as MID,
  FILM_SCROLL,
  PINNED,
} from '@/components/blocks/FilmHero'
import { CAPTION_FADE, captionOpacity } from '@/components/scroll-scrub/scroll-scrub'

/**
 * A filmsáv 2. és 3. „állásának" megjelenési görbéje.
 *
 * A feliratok láthatósága KIZÁRÓLAG a scrub-pozícióból (0..1) számolódik, ezért
 * a görbe tisztán tesztelhető — nem kell hozzá böngésző.
 *
 * A sávok a FilmHero.tsx-ben a TŰZÖTT szakaszra vannak skálázva:
 * PINNED = (FILM_SCROLL - 1) / FILM_SCROLL. WP50 óta a teszt a FilmHero
 * exportált értékeit használja, így a scrub-hossz vagy a sáv-arányok
 * változása itt automatikusan érvényesül; a „nem fedi egymást" eset a
 * tényleges sávokra fut.
 */
it('a sávok a tűzött szakaszra skálázottak', () => {
  expect(PINNED).toBeCloseTo((FILM_SCROLL - 1) / FILM_SCROLL, 12)
  expect(MID.to).toBeLessThan(END.from)
  expect(END.to).toBe(1)
})

/** Egyenletes mintavétel egy szakaszon (a végpontokat is beleértve). */
const samples = (from: number, to: number, count = 5) =>
  Array.from({ length: count }, (_, index) => from + ((to - from) * index) / (count - 1))

describe('captionOpacity', () => {
  it('a sávon belül teljesen látszik', () => {
    for (const p of samples(MID.from, MID.to)) {
      expect(captionOpacity(p, MID.from, MID.to)).toBe(1)
    }
  })

  it('a sáv előtt és után teljesen eltűnik', () => {
    expect(captionOpacity(MID.from - CAPTION_FADE, MID.from, MID.to)).toBe(0)
    expect(captionOpacity(0.1, MID.from, MID.to)).toBe(0)
    expect(captionOpacity(MID.to + CAPTION_FADE, MID.from, MID.to)).toBe(0)
    expect(captionOpacity(0.9, MID.from, MID.to)).toBe(0)
  })

  it('a sáv elé eső átúszás monoton nő', () => {
    const curve = samples(MID.from - CAPTION_FADE, MID.from).map((p) =>
      captionOpacity(p, MID.from, MID.to),
    )
    expect(curve.at(0)).toBe(0)
    expect(curve.at(-1)).toBe(1)
    for (const [index, value] of curve.entries()) {
      if (index > 0) {
        expect(value).toBeGreaterThan(curve[index - 1])
      }
    }
  })

  it('a sáv után monoton csökken', () => {
    const curve = samples(MID.to, MID.to + CAPTION_FADE).map((p) =>
      captionOpacity(p, MID.from, MID.to),
    )
    expect(curve.at(0)).toBe(1)
    expect(curve.at(-1)).toBe(0)
    for (const [index, value] of curve.entries()) {
      if (index > 0) {
        expect(value).toBeLessThan(curve[index - 1])
      }
    }
  })

  it('a záró felirat (to = 1) a film végéig kint marad', () => {
    expect(captionOpacity(0.95, END.from, END.to)).toBe(1)
    expect(captionOpacity(1, END.from, END.to)).toBe(1)
  })

  it('a két felirat sávja nem fedi egymást', () => {
    // A közép-felirat már teljesen eltűnt, mire a záró elkezd beúszni.
    expect(captionOpacity(END.from - CAPTION_FADE, MID.from, MID.to)).toBe(0)
    // És fordítva: a záró még nem látszik, amíg a közép ki nem futott.
    expect(captionOpacity(MID.to + CAPTION_FADE, END.from, END.to)).toBe(0)
  })

  it('csökkentett mozgásnál nincs átúszás — állókép', () => {
    expect(captionOpacity(MID.from - 0.001, MID.from, MID.to, true)).toBe(0)
    expect(captionOpacity(MID.from, MID.from, MID.to, true)).toBe(1)
    expect(captionOpacity(MID.to, MID.from, MID.to, true)).toBe(1)
    expect(captionOpacity(MID.to + 0.001, MID.from, MID.to, true)).toBe(0)
  })

  it('a scrub-arányt 0..1 közé szorítja', () => {
    expect(captionOpacity(-5, MID.from, MID.to)).toBe(0)
    expect(captionOpacity(5, END.from, END.to)).toBe(1)
  })
})
