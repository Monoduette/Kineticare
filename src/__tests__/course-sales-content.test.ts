import { describe, expect, it } from 'vitest'

import {
  MAX_HIGHLIGHTS,
  buildCourseSalesContent,
  classifyHeading,
  factHighlights,
  factSteps,
  guaranteeBadgeLabel,
  shortenHighlight,
  type CourseFactsInput,
} from '../components/courses/sales-content'
import type { Product } from '../payload-types'

/**
 * A kurzusoldal ÉRTÉKESÍTŐ TARTALMÁNAK fallback-lánca.
 *
 * A tétje üzleti: a strukturált mezők ÚJak, az élő kurzusok tartalma viszont a
 * `longDescription` folyószövegében él. Ha a kinyerés téved, vagy a felhasznált
 * szakasz duplán (és a fel NEM használt szakasz sehol) jelenik meg, azt a
 * látogató a fizetős oldalon látja meg. Ezért itt minden ág mérve van:
 * strukturált → leírás-szakasz → tényadat, és külön a törzs-visszaadás.
 */

type LexicalDoc = NonNullable<Product['longDescription']>
type LexicalNode = LexicalDoc['root']['children'][number]

const text = (value: string): LexicalNode =>
  ({ type: 'text', version: 1, text: value, format: 0 }) as unknown as LexicalNode

const para = (value: string): LexicalNode =>
  ({ type: 'paragraph', version: 1, children: [text(value)] }) as unknown as LexicalNode

const heading = (tag: string, value: string): LexicalNode =>
  ({ type: 'heading', version: 1, tag, children: [text(value)] }) as unknown as LexicalNode

const list = (items: string[]): LexicalNode =>
  ({
    type: 'list',
    version: 1,
    tag: 'ul',
    children: items.map(
      (item) =>
        ({ type: 'listitem', version: 1, children: [text(item)] }) as unknown as LexicalNode,
    ),
  }) as unknown as LexicalNode

const doc = (children: LexicalNode[]): LexicalDoc =>
  ({
    root: { type: 'root', version: 1, direction: 'ltr', format: '', indent: 0, children },
  }) as unknown as LexicalDoc

/** A régi kineticare.hu KézRehab értékesítő oldalának SZÓ SZERINTI címsorai. */
const legacyDescription = (): LexicalDoc =>
  doc([
    para('Az Otthoni KézRehab egy könnyen követhető program.'),
    para('Ezzel a módszerrel képes leszel:'),
    list([
      'a hetek óta tartó fájdalmat is rendbehozni,',
      'megtanulni a megelőzés fortélyait,',
      'felkészíteni a kezeidet a napi terhelésre.',
    ]),
    heading('h2', 'Ez a program tökéletes számodra, ha…'),
    list(['hónapok óta fáj a kezed,', 'sokat dolgozol a kezeddel,']),
    heading('h2', 'Nem javasoljuk a programot, ha…'),
    list(['traumás sérülésed volt,', 'nincs napi 5 perced magadra.']),
    heading('h2', '30 napos kipróbálási garancia'),
    para('Próbáld ki a programot 30 napig, és kérdés nélkül visszafizetjük az árát.'),
    heading('h2', 'Kérdések, amik talán felmerültek benned'),
    heading('h3', 'Mennyire bonyolultak ezek a gyakorlatok?'),
    para('Nagyon egyszerűek, a videókban lépésről lépésre megmutatjuk.'),
    heading('h3', 'Elég napi 5 perc?'),
    para('Igen, a gyakorlatok 5 perces miniblokkokba vannak szervezve.'),
  ])

const facts: CourseFactsInput = {
  moduleCount: 4,
  lessonCount: 52,
  accessDurationDays: null,
  free: false,
  hasPreview: true,
}

/** Minimális termék-fixture: minden strukturált mező üres. */
const emptyProduct = (longDescription: LexicalDoc | null) =>
  ({
    longDescription,
    salesHighlights: null,
    howItWorks: null,
    fitFor: null,
    notFitFor: null,
    guaranteeTitle: null,
    guaranteeText: null,
    faq: null,
  }) as unknown as Product

function bodyTexts(content: ReturnType<typeof buildCourseSalesContent>): string {
  return JSON.stringify(content.body ?? {})
}

describe('classifyHeading — a szakasz-felismerés a SAJÁT címsorainkon', () => {
  it('a tagadó címsor NEM eshet a pozitív ágba', () => {
    expect(classifyHeading('Nem javasoljuk a programot, ha…')).toBe('notFitFor')
  })

  it('felismeri a pozitív, a garancia- és a kérdés-szakaszt', () => {
    expect(classifyHeading('Ez a program tökéletes számodra, ha…')).toBe('fitFor')
    expect(classifyHeading('30 napos kipróbálási garancia')).toBe('guarantee')
    expect(classifyHeading('Kérdések, amik talán felmerültek benned')).toBe('faq')
    expect(classifyHeading('Gyakran ismételt kérdések')).toBe('faq')
  })

  it('minden más címsor a törzsben marad', () => {
    expect(classifyHeading('Mi vár a programban?')).toBe('body')
    expect(classifyHeading('Bónusz minikurzusok')).toBe('body')
    expect(classifyHeading('')).toBe('body')
  })
})

describe('buildCourseSalesContent — kinyerés a MEGLÉVŐ leírásból', () => {
  const content = buildCourseSalesContent(emptyProduct(legacyDescription()), facts)

  it('a „kinek való / kinek nem" listák a saját szakaszukból jönnek', () => {
    expect(content.fitFor).toEqual(['hónapok óta fáj a kezed,', 'sokat dolgozol a kezeddel,'])
    expect(content.notFitFor).toEqual(['traumás sérülésed volt,', 'nincs napi 5 perced magadra.'])
  })

  it('a garancia címe és szövege a garancia-szakaszból jön', () => {
    expect(content.guarantee).not.toBeNull()
    expect(content.guarantee?.title).toBe('30 napos kipróbálási garancia')
    expect(content.guarantee?.text).toContain('kérdés nélkül visszafizetjük')
  })

  it('a GYIK a h3-as kérdés + bekezdés párokból áll össze', () => {
    expect(content.faq).toEqual([
      {
        question: 'Mennyire bonyolultak ezek a gyakorlatok?',
        answer: 'Nagyon egyszerűek, a videókban lépésről lépésre megmutatjuk.',
      },
      {
        question: 'Elég napi 5 perc?',
        answer: 'Igen, a gyakorlatok 5 perces miniblokkokba vannak szervezve.',
      },
    ])
  })

  it('a felhasznált szakaszok NEM maradnak a törzsben (nincs duplázás)', () => {
    const body = bodyTexts(content)
    expect(body).toContain('Az Otthoni KézRehab egy könnyen követhető program.')
    expect(body).not.toContain('30 napos kipróbálási garancia')
    expect(body).not.toContain('Nem javasoljuk a programot')
    expect(body).not.toContain('Mennyire bonyolultak')
  })

  it('az előny-pipák a törzs ELSŐ felsorolásából képződnek, legfeljebb 3 sorban', () => {
    expect(content.highlights).toHaveLength(3)
    expect(content.highlights[0]).toBe('a hetek óta tartó fájdalmat is rendbehozni')
  })
})

describe('buildCourseSalesContent — a strukturált mező MINDIG erősebb', () => {
  const product = {
    ...emptyProduct(legacyDescription()),
    salesHighlights: [{ text: 'Örökös hozzáférés' }, { text: '50+ videós gyakorlat' }],
    fitFor: [{ text: 'Szeretnél otthon gyakorolni' }],
    notFitFor: [{ text: 'Nincs napi 5 perced' }],
    guaranteeTitle: 'Saját garancia',
    guaranteeText: 'A szerkesztő által írt garancia-szöveg.',
    faq: [{ question: 'Saját kérdés?', answer: 'Saját válasz.' }],
    howItWorks: [{ title: 'Első lépés', text: 'Leírás' }],
  } as unknown as Product
  const content = buildCourseSalesContent(product, facts)

  it('minden szakasz a szerkesztő szövegét viszi', () => {
    expect(content.highlights).toEqual(['Örökös hozzáférés', '50+ videós gyakorlat'])
    expect(content.fitFor).toEqual(['Szeretnél otthon gyakorolni'])
    expect(content.notFitFor).toEqual(['Nincs napi 5 perced'])
    expect(content.guarantee).toEqual({
      title: 'Saját garancia',
      text: 'A szerkesztő által írt garancia-szöveg.',
    })
    expect(content.faq).toEqual([{ question: 'Saját kérdés?', answer: 'Saját válasz.' }])
    expect(content.steps).toEqual([{ title: 'Első lépés', text: 'Leírás' }])
  })

  it('a leírás megfelelő szakasza ilyenkor SEM duplázódik a törzsbe', () => {
    const body = bodyTexts(content)
    expect(body).not.toContain('30 napos kipróbálási garancia')
    expect(body).not.toContain('tökéletes számodra')
  })
})

describe('buildCourseSalesContent — néma tartalomvesztés nincs', () => {
  it('a HASZNÁLHATATLAN szakasz (csak címsor) VISSZAKERÜL a törzsbe', () => {
    const content = buildCourseSalesContent(
      emptyProduct(
        doc([
          para('Bevezető.'),
          heading('h2', '30 napos garancia'),
          // Se bekezdés, se lista → nincs mit kiemelni.
          heading('h2', 'Utána'),
          para('Záró bekezdés.'),
        ]),
      ),
      facts,
    )
    expect(content.guarantee).toBeNull()
    const body = bodyTexts(content)
    expect(body).toContain('30 napos garancia')
    expect(body).toContain('Záró bekezdés.')
  })

  it('üres leírásnál a törzs null, a tényadat-tartalék viszont van', () => {
    const content = buildCourseSalesContent(emptyProduct(null), facts)
    expect(content.body).toBeNull()
    expect(content.fitFor).toEqual([])
    expect(content.faq).toEqual([])
    expect(content.highlights.length).toBeGreaterThan(0)
    expect(content.steps).toHaveLength(3)
  })
})

/**
 * WP51 (tulajdonosi kör 2026-09-19, ingyenes SOS villámkurzus): „100%
 * boldogság garancia: nincs visszatérítés, mert ingyenes." A garancia
 * visszatérítési ígéret — ingyenes kurzuson HAMIS állítás lenne, ezért a
 * `free` ágon sem a sáv, sem a vásárlódoboz címkéje nem jelenik meg, akkor
 * sem, ha a CMS strukturált mezője ki van töltve vagy a leírásban van
 * garancia-szakasz (az sem kerül vissza a törzsbe).
 */
describe('buildCourseSalesContent — ingyenes kurzuson nincs garancia', () => {
  const ingyenes: CourseFactsInput = { ...facts, free: true }

  it('a strukturált garancia-mező is null-ra esik, a vásárlódoboz címkéje nincs', () => {
    const product = {
      ...emptyProduct(legacyDescription()),
      guaranteeTitle: '100% boldogság garancia',
      guaranteeText: 'Ha nem tetszik, kérdés nélkül visszafizetjük.',
    } as unknown as Product
    const content = buildCourseSalesContent(product, ingyenes)
    expect(content.guarantee).toBeNull()
    expect(guaranteeBadgeLabel(content.guarantee)).toBeNull()
    // Fizetős ágon ugyanez a termék viszi a garanciát: a szabály az ingyenességé.
    expect(buildCourseSalesContent(product, facts).guarantee).toEqual({
      title: '100% boldogság garancia',
      text: 'Ha nem tetszik, kérdés nélkül visszafizetjük.',
    })
  })

  it('a leírás garancia-szakasza SEM a sávba, SEM a törzsbe nem kerül', () => {
    const content = buildCourseSalesContent(emptyProduct(legacyDescription()), ingyenes)
    expect(content.guarantee).toBeNull()
    const body = bodyTexts(content)
    expect(body).not.toContain('30 napos kipróbálási garancia')
    expect(body).not.toContain('visszafizetjük')
    // A többi kinyert szakasz változatlan: a szabály csak a garanciát érinti.
    expect(content.fitFor).toHaveLength(2)
    expect(content.faq).toHaveLength(2)
    expect(body).toContain('könnyen követhető program')
  })
})

describe('tényadat-tartalékok — kitalált marketingállítás nélkül', () => {
  it('a pipák a tananyag és a hozzáférés MÉRT adataiból állnak', () => {
    expect(factHighlights(facts)).toEqual([
      '4 modul, lépésről lépésre',
      '52 lecke a tananyagban',
      'Örökös hozzáférés: bármikor újranézheted',
      'Ingyenes előzetes vásárlás előtt',
    ])
    expect(factHighlights(facts).length).toBeLessThanOrEqual(MAX_HIGHLIGHTS)
  })

  it('lejáró hozzáférésnél a NAPOK SZÁMA jelenik meg, nem „örökös"', () => {
    const rows = factHighlights({ ...facts, accessDurationDays: 90 })
    expect(rows).toContain('90 napos hozzáférés')
    expect(rows.join(' ')).not.toContain('Örökös')
  })

  it('a lépések ingyenes kurzusnál nem beszélnek fizetésről', () => {
    const paid = factSteps(facts)
      .map((step) => step.text ?? '')
      .join(' ')
    expect(paid).toContain('Barion')
    const free = factSteps({ ...facts, free: true })
    expect(free.map((step) => step.text ?? '').join(' ')).not.toContain('Barion')
    expect(free[0].title).toBe('Belépsz')
  })
})

describe('shortenHighlight — a pipás sor egy pillantással olvasható marad', () => {
  it('a rövid sort változatlanul hagyja, csak a záró írásjelet veszi le', () => {
    expect(shortenHighlight('Örökös hozzáférés,')).toBe('Örökös hozzáférés')
  })

  it('tagmondat-határon vág, ha van', () => {
    expect(
      shortenHighlight(
        '50+ videós gyakorlat – rövid, lépésről lépésre bemutatott mozdulatsorok a kezed rehabilitálására',
      ),
    ).toBe('50+ videós gyakorlat')
  })

  it('tagmondat-határ nélkül szóhatáron vág, és jelzi a rövidítést', () => {
    const long = 'a'.repeat(30) + ' ' + 'b'.repeat(30) + ' ' + 'c'.repeat(40)
    const short = shortenHighlight(long)
    expect(short.length).toBeLessThanOrEqual(85)
    expect(short.endsWith('…')).toBe(true)
  })
})
