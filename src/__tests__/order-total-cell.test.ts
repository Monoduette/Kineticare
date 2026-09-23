import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import {
  ORDER_TOTAL_MISSING,
  OrderTotalCell,
  formatOrderTotalCell,
} from '../components/admin/OrderTotalCell'
import { formatPriceHuf } from '../lib/format-price'

/**
 * A Rendelések lista végösszeg-cellája (src/components/admin/OrderTotalCell.tsx,
 * K34): „79 500 Ft” alak, ugyanazzal a formázóval, mint a Tételek oszlop és a
 * vásárlói felület. A formatPriceHuf nem törhető szóközzel tagol.
 */
const NBSP = ' '

describe('formatOrderTotalCell', () => {
  it('a nyers számot forintosan, ezres tagolással írja', () => {
    expect(formatOrderTotalCell(79500)).toBe(`79${NBSP}500${NBSP}Ft`)
    expect(formatOrderTotalCell(79500)).toBe(formatPriceHuf(79500))
    expect(formatOrderTotalCell(0)).toBe(`0${NBSP}Ft`)
    expect(formatOrderTotalCell('39500')).toBe(`39${NBSP}500${NBSP}Ft`)
  })

  it('hiányzó vagy hibás értéknél kimondott szöveg áll, és sosem dob', () => {
    for (const value of [
      null,
      undefined,
      '',
      'abc',
      Number.NaN,
      Number.POSITIVE_INFINITY,
      -1,
      {},
    ]) {
      expect(formatOrderTotalCell(value)).toBe(ORDER_TOTAL_MISSING)
    }
    expect(ORDER_TOTAL_MISSING).not.toMatch(/[–—]/)
  })

  it('a cella egy sorban tartja az összeget', () => {
    expect(renderToStaticMarkup(createElement(OrderTotalCell, { cellData: 79500 }))).toBe(
      `<span style="white-space:nowrap">79${NBSP}500${NBSP}Ft</span>`,
    )
  })
})
