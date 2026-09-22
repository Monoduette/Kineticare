# Tulajdonosi tartalom-javítás, 2026-09-22

A `npm run content:owner` (`src/scripts/apply-owner-content.ts`) új szabálya.
Alapból próbafutás; írni csak `OWNER_CONTENT_CONFIRM=igen` mellett ír.

## `diagnozis-tagmondat`

Tulajdonosi kérés a „Rendelői kezelések" ajtó szövegéről: „ebből a szövegből
mindenhol […] kivenném, hogy ez nem diagnózis a webről".

- Mit tesz: a `services` blokkok soraiban a PONTOSAN
  „A pontos tervet vizsgálat után állítjuk össze; ez nem diagnózis a webről."
  mondatot „A pontos tervet vizsgálat után állítjuk össze." mondatra cseréli.
  A sor többi szövege nem változik.
- Hol fut: a kezdőlap és a /rolunk szekciósorának láncában, a lánc végén.
  Élesben a mondat 2026-09-22-én csak a /rolunk „Így tudunk segíteni"
  szekciójában állt (mérve a `/api/pages` válaszán); a kezdőlap CMS-szövege
  nem tartalmazta.
- Feltétel: betűre egyező mondat. Ha a szöveg már javított: „MÁR" kihagyás.
  Ha a szerkesztő másként fogalmazott: csendes, indokolt kihagyás.
- A kód oldali tartalékszöveg (`src/lib/home-help-states.ts`) ugyanebben a
  körben kapta meg a javított mondatot.

Őr: `src/__tests__/owner-content-diagnozis.test.ts`.
