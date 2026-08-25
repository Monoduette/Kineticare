import { createRequire } from 'node:module'

// Az eslint-config-next 16 már NATÍV flat-config tömböket exportál (a 15-ös
// eslintrc-alak megszűnt), ezért a korábbi FlatCompat + compat.extends() út
// itt eltörne (a @eslint/eslintrc validátora körkörös plugin-objektumon
// TypeError-ral omlik össze). A configokat közvetlenül importáljuk; a csomag
// CJS-ben publikálja őket, ezért createRequire kell.
const require = createRequire(import.meta.url)
const nextCoreWebVitals = require('eslint-config-next/core-web-vitals')
const nextTypescript = require('eslint-config-next/typescript')

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    // A `.claude/**` az ügynök-worktree-ké: a repó teljes másolatát tartalmazza,
    // lintelve minden találat duplán jelenne meg.
    ignores: [
      'node_modules/**',
      '.next/**',
      'dist/**',
      'coverage/**',
      '.claude/**',
    ],
  },
  // A migrációs fájlokat a Payload migrációs eszköze generálja, és a 3. tilos
  // zóna szerint kézzel nem szerkeszthetők. A generált up/down szignatúrák
  // `payload` és `req` paramétere üres migrációkban használatlan marad, ezért
  // itt kivesszük őket a no-unused-vars ellenőrzés alól — a valós figyelmeztetések
  // (pl. nem használt lokális változó) továbbra is megmaradnak.
  {
    files: ['src/migrations/**'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^(payload|req)$' }],
    },
  },
  // A react-hooks 7 (az eslint-config-next 16 tranzitív majorja) öt jelzését a
  // 2026-08-07-i javító PR rendezte; az ÁTMENETI, repó-szintű warn-leminősítés
  // ezért megszűnt — mindkét szabály (set-state-in-effect, immutability) újra a
  // recommended szintjén (error, illetve warn) fut mindenhol.
  //
  // EGYETLEN kivétel maradt, szűken erre a fájlra:
  //   src/components/account/CoursePlayer.tsx — a mountkori automatikus
  //   videóindítás (`useEffect` → `loadVideo(0)`).
  // Ez a jelzés a `react-hooks/immutability` javítása UTÁN bukkant elő: amíg a
  // `loadVideo` önhivatkozása hibás volt, a szabály nem elemezte át a hívást.
  // Nem a listázott öt hely egyike. A szabály minden olyan szinkron hívást
  // megjelöl az effekt-törzsben, amely tranzitíven setState-et tartalmaz — a
  // feltételes ágaktól függetlenül —, ezért csak a lejátszó kezdőállapotának
  // és betöltő-függvényének átszabásával lenne elnémítható. Az a refaktor
  // megváltoztatná a szerver-oldali kimenetet (üres stage helyett „A videó
  // betöltése…"), és a fizetős tartalom lejátszóját érinti, amelyre nincs
  // komponens-teszt — ezért külön, felülvizsgált lépés. Addig warn: látszik,
  // de nem tör CI-t.
  {
    files: ['src/components/account/CoursePlayer.tsx'],
    rules: {
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
]

export default eslintConfig
