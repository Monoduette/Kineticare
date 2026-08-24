import type { Field } from 'payload'
import { describe, expect, it } from 'vitest'

import { Pages } from '../collections/Pages'
import { authorPersonOf } from '../components/content/post-article'
import { absoluteUrl } from '../lib/seo'
import { cmsPageJsonLd } from '../lib/seo-cikk'
import type { Page } from '../payload-types'

/**
 * ŐR: a CMS-oldal (`pages`) E-E-A-T mezői és a MedicalWebPage séma.
 *
 * A Search kapu a Cluster A hubokat (`/inhuvelygyulladas` stb.) a `pages`
 * collectionben tartja, nem a `/blog/` útvonalon. A mezők a `posts`
 * collectionből jönnek át (ugyanaz a címke, ugyanaz a dayOnly dátum);
 * hiányzó mező némán elhagyná a szerző-blokkot és a Person JSON-LD-t.
 */

function rootFields(fields: Field[], acc = new Map<string, Field>()): Map<string, Field> {
  for (const field of fields) {
    if ('name' in field && typeof field.name === 'string') {
      acc.set(field.name, field)
      continue
    }
    if (field.type === 'row' || field.type === 'collapsible' || field.type === 'group') {
      rootFields(field.fields, acc)
      continue
    }
    if (field.type === 'tabs') {
      for (const tab of field.tabs) {
        if (!('name' in tab)) {
          rootFields(tab.fields, acc)
        }
      }
    }
  }
  return acc
}

const pageFields = rootFields(Pages.fields)

function fieldOf(name: string): Field {
  const field = pageFields.get(name)
  if (!field) {
    throw new Error(`a pages.${name} mező HIÁNYZIK a kollekció-konfig gyökeréről`)
  }
  return field
}

function adminDescriptionOf(field: Field): unknown {
  if (!('admin' in field)) return undefined
  const admin: unknown = field.admin
  if (typeof admin !== 'object' || admin === null) return undefined
  return (admin as Record<string, unknown>).description
}

const HUNGARIAN_LETTER = /[áéíóöőúüűÁÉÍÓÖŐÚÜŰ]/

const EEAT_FIELDS: Array<{ name: string; type: Field['type'] }> = [
  { name: 'author', type: 'relationship' },
  { name: 'reviewedBy', type: 'relationship' },
  { name: 'reviewedAt', type: 'date' },
  { name: 'nextReviewAt', type: 'date' },
  { name: 'faq', type: 'array' },
]

describe('pages E-E-A-T mezők', () => {
  it.each(EEAT_FIELDS)('a pages.$name mező létezik, típusa $type', ({ name, type }) => {
    expect(fieldOf(name).type).toBe(type)
  })

  it.each(EEAT_FIELDS)('a pages.$name mezőnek van magyar admin-leírása', ({ name }) => {
    const description = adminDescriptionOf(fieldOf(name))
    expect(typeof description).toBe('string')
    const text = String(description).trim()
    expect(text.length).toBeGreaterThan(0)
    expect(HUNGARIAN_LETTER.test(text)).toBe(true)
  })

  it('a pages.author és a pages.reviewedBy a users kollekcióra hivatkozik', () => {
    for (const name of ['author', 'reviewedBy'] as const) {
      const field = fieldOf(name)
      if (field.type !== 'relationship') {
        throw new Error(`a pages.${name} nem relationship`)
      }
      expect(field.relationTo).toBe('users')
    }
  })

  it('a dátummezők dayOnly megjelenítésűek', () => {
    for (const name of ['reviewedAt', 'nextReviewAt'] as const) {
      const field = fieldOf(name)
      if (field.type !== 'date') {
        throw new Error(`a pages.${name} nem date`)
      }
      const admin: unknown = field.admin
      const date =
        typeof admin === 'object' && admin !== null
          ? (admin as Record<string, unknown>).date
          : undefined
      const appearance =
        typeof date === 'object' && date !== null
          ? (date as Record<string, unknown>).pickerAppearance
          : undefined
      expect(appearance, `pages.${name} pickerAppearance`).toBe('dayOnly')
    }
  })

  it('a pages.faq array, hatos plafonnal, kötelező kérdés- és válasz-almezővel', () => {
    const faq = fieldOf('faq')
    if (faq.type !== 'array') {
      throw new Error('a pages.faq nem array')
    }
    expect(faq.maxRows).toBe(6)
    const rowFields = rootFields(faq.fields)
    const question = rowFields.get('question')
    const answer = rowFields.get('answer')
    expect(question?.type).toBe('text')
    expect(answer?.type).toBe('textarea')
    expect(question && 'required' in question ? question.required : undefined).toBe(true)
    expect(answer && 'required' in answer ? answer.required : undefined).toBe(true)
  })

  it('nincs noindex mező (a piszkozat 404, a közzétett indexelhető)', () => {
    expect(pageFields.has('noindex')).toBe(false)
  })
})

describe('cmsPageJsonLd (MedicalWebPage, nem Article)', () => {
  const oldal = {
    title: 'Tesztoldal a sémához',
    excerpt: 'Rövid bevezető a nyilvános lapon.',
    publishedAt: '2026-08-10T08:00:00.000Z',
    updatedAt: '2026-08-12T09:30:00.000Z',
  }

  it('a típus MedicalWebPage, nem Article és nem blog-útvonal', () => {
    const jsonLd = cmsPageJsonLd({ page: oldal, path: '/tesztoldal' })
    expect(jsonLd['@type']).toBe('MedicalWebPage')
    expect(jsonLd['@type']).not.toBe('Article')
    expect(jsonLd.headline).toBe(oldal.title)
    expect(jsonLd.name).toBe(oldal.title)
    expect(jsonLd.mainEntityOfPage).toBe(absoluteUrl('/tesztoldal'))
    expect(jsonLd.inLanguage).toBe('hu-HU')
  })

  it('kitöltött szerző Person, a publisher Organization marad', () => {
    const jsonLd = cmsPageJsonLd({
      page: oldal,
      path: '/tesztoldal',
      author: { name: 'Kiss Kata', credentials: 'gyógytornász' },
    })
    const author = jsonLd.author as Record<string, unknown>
    const publisher = jsonLd.publisher as Record<string, unknown>
    expect(author['@type']).toBe('Person')
    expect(author.name).toBe('Kiss Kata')
    expect(author.jobTitle).toBe('gyógytornász')
    expect(author.name).not.toBe('Kineticare')
    expect(publisher['@type']).toBe('Organization')
    expect(publisher.name).toBe('Kineticare')
  })

  it('üres szerzőnél nincs author kulcs (nincs Organization-tartalék)', () => {
    const jsonLd = cmsPageJsonLd({ page: oldal, path: '/tesztoldal' })
    expect('author' in jsonLd).toBe(false)
    expect((jsonLd.publisher as Record<string, unknown>)['@type']).toBe('Organization')
  })

  it('reviewedBy csak kitöltött lektornál, lastReviewed csak valós dátumnál', () => {
    const lektorral = cmsPageJsonLd({
      page: oldal,
      path: '/tesztoldal',
      reviewer: { name: 'Kocsis Kata', credentials: 'gyógytornász' },
      lastReviewed: '2026-08-18T14:25:00.000Z',
    })
    const ures = cmsPageJsonLd({ page: oldal, path: '/tesztoldal' })
    const lektor = lektorral.reviewedBy as Record<string, unknown>
    expect(lektor['@type']).toBe('Person')
    expect(lektor.name).toBe('Kocsis Kata')
    expect(lektorral.lastReviewed).toBe('2026-08-18')
    expect('reviewedBy' in ures).toBe(false)
    expect('lastReviewed' in ures).toBe(false)
  })
})

describe('authorPersonOf populálatlan kapcsolaton', () => {
  it('nyers user-id nem lesz kitalált Person', () => {
    expect(authorPersonOf({ author: 7 } as unknown as Page)).toBeNull()
  })

  it('populált Kiss Kata usert Person-ként adja', () => {
    const szemely = authorPersonOf({
      author: { id: 2, name: 'Kiss Kata', credentials: 'gyógytornász' },
    })
    expect(szemely?.name).toBe('Kiss Kata')
    expect(szemely?.credentials).toBe('gyógytornász')
  })
})
