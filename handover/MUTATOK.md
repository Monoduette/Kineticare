# Hol találja meg a következő agent ezt a csomagot

A kanonikus kézikönyv: `docs/ugynok-kezikonyv.md`.
A Claude-nak bemásolható indító: `docs/claude-indito-prompt.md`.
Ez a mappa (`handover/`) a küldhető másolat.

Mutatók a repóban (ne töröld őket):

| Fájl                                  | Mit mond                                                  |
| ------------------------------------- | --------------------------------------------------------- |
| `AGENTS.md`                           | kézikönyv + `handover/` a fájl tetején és a docs-táblában |
| `CLAUDE.md`                           | ugyanez a fájl tetején                                    |
| `README.md`                           | docs-tábla: kézikönyv + átadási csomag                    |
| `docs/agent-feature-map.md`           | a zár-térkép a teljes kézikönyvre mutat                   |
| `.cursor/agents/kineticare-bugbot.md` | a Bugbot a kézikönyvet térképként említi                  |

Őr: `src/__tests__/ugynok-kezikonyv.test.ts` (másolata:
`handover/ugynok-kezikonyv.test.ts`, a vitest mindkettőt futtatja).

Ha a kézikönyvet vagy a Claude-indítót frissíted, másold újra ide is
(`docs/ugynok-kezikonyv.md` → `handover/ugynok-kezikonyv.md`,
`docs/claude-indito-prompt.md` → `handover/claude-indito-prompt.md`),
különben a CI bukik: a két pár bájtra azonos kell legyen.

Utoljára ellenőrizve: 2026-09-23.
