/**
 * Actual course route/gallery and CourseShowcase with fixture-only server boundaries.
 * Node 24: node <this-file> <installed-playwright/index.mjs> [screenshot-directory]
 * No Payload, database, app server, production requests, or added dependencies.
 */
import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { build } from 'esbuild'
import sharp from 'sharp'

const root = fileURLToPath(new URL('../../', import.meta.url))
assert.ok(process.argv[2], 'Supply the installed Playwright module path.')
const { chromium } = await import(pathToFileURL(path.resolve(process.argv[2])).href)
const output = process.argv[3]
if (output) await mkdir(output, { recursive: true })

async function media(file, id) {
  const bytes = await readFile(path.join(root, file))
  const { width, height, format } = await sharp(bytes).metadata()
  return {
    id,
    width,
    height,
    mimeType: `image/${format}`,
    alt: `Gallery fixture ${id}`,
    url: `data:image/${format};base64,${bytes.toString('base64')}`,
  }
}
const images = [
  await media('content/home-images/site/katak-team.jpg', 1),
  await media('src/scripts/legacy-content/kepek/67b3c6e9e315f_KocsisKatakozeli.png', 2),
]
let styles = ''
for (const file of ['tokens', 'fonts', 'base', 'ui', 'blocks/course-showcase']) {
  styles += await readFile(path.join(root, `src/app/(frontend)/styles/${file}.css`), 'utf8')
}
styles += await readFile(path.join(root, 'src/app/(frontend)/kurzusok/kurzusok.css'), 'utf8')
for (const match of [...styles.matchAll(/url\('([^']+\.woff2)'\)/g)]) {
  const font = await readFile(path.join(root, 'public', match[1]))
  styles = styles.replace(match[0], `url('data:font/woff2;base64,${font.toString('base64')}')`)
}

const stubs = {
  payload: `export const getPayload = async () => ({
    find: async () => ({ docs: [window.cmsProduct] }), auth: async () => ({ user: null })
  })`,
  'next/headers': 'export const headers = async () => new Headers()',
  'next/navigation': `export const notFound = () => { throw new Error('Unexpected 404') };
    export const permanentRedirect = () => { throw new Error('Unexpected redirect') }`,
  '@/lib/course-access-lookup':
    'export const resolveSingleCourseAccess = async () => ({ hasAccess: false })',
  '@/lib/logger':
    'export const logger = { warn: (...args) => { throw new Error(JSON.stringify(args)) } }',
  '@/lib/seo': `export const absoluteUrl = (value) => 'https://example.test' + value;
    export const buildProductMetadata = () => ({});
    export const courseJsonLd = () => ({});
    export const faqPageJsonLd = () => ({});
    export const productSeoDoc = () => ({});
    export const resolveSeoDescription = () => ''`,
  '@/lib/seo-graph': 'export const siteGraphJsonLd = () => ({})',
}
for (const name of ['CourseBuybox', 'CourseBuyBar', 'CourseBarionView', 'RelatedCourses']) {
  stubs[`@/components/courses/${name}`] = `export const ${name} = () => null`
}
stubs['@/components/analytics/TrackEvent'] = 'export const TrackEvent = () => null'

const bundle = await build({
  stdin: {
    contents: `
      import React from 'react'
      import { createRoot } from 'react-dom/client'
      import { flushSync } from 'react-dom'
      import CoursePage from './src/app/(frontend)/kurzusok/[slug]/page'
      import { CourseShowcase } from './src/components/content/home/CourseShowcase'
      import { Container } from './src/components/ui/Container'
      import { Section } from './src/components/ui/Section'
      const images = ${JSON.stringify(images)}
      const root = createRoot(document.getElementById('root'))
      window.renderCms = async (options = {}) => {
        window.cmsProduct = {
          id: 1, sku: 'Otthoni kurzus', slug: 'otthoni', status: 'published',
          priceInHUFEnabled: true, priceInHUF: 10000,
          coverImage: images[0], createdAt: '', updatedAt: '',
          gallery: options.empty ? [] : images.map((image, index) => ({
            id: String(index), image: options.legacy ? { ...image, width: null, height: null } : image,
          })),
        }
        const route = await CoursePage({ params: Promise.resolve({ slug: 'otthoni' }) })
        flushSync(() => root.render(<main>
          <Section><Container>
            <CourseShowcase products={[window.cmsProduct]} drift={false} mark={null}
              eyebrow={options.long ? 'Szerkesztett felvezeto '.repeat(10) : 'Valassz kurzust'}
              ctaLabel={options.long ? 'Ismerd meg a kurzus reszleteit '.repeat(5) : 'Ismerd meg a kurzust'} />
          </Container></Section>
          {route}
        </main>))
      }
    `,
    resolveDir: root,
    loader: 'tsx',
  },
  bundle: true,
  write: false,
  format: 'iife',
  jsx: 'automatic',
  platform: 'browser',
  loader: { '.css': 'empty' },
  plugins: [
    {
      name: 'fixture-server-boundaries',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, (args) => {
          if (args.path in stubs || args.path.endsWith('payload.config')) {
            return { path: args.path, namespace: 'fixture' }
          }
          if (/^next\/(image|link)$/.test(args.path)) {
            return { path: args.path, namespace: 'next-exports' }
          }
        })
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
          contents: stubs[args.path] ?? 'export default {}',
          resolveDir: root,
        }))
        builder.onLoad({ filter: /.*/, namespace: 'next-exports' }, (args) => {
          const isImage = args.path === 'next/image'
          const entry = path.join(
            root,
            'node_modules/next/dist/client',
            isImage ? 'image-component.js' : 'link.js',
          )
          return {
            contents: `const next = require(${JSON.stringify(entry)}); export default next.${isImage ? 'Image' : 'default'}`,
            resolveDir: root,
          }
        })
      },
    },
  ],
  define: { 'process.env': JSON.stringify({ NODE_ENV: 'production' }) },
})

const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage()
  const errors = []
  const requests = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/*', (route) => {
    requests.push(route.request().url())
    return route.abort()
  })
  await page.setContent(
    `<html lang="hu"><head><style>${styles}</style></head><body><div id="root"></div></body></html>`,
  )
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    for (const options of [{}, { long: true }, { legacy: true }, { empty: true }]) {
      await page.evaluate((options) => window.renderCms(options), options)
      await page.evaluate(async () => {
        await document.fonts.ready
        await Promise.all(
          [...document.images].map((img) => {
            img.loading = 'eager'
            return img.decode()
          }),
        )
      })
      const geometry = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > innerWidth,
        images: [...document.querySelectorAll('.kc-course-gallery__image')].map((img) => ({
          loaded: img.naturalWidth > 0,
          fit: getComputedStyle(img).objectFit,
          width: img.getBoundingClientRect().width,
          parentWidth: img.parentElement.getBoundingClientRect().width,
          ratio: img.getBoundingClientRect().width / img.getBoundingClientRect().height,
          naturalRatio: img.naturalWidth / img.naturalHeight,
        })),
        ctas: [...document.querySelectorAll('.kc-course-showcase__link')].map((link) => ({
          text: link.querySelector('.kc-course-showcase__cta').textContent,
          label: link.getAttribute('aria-label'),
          overflow: link.scrollWidth > link.clientWidth,
        })),
      }))
      assert.equal(geometry.overflow, false, `page overflow ${width} ${JSON.stringify(options)}`)
      assert.equal(geometry.images.length, options.empty ? 0 : 2)
      for (const img of geometry.images) {
        assert.equal(img.loaded, true)
        assert.equal(img.fit, 'contain')
        assert.ok(img.width <= img.parentWidth + 1)
        assert.ok(Math.abs(img.ratio - img.naturalRatio) < 0.02)
      }
      for (const cta of geometry.ctas) {
        assert.ok(cta.label.includes(cta.text))
        assert.equal(cta.overflow, false)
      }
      if (!options.empty) {
        const jump = page.locator('a[href="#kurzus-kepek"]')
        await jump.focus()
        await page.keyboard.press('Enter')
        assert.equal(await page.evaluate(() => location.hash), '#kurzus-kepek')
      }
      if (output && Object.keys(options).length === 0) {
        await page.screenshot({
          path: path.join(output, `course-cms-${width}.png`),
          fullPage: true,
        })
      }
    }
    console.log(
      `PASS ${width}px: CMS copy, gallery, legacy media, empty state, keyboard anchor, reflow`,
    )
  }
  assert.deepEqual(errors, [])
  assert.deepEqual(requests, [])
} finally {
  await browser.close()
}
