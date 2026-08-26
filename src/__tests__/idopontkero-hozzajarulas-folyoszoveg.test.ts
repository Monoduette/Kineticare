import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * Az időpontkérő űrlap hozzájárulás-felirata FOLYÓSZÖVEG — nem elrendezés.
 * A `.kc-appointment__consent-label` `display: flex` volt. A felirat viszont
 * nem elrendezés, hanem egyetlen mondat, benne egy beágyazott hivatkozással:
 * „Hozzájárulok, hogy a Kineticare … kezelje az
 * <a>Adatkezelési és adatvédelmi szabályzat</a> szerint. A hozzájárulás
 */

const APPOINTMENT_CSS = readFileSync(
  fileURLToPath(new URL('../app/(frontend)/styles/blocks/appointment.css', import.meta.url)),
  'utf8',
)

/**
 * A `.kc-appointment__consent-label` szabályblokkjai.
 *
 * A KOMMENTEKET ELŐBB KIVESSZÜK. Enélkül az őr vakon zöld lenne: a szabály
 * fölé írt magyarázat maga is tartalmazza a `display: flex` szöveget (épp azt
 * magyarázza, miért nem szabad), tehát a keresés akkor is találna, ha a
 * tényleges deklaráció visszakerülne a szabályba.
 */
function feliratSzabalyok(): string[] {
  const kommentNelkul = APPOINTMENT_CSS.replace(/\/\*[\s\S]*?\*\//g, '')
  return kommentNelkul.match(/[^{}]*\.kc-appointment__consent-label[^{}]*\{[^}]*\}/g) ?? []
}

describe('időpontkérés — a hozzájárulás felirata', () => {
  it('NEM flex-konténer (ettől esett szét a mondat hasábokra)', () => {
    const szabalyok = feliratSzabalyok().join('\n')
    expect(szabalyok).not.toMatch(/display:\s*flex/)
    expect(szabalyok).not.toMatch(/display:\s*inline-flex/)
    expect(szabalyok).not.toMatch(/display:\s*grid/)
  })

  it('folyószövegként rendel (display: block)', () => {
    expect(feliratSzabalyok().join('\n')).toMatch(/display:\s*block/)
  })

  it('nincs rajta függőleges flex-igazítás sem', () => {
    // Az `align-items` blokk-konténeren hatástalan, de a jelenléte azt jelzi,
    // hogy valaki visszatette a flex-szemléletet — az a következő lépésben a
    // `display: flex`-et is visszahozná.
    expect(feliratSzabalyok().join('\n')).not.toMatch(/align-items/)
  })

  it('a 44 px-es célfelület megmarad (WCAG 2.5.5)', () => {
    expect(feliratSzabalyok().join('\n')).toMatch(/min-height:\s*2\.75rem/)
  })

  it('a védelem nem írható felül némán: pontosan EGY felirat-szabály van', () => {
    /**
     * MIÉRT SZÁMLÁLUNK: a puszta „nem szerepel" vizsgálat vakon zöld marad, ha
     * valaki később egy második, hátrébb álló szabállyal visszaállítja a
     * `display: flex`-et. A repóban ez a hiba korábban már megtörtént, ezért
     * rögzítjük a szabályok SZÁMÁT is.
     */
    expect(feliratSzabalyok()).toHaveLength(1)
  })

  it('a sor a felirat ELSŐ sorához igazítja a négyzetet (többsoros szöveghez ez a helyes)', () => {
    const kommentNelkul = APPOINTMENT_CSS.replace(/\/\*[\s\S]*?\*\//g, '')
    const sor = kommentNelkul.match(/\.kc-appointment__consent-row\s*\{[^}]*\}/g) ?? []
    expect(sor).toHaveLength(1)
    expect(sor.join('\n')).toMatch(/align-items:\s*flex-start/)
  })
})
