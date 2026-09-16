# Kineticare — átadási csomag

Ezt a mappát add oda a következő kódoló ügynöknek. Nem helyettesíti a
repó gyökerében lévő `AGENTS.md` / `CLAUDE.md` szabálykönyvet: azok
maradnak a mérvadó tilos zónák. Itt a **hol-mi-van térkép** van,
egyetlen könyvtárban, elküldhetően.

A kanonikus példányok a repóban a helyükön maradtak (mutatók + CI-őr).
Ez a mappa **másolat**. Az őrteszt (`src/__tests__/ugynok-kezikonyv.test.ts`)
bukik, ha a kézikönyv itt és a `docs/` alatt szétcsúszik.

## Mit másolj be a Claude-nak

1. `claude-indito-prompt.md` — **ezt másold be első üzenetnek**
   (a `MÁSOLD INNENTŐL` … `MÁSOLD IDÁIG` blokkot). A `FELADAT` alá
   írd a konkrét kérést.
2. Utána a Claude a prompt szerint olvasson: kézikönyv 0–4, `CLAUDE.md`,
   `AGENTS.md`, `docs/szerkesztoi-utmutato.md`.

## Mit olvass először (ha te vagy az agent)

1. `claude-indito-prompt.md` — a szereped és a tanulási sorrend.
2. `ugynok-kezikonyv.md` — **0–4. szakasz mindig**, utána a tartomány,
   amihez nyúlsz.
3. A repó gyökerében: `CLAUDE.md` (ellentmondásnál ez nyer), `AGENTS.md`.
4. Admin / tartalom: `docs/szerkesztoi-utmutato.md`.
5. Cikk-CTA / Ads zár: `docs/agent-feature-map.md`.
6. Felületi munka előtt: `docs/ertekesitesi-ux-skill.md` +
   `.claude/skills/termektervezes/SKILL.md`.

## Mi van itt

| Fájl | Mi ez |
| --- | --- |
| `claude-indito-prompt.md` | Bemásolható első üzenet a következő Claude-nak (másolat a `docs/`-ból) |
| `ugynok-kezikonyv.md` | Teljes backend + frontend kézikönyv (másolat a `docs/`-ból) |
| `ugynok-kezikonyv.test.ts` | Az őr, ami a mutatókat és a másolat egyezését védi. A repo-gyökeret felfelé keresi (`AGENTS.md`), ezért a `handover/`-ből is futtatható |
| `env-kulcsok.example` | Az ebben a körben dokumentált env-kulcsnevek, **érték nélkül** |
| `MUTATOK.md` | Hol mutat a repó erre a csomagra |

Titkot, `.env` értéket, POSKey-t ebbe a mappába se tegyél.
`.env*` fájlt ne olvass és ne másolj.

## Mit ne csinálj

- `confirmOrder` hívás / import / „javítás”
- kézi migráció-szerkesztés
- access-szabály átírás emberi review nélkül
- pinned `@payloadcms/*` emelés
- Ads Enable / spend ebből a csomagból
