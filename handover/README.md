# Kineticare — átadási csomag

Ezt a mappát add oda a következő kódoló ügynöknek. Nem helyettesíti a
repó gyökerében lévő `AGENTS.md` / `CLAUDE.md` szabálykönyvet: azok
maradnak a mérvadó tilos zónák. Itt a **hol-mi-van térkép** van,
egyetlen könyvtárban, elküldhetően.

A kanonikus példányok a repóban a helyükön maradtak (mutatók + CI-őr).
Ez a mappa **másolat**. Az őrteszt (`src/__tests__/ugynok-kezikonyv.test.ts`)
bukik, ha a kézikönyv itt és a `docs/` alatt szétcsúszik.

## Mit olvass először

1. `ugynok-kezikonyv.md` — **0–4. szakasz mindig**, utána a tartomány,
   amihez nyúlsz.
2. A repó gyökerében: `CLAUDE.md` (ellentmondásnál ez nyer), `AGENTS.md`.
3. Cikk-CTA / Ads zár: `docs/agent-feature-map.md`.
4. Felületi munka előtt: `docs/ertekesitesi-ux-skill.md` +
   `.claude/skills/termektervezes/SKILL.md`.

## Mi van itt

| Fájl | Mi ez |
| --- | --- |
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
