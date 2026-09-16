# Kineticare — mester-prompt (Codex / Claude)

Ezt a fájlt add a lányok agentjének: **OpenAI Codex** vagy **Anthropic
Claude** (telefonos Claude, Claude Code, Cursor).

1. Nyisd meg a repót: https://github.com/Monoduette/Kineticare
2. Másold be **első üzenetnek** a `MÁSOLD INNENTŐL` és `MÁSOLD IDÁIG`
   közötti részt.
3. A `FELADAT` blokkba írd a konkrét kérést, vagy hagyd ott, és a
   következő üzenetben add meg.

A kanonikus példány: `docs/claude-indito-prompt.md`.
Küldhető másolat: `handover/claude-indito-prompt.md`.
A két fájl bitazonos. Ha az egyiket módosítod, másold a másikba.

---

## MÁSOLD INNENTŐL

Szia. Ettől a perctől a **Kineticare** repón dolgozol.

Repo: https://github.com/Monoduette/Kineticare

Nyisd meg ezt a GitHub-repót, járjad be a fájlokat a lent megadott
sorrendben, és **tanuld meg** a projektet, mielőtt bármit írnál vagy
„javítanál”. Nem találgatsz. A bizonyíték a kód és a tesztek, nem a
memóriád, nem egy screenshot, nem egy régi kampányjegyzet.

### Mi a Kineticare

Magyar kézrehabilitációs **kurzusbolt**: webshop + Payload CMS + védett
videó. A vevő Barionnal fizet, Számlázz.hu-n kap számlát, a megvett
kurzust Bunny tokennel nézi.

Tulajdonos: Barna Norbert. A tartalom és az orvosi állítás gazdái:
Kocsis Kata és Kiss Kata. Gyakran **kisebb** munkát kérnek: új oldal,
szövegcsere, szekció, kép, menü, cikk.

Élő bolt: Railway `Kineticare` appservice. A `kineticare.hu` domain-
átállás külön doksi. DNS-hez és `.env*`-hoz kérés nélkül ne nyúlj.

Stack, amit ismerned kell (pinned): Next.js 16.3.3 App Router, React
19.2.8, Payload CMS 3.88.0, `@payloadcms/plugin-ecommerce` 3.88.0
(béta), PostgreSQL, Node 24.20.0. A `@payloadcms/*` verzió pontos,
`^` tilos.

### Mi a dolgod ebben a repóban

Te a következő agent vagy: Codex vagy Claude. A feladatod:

1. **Tanuld meg** a repót a sorrend szerint.
2. **Csak a FELADATOT** csináld meg, a lehető legkisebb, biztonságos
   változtatással. Ne bővítsd a kört.
3. **Tartalom** (szöveg, oldal, cikk, kezdőlap-sáv, menü, kép, vélemény,
   tananyag-szöveg): Payload admin (`/admin`) +
   `docs/szerkesztoi-utmutato.md`. Ne a `HomeView` kódjához nyúlj, ha
   a CMS viszi.
4. **Kód / felület / viselkedés:** `docs/ugynok-kezikonyv.md`
   „Hol kezdj, ha X” és „Hol szerkeszd”. Felület előtt kötelező skill.
5. **Ha bizonytalan vagy:** állj meg, írd meg mit nem tudsz, kérdezz.
   Ne találj ki orvosi szöveget, árat, Ads-t, fizetési „javítást”.

Felhasználónak szóló szöveg **magyarul**, natív, nem AI-ízű.

### Mit tanulj meg (kötelező)

Mielőtt a FELADATOT nyúlnád, ezeket értened kell:

- Ez kurzusbolt, nem általános CMS-sablon.
- A fizetés saját Barion-állapotgép, nem a plugin `confirmOrder`.
- Három hozzáférés-igazság: rendelés ≠ purchases-pipa ≠ accessGrants óra.
- A storefront API a `(frontend)/api` alatt van.
- Tartalmat az adminból viszik; a kód a szerkezet.
- Mik a tilos zónák (lent). Ezeket megsérteni tilos, megkerülni is.

### Tanulási sorrend — járjad be, ne ugord át

Olvasd el **ebben a sorrendben**. A 1–6. mindig kötelező. A 7–9. akkor,
ha a FELADAT ahhoz a tartományhoz nyúl.

1. https://github.com/Monoduette/Kineticare — a repo gyökere, `README.md`.
2. `handover/README.md` — az átadási csomag, mit ne csinálj.
3. `docs/ugynok-kezikonyv.md` **0–4. szakasz** (másolat:
   `handover/ugynok-kezikonyv.md`; a kettő bitazonos). Ez a hol-mi-van
   térkép: termék, tilos zónák, mentális modell, hogyan dolgozz.
4. `CLAUDE.md` — mérvadó szabálykönyv. Ellentmondásnál ez nyer.
5. `AGENTS.md` — rövid szabály, parancsok, tilos zónák.
6. `docs/szerkesztoi-utmutato.md` — admin: mit kattints, mihez ne nyúlj.
7. Cikk / CTA / Ads-zár: `docs/agent-feature-map.md`.
8. Felületi munka előtt: `docs/ertekesitesi-ux-skill.md` **és**
   `.claude/skills/termektervezes/SKILL.md`. Memóriából UI tilos.
9. A FELADAT szerinti fejezet a kézikönyv 5. szakaszától, plusz a
   `docs/` egy-témás doksija.

Amíg az 1–6. nincs meg, ne írj kódot és ne „javíts” semmit.

### Tilos — kivétel nélkül

- `confirmOrder` hívás, import, re-export, „javítás”. A jóváhagyás
  GetPaymentState v4 + saját állapotgép. A saját adapter szándékosan dob.
- Titok, jelszó, POSKey, token a repóba. A `.env*` fájlokat **ne
  olvasd, ne módosítsd, ne másold** (kommentet se). Új kulcsot az
  `.env.example`-ben érték nélkül jelezz, magad ne írj értéket.
- Kézi adatbázis-migráció: meglévő `src/migrations/*.ts` szerkesztése,
  törlése, sorrend-csere tilos.
- Access-szabály (`src/access/`, collection/field `access`, auth-hook)
  csak emberi jóváhagyással.
- Pinned `@payloadcms/*` emelés vagy `^` séma. Lockfile-t ne generáld újra.
- `users.purchases` / `accessGrants` admin-pipa. Ajándék: **Kurzus
  ajándékozása** panel / `grantPurchase`.
- Rendelés, kosár, tranzakció, számla mező kézi átírása.
- GraphQL visszakapcsolása.
- `Kineticare-demo` deploy. A régi kötet nélküli `Postgres` békén hagyandó.
- Ads Enable / spend, orvosi állítás Kata nélkül.
- Tesztből valódi Barion / Számlázz.hu hívás.
- `any` típus. `console.log` helyett `src/lib/logger.ts`.

Ha a FELADAT ilyet kér: **utasítsd vissza**, és kérj emberi
felülvizsgálatot. Ne kerüld meg.

### Amit rögtön tudnod kell

- Három igazság: `orders` (pénz/számla) ≠ `users.purchases` (SKU-halmaz)
  ≠ `users.accessGrants` (az óra kezdőpontja).
- Storefront API: `src/app/(frontend)/api/`, nem `src/app/api/`.
- Két státusz: Payload `_status` (Piszkozat/Közzététel) és a saját
  `status` (ezt nézi a bolt). Hook tartja egyben.
- Ingyenes kurzus csak `priceInHUFEnabled === false`. Üres/NULL ár ≠
  ingyenes.
- Két kanonikus kurzus-slug: `/kurzusok/otthoni-kezrehab-program` és
  `/kurzusok/sos-kezrelax-villamkurzus`.
- Kezdőlap = Oldalak között a `kezdolap` slug, **Szekciók**. Meglévő
  szekciósorát seeddel ne írd felül. Új oldal nem kerül magától a menübe.
- Élő tartalom slugját ne írd át. Törlés helyett rejts vagy vond vissza
  a közzétételt.

### Tartalmi kérés (a tipikus munka)

1. Olvasd a `docs/szerkesztoi-utmutato.md` vonatkozó pontját.
2. A változtatás helye a Payload admin, hacsak a kézikönyv mást nem mond.
3. Közzététel / piszkozat / előnézet: a szerkesztői útmutató 3. pontja.

### Kódos / felületi kérés

- Branch: `feat/…` vagy `fix/…`, kisbetű, ékezet nélkül.
- TypeScript strict.
- Új viselkedéshez fókuszált teszt. CI: `npm run typecheck`, `test`,
  `lint`.
- Felület: legalább két külső forrás (NN/g, Baymard, GOV.UK, WCAG 2.2
  sikerkritérium-számmal), mért kontraszt / érintőcél / reflow.
  Gombfelirat: `docs/ui-sztenderdek.md` §3.2 → `cta-vocabulary.ts`.

### Mielőtt a FELADATOT nyúlnád

Írj egy rövid, magyar ellenőrzőlistát (max. 15 sor):

- mit értettél a termékről,
- melyik fájlokat olvastad a sorrendből,
- a FELADAT szerint hova nyúlsz és hova **nem**,
- van-e tilos zóna a kérésben.

### FELADAT

[Ide írd a konkrét kérést.]

Ha ez a blokk üres, várd meg a következő üzenetet. Addig se írj kódot,
csak tanuld meg a repót a sorrend szerint.

## MÁSOLD IDÁIG
