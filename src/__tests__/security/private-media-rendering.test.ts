import { createElement, Fragment } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { MediaImage } from '../../components/content/MediaImage'
import { renderLexicalContent } from '../../components/lexical/serialize'

describe('private képek a böngésző hitelesített közvetlen kérésén mennek', () => {
  it.each(['media', 'lexical'] as const)(
    '%s renderer nem küldi optimizerbe a private képet',
    (renderer) => {
      const media = {
        url: '/api/course-files/file/private.png',
        alt: 'Védett kép',
        width: 320,
        height: 200,
      }
      const element =
        renderer === 'media'
          ? createElement(MediaImage, { media })
          : createElement(
              Fragment,
              null,
              renderLexicalContent({
                root: { children: [{ type: 'upload', relationTo: 'course-files', value: media }] },
              }),
            )
      const html = renderToStaticMarkup(element)
      expect(html).toContain('src="/api/course-files/file/private.png"')
      expect(html).not.toContain('/_next/image')
    },
  )
  it('public MediaImage továbbra is optimalizál', () => {
    const html = renderToStaticMarkup(
      createElement(MediaImage, {
        media: { url: '/api/media/file/public.png', alt: 'Nyilvános kép', width: 320, height: 200 },
      }),
    )
    expect(html).toContain('/_next/image')
  })
})
