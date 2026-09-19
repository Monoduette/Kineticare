import { readFileSync } from 'node:fs'
import postcss, { type AtRule, type Rule } from 'postcss'
import { describe, expect, it } from 'vitest'

const css = postcss.parse(readFileSync('src/app/(frontend)/styles/blocks/film-hero.css', 'utf8'))
const compact = css.nodes.find(
  (node): node is AtRule =>
    node.type === 'atrule' &&
    node.name === 'media' &&
    node.params === '(max-width: 860px) and (max-height: 700px)',
)

describe('film hero short-mobile text layout', () => {
  it('lets very short viewports scroll the text naturally without changing the film or opacity', () => {
    const reading = css.nodes.find(
      (node): node is AtRule =>
        node.type === 'atrule' &&
        node.name === 'media' &&
        node.params === '(max-width: 860px) and (max-height: 480px)',
    )
    expect(reading).toBeDefined()
    expect(reading!.nodes).toHaveLength(1)
    const rule = reading?.nodes?.[0]
    expect(rule?.type).toBe('rule')
    if (!rule || rule.type !== 'rule') throw new Error('Missing short-viewport reading rule')
    expect(rule.selector).toBe('.kc-film-hero .scroll-scrub__chapter-pin')
    expect(rule.nodes).toHaveLength(1)
    expect(rule.nodes[0]).toMatchObject({ type: 'decl', prop: 'position', value: 'relative' })
  })

  it('bounds the override to short mobile viewports, leaving desktop and tall mobile alone', () => {
    expect(compact).toBeDefined()
  })

  it('changes only film-scoped text rhythm, never media, veil, scale or sticky geometry', () => {
    expect(compact).toBeDefined()
    const rules = compact!.nodes as Rule[]
    expect(rules.every((rule) => rule.type === 'rule')).toBe(true)
    expect(rules.flatMap((rule) => rule.selectors)).toEqual([
      '.kc-film-hero .scroll-scrub__chapter-pin',
      '.kc-film-hero .scroll-scrub__title',
      '.kc-film-hero .scroll-scrub__body',
      '.kc-film-hero .scroll-scrub__tags',
      '.kc-film-hero .scroll-scrub__actions',
      '.kc-film-hero .kc-film-hero__cta',
      '.kc-film-hero .scroll-scrub__aside',
    ])
    const declarations: [string, string][] = []
    compact!.walkDecls(({ prop, value }) => {
      declarations.push([prop, value])
    })
    expect(declarations).toEqual([
      ['padding-top', 'calc(3.5rem + var(--kc-space-2))'],
      ['padding-bottom', 'calc(var(--kc-space-4) + env(safe-area-inset-bottom))'],
      ['line-height', 'var(--kc-leading-board)'],
      ['margin-top', 'var(--kc-space-2)'],
      ['padding-block', 'var(--kc-space-2)'],
      // WP50: a szerző-sor (alapítók arcképe) rövid mobil nézetben elmarad.
      ['display', 'none'],
    ])
  })

  it('retains the existing minimum 44px CTA target independently of compact padding', () => {
    const targets = css.nodes.filter(
      (node): node is Rule =>
        node.type === 'rule' && node.selector === '.kc-film-hero .kc-film-hero__cta',
    )
    for (const property of ['min-height', 'min-width']) {
      expect(
        targets.some((rule) =>
          rule.nodes.some(
            (node) => node.type === 'decl' && node.prop === property && node.value === '2.75rem',
          ),
        ),
      ).toBe(true)
    }
  })
})
