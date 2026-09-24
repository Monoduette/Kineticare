/**
 * Függőség nélküli XSD-validátor a Számla Agent sémáinak részhalmazára.
 *
 * MIÉRT SAJÁT: a repóban nincs XML-séma-könyvtár, a CI-futtatón pedig nem
 * garantált az `xmllint`. A Számlázz.hu élő XSD-i viszont szándékosan
 * egyszerűek: kizárólag `complexType/sequence/element`, `minOccurs`/
 * `maxOccurs`, beépített egyszerű típusok (string, double, int, boolean, date,
 * base64Binary) és egy felsorolásos `simpleType`. Ezt a részhalmazt teljesen
 * lefedjük; minden MÁS szerkezetre (choice, attribute, extension, import …)
 * a fordító HANGOSAN dob — egy bővülő séma így nem mehet át csendben.
 *
 * Amit ellenőriz (a Xerces-validáció megfelelője erre a részhalmazra):
 * elemsorrend, kötelező és ismétlődő elemek, ismeretlen elem, üres vagy rossz
 * alakú típusos érték (pl. üres xs:double — ezen bukott az üres <arfolyam>),
 * felsorolás, a gyökér névtere, és hogy attribútum csak a gyökéren, a
 * névtér-deklarációkban (xmlns, xsi:…) állhat.
 *
 * Jólformáltság (XML 1.0): az XML 1.0 `Char` produkción kívüli karakter
 * (pl. U+000B, U+FFFF, magányos surrogate), a csupasz vagy ismeretlen `&`, a
 * nem XML-karakterre mutató karakterhivatkozás (`&#0;`, `&#xFFFF;`), a
 * szövegben álló `]]>` és az attribútumértékben álló `<` elutasítást ad. Ezek
 * mind a Számla Agent 57-es „XML beolvasási hibájához" vezetnének.
 *
 * A teszt, ahol `xmllint` elérhető, ugyanezeket a mintákat vele is lefuttatja,
 * és ellenőrzi, hogy a két validátor ítélete egyezik. A GitHub CI futtatóján
 * az `xmllint` NINCS telepítve (a ci.yml nem teszi fel a libxml2-utils
 * csomagot), ott tehát kizárólag ez a validátor fut: ezért kell a
 * jólformáltságot is magának ellenőriznie.
 */

export interface XmlElement {
  name: string
  attributes: Map<string, string>
  children: XmlElement[]
  text: string
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
}

/** Az XML 1.0 `Char` produkción kívüli kódpont (escape-pel sem menthető). */
const NON_XML_CHAR = /[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/u

/** Karakterhivatkozás feloldása: csak XML 1.0-karakterre mutathat. */
function charFromReference(codePoint: number, match: string): string {
  if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
    throw new Error(`Nem XML-karakterre mutató hivatkozás: ${match}`)
  }
  const char = String.fromCodePoint(codePoint)
  if (NON_XML_CHAR.test(char)) {
    throw new Error(`Nem XML-karakterre mutató hivatkozás: ${match}`)
  }
  return char
}

function decodeEntities(value: string): string {
  if (/&(?!(?:#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z]+);)/.test(value)) {
    throw new Error('Csupasz & jel (nem entitás- és nem karakterhivatkozás)')
  }
  return value.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z]+);/g, (match, entity: string) => {
    const named = NAMED_ENTITIES[entity]
    if (named !== undefined) {
      return named
    }
    if (entity.startsWith('#x')) {
      return charFromReference(Number.parseInt(entity.slice(2), 16), match)
    }
    if (entity.startsWith('#')) {
      return charFromReference(Number.parseInt(entity.slice(1), 10), match)
    }
    throw new Error(`Ismeretlen XML-entitás: ${match}`)
  })
}

/**
 * Minimális, jólformáltságot ellenőrző XML-elemző (deklaráció, komment, CDATA,
 * XML 1.0-karakterkészlet, entitás- és karakterhivatkozások).
 */
export function parseXml(source: string): XmlElement {
  const stack: XmlElement[] = []
  let root: XmlElement | null = null
  let index = source.charCodeAt(0) === 0xfeff ? 1 : 0
  const illegal = NON_XML_CHAR.exec(source.slice(index))
  if (illegal) {
    const codePoint = illegal[0].codePointAt(0) ?? 0
    throw new Error(
      `Nem XML 1.0 karakter a dokumentumban: U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`,
    )
  }

  while (index < source.length) {
    if (source.startsWith('<?', index)) {
      const end = source.indexOf('?>', index)
      if (end < 0) throw new Error('Lezáratlan feldolgozási utasítás')
      index = end + 2
      continue
    }
    if (source.startsWith('<!--', index)) {
      const end = source.indexOf('-->', index)
      if (end < 0) throw new Error('Lezáratlan komment')
      index = end + 3
      continue
    }
    if (source.startsWith('<![CDATA[', index)) {
      const end = source.indexOf(']]>', index)
      const top = stack[stack.length - 1]
      if (end < 0 || !top) throw new Error('CDATA elemen kívül vagy lezáratlanul')
      top.text += source.slice(index + 9, end)
      index = end + 3
      continue
    }
    if (source.startsWith('</', index)) {
      const end = source.indexOf('>', index)
      if (end < 0) throw new Error('Lezáratlan záró tag')
      const name = source.slice(index + 2, end).trim()
      const open = stack.pop()
      if (!open || open.name !== name) {
        throw new Error(`Nem egyező záró tag: </${name}> (nyitott: ${open?.name ?? 'nincs'})`)
      }
      index = end + 1
      continue
    }
    if (source[index] === '<') {
      let end = index + 1
      let quote: string | null = null
      while (end < source.length) {
        const char = source[end]
        if (quote) {
          if (char === quote) quote = null
        } else if (char === '"' || char === "'") {
          quote = char
        } else if (char === '>') {
          break
        }
        end += 1
      }
      if (end >= source.length) throw new Error('Lezáratlan nyitó tag')
      let raw = source.slice(index + 1, end)
      const selfClosing = raw.endsWith('/')
      if (selfClosing) raw = raw.slice(0, -1)
      const nameMatch = /^([^\s/>]+)/.exec(raw)
      if (!nameMatch?.[1]) throw new Error(`Érvénytelen tag: <${raw}>`)
      const element: XmlElement = {
        name: nameMatch[1],
        attributes: new Map(),
        children: [],
        text: '',
      }
      const rest = raw.slice(nameMatch[1].length)
      const attributePattern = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
      const leftover = rest.replace(attributePattern, (_match, key: string, dq, sq) => {
        if (element.attributes.has(key)) throw new Error(`Ismétlődő attribútum: ${key}`)
        const rawValue = String(dq ?? sq ?? '')
        if (rawValue.includes('<')) throw new Error(`'<' az attribútumértékben: ${key}`)
        element.attributes.set(key, decodeEntities(rawValue))
        return ''
      })
      if (leftover.trim() !== '') throw new Error(`Érvénytelen attribútum-szintaxis: ${raw}`)
      const parent = stack[stack.length - 1]
      if (parent) {
        parent.children.push(element)
      } else if (root) {
        throw new Error('Több gyökérelem')
      } else {
        root = element
      }
      if (!selfClosing) stack.push(element)
      index = end + 1
      continue
    }
    const next = source.indexOf('<', index)
    const chunk = source.slice(index, next < 0 ? source.length : next)
    if (chunk.includes(']]>')) throw new Error("']]>' a szöveges tartalomban")
    const top = stack[stack.length - 1]
    if (top) {
      top.text += decodeEntities(chunk)
    } else if (chunk.trim() !== '') {
      throw new Error('Szöveg a gyökérelemen kívül')
    }
    index = next < 0 ? source.length : next
  }
  if (stack.length > 0) throw new Error(`Lezáratlan elem: <${stack[stack.length - 1]?.name}>`)
  if (!root) throw new Error('Nincs gyökérelem')
  return root
}

// ---------------------------------------------------------------------------
// Séma-fordítás
// ---------------------------------------------------------------------------

const BUILTIN_TYPES = new Set(['string', 'double', 'int', 'boolean', 'date', 'base64Binary'])

type TypeDef =
  | { kind: 'builtin'; name: string }
  | { kind: 'simple'; base: string; enumeration: string[] | null; minInclusive: number | null }
  | { kind: 'complex'; particles: Particle[] }

interface Particle {
  name: string
  type: () => TypeDef
  min: number
  max: number
}

export interface CompiledSchema {
  targetNamespace: string
  rootElements: Map<string, Particle>
}

function localName(qname: string): string {
  const colon = qname.indexOf(':')
  return colon < 0 ? qname : qname.slice(colon + 1)
}

function occurs(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback
  if (value === 'unbounded') return Number.POSITIVE_INFINITY
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`Érvénytelen occurs: ${value}`)
  return parsed
}

/** Az XSD lefordítása; ismeretlen szerkezetre hangosan dob. */
export function compileSchema(xsdSource: string): CompiledSchema {
  const schema = parseXml(xsdSource)
  if (localName(schema.name) !== 'schema') throw new Error('Nem XSD: a gyökér nem <schema>')
  const targetNamespace = schema.attributes.get('targetNamespace') ?? ''
  const named = new Map<string, TypeDef>()
  const pendingNamed = new Map<string, XmlElement>()

  const compileSimpleType = (node: XmlElement): TypeDef => {
    const [restriction, ...extra] = node.children
    if (!restriction || extra.length > 0 || localName(restriction.name) !== 'restriction') {
      throw new Error('Támogatatlan simpleType-szerkezet')
    }
    const base = localName(restriction.attributes.get('base') ?? '')
    if (!BUILTIN_TYPES.has(base)) throw new Error(`Támogatatlan restriction-bázis: ${base}`)
    let enumeration: string[] | null = null
    let minInclusive: number | null = null
    for (const facet of restriction.children) {
      const facetName = localName(facet.name)
      const value = facet.attributes.get('value') ?? ''
      if (facetName === 'enumeration') {
        enumeration = [...(enumeration ?? []), value]
      } else if (facetName === 'minInclusive') {
        minInclusive = Number(value)
      } else {
        throw new Error(`Támogatatlan facet: ${facetName}`)
      }
    }
    return { kind: 'simple', base, enumeration, minInclusive }
  }

  const compileComplexType = (node: XmlElement): TypeDef => {
    const [sequence, ...extra] = node.children
    if (!sequence || extra.length > 0 || localName(sequence.name) !== 'sequence') {
      throw new Error('Támogatatlan complexType-szerkezet (csak egyetlen sequence)')
    }
    const particles = sequence.children.map(compileElement)
    const names = new Set(particles.map((particle) => particle.name))
    if (names.size !== particles.length) throw new Error('Ismétlődő elemnév egy sequence-ben')
    return { kind: 'complex', particles }
  }

  const resolveNamed = (qname: string): TypeDef => {
    const name = localName(qname)
    if (!qname.includes(':') && BUILTIN_TYPES.has(name)) return { kind: 'builtin', name }
    if (qname.includes(':') && !qname.startsWith('tns:')) {
      if (BUILTIN_TYPES.has(name)) return { kind: 'builtin', name }
    }
    const cached = named.get(name)
    if (cached) return cached
    const node = pendingNamed.get(name)
    if (!node) throw new Error(`Ismeretlen típus: ${qname}`)
    const compiled =
      localName(node.name) === 'complexType' ? compileComplexType(node) : compileSimpleType(node)
    named.set(name, compiled)
    return compiled
  }

  function compileElement(node: XmlElement): Particle {
    if (localName(node.name) !== 'element') {
      throw new Error(`Támogatatlan részecske: ${node.name}`)
    }
    for (const key of node.attributes.keys()) {
      if (!['name', 'type', 'minOccurs', 'maxOccurs'].includes(key)) {
        throw new Error(`Támogatatlan elem-attribútum: ${key}`)
      }
    }
    const name = node.attributes.get('name')
    if (!name) throw new Error('Név nélküli elem')
    const typeName = node.attributes.get('type')
    const min = occurs(node.attributes.get('minOccurs'), 1)
    const max = occurs(node.attributes.get('maxOccurs'), 1)
    if (typeName) {
      if (node.children.length > 0) throw new Error(`Típus és belső definíció együtt: ${name}`)
      return { name, min, max, type: () => resolveNamed(typeName) }
    }
    const [inline, ...extra] = node.children
    if (!inline || extra.length > 0) throw new Error(`Típus nélküli elem: ${name}`)
    const inlineKind = localName(inline.name)
    let compiled: TypeDef | null = null
    const lazy = (): TypeDef => {
      if (!compiled) {
        if (inlineKind === 'complexType') compiled = compileComplexType(inline)
        else if (inlineKind === 'simpleType') compiled = compileSimpleType(inline)
        else throw new Error(`Támogatatlan belső típus: ${inlineKind}`)
      }
      return compiled
    }
    return { name, min, max, type: lazy }
  }

  const rootElements = new Map<string, Particle>()
  for (const child of schema.children) {
    const kind = localName(child.name)
    const name = child.attributes.get('name')
    if (!name) throw new Error(`Név nélküli felső szintű ${kind}`)
    if (kind === 'complexType' || kind === 'simpleType') {
      pendingNamed.set(name, child)
    } else if (kind === 'element') {
      rootElements.set(name, compileElement(child))
    } else {
      throw new Error(`Támogatatlan felső szintű szerkezet: ${kind}`)
    }
  }
  // Minden nevesített típust lefordítunk — a nem használtakat is, hogy egy
  // támogatatlan szerkezet akkor is kiderüljön, ha a minták nem érintik.
  for (const name of pendingNamed.keys()) resolveNamed(`tns:${name}`)
  for (const particle of rootElements.values()) forceCompile(particle, new Set())
  return { targetNamespace, rootElements }
}

function forceCompile(particle: Particle, seen: Set<TypeDef>): void {
  const type = particle.type()
  if (seen.has(type)) return
  seen.add(type)
  if (type.kind === 'complex') {
    for (const child of type.particles) forceCompile(child, seen)
  }
}

// ---------------------------------------------------------------------------
// Validálás
// ---------------------------------------------------------------------------

const DOUBLE_PATTERN = /^(?:[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[+-]?INF|NaN)$/
const INT_PATTERN = /^[+-]?\d+$/
const DATE_PATTERN = /^(-?\d{4,})-(\d{2})-(\d{2})(?:Z|[+-]\d{2}:\d{2})?$/

function builtinError(base: string, raw: string): string | null {
  // xs:string-nél a whitespace „preserve", a többinél „collapse".
  const value = base === 'string' ? raw : raw.trim()
  switch (base) {
    case 'string':
      return null
    case 'double':
      return DOUBLE_PATTERN.test(value) ? null : `'${value}' nem érvényes xs:double`
    case 'int': {
      if (!INT_PATTERN.test(value)) return `'${value}' nem érvényes xs:int`
      const parsed = Number(value)
      return parsed >= -2147483648 && parsed <= 2147483647
        ? null
        : `'${value}' kívül esik az xs:int tartományon`
    }
    case 'boolean':
      return ['true', 'false', '1', '0'].includes(value)
        ? null
        : `'${value}' nem érvényes xs:boolean`
    case 'date': {
      const match = DATE_PATTERN.exec(value)
      if (!match) return `'${value}' nem érvényes xs:date`
      const month = Number(match[2])
      const day = Number(match[3])
      const year = Number(match[1])
      const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
      return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth
        ? null
        : `'${value}' nem létező dátum`
    }
    case 'base64Binary':
      return /^[A-Za-z0-9+/=\s]*$/.test(value) ? null : `'${value}' nem érvényes xs:base64Binary`
    default:
      return `ismeretlen beépített típus: ${base}`
  }
}

function validateElement(
  element: XmlElement,
  particle: Particle,
  path: string,
  errors: string[],
): void {
  const type = particle.type()
  if (type.kind === 'complex') {
    if (element.text.trim() !== '') errors.push(`${path}: szöveg egy összetett típusú elemben`)
    let cursor = 0
    for (const child of type.particles) {
      let count = 0
      while (cursor < element.children.length && element.children[cursor]?.name === child.name) {
        const node = element.children[cursor]
        if (node) validateElement(node, child, `${path}/${child.name}`, errors)
        cursor += 1
        count += 1
      }
      if (count < child.min) errors.push(`${path}: hiányzó kötelező elem <${child.name}>`)
      if (count > child.max) errors.push(`${path}: <${child.name}> túl sokszor (${count})`)
    }
    for (const extra of element.children.slice(cursor)) {
      errors.push(`${path}: nem várt (vagy rossz helyen álló) elem <${extra.name}>`)
    }
    return
  }
  if (element.children.length > 0) {
    errors.push(`${path}: egyszerű típusú elemben gyerekelem áll`)
    return
  }
  const base = type.kind === 'builtin' ? type.name : type.base
  const error = builtinError(base, element.text)
  if (error) {
    errors.push(`${path}: ${error}`)
    return
  }
  if (type.kind === 'simple') {
    const value = base === 'string' ? element.text : element.text.trim()
    if (type.enumeration && !type.enumeration.includes(value)) {
      errors.push(`${path}: '${value}' nincs a felsorolásban`)
    }
    if (type.minInclusive !== null && Number(value) < type.minInclusive) {
      errors.push(`${path}: '${value}' kisebb a megengedettnél`)
    }
  }
}

function checkAttributes(
  element: XmlElement,
  isRoot: boolean,
  path: string,
  errors: string[],
): void {
  for (const key of element.attributes.keys()) {
    const allowed =
      isRoot && (key === 'xmlns' || key.startsWith('xmlns:') || key.startsWith('xsi:'))
    if (!allowed) errors.push(`${path}: nem megengedett attribútum '${key}'`)
  }
  for (const child of element.children)
    checkAttributes(child, false, `${path}/${child.name}`, errors)
}

/** A dokumentum validálása; üres tömb = érvényes. */
export function validateXml(xml: string, schema: CompiledSchema): string[] {
  let root: XmlElement
  try {
    root = parseXml(xml)
  } catch (error) {
    return [`nem jólformált XML: ${error instanceof Error ? error.message : String(error)}`]
  }
  const errors: string[] = []
  if (root.name.includes(':'))
    errors.push(`/${root.name}: előtagos elem (a séma alapértelmezett névteret vár)`)
  const particle = schema.rootElements.get(root.name)
  if (!particle) return [`/${root.name}: ismeretlen gyökérelem`]
  if ((root.attributes.get('xmlns') ?? '') !== schema.targetNamespace) {
    errors.push(`/${root.name}: a névtér nem '${schema.targetNamespace}'`)
  }
  checkAttributes(root, true, `/${root.name}`, errors)
  validateElement(root, particle, `/${root.name}`, errors)
  return errors
}
