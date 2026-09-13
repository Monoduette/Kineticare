import { readFileSync } from 'node:fs'

import ts from 'typescript'
import { describe, expect, it } from 'vitest'

describe('source-only website creator credit', () => {
  it.each([
    ['(frontend)/layout.tsx', 'FrontendLayout'],
    ['global-not-found.tsx', 'GlobalNotFound'],
  ])('%s declares the creator without author or publisher claims', (path, componentName) => {
    const layout = ts.createSourceFile(
      path,
      readFileSync(new URL(`../app/${path}`, import.meta.url), 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    )
    const metadata = layout.statements
      .filter(ts.isVariableStatement)
      .filter((statement) =>
        statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword),
      )
      .flatMap((statement) => statement.declarationList.declarations)
      .find(
        (declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === 'metadata',
      )?.initializer

    if (!metadata || !ts.isObjectLiteralExpression(metadata)) {
      throw new Error('Expected exported metadata object')
    }

    const properties = new Map(
      metadata.properties
        .filter(ts.isPropertyAssignment)
        .map((property) => [
          ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)
            ? property.name.text
            : property.name.getText(layout),
          property.initializer,
        ]),
    )
    const creator = properties.get('creator')
    expect(creator && ts.isStringLiteral(creator) ? creator.text : undefined).toBe('Barna Norbert')
    const other = properties.get('other')
    const creatorUrl =
      other && ts.isObjectLiteralExpression(other)
        ? other.properties
            .filter(ts.isPropertyAssignment)
            .find(
              (property) =>
                ts.isStringLiteral(property.name) && property.name.text === 'creator-url',
            )?.initializer
        : undefined
    expect(creatorUrl && ts.isStringLiteral(creatorUrl) ? creatorUrl.text : undefined).toBe(
      'https://www.barnanorbert.com/',
    )
    expect(properties.has('authors')).toBe(false)
    expect(properties.has('publisher')).toBe(false)

    const component = layout.statements
      .filter(ts.isFunctionDeclaration)
      .find((declaration) => declaration.name?.text === componentName)
    expect(component).toBeDefined()
    expect(component?.getText(layout)).not.toContain('Barna Norbert')
    expect(component?.getText(layout)).not.toContain('barnanorbert.com')
  })

  it('keeps the standalone global error credit in its head, outside the body', () => {
    const source = ts.createSourceFile(
      'global-error.tsx',
      readFileSync(new URL('../app/global-error.tsx', import.meta.url), 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    )
    const elements: ts.JsxElement[] = []
    function visit(node: ts.Node) {
      if (ts.isJsxElement(node)) elements.push(node)
      ts.forEachChild(node, visit)
    }
    visit(source)

    const html = elements.find(
      (element) => element.openingElement.tagName.getText(source) === 'html',
    )
    const head = html?.children
      .filter(ts.isJsxElement)
      .find((element) => element.openingElement.tagName.getText(source) === 'head')
    const metas = head?.children
      .filter(ts.isJsxSelfClosingElement)
      .filter((element) => element.tagName.getText(source) === 'meta')
      .map((element) =>
        Object.fromEntries(
          element.attributes.properties
            .filter(ts.isJsxAttribute)
            .map((attribute) => [
              attribute.name.getText(source),
              attribute.initializer && ts.isStringLiteral(attribute.initializer)
                ? attribute.initializer.text
                : undefined,
            ]),
        ),
      )
    expect(metas).toEqual([
      { name: 'creator', content: 'Barna Norbert' },
      { name: 'creator-url', content: 'https://www.barnanorbert.com/' },
    ])
    const body = html?.children
      .filter(ts.isJsxElement)
      .find((element) => element.openingElement.tagName.getText(source) === 'body')
    expect(body).toBeDefined()
    expect(body?.getText(source)).not.toContain('Barna Norbert')
    expect(body?.getText(source)).not.toContain('barnanorbert.com')
  })
})
