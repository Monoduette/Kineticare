/**
 * vitest-konfiguráció.
 *
 * Az oxc.jsx.runtime: 'automatic' azért kell, mert a React 19 automatikus
 * JSX-runtime-ját használó komponensek (a content- és lexical-komponensek)
 * renderToStaticMarkup-pel tesztelhetők legyenek külön @jsxImportSource
 * pragma nélkül. A Vite 8 rolldown/oxc-alapú, ezért a korábbi esbuild-opció
 * helyett az oxc-transzformer konfigurálandó. A meglévő teszteket nem bontja.
 */
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  oxc: {
    jsx: { runtime: 'automatic' },
  },
  resolve: {
    alias: {
      // A tsconfig paths '@/*' → './src/*' megfelelője — az '@/lib/...'
      // importok a tesztekben is feloldódjanak.
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'handover/**/*.test.ts'],
    environment: 'node',
  },
})
