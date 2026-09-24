/**
 * Lexical rich-text → a jogi forrásfájlok jelölős formátuma: a
 * `jogiRichText` (src/lib/legal-content.ts) PONTOS INVERZE.
 *
 * Miért kell: a vásárlás-visszaigazoló levél az ÁSZF-et és a szolgáltató
 * adatait a KÖZZÉTETT /aszf oldalból építi (azt fogadta el a vevő a
 * pénztárban, lásd order-legal.ts), a levél jogi csomagja viszont a
 * forrásfájl formátumát érti (`# ` fejezetcím, `## ` alcím, `- ` felsorolás,
 * soronként egy bekezdés). A `richTextSzoveg` erre nem jó: eldobja a címsorok
 * jelölőjét (a melléklet elveszti a fejezetcímeket, a szolgáltatói adatblokk
 * pedig nem áll meg a következő fejezetnél), a sortörés (Shift+Enter)
 * csomópontot pedig üres szövegnek veszi, így az adminban soronként tördelt
 * adatok egy sorba folynának össze.
 *
 * MIÉRT NEM a legal-content.ts-ben él: az a modul a Lexical-építőket a
 * src/scripts/restore-legacy-content.ts-ből hozza, az pedig a
 * payload.config-ot importálja. A levelet küldő order-paid.ts a
 * payload.config → barion-callback → order-paid láncon maga is a config része,
 * így a statikus import körkörös függőséget és egy szkriptet húzna a szerver
 * futásidejébe. Ez a modul függőség nélküli; a legal-content.ts
 * továbbexportálja, hogy az inverz párja mellett is elérhető legyen.
 *
 * A megfeleltetés:
 * - `h1`, `h2` címsor → `# szöveg`; `h3`–`h6` → `## szöveg` (a címsor egy sor,
 *   a benne álló sortörés szóközzé válik);
 * - felsorolás eleme → `- szöveg`, számozott listában `1. szöveg`; a
 *   beágyazott lista elemei szintenként két szóközzel beljebb kezdődnek;
 * - bekezdés (és idézet, kódblokk) → a szövege saját sorban; a `linebreak`
 *   csomópont új sort kezd, a `tab` tabulátor;
 * - link → a felirata, és ha a cím abszolút és nem szerepel a feliratban,
 *   utána zárójelben a cím (a melléklet sima szöveg, a hivatkozás különben
 *   elveszne);
 * - minden blokk külön sorban áll; az üres bekezdés üres sor.
 *
 * Bizonyított tulajdonság (src/__tests__/legal-content.test.ts): bármely
 * forrásra `parseJogiForras(lexicalToJogiForras(jogiRichText(parseJogiForras(f))))`
 * ugyanazt adja, mint `parseJogiForras(f)`. Rossz alakú bemenetre üres
 * szöveget ad, nem dob.
 */
export function lexicalToJogiForras(tartalom: unknown): string {
  const gyoker =
    typeof tartalom === 'object' && tartalom !== null
      ? (tartalom as { root?: unknown }).root
      : undefined
  return gyermekLista(gyoker)
    .flatMap((csomopont) => forrasSorok(csomopont))
    .join('\n')
}

/** Egy csomópont `children` tömbje, ha van. */
function gyermekLista(csomopont: unknown): unknown[] {
  if (typeof csomopont !== 'object' || csomopont === null) {
    return []
  }
  const gyerekek = (csomopont as { children?: unknown }).children
  return Array.isArray(gyerekek) ? gyerekek : []
}

function tipusa(csomopont: unknown): unknown {
  return typeof csomopont === 'object' && csomopont !== null
    ? (csomopont as { type?: unknown }).type
    : undefined
}

/** Egy blokk-szintű csomópont forrássorai. */
function forrasSorok(csomopont: unknown): string[] {
  const tipus = tipusa(csomopont)
  if (tipus === 'heading') {
    const tag = (csomopont as { tag?: unknown }).tag
    const jelolo = typeof tag === 'string' && /^h[12]$/u.test(tag) ? '# ' : '## '
    return [`${jelolo}${soronBeluliSzoveg(gyermekLista(csomopont)).replace(/\n/gu, ' ')}`]
  }
  if (tipus === 'list') {
    return listaSorok(csomopont, 0)
  }
  if (tipus === 'horizontalrule') {
    return ['']
  }
  if (typeof csomopont !== 'object' || csomopont === null || !('children' in csomopont)) {
    return []
  }
  return soronBeluliSzoveg(gyermekLista(csomopont)).split('\n')
}

/** Egy lista elemei soronként, a jelölővel és a mélységnek megfelelő behúzással. */
function listaSorok(lista: unknown, melyseg: number): string[] {
  const szamozott = (lista as { listType?: unknown }).listType === 'number'
  const behuzas = '  '.repeat(melyseg)
  const sorok: string[] = []
  let sorszam = 0
  for (const elem of gyermekLista(lista)) {
    const gyerekek = gyermekLista(elem)
    const beagyazottListak = gyerekek.filter((gyerek) => tipusa(gyerek) === 'list')
    const soronBelul = gyerekek.filter((gyerek) => tipusa(gyerek) !== 'list')
    // A Lexical a beágyazott listát egy SAJÁT, szöveg nélküli listaelembe
    // teszi; ennek nincs önálló sora, csak a benne álló lista elemeinek.
    if (soronBelul.length > 0 || beagyazottListak.length === 0) {
      sorszam += 1
      const ertek =
        typeof elem === 'object' && elem !== null ? (elem as { value?: unknown }).value : undefined
      const jelolo = szamozott
        ? `${typeof ertek === 'number' && Number.isInteger(ertek) ? ertek : sorszam}. `
        : '- '
      const [elso = '', ...tovabbiak] = soronBeluliSzoveg(soronBelul).split('\n')
      sorok.push(`${behuzas}${jelolo}${elso}`, ...tovabbiak.map((sor) => `${behuzas}  ${sor}`))
    }
    for (const beagyazott of beagyazottListak) {
      sorok.push(...listaSorok(beagyazott, melyseg + 1))
    }
  }
  return sorok
}

/** Csomópontok soron belüli szövege: a sortörés `\n`, a tabulátor `\t`. */
function soronBeluliSzoveg(csomopontok: readonly unknown[]): string {
  return csomopontok.map(soronBeluliElem).join('')
}

function soronBeluliElem(csomopont: unknown): string {
  if (typeof csomopont !== 'object' || csomopont === null) {
    return ''
  }
  const rekord = csomopont as { type?: unknown; text?: unknown; fields?: unknown; url?: unknown }
  if (rekord.type === 'text') {
    return typeof rekord.text === 'string' ? rekord.text : ''
  }
  if (rekord.type === 'linebreak') {
    return '\n'
  }
  if (rekord.type === 'tab') {
    return '\t'
  }
  const szoveg = soronBeluliSzoveg(gyermekLista(csomopont))
  if (rekord.type === 'link' || rekord.type === 'autolink') {
    const cim = linkCime(rekord)
    return cim !== null && !szoveg.includes(cim) ? `${szoveg} (${cim})` : szoveg
  }
  return szoveg
}

/** Egy link-csomópont abszolút címe (a `mailto:` előtag nélkül); relatív címnél null. */
function linkCime(link: { fields?: unknown; url?: unknown }): string | null {
  const mezok =
    typeof link.fields === 'object' && link.fields !== null
      ? (link.fields as { url?: unknown })
      : {}
  const nyers = typeof mezok.url === 'string' ? mezok.url : link.url
  if (typeof nyers !== 'string') {
    return null
  }
  const cim = nyers.trim()
  if (/^mailto:/iu.test(cim)) {
    return cim.replace(/^mailto:/iu, '')
  }
  return /^https?:\/\//iu.test(cim) ? cim : null
}
