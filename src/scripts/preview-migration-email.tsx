/** Offline előnézet: nincs Payload-inicializálás, adatbázis vagy levélküldés. */
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import BelepesAtallasPage from '../app/(frontend)/belepes-atallas/page'
import { resetPasswordEmail } from '../lib/email/templates/auth'
import { migrationNoticeEmail } from '../lib/email/templates/migration'

const output = process.argv[2]
if (!output) throw new Error('Adj meg egy előnézeti kimeneti könyvtárat.')
const directory = path.resolve(output)
await mkdir(directory, { recursive: true })

// Kitalált mintaadatok. Nincs működő reset-token, csak statikus előnézet.
const examples = [
  { file: 'nevvel', label: 'Névvel', name: 'Őri Anna', email: 'ori.anna@example.com' },
  { file: 'nev-nelkul', label: 'Név nélkül', name: null, email: 'pelda@example.com' },
  {
    file: 'hosszu-adatok',
    label: 'Hosszú név és e-mail',
    name: `Őri-${'Minta'.repeat(16)} <Példa> & Társa`,
    email: `${'teszt'.repeat(12)}+atallas@${'hosszu'.repeat(8)}.example.com`,
  },
]

for (const example of examples) {
  const email = migrationNoticeEmail({ ...example, serverUrl: 'https://kineticare.example.com' })
  await writeFile(path.join(directory, `${example.file}.html`), email.html)
  await writeFile(path.join(directory, `${example.file}.txt`), `${email.subject}\n\n${email.text}`)
}

// Importálható draft: teljes megszólítás változóként, hogy a fallback is helyes legyen.
// Resendben a GREETING fallbackje „Szia!”, ACCOUNT_EMAIL és MIGRATION_URL kötelező.
const draft = migrationNoticeEmail({
  name: null,
  email: '{{{ACCOUNT_EMAIL}}}',
  serverUrl: 'https://preview.invalid',
})
await writeFile(
  path.join(directory, 'resend-draft.html'),
  draft.html
    .replace('Szia!', '{{{GREETING}}}')
    .replaceAll('https://preview.invalid/belepes-atallas', '{{{MIGRATION_URL}}}'),
)
await writeFile(
  path.join(directory, 'resend-draft.txt'),
  draft.text
    .replace('Szia!', '{{{GREETING}}}')
    .replaceAll('https://preview.invalid/belepes-atallas', '{{{MIGRATION_URL}}}'),
)

const reset = resetPasswordEmail({
  name: 'Őri Anna',
  resetUrl: 'https://kineticare.example.com/jelszo-visszaallitas',
})
await writeFile(path.join(directory, 'reset-minta.html'), reset.html)

const styles = await Promise.all(
  [
    'styles/fonts.css',
    'styles/tokens.css',
    'styles/base.css',
    'styles/layout.css',
    'styles/ui.css',
    'auth.css',
  ].map((file) => readFile(path.join('src/app/(frontend)', file), 'utf8')),
)
await cp('public/fonts', path.join(directory, 'fonts'), { recursive: true })
await writeFile(
  path.join(directory, 'celoldal.html'),
  `<!doctype html><html lang="hu"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Átállási céllap: statikus előnézet</title><style>${styles.join('\n')}</style><body><main>${renderToStaticMarkup(createElement(BelepesAtallasPage))}</main></body></html>`,
)

await writeFile(
  path.join(directory, 'index.html'),
  `<!doctype html><html lang="hu"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kineticare átállási levél – előnézet</title>
<style>body{margin:0;padding:24px;font:16px/1.6 system-ui,sans-serif;background:#f6f9fc;color:#10243e}h1{font:32px Georgia,serif}a{color:#2f6e9f}nav{display:flex;gap:20px;flex-wrap:wrap;margin-bottom:24px}.views{display:flex;align-items:flex-start;gap:24px;flex-wrap:wrap}iframe{border:1px solid #d8e2eb;border-radius:12px;background:white;max-width:100%;height:1100px}p{max-width:70ch}</style>
<h1>Megújulási értesítő</h1><p>Statikus előnézet kitalált adatokkal. Nem küld levelet. A lenti mobilnézet 320 px széles; az oldalak külön is megnyithatók. A linkek példadomainre mutatnak.</p>
<nav>${examples.map((item) => `<a href="${item.file}.html">${item.label}</a><a href="${item.file}.txt">${item.label}: szöveges levél</a>`).join('')}<a href="celoldal.html">Átállási céllap</a><a href="reset-minta.html">Resetlevél, token nélkül</a></nav>
<div class="views"><section><h2>Asztali</h2><iframe title="Asztali e-mail" width="680" src="nevvel.html"></iframe></section><section><h2>Mobil · 320 px</h2><iframe title="Mobil e-mail" width="320" src="nevvel.html"></iframe></section></div></html>`,
)
process.stdout.write(`Előnézet elkészült: ${directory}\n`)
