# Jegyzőkönyv — kritikus utak logikai és regressziós vizsgálata (2026-08-22)

> **Kinek szól:** tulajdonos, reviewer, a következő javító kör (Sol orkesztrátor,
> Grok 4.6 thinking csapat — lásd `CLAUDE.md` Munkamodell, 2026-08-22).
> **Önálló dokumentum.** A kódot ez a kör nem módosította.
> **Célfa:** `origin/main` HEAD `f1dce1d` (Payload 3.88.0). A fán lévő
> `9e55a0b` csak `AGENTS.md`/`CLAUDE.md`, forrást nem érint.

## 0. Egy percben

Hat szál járta végig a fizetést, a számlát, a user/auth utat, a kurzus-
hozzáférést, a jobokat és a regressziós tesztlyukakat.

**A Barion-mag szilárd:** `paid` csak v4 `GetPaymentState`-ből, összeg/deviza-
assert, rendelés-szintű zár, `confirmOrder` runtime-hívás nincs, IDOR a
rendelésszámon nincs. A tegnapi F1–F11 őrei zöldek (231 fájl / 5096 teszt).

**A lyuk a `users.purchases` és a fiók-feloldás körül van**, nem a Barionon.
Hat kritikus / high tétel: elveszett `purchases`-írás, igazolatlan e-mailre
ülő vendég-vásárlás, nyilvános ingyenes-kurzus 7 napos reset-token owner
fiókra is, helyesbítő kísérlet-számláló rendelés-szintű, staff PATCH a számla-
állapotmezőkre, és a `paid` ág `else` (latens fail-open).

**Határozat:** ez a kör jegyzőkönyv. Javítás a következő körben, a 8. szakasz
sorrendje szerint. Access-controlt és migrációt igénylő tételek emberi
jóváhagyásra várnak.

---

## 1. Azonosítók

| Mező | Érték |
| --- | --- |
| Dátum | 2026-08-22 |
| Hatókör | Teljes production-fa, P0: fizetés, számla, user, stream/grant, jobok |
| HEAD | `f1dce1d` |
| Módszer | Hat Opus-szál (a vizsgálat a modellváltás előtt indult); kimenet a 2026-08-22-i Sol+Grok standard szerint a következő körre megy |
| Előző kör | `docs/review-2026-08-21-statisztika-bunny.md` — F1–F11 a #140-ben zárva, itt nem nyitjuk újra |
| Tilos zónák | titok, `confirmOrder`, kézi migráció, access átírás, payload bump — jelentés igen, kód nem |
| Eredmény a kódon | semmi |

Szálak: fizetés-állapotgép, számla/refund, user/auth/RBAC, stream/grant/progress,
jobok/webhook/lock, adversariális regresszió.

---

## 2. Találatok (egyeztetett lista, súlyosság szerint)

Az ismétlődő megállapításokat egy sorba vontuk.

| # | Severity | Location | Finding |
| --- | --- | --- | --- |
| K1 | CRITICAL | `apply-barion-state.ts:243`, `grant-purchase.ts:174`, `free-course-grant.ts:116`, `refund-order.ts:322` | `users.purchases` read-modify-write, vevő-szintű zár nélkül. Két párhuzamos fizetés / grant / refund elveszítheti a másik kurzust. A rendelés `paid`, a számla kimegy, a poll nem javítja. |
| K2 | CRITICAL | `Users.ts` `access.create: () => true`, nincs `auth.verify`; `resolve-order-customer.ts` | Igazolatlan e-mail + nyilvános regisztráció: idegen fiók megkapja a későbbi vendég-vásárlás hozzáférését. |
| K3 | CRITICAL | `free-course/request-access.ts` | Hitelesítés nélküli űrlap `forgotPassword`-öt hív 7 napos TTL-lel **bármely** meglévő fiókra, owner/staff is; közben `purchases`-t is ír. |
| K4 | CRITICAL | `szamlazz/corrective.ts:279` | A helyesbítő kísérlet-számláló rendelés-szintű, nem bizonylat-szintű. Átfedő részrefundnál a beküldés előtti lekérdezés kimarad → dupla helyesbítő / plafon nullázás. |
| K5 | CRITICAL | `plugins/ecommerce.ts` invoice/storno/corrective mezők | Staff `PATCH /api/orders/:id` átírhatja az `invoiceStatus` / `stornoStatus` mezőket (`admin.readOnly` ≠ API-védelem) → néma számla- vagy stornó-elnyomás. **Tilos zóna 4.** |
| K6 | HIGH | `apply-barion-state.ts:365` | A `paid` ág az `else`. Ma a unió három értékű, ezért zöld. Negyedik státusz (`payment_failed`, a saját roadmap) a paid ágra esne. Fail-open, a modul saját elve ellen. |
| W1 | WARNING | `order-poll/service.ts:307` | `payment_pending` `createdAt` ASC, 25-ös ablak. Elutasított / beragadt sorok a fejben maradnak → a mentőháló leáll. |
| W2 | WARNING | `start-checkout.ts:664` | Bejelentkezve a duplavásárlás-blokk nem látja a `customer` nélküli vendég-`payment_pending`-et → dupla terhelés. |
| W3 | WARNING | `advisory-lock.ts` + `payload.config.ts` pool | Beágyazott zár (rendelés → e-mail) + `pool.max` alap 10. ~6 egyidejű vendég-`paid` kimeríti a poolt. |
| W4 | WARNING | `start-checkout.ts:582` | Vendég 409: „már megvásároltad”, ha az **idegen** e-mailhez tartozó fiók birtokolja a kurzust. Hitelesítetlen orákulum, egészségügyi kontextus. |
| W5 | WARNING | `szamlazz/storno.ts` + `storno-issue.ts` | Minden sorba állított `storno-issue` zsákutca: az inline retryable hiba után a job a „bizonytalan állapot” ágon no-opol. |
| W6 | WARNING | `szamlazz/queue.ts:36` | Hiányzó `jobs.queue` némán `false` (stornó/helyesbítő). Az `order-paid.ts` ugyanezt riasztja. |
| W7 | WARNING | `invoice.ts` × `refund-order.ts` | Számla-POST és refund versenyezhet: `refunded` + kiállított számla, stornó nélkül. |
| W8 | WARNING | `stream/route-handler.ts:86` | Stream-token 200 `Cache-Control` nélkül; a szomszéd admin-útak `no-store`. |
| W9 | WARNING | `grant-purchase.ts:113` | E-mail-keresés nem kisbetűsít; a Payload mentéskor igen → CLI hamis „nincs ilyen user”. |
| W10 | WARNING | `grant-purchase.ts:152` | Lejárt hozzáférésnél „Már hozzáfér” — a vevő 403-at kap. |
| W11 | WARNING | `preview/route-handler.ts:91` | `Location` a `request.url`-ből (Railway belső host). Az exit-preview ezt már javította. |
| W12 | WARNING | `barion-callback/route-handler.ts` | Nincs rate limit; véletlen GUID = DB-sor + GetState. Ismert PaymentId-knek kellene korlátlanul menniük. |
| W13 | WARNING | `idempotency.ts` | `pending_repoll` kimerülés néma, a retry-job `succeeded`-ként számolja. |
| W14 | WARNING | `order-paid.ts` vendég-TTL | 30 napos aktiváló token (import-TTL) a folyamatos vendég-vásárlásra. |
| W15 | WARNING | `logger.ts` vs `audit.ts` | Logger pontos kulcsegyezés: `resetPasswordToken` / `activationUrl` / `sessions` nem redaktált (latens). |
| W16 | WARNING | `plugins/audit.ts` | `purchases` közvetlen írása auditálatlan; a grant-panel igen. |
| W17 | WARNING | `Users.ts` `logFailedLogin` | Hamisítható `x-forwarded-for` első elem; az e-mail `[REDACTED]`. |
| W18 | WARNING | `rate-limit.ts` | `/api/users/login` nincs kereten; a fiókzár DoS is. |
| W19 | WARNING | `course-progress/route-handler.ts:159` | A subject a `payload.auth()`-ból jön (helyes), de **nincs teszt**, hogy a törzs `userId`-ja nem számít. |
| W20 | WARNING | `apply-barion-state.ts:366` | `paid-not-allowed` / `cancel-not-allowed` **nulla teszt**. A guard kiiktatása után 233 teszt zöld. Refunded → paid + új számla. |

### K1 — elveszett `purchases`

Négy író olvassa a teljes tömböt és visszaírja. A zárak rendelés-szintűek
(`order-transition:order:<id>`, `refund:order:<id>`), a free-course grant a
fiók-zár **elengedése után** fut. Két kurzus, két callback, egy vevő → az
egyik kiesik. Az `order-poll` csak `payment_pending`-et néz.

**Javítás:** `withUserPurchasesLock(payload, userId, fn)`, sorrend:
rendelés → e-mail → vevő. Access-szabály nem kell. Őr-teszt: két különböző
`order.id`, ugyanaz a vevő, a második szál szándékosan régi listát kap —
a végállapot mindkét termék.

### K2 — igazolatlan e-mail

`resolveOrderCustomer` `email equals` alapján köt. Nincs `auth.verify`.
Előregisztráció idegen címre → a vendég-fizetés oda grantol. **Tilos zóna
3+4** (`auth.verify` + `_verified` mező). Szűkebb, séma nélküli fék:
csak bejelentkezett vagy `passwordSetupPending` fiókhoz kössön.

### K3 — free-course token

Meglévő owner fiókra mért: `forgotPassword` `expiration: 604800000` (7 nap),
normál forgot 1 óra. Ismétlés érvényteleníti a valódi reset-linket.
**Javítás (nincs tilos zóna):** token+grant csak új / `passwordSetupPending`
+ `customer` fiókra; a HTTP-alak marad `{ ok: true }`.

### K4 — helyesbítő számláló

`previousAttempts = (attemptsSeq === refundSeq) ? attempts : 0`. Seq=1
timeoutol, seq=2 kiáll, seq=1 jobja `previousAttempts=0` → nincs
`queryByKulsoAzon`, vak POST. **Séma:** refundSeq → attempts térkép,
Payload-generált migráció (zóna 3). Minimális fék: a lekérdezés mindig
fusson, ha a kért seq nem a rögzített.

### K5 — staff PATCH

`update: isAdmin` (staff+owner). `invoiceStatus` mezőn nincs `update: false`,
csak `admin.readOnly`. `invoiceStatus: 'issued'` → az invoice-issue örökre
no-opol, a resweep nem szedi. **Javítás:** `update: () => false` a
bizonylat-mezőkre; merge előtt emberi review.

### K6 — `paid` az `else`

Mért: `mapped: 'payment_failed'` → `{ action: 'paid', transitionedToPaid: true }`.
Egy sor: `default: throw` / `never`. Teszt: negyedik uniótag nem érheti el
a paid ágat.

---

## 3. Ami áll

- `paid` csak v4 GetState; callback-body nem bizonyíték.
- Összeg/deviza-assert konzervatív; hiányzó érték bukás.
- Callback × poll: `order-transition` zár, záron belül friss olvasás,
  `transitionedToPaid` egyszer.
- `paid → cancelled` és `cancelled|refunded|payment_failed → paid` a kódban
  tiltott — **teszt csak az első irányra van** (W20).
- Kliens-ár sosem forrás (`orderIntegrityBeforeChange`).
- Order-status IDOR nincs (`orderNumber` ∧ `customer = user.id`, 404).
- Plugin `/payments/*` üres `paymentMethods` + szűrő; adapter `confirmOrder`
  dob. Őr-teszt a 3.88 installed pluginen is stimmel.
- Stream-token: nem-vevő 403 bájtra azonos (létező / nem létező / draft);
  archived vevő játszhat, draft senki; token nincs a naplóban.
- Grant-purchase route: anon 401, customer 403, staff/owner + audit a
  változató ágon.
- Job-ütemezés: mindkét periodikus tasknak van `schedule`; a historic
  `autoRun` nélküli bug zárva.
- Webhook `(provider, externalId)` unique; STARTTLS kötelező; teszt nem hív
  Resendet; gitleaks allowlist szűk.
- F1–F11 őr-tesztek zöldek (10 fájl / 176 teszt).

---

## 4. Tesztlyukak, amelyek a HIGH-ot átengednék

1. Két `applyBarionStateTransition`, két `order.id`, egy vevő — K1.
2. `paid-not-allowed` / `cancel-not-allowed` — W20. Mutáció: 233 teszt zöld.
3. Negyedik `OrderPaymentState` → ne legyen `paid` — K6.
4. `mark-watched` törzs `userId` ignorálása — W19. Mutáció: 224 teszt zöld.
5. Corrective: `attemptsSeq=2`, job `refundSeq=1` → `queryByKulsoAzon` hívódik — K4.
6. Staff PATCH `invoiceStatus: 'issued'` → mező változatlan — K5.
7. Free-course meglévő owner: `forgotPassword` 0, HTTP-alak azonos — K3.
8. Vendég checkout idegen, kurzust birtokló e-mail → ne 409-orákulum — W4.
9. 25 rejected `payment_pending` + 1 friss Succeeded → a 26. is `paid` — W1.
10. Bejelentkezve, `customer` nélküli aktív pending ugyanarra az e-mailre → 409 — W2.

---

## 5. Tulajdonosi döntések (javítás előtt)

1. **K2:** Payload `auth.verify` (migráció + konverzió-veszteség), vagy csak
   bejelentkezett / rendszer-fiókhoz kötés?
2. **W4 / K2 rokona:** a vendég 409 „már megvetted” kényelem vs. szondázás.
   Szűkítés: customer-szűrő csak sessionből; a vendég a K5 paid-őrre essen.
3. **K5:** a staffnak kell-e bármelyik számla-mező írása hibakereséshez?
4. **K4 séma + K5 access:** egy változáskör? (ugyanaz az `orders` mezőlista)
5. **W5:** a `storno-issue` job maradjon (ma nulla haszon), vagy owner
   megerősített újraküldés?
6. **W3 / pool.max:** Railway `max_connections` × replikaszám nélkül ne
   írjunk `max`-ot.
7. **K3:** a 7 napos TTL csak új lead-fiókra, vagy meglévő vevőnek is?
8. **W10:** lejárt hozzáférés helyreállítása = új vásárlás, vagy külön
   hosszabbítás (séma)?
9. **Jelszócsere session-visszavonás** (user J2) — **eldöntve, 9.5:** a többi
   session elesik, a cserét végző megmarad.

A W3/W1/K1/K3/K6/W5/W6/W8/W9/W11/W12/W13/W14/W15/W16/W17/W18 **nem**
igényel access- vagy migrációs zónát, ha a fenti döntésektől független
részükön indulnak.

---

## 6. Javítási sorrend (következő kör)

A csapat: orkesztrátor `gpt-5.6-sol-xhigh`, megvalósítás
`cursor-grok-4.6-high-fast`. Access/migráció nélkül először:

1. **K1** vevő-zár a négy `purchases`-íróra + teszt
2. **K6 + W20** `default: throw` + `paid-not-allowed` / `cancel-not-allowed` teszt
3. **K3** free-course: token csak új/pending customer; owner/staff skip
4. **W1 + W13** poll-ablak / pending_repoll riasztás (a webhook-retry K3 mintája)
5. **W5 + W6** stornó-job őszinteség + queue riasztás
6. **W8, W9, W11, W15, W16, W19** (kis, zárt foltok)
7. **W2** bejelentkezett e-mail duplavásárlás-ellenőrzés
8. **W12** ismeretlen-GUID keret a callbacken (ismert id korlátlan)

Emberi jóváhagyás után, külön PR-ben:

9. **K5** mező `update: () => false` (zóna 4)
10. **K4** bizonylat-szintű számláló (zóna 3, generált migráció)
11. **K2** cím-igazolás vagy kötési szabály (zóna 3+4)
12. **W3** `pool.max` / zár-beágyazás a 5.6-os döntés után
13. **W4** 409-orákulum a 5.2-es döntés után

---

## 7. Tilos zóna

| Zóna | Érintve? |
| --- | --- |
| 1 titok | Nem. `.env*` olvasva nincs. |
| 2 `confirmOrder` | Nem. Runtime-hívás nincs. |
| 3 migráció | Csak javaslat: K2, K4, lastLoginAt. Fájl nem készült. |
| 4 access | Csak javaslat: K5, K2 `auth.verify`. Kód nem változott. |
| 5 payload pin | Nem. 3.88.0 maradt. |

---

## 8. Határozatok

1. A vizsgálat a `f1dce1d` fán lezárult ezzel a jegyzőkönyvvel.
2. Kódot ez a kör nem változtat.
3. A Barion-jóváhagyási magot nem bontjuk szét; a javítás a `purchases`
   írás, a fiók-feloldás, a számla-mezők és a tesztlyukak körül van.
4. A következő javító kör a 6. szakasz sorrendjét viszi, Sol orkesztrátorral
   és Grok 4.6 thinking csapattal.
5. A `feat/kurzusoldal-velemenyek` továbbra sem mergelendő.

---

## 9. Lezárás — hol zárult le melyik találat (2026-08-22, második kör)

A 0–8. szakasz a vizsgálat pillanatképe (`f1dce1d`). Ez a szakasz a kimenetel.

### 9.1 Első hullám — PR #143

K1, K3, K6, W1, W2, W5, W6, W8, W9, W11, W12, W13, W15, W16, W19, W20.
A #144 ág ezeket a commitokat magában foglalja.

### 9.2 Második hullám — PR #144 (tilos zóna nélkül)

| # | Hol | Mi lett |
| --- | --- | --- |
| K4-min | `szamlazz/corrective.ts` | A `queryByKulsoAzon` a POST előtt mindig fut. Maradék seq=1-es job seq=2 után nem küld vakon. Séma nincs. |
| W7 | `szamlazz/invoice.ts` | POST előtt statusz-újraolvasás; kiállítás után, ha `refunded`, inline stornó. Zár HTTP fölött nincs. |
| W10 | `grant-purchase.ts` + route/CLI/panel | Lejárt hozzáférés → `access-expired` (409), nem „Már hozzáfér”. Nincs ajándék paid rendelés. |
| W14 | `security/activation-token.ts`, `order-paid.ts` | Vendég-aktiváló token 7 nap, nem az import 30 napja. |
| W17 | `Users.ts` `logFailedLogin` | Trusted-hop IP (`audit.resolveClientIp`). Access-szabály érintetlen. |
| W18 | `security/rate-limit.ts` | `/api/users/login` IP- + e-mail-keret (10/10 perc). `maxLoginAttempts` megmarad. |

### 9.3 Tulajdonosi döntések (2026-08-22, „Te döntesz”)

| # | Döntés | Mit jelent |
| --- | --- | --- |
| K2 | Szűk kötés, nincs `auth.verify` / migráció | Vendég csak aktiválatlan `customer` fiókhoz köt. Aktivált vevő / staff / owner: 409 belépésre, a paid-átmenet nem grantol idegen fiókra. |
| K4 teljes | Nem | A K4-min (mindig `queryByKulsoAzon`) elég. Bizonylat-szintű térkép = generált migráció, most nincs hozadéka. |
| K5 | Mező `update` zárva | Számla / stornó / helyesbítő mezők: `denyFieldWrite`. REST/admin senkinek. Jobok `overrideAccess: true`. **Tilos zóna 4, merge előtt emberi review.** |
| W3 | Nincs `pool.max` | Railway `max_connections` × replika nélkül a cap vagy kimerít, vagy hazudik. Komment a `payload.config.ts` poolján. |
| W4 | Nincs vásárlás-orákulum | Vendégnek ugyanaz a 409, akár van kurzusuk, akár nincs. „Már megvásároltad” csak bejelentkezve. |

### 9.4 Hátra

A 26 tételből kód nincs nyitva. A 5. szakasz 9. pontja (jelszócsere session)
a 9.5-ben dőlt el.

### 9.5 Maradék döntések (2026-08-22, „eldöntendő kérdést döntsd el”)

A 5. szakaszban még nyitva hagyott, illetve a körben felmerült kérdések.
Nem megy vissza a tulajdonoshoz.

| # | Döntés | Miért |
| --- | --- | --- |
| **J2 session** | IGEN: a többi session elesik, a cserét végző megmarad | OWASP ASVS V3.3.1, Session Management Cheat Sheet, CWE-613. A Payload `resetPassword` és a PATCH eddig nem nyúlt a `users.sessions` tömbhöz. Séma nincs. |
| **W5** | A `storno-issue` job MARAD, csak kézi / explicit újrasorbaállításra | Az inline timeout után a vak retry dupla stornó. Nincs új admin-UI és nincs owner-megerősítő képernyő: az ember a Számlázz.hu-fiókban nézi meg, hogy nincs stornó, aztán indítja a taskot. |
| **K3 meglévő vevő** | A 7 napos token NEM jár aktivált fióknak | Már a #148-ban így van: csak új / `passwordSetupPending` + `customer`. Az aktivált vevő a sima, 1 órás forgot-passwordot kapja. |
| **`auth.verify`** | NEM most | A K2 szűk kötés elég; migráció + konverzió-veszteség külön kör, ha a fék nem bírja. |
| **B10 Linear** | Nincs GitHub↔Linear szinkron | A `feat/<ticket-id>-…` ágnév már illeszkedik. Külön szinkron új üzemeltetési felület, a fizetéshez nem kell. |
| **LoginForm userId** | Marad a válasz-klón | Egy kérés, az auth-kliens szerződése érintetlen. |
| **J16 termékszöveg** | Marad a Katáknak | A cikkek mellett ott a tájékozódás-mondat. A SOS Kézrelax terméklapja tartalmi tulajdon, nem auth-lyuk. |

Kód: `src/lib/security/revoke-other-sessions.ts`, Users hookok, a reset siker-panel második mondata.
