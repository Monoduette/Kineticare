import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { compile } from 'sass'

const root = fileURLToPath(new URL('../../../../', import.meta.url))
const here = fileURLToPath(new URL('./', import.meta.url))
const { chromium } = await import(
  process.argv[2] ? pathToFileURL(resolve(process.argv[2])).href : 'playwright'
)
const bundled = await build({
  absWorkingDir: root,
  entryPoints: [resolve(here, 'main.tsx')],
  bundle: true,
  write: false,
  outdir: '/tmp/bunny-video-fixture-build',
  format: 'esm',
  jsx: 'automatic',
  alias: {
    '@payloadcms/ui': resolve(here, 'payload-ui.tsx'),
    'tus-js-client': resolve(here, 'tus.ts'),
  },
  define: { 'process.env.NODE_ENV': '"development"' },
  plugins: [
    {
      name: 'payload-icon-scss',
      setup(build) {
        build.onLoad({ filter: /\.scss$/ }, (args) => ({
          contents: compile(args.path, { logger: { warn() {}, debug() {} } }).css,
          loader: 'css',
        }))
      },
    },
  ],
})
const thumbnail = await readFile(resolve(root, 'public/media/team/hand-treatment-detail-1600.webp'))
const html =
  '<!doctype html><html lang="hu"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Video fixture</title><link rel="stylesheet" href="/main.css"><div id="root"></div><script type="module" src="/main.js"></script></html>'
const server = createServer((req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname
  const output = bundled.outputFiles.find((file) => file.path.endsWith(name) && name !== '/')
  res.setHeader(
    'Content-Type',
    name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html',
  )
  res.end(output ? output.contents : html)
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
const screenshots = '/tmp/kineticare-video-ui-20260909-evidence'
await mkdir(screenshots, { recursive: true })
const browser = await chromium.launch({ headless: true })
const results = []
let external = 0
async function pageFor(scenario = 'normal', extra = '') {
  const page = await browser.newPage({ viewport: { width: 768, height: 900 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/*', (route) => {
    const url = route.request().url()
    if (url.startsWith(origin)) return route.continue()
    if (url === 'https://fixture.b-cdn.net/thumbnail.webp')
      return route.fulfill({ contentType: 'image/webp', body: thumbnail })
    if (url.startsWith('https://iframe.mediadelivery.net/'))
      return route.fulfill({
        contentType: 'text/html',
        body: '<html><body>Local preview fixture</body></html>',
      })
    external++
    return route.abort()
  })
  await page.goto(`${origin}/?scenario=${scenario}${extra}`)
  await page.getByRole('heading', { name: 'Videótár', exact: true }).waitFor()
  return { page, errors }
}
async function test(name, fn) {
  if (process.argv[3] && !new RegExp(process.argv[3]).test(name)) return
  await fn()
  results.push(name)
  process.stdout.write(`PASS ${name}\n`)
}
async function openPicker(page) {
  await page.getByRole('button', { name: 'Videó kiválasztása', exact: true }).click()
  await page.getByRole('button', { name: 'Kiválasztás', exact: true }).waitFor()
}
const guid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
try {
  await test('mode switch invalidates delayed picker selection while upload persists across tabs', async () => {
    const { page } = await pageFor('late')
    await openPicker(page)
    await page.getByRole('button', { name: 'Kiválasztás', exact: true }).click()
    await page.getByRole('button', { name: 'Feltöltés', exact: true }).click()
    await page
      .getByLabel('Videófájl', { exact: true })
      .setInputFiles({
        name: 'new-upload.mp4',
        mimeType: 'video/mp4',
        buffer: Buffer.from('DUMMY VIDEO FIXTURE'),
      })
    await page.getByRole('button', { name: 'Feltöltés indítása', exact: true }).click()
    await page.getByRole('button', { name: 'Szüneteltetés', exact: true }).waitFor()
    await page.evaluate(() => window.bunnyFixture.release())
    await page.waitForTimeout(50)
    assert.equal(await page.evaluate(() => window.bunnyFixture.fixture.commits), 0)
    assert.equal(await page.getByRole('dialog').count(), 1)
    await page.getByRole('button', { name: 'Videótár', exact: true }).click()
    await page.getByRole('button', { name: 'Kiválasztás', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Feltöltés', exact: true }).click()
    assert.equal(await page.getByLabel('Videó címe', { exact: true }).inputValue(), 'new-upload')
    assert.equal(await page.evaluate(() => window.bunnyFixture.tusFixture.instances.length), 1)
    assert.deepEqual(await page.evaluate(() => window.bunnyFixture.tusFixture.aborts), [])
    await page.close()
  })
  await test('public unlink cancel, clear and select again affect only the reference without provider calls', async () => {
    const { page } = await pageFor('public-clear')
    await page.getByLabel('Nyilvános mező').check()
    const before = await page.evaluate(() => window.bunnyFixture.fixture.fields)
    await page
      .getByRole('button', { name: 'Előzetes leválasztása', exact: true })
      .click({ timeout: 2000 })
    const dialog = page.getByRole('dialog', { name: 'Leválasztod az előzetest?' })
    await dialog.getByRole('button', { name: 'Mégse', exact: true }).click()
    assert.deepEqual(await page.evaluate(() => window.bunnyFixture.fixture.fields), before)
    assert.equal(await page.evaluate(() => window.bunnyFixture.fixture.commits), 0)
    await page.getByRole('button', { name: 'Előzetes leválasztása', exact: true }).click()
    await dialog.getByRole('button', { name: 'Előzetes leválasztása', exact: true }).click()
    const after = await page.evaluate(() => window.bunnyFixture.fixture.fields)
    assert.equal(after.previewVideoStreamId.value, '')
    delete after.previewVideoStreamId
    delete before.previewVideoStreamId
    assert.deepEqual(after, before)
    assert.equal(await page.evaluate(() => window.bunnyFixture.fixture.commits), 1)
    assert.deepEqual(await page.evaluate(() => window.bunnyFixture.requests), [])
    await openPicker(page)
    await page.getByRole('button', { name: 'Kiválasztás', exact: true }).click()
    await page.getByRole('dialog').waitFor({ state: 'hidden' })
    assert.equal(
      await page.evaluate(() => window.bunnyFixture.fixture.fields.previewVideoStreamId.value),
      guid,
    )
    await page.close()
  })
  await test('public unlink respects readonly and rejects concurrent reference replacement', async () => {
    const readonly = await pageFor('public-readonly')
    await readonly.page.getByLabel('Nyilvános mező').check()
    assert.equal(
      await readonly.page
        .getByRole('button', { name: 'Előzetes leválasztása', exact: true })
        .isDisabled(),
      true,
    )
    assert.equal(await readonly.page.evaluate(() => window.bunnyFixture.fixture.commits), 0)
    await readonly.page.close()
    const { page } = await pageFor('public-clear')
    await page.getByLabel('Nyilvános mező').check()
    await page.getByRole('button', { name: 'Előzetes leválasztása', exact: true }).click()
    await page.evaluate(() => {
      const { fixture } = window.bunnyFixture
      fixture.publish({
        ...fixture.fields,
        previewVideoStreamId: { value: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', valid: true },
      })
    })
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Előzetes leválasztása', exact: true })
      .click()
    assert.equal(await page.evaluate(() => window.bunnyFixture.fixture.commits), 0)
    assert.equal(
      await page.evaluate(() => window.bunnyFixture.fixture.fields.previewVideoStreamId.value),
      guid,
    )
    await page.getByRole('alert').waitFor()
    await page.close()
  })
  await test('future capability rejected with invalid-session requires explicit restart confirmation', async () => {
    const { page } = await pageFor('sign-invalid-session')
    await startUpload(page)
    await page.getByRole('button', { name: 'Szüneteltetés', exact: true }).click()
    assert.equal(
      await page.evaluate(() => window.bunnyFixture.finalExpiry * 1000 > Date.now() + 3000000),
      true,
    )
    await page.getByRole('button', { name: 'Folytatás', exact: true }).click()
    await page
      .getByRole('button', { name: 'Új feltöltés indítása', exact: true })
      .waitFor({ timeout: 2000 })
    assert.equal(await page.getByRole('button', { name: 'Folytatás', exact: true }).count(), 0)
    assert.equal(await page.evaluate(() => window.bunnyFixture.initCount), 1)
    assert.equal(await page.getByText('DUMMY-private-upstream-message').count(), 0)
    await page.getByRole('button', { name: 'Új feltöltés indítása', exact: true }).click()
    assert.equal(await page.evaluate(() => window.bunnyFixture.initCount), 1)
    const confirmation = page.getByRole('dialog', { name: 'Új feltöltést indítasz?' })
    await confirmation.getByRole('button', { name: 'Mégse', exact: true }).click()
    assert.equal(await page.evaluate(() => window.bunnyFixture.initCount), 1)
    await page.getByRole('button', { name: 'Új feltöltés indítása', exact: true }).click()
    await confirmation.getByRole('button', { name: 'Új feltöltés indítása', exact: true }).click()
    await page.getByRole('button', { name: 'Szüneteltetés', exact: true }).waitFor()
    assert.equal(await page.evaluate(() => window.bunnyFixture.initCount), 2)
    await page.close()
  })
  for (const scenario of ['sign-unauthorized', 'sign-forbidden', 'sign-transient'])
    await test(`nonterminal sign response never creates a video: ${scenario}`, async () => {
      const { page } = await pageFor(scenario)
      await startUpload(page)
      await page.getByRole('button', { name: 'Szüneteltetés', exact: true }).click()
      await page.getByRole('button', { name: 'Folytatás', exact: true }).click()
      await page.getByRole('alert').waitFor()
      await page.getByRole('button', { name: 'Folytatás', exact: true }).waitFor()
      assert.equal(
        await page.getByRole('button', { name: 'Új feltöltés indítása', exact: true }).count(),
        0,
      )
      assert.equal(await page.evaluate(() => window.bunnyFixture.initCount), 1)
      await page.getByRole('button', { name: 'Folytatás', exact: true }).click()
      await page.getByRole('button', { name: 'Folytatás', exact: true }).waitFor()
      assert.equal(
        await page.evaluate(
          () => window.bunnyFixture.requests.filter((r) => r.path.endsWith('/sign')).length,
        ),
        2,
      )
      assert.equal(await page.evaluate(() => window.bunnyFixture.initCount), 1)
      await page.close()
    })
  for (const scenario of ['malformed-list', 'partial-list'])
    await test(`malformed list is reported instead of silently filtered: ${scenario}`, async () => {
      const { page } = await pageFor(scenario)
      await page.getByRole('button', { name: 'Videó kiválasztása', exact: true }).click()
      await page.getByRole('alert').waitFor({ timeout: 2000 })
      assert.equal(await page.getByText('Nincs találat.', { exact: true }).count(), 0)
      assert.equal(await page.getByRole('button', { name: 'Kiválasztás', exact: true }).count(), 0)
      await page.close()
    })
  await test('nested Escape closes replacement only and preserves the picker', async () => {
    const { page } = await pageFor('replace')
    await page.getByRole('button', { name: 'Videó cseréje', exact: true }).click()
    await page.getByRole('button', { name: 'Kiválasztás', exact: true }).click()
    await page.getByRole('dialog', { name: 'Lecseréled a videót?' }).waitFor()
    await page.keyboard.press('Escape')
    assert.equal(await page.getByRole('dialog').count(), 1)
    await page.getByRole('dialog', { name: 'Lecke videója', exact: true }).waitFor()
    assert.equal(await page.evaluate(() => window.bunnyFixture.fixture.commits), 0)
    await page.getByRole('button', { name: 'Kiválasztás', exact: true }).click()
    await page.getByRole('dialog', { name: 'Lecseréled a videót?' }).waitFor()
    await page.close()
  })
  await test('nested Escape closes expired restart only and preserves the upload session', async () => {
    const { page } = await pageFor('expired')
    await startUpload(page)
    await page.getByRole('button', { name: 'Új feltöltés indítása', exact: true }).click()
    await page.getByRole('dialog', { name: 'Új feltöltést indítasz?' }).waitFor()
    await page.keyboard.press('Escape')
    assert.equal(await page.getByRole('dialog').count(), 1)
    assert.equal(
      await page.getByLabel('Videó címe', { exact: true }).inputValue(),
      'Saját feltöltési cím',
    )
    assert.equal(await page.evaluate(() => window.bunnyFixture.initCount), 1)
    await page.getByRole('button', { name: 'Új feltöltés indítása', exact: true }).click()
    await page.getByRole('dialog', { name: 'Új feltöltést indítasz?' }).waitFor()
    await page.close()
  })
  await test('real React selection: atomic UPDATE_MANY, preserves title/kind/order, single commit', async () => {
    const { page, errors } = await pageFor()
    await openPicker(page)
    await page.getByRole('button', { name: 'Kiválasztás', exact: true }).dblclick()
    await page.getByRole('dialog').waitFor({ state: 'hidden' })
    const state = await page.evaluate(() => ({
      fields: window.bunnyFixture.fixture.fields,
      actions: window.bunnyFixture.fixture.actions,
      modified: window.bunnyFixture.fixture.modified,
    }))
    assert.deepEqual(state.actions, ['UPDATE_MANY'])
    assert.equal(state.modified, 1)
    assert.equal(state.fields['modules.0.lessons.0.streamAssetId'].value, guid)
    assert.equal(state.fields['modules.0.lessons.0.title'].value, 'Saját cím a')
    assert.equal(state.fields['modules.0.lessons.0.kind'].value, 'video')
    assert.equal(state.fields['modules.0.lessons.0.order'].value, 0)
    assert.equal(state.fields['modules.0.lessons.0.durationSec'].value, 123)
    assert.equal(state.fields['modules.0.lessons.0.status'].value, 'ready')
    assert.deepEqual(errors, [])
    await page.close()
  })
  for (const scenario of ['reorder', 'delete'])
    await test(`late detail after row ${scenario}`, async () => {
      const { page } = await pageFor(scenario)
      await openPicker(page)
      await page.getByRole('button', { name: 'Kiválasztás', exact: true }).click()
      await page.getByRole('dialog').waitFor({ state: 'hidden' })
      const state = await page.evaluate(() => ({
        fields: window.bunnyFixture.fixture.fields,
        commits: window.bunnyFixture.fixture.commits,
      }))
      assert.equal(state.commits, scenario === 'delete' ? 0 : 1)
      if (scenario === 'reorder') {
        assert.equal(state.fields['modules.0.lessons.1.streamAssetId'].value, guid)
        assert.equal(state.fields['modules.0.lessons.0.streamAssetId'].value, '')
      }
      await page.close()
    })
  await test('cancel in-flight detail never commits and restores focus', async () => {
    const { page } = await pageFor('late')
    await openPicker(page)
    await page.getByRole('button', { name: 'Kiválasztás', exact: true }).click()
    await page.getByRole('button', { name: 'Bezárás', exact: true }).click()
    await page.evaluate(() => window.bunnyFixture.release())
    await page.waitForTimeout(50)
    assert.equal(await page.evaluate(() => window.bunnyFixture.fixture.commits), 0)
    assert.equal(
      await page.evaluate(() => document.activeElement.textContent),
      'Videó kiválasztása',
    )
    await page.close()
  })
  await test('replacement requires confirmation; cancel writes nothing', async () => {
    const { page } = await pageFor('replace')
    await page.getByRole('button', { name: 'Videó cseréje', exact: true }).click()
    await page.getByRole('button', { name: 'Kiválasztás', exact: true }).click()
    const confirm = page.getByRole('dialog', { name: 'Lecseréled a videót?' })
    await confirm.waitFor()
    assert.equal(await page.evaluate(() => window.bunnyFixture.fixture.commits), 0)
    await confirm.getByRole('button', { name: 'Mégse', exact: true }).click()
    assert.equal(await page.evaluate(() => window.bunnyFixture.fixture.commits), 0)
    await page.getByRole('button', { name: 'Kiválasztás', exact: true }).click()
    await confirm.getByRole('button', { name: 'Videó cseréje', exact: true }).click()
    await page
      .getByRole('dialog', { name: 'Lecke videója', exact: true })
      .waitFor({ state: 'hidden' })
    assert.equal(await page.evaluate(() => window.bunnyFixture.fixture.commits), 1)
    await page.close()
  })
  await test('public picker cannot upload and only writes previewVideoStreamId', async () => {
    const { page } = await pageFor()
    await page.getByLabel('Nyilvános mező').check()
    await openPicker(page)
    assert.equal(await page.getByRole('button', { name: 'Feltöltés', exact: true }).count(), 0)
    await page.getByRole('button', { name: 'Kiválasztás', exact: true }).click()
    await page.getByRole('dialog').waitFor({ state: 'hidden' })
    const state = await page.evaluate(() => window.bunnyFixture.fixture.fields)
    assert.equal(state.previewVideoStreamId.value, guid)
    assert.equal(state['modules.0.lessons.0.streamAssetId'].value, '')
    await page.getByRole('button', { name: 'Előnézet', exact: true }).click()
    await page.locator('iframe').waitFor()
    assert.equal(
      await page.evaluate(() =>
        window.bunnyFixture.requests.some((r) => r.path.includes('library=protected')),
      ),
      false,
    )
    await page.close()
  })
  await test('replacement confirmation rejects a concurrently changed current GUID', async () => {
    const { page } = await pageFor('replace')
    await page.getByRole('button', { name: 'Videó cseréje', exact: true }).click()
    await page.getByRole('button', { name: 'Kiválasztás', exact: true }).click()
    const confirm = page.getByRole('dialog', { name: 'Lecseréled a videót?' })
    await confirm.waitFor()
    await page.evaluate(() => {
      const { fixture } = window.bunnyFixture
      fixture.publish({
        ...fixture.fields,
        'modules.0.lessons.0.streamAssetId': {
          value: '22222222-2222-3333-4444-555555555555',
          valid: true,
        },
      })
    })
    await confirm.getByRole('button', { name: 'Videó cseréje', exact: true }).click()
    assert.equal(await page.evaluate(() => window.bunnyFixture.fixture.commits), 0)
    await page.getByRole('alert').waitFor()
    await page.close()
  })
  for (const scheme of ['light', 'dark'])
    for (const width of [320, 390, 768, 1440])
      await test(`${width}px ${scheme}: reflow, 44px targets, native focus trap, thumbnails`, async () => {
        const { page, errors } = await pageFor()
        await page.setViewportSize({ width, height: 900 })
        await page.emulateMedia({ colorScheme: scheme })
        await openPicker(page)
        await page.waitForFunction(() =>
          Array.from(document.images).every((img) => img.complete && img.naturalWidth > 0),
        )
        const metrics = await page.evaluate(() => {
          const dialog = document.querySelector('dialog')
          return {
            overflow: dialog.scrollWidth > dialog.clientWidth + 1,
            buttons: Array.from(dialog.querySelectorAll('button'))
              .filter((b) => b.getClientRects().length)
              .map((b) => ({
                text: b.textContent,
                width: b.getBoundingClientRect().width,
                height: b.getBoundingClientRect().height,
              })),
          }
        })
        assert.equal(metrics.overflow, false)
        for (const button of metrics.buttons) {
          assert.ok(button.width >= 44, button.text)
          assert.ok(button.height >= 44, button.text)
        }
        for (let i = 0; i < 14; i++) {
          await page.keyboard.press('Tab')
          assert.equal(
            await page.evaluate(() =>
              document.querySelector('dialog').contains(document.activeElement),
            ),
            true,
          )
        }
        await page.screenshot({
          path: `${screenshots}/picker-${width}-${scheme}.png`,
          fullPage: true,
        })
        await page.keyboard.press('Escape')
        assert.equal(await page.getByRole('dialog').count(), 0)
        assert.deepEqual(errors, [])
        await page.close()
      })
  await test('search empty state and unknown-total pagination', async () => {
    const { page } = await pageFor('unknown-total')
    await openPicker(page)
    await page.getByRole('button', { name: 'Következő oldal' }).click()
    await page.getByText('2. oldal', { exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Következő oldal' }).isDisabled(), true)
    await page.getByRole('searchbox').fill('nincs')
    await page.getByText('Nincs találat.', { exact: true }).waitFor()
    await page.close()
  })
  async function startUpload(page) {
    await openPicker(page)
    await page.getByRole('button', { name: 'Feltöltés', exact: true }).click()
    await page.getByLabel('Videófájl', { exact: true }).setInputFiles({
      name: 'rehab.mp4',
      mimeType: 'video/mp4',
      buffer: Buffer.from('DUMMY VIDEO FIXTURE'),
    })
    await page.getByLabel('Videó címe', { exact: true }).fill('Saját feltöltési cím')
    await page.getByRole('button', { name: 'Feltöltés indítása', exact: true }).click()
  }
  await test('upload pause/resume uses same instance, no fingerprint storage, cancel does not delete', async () => {
    const { page } = await pageFor()
    await startUpload(page)
    await page.getByRole('button', { name: 'Szüneteltetés', exact: true }).click()
    await page.getByRole('button', { name: 'Folytatás', exact: true }).click()
    await page.getByRole('button', { name: 'Szüneteltetés', exact: true }).waitFor()
    const before = await page.evaluate(() => ({
      starts: window.bunnyFixture.tusFixture.starts,
      instances: window.bunnyFixture.tusFixture.instances.length,
      stored: window.bunnyFixture.tusFixture.instances[0].options.storeFingerprintForResuming,
      init: window.bunnyFixture.initCount,
      local: localStorage.length,
      session: sessionStorage.length,
    }))
    assert.deepEqual(before, {
      starts: 2,
      instances: 1,
      stored: false,
      init: 1,
      local: 0,
      session: 0,
    })
    await page.getByRole('button', { name: 'Megszakítás', exact: true }).click()
    const aborts = await page.evaluate(() => window.bunnyFixture.tusFixture.aborts)
    assert.ok(aborts.length > 0)
    assert.ok(aborts.every((value) => value === false))
    await page.close()
  })
  await test('upload uncertain initialization is never retried implicitly', async () => {
    const { page } = await pageFor('uncertain')
    await startUpload(page)
    await page.getByText('A létrehozás eredménye bizonytalan.', { exact: true }).waitFor()
    assert.equal(
      await page.getByRole('button', { name: 'Feltöltés indítása', exact: true }).count(),
      0,
    )
    assert.equal(await page.evaluate(() => window.bunnyFixture.initCount), 1)
    await page.close()
  })
  await test('expired initialization requires explicit restart confirmation', async () => {
    const { page } = await pageFor('expired')
    await startUpload(page)
    await page.getByRole('button', { name: 'Új feltöltés indítása', exact: true }).click()
    assert.equal(await page.evaluate(() => window.bunnyFixture.initCount), 1)
    await page
      .getByRole('dialog', { name: 'Új feltöltést indítasz?' })
      .getByRole('button', { name: 'Új feltöltés indítása', exact: true })
      .click()
    await page.getByRole('button', { name: 'Szüneteltetés', exact: true }).waitFor()
    assert.equal(await page.evaluate(() => window.bunnyFixture.initCount), 2)
    await page.close()
  })
  await test('upload success waits for trusted detail, then explicit field selection', async () => {
    const { page } = await pageFor()
    await startUpload(page)
    await page.getByRole('button', { name: 'Szüneteltetés', exact: true }).waitFor()
    await page.evaluate(() => window.bunnyFixture.tusFixture.succeed())
    await page.getByRole('button', { name: 'Videó használata', exact: true }).waitFor()
    assert.equal(await page.evaluate(() => window.bunnyFixture.fixture.commits), 0)
    await page.getByRole('button', { name: 'Videó használata', exact: true }).click()
    await page.getByRole('dialog').waitFor({ state: 'hidden' })
    assert.equal(await page.evaluate(() => window.bunnyFixture.fixture.commits), 1)
    await page.close()
  })
  await test('standalone library supports upload/search/preview and public switch clears upload control', async () => {
    const { page } = await pageFor('normal', '&view=library')
    await page.getByRole('button', { name: 'Előnézet', exact: true }).click()
    await page.locator('iframe').waitFor()
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Videó feltöltése', exact: true }).click()
    await page.getByLabel('Videófájl', { exact: true }).waitFor()
    await page.keyboard.press('Escape')
    await page.getByRole('combobox').selectOption('public')
    assert.equal(
      await page.getByRole('button', { name: 'Videó feltöltése', exact: true }).count(),
      0,
    )
    await page.close()
  })
  await test('processing polling stops by ten minutes and manual refresh remains available', async () => {
    const { page } = await pageFor('processing')
    await page.clock.install()
    await startUpload(page)
    await page.getByRole('button', { name: 'Szüneteltetés', exact: true }).waitFor()
    await page.evaluate(() => window.bunnyFixture.tusFixture.succeed())
    await page.getByRole('status').filter({ hasText: 'Feldolgozás alatt' }).waitFor()
    await page.clock.runFor(610000)
    await page
      .getByText('Az automatikus ellenőrzés véget ért. Frissítsd az állapotot.', { exact: true })
      .waitFor()
    const count = await page.evaluate(() => window.bunnyFixture.requests.length)
    await page.clock.runFor(60000)
    assert.equal(await page.evaluate(() => window.bunnyFixture.requests.length), count)
    await page.getByRole('button', { name: 'Állapot frissítése', exact: true }).click()
    assert.equal(await page.evaluate(() => window.bunnyFixture.requests.length), count + 1)
    await page.close()
  })
  await test('ready list followed by processing detail cannot write a field', async () => {
    const { page } = await pageFor('processing')
    await openPicker(page)
    await page.getByRole('button', { name: 'Kiválasztás', exact: true }).click()
    await page.getByText('A videó még nem kész. Frissítsd a listát.', { exact: true }).waitFor()
    assert.equal(await page.evaluate(() => window.bunnyFixture.fixture.commits), 0)
    await page.close()
  })
  for (const scenario of ['resume-expiry', 'sign-expiry'])
    await test(`paused session fixed expiry: ${scenario}`, async () => {
      const { page } = await pageFor(scenario)
      await page.clock.install()
      await startUpload(page)
      await page.getByRole('button', { name: 'Szüneteltetés', exact: true }).click()
      await page.getByRole('button', { name: 'Folytatás', exact: true }).waitFor()
      if (scenario === 'resume-expiry') await page.clock.runFor(3000)
      await page.getByRole('button', { name: 'Folytatás', exact: true }).click()
      if (scenario === 'sign-expiry') await page.clock.runFor(3000)
      await page.getByRole('button', { name: 'Új feltöltés indítása', exact: true }).waitFor()
      assert.equal(await page.getByRole('button', { name: 'Folytatás', exact: true }).count(), 0)
      assert.equal(await page.evaluate(() => window.bunnyFixture.initCount), 1)
      assert.equal(
        await page.evaluate(
          () => window.bunnyFixture.requests.filter((r) => r.path.endsWith('/sign')).length,
        ),
        scenario === 'resume-expiry' ? 0 : 1,
      )
      await page.close()
    })
  await test('standalone upload close/reopen resets local file and session without creating a video', async () => {
    const { page } = await pageFor('normal', '&view=library')
    await page.getByRole('button', { name: 'Videó feltöltése', exact: true }).click()
    await page.getByLabel('Videófájl', { exact: true }).setInputFiles({
      name: 'rehab.mp4',
      mimeType: 'video/mp4',
      buffer: Buffer.from('DUMMY VIDEO FIXTURE'),
    })
    await page.getByRole('button', { name: 'Feltöltés indítása', exact: true }).click()
    await page.getByRole('button', { name: 'Szüneteltetés', exact: true }).waitFor()
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Videó feltöltése', exact: true }).click()
    assert.equal(await page.getByLabel('Videó címe', { exact: true }).inputValue(), '')
    assert.equal(
      await page.getByRole('button', { name: 'Feltöltés indítása', exact: true }).isDisabled(),
      true,
    )
    assert.equal(await page.evaluate(() => window.bunnyFixture.initCount), 1)
    assert.ok(
      (await page.evaluate(() => window.bunnyFixture.tusFixture.aborts)).every((v) => v === false),
    )
    await page.close()
  })
  assert.equal(external, 0)
  process.stdout.write(
    `Verified ${results.length} browser checks; no external requests. Screenshots: ${screenshots}\n`,
  )
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
