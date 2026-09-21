import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CoursePackageContent } from '../components/courses/promo/CoursePackageContent'
import { LexicalContent } from '../components/courses/LexicalContent'
import type { CoursePackageData } from '../lib/course-package'
import type { Product } from '../payload-types'

const data: CoursePackageData = {
  heading: 'Csomag',
  items: [{ icon: 'book', title: '<script>no</script>', description: 'Eredeti leírás' }],
}

describe('CoursePackageContent', () => {
  it('félkész sor mellett is megtartja a blokk többi szövegét és a hiányos sor leírását', () => {
    const content: Product['longDescription'] = {
      root: {
        type: 'root',
        version: 1,
        direction: null,
        format: '',
        indent: 0,
        children: [
          {
            type: 'block',
            version: 2,
            fields: {
              blockType: 'coursePackage',
              heading: 'Félkész csomag',
              items: [
                { icon: 'book', title: 'Érvényes sor', description: 'Megőrzött szöveg' },
                { title: '', description: '<script>draft</script>' },
              ],
            },
          },
        ],
      },
    }
    const html = renderToStaticMarkup(<LexicalContent content={content} />)
    expect(html).toContain('Érvényes sor')
    expect(html).toContain('Megőrzött szöveg')
    expect(html).toContain('&lt;script&gt;draft&lt;/script&gt;')
    expect(html).not.toContain('kc-course-package__icon')
  })
  it('egy tételt egy oszlopban tart, biztonságos fix ikonnal és szöveg-escape-pel', () => {
    const html = renderToStaticMarkup(<CoursePackageContent data={data} enhanced />)
    expect(html).toContain('data-columns="1"')
    expect(html).toContain('/assets/icons/course-package/book-open.svg')
    expect(html).toContain('&lt;script&gt;no&lt;/script&gt;')
    expect(html).not.toContain('<script>')
  })
  it('normál fallbackben minden szöveg megmarad, kampányikon és duplikált horgony nélkül', () => {
    const html = renderToStaticMarkup(<CoursePackageContent data={data} />)
    expect(html).toContain('Eredeti leírás')
    expect(html).not.toContain('mask-image')
    expect(html).not.toContain('id="csomag-cim"')
  })
})
