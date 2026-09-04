import { readFileSync } from 'node:fs'

import { getFromImportMap } from 'payload/shared'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'

const importMapURL = new URL('../app/(payload)/admin/importMap.js', import.meta.url)
const components = ['WebAnalyticsView', 'WebAnalyticsNavLink'] as const

function readGeneratedBindings() {
  // Parse only: importing the generated module would load real admin components.
  const source = ts.createSourceFile(
    'importMap.js',
    readFileSync(importMapURL, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  )
  const imports = new Map<string, { path: string; exportName: string }>()
  let map: ts.ObjectLiteralExpression | undefined

  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const bindings = statement.importClause?.namedBindings
      if (bindings && ts.isNamedImports(bindings)) {
        for (const binding of bindings.elements) {
          imports.set(binding.name.text, {
            path: statement.moduleSpecifier.text,
            exportName: (binding.propertyName ?? binding.name).text,
          })
        }
      }
    }

    if (
      ts.isVariableStatement(statement) &&
      statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.name.text === 'importMap') {
          if (
            map ||
            !declaration.initializer ||
            !ts.isObjectLiteralExpression(declaration.initializer)
          ) {
            throw new Error('Expected one exported importMap object literal')
          }
          map = declaration.initializer
        }
      }
    }
  }

  if (!map) throw new Error('Generated importMap export is missing')

  const entries = new Map<string, string>()
  for (const property of map.properties) {
    if (
      !ts.isPropertyAssignment(property) ||
      !ts.isStringLiteral(property.name) ||
      !ts.isIdentifier(property.initializer)
    ) {
      throw new Error('Expected generated string-keyed component bindings')
    }
    if (entries.has(property.name.text)) throw new Error('Duplicate generated component key')
    entries.set(property.name.text, property.initializer.text)
  }

  return { imports, entries }
}

describe('generated WebAnalytics import-map bindings', () => {
  it.each(components)('%s resolves through the committed binding without rendering', (name) => {
    const { imports, entries } = readGeneratedBindings()
    const key = `/components/admin/${name}#${name}`
    const identifier = entries.get(key)
    expect(identifier).toBeDefined()
    if (!identifier) throw new Error(`Missing generated binding: ${key}`)

    expect(imports.get(identifier)).toEqual({
      path: `../../../components/admin/${name}`,
      exportName: name,
    })

    const component = vi.fn(() => null)
    const symbols = new Map([[identifier, component]])
    const importMap = Object.fromEntries(
      [...entries].map(([entryKey, localName]) => [entryKey, symbols.get(localName)]),
    )

    expect(
      getFromImportMap({ importMap, PayloadComponent: key, schemaPath: 'admin.components' }),
    ).toBe(component)
    expect(component).not.toHaveBeenCalled()
  })

  it.each(components)('%s has no implicit resolver fallback when its mapping is absent', (name) => {
    expect(
      getFromImportMap({
        importMap: {},
        PayloadComponent: `/components/admin/${name}#${name}`,
        silent: true,
      }),
    ).toBeUndefined()
  })
})
