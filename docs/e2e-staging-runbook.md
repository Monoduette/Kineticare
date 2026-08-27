# E2E-futtatási jegyzőkönyv — staging

> Futtatás előtt: a `docs/deploy-railway.md` 5. pontjának ellenőrzőlistája zöld,
> a seed lefutott, a Barion sandbox beállítva (`docs/barion-sandbox-setup.md`),
> és van külön **vevő** sandbox-fiók (a shop tulajdonosa nem fizethet a saját
> boltjában).
>
> Minden tesztnél rögzítsd: dátum, deploy-commit, tesztelő, eredmény,
> bizonyíték (screenshot / admin-URL / logrészlet).

---

## E2E-01 — Sikeres vásárlás (happy path)

1. Regisztrálj új ügyfelet a staging oldalon (valódi, általad olvasott e-mail).
2. Nyisd meg a demó-kurzust → **Megveszem** → pénztár.
3. Töltsd ki a számlázási adatokat; **mindkét** elállási-jog checkboxot pipáld
   (szövegük: „Kifejezetten kérem, hogy a digitális tartalomhoz a hozzáférés
   azonnal megkezdődjön.” + „Tudomásul veszem, hogy a teljesítés megkezdésével
   elveszítem a 14 napos elállási jogomat.”).
4. **Megrendelés és fizetés** → át kell irányítson a test.barion.com-ra.
5. Fizess a `4444 8888 8888 5559` kártyával (bármilyen jövőbeli lejárat, bármilyen CVC).
6. Visszairányítás a `/fizetes/koszonom` oldalra.

**Ha belépve vásároltál:** max. néhány mp polling után **„Köszönjük a vásárlást!”**
fejléc + „A fizetésed sikeresen megérkezett.” + rendelésszám + a kurzus
lejátszójára vivő gomb (**Kezdd el a kurzust**). Ha a termék-id nem jön a
státuszból, a gomb **Nyisd meg a kurzusaidat** a listára visz.

**Ha vendégként (belépés nélkül) vásároltál:** a státusz-API belépést kér, ezért
**nem** a „Köszönjük a vásárlást” jelenik meg. Várt cím:
**„A visszaigazolás e-mailben érkezik”**. Az elsődleges út a postaláda
(jelszó-beállító link), a Belépés másodlagos. Lásd E2E-G.

**Várható állapot (admin-ban ellenőrizendő):**

- Orders: `paid`, `consentWithdrawalWaiver = true` + időbélyeg, Barion PaymentId kitöltve
- Az ügyfél `purchases` mezője tartalmazza a terméket
- `/kurzusaim` oldalon a kurzus elérhető
- webhook-events: a callback dedup-rekordja létezik (provider=barion)

## E2E-G — Vendég vásárlás (a többségi út)

Az E2E-01 belépett vevőt mér. A pénztár szövege vendég-vásárlást is ígér
(„nem kell regisztrálni”). Ezt külön kell végigjátszani.

1. Inkognitóablak. Ne lépj be.
2. Nyisd meg a fizetős kurzust → **Megveszem a kurzust** → pénztár.
3. A vendég-úton a fizetéshez **nem** a Belépés a gomb (az a 409-es,
   már-meglévő-fiók ág). Számlázás kitöltése, elállás pipák, fizetés Barionnal.
4. `/fizetes/koszonom`: cím **„A visszaigazolás e-mailben érkezik”**. Ne legyen
   a címen „Nem látjuk, mi történt a fizetéssel”. A Belépés másodlagos,
   `returnUrl=/kurzusaim`.
5. A visszaigazoló levél:
   - új / még nincs jelszava: **Beállítom az új jelszót** → `/jelszo-visszaallitas`
     a `returnUrl`-lel a lejátszóra vagy `/kurzusaim`-ra;
   - meglévő aktivált fiók, vendégként vásárolt: **Belépés**.
6. Jelszó beállítása után **ne** jelenjen meg „Most már be tudsz lépni” + `/belepes`
   `returnUrl` nélkül. Várt: „Új jelszó beállítva” + **Nyisd meg a kurzusaidat**
   vagy **Kezdd el a kurzust**. Külön belépés nem kell.
7. A fejlécben megjelenik a **Kurzusaim**. A kártya a `/kurzusaim/{id}` lejátszóra
   visz, nem a Bunny oldalára.

**SKIP**, ha a staging e-mail noop (nincs Resend/SMTP): a hozzáférés ettől még
létrejön; a vendég-út levél nélkül zsákutca. Ezt a jegyzőkönyvben jelezd.

## E2E-F — Ingyenes kurzus (három ág)

Feltétel: van ingyenes, közzétett kurzus (`priceInHUFEnabled: false`, pl. SOS
Kézrelax). Az űrlap a kurzusoldalon van, nem a Barionon.

1. **Új e-mail, kijelentkezve.** Küldés után a HTTP `{ ok: true }` (anti-enum).
   A képernyő: **„Nézd meg a postaládád”**. A levél jelszó-linkkel a lejátszóra
   visz. Utána Kurzusaim.
2. **Már belépett, aktivált vevő, saját e-mail.** A kurzus ráíródik a fiókra.
   A képernyő: **„A kurzusod megvan”** + **Kezdd el a kurzust**. Nem ígér
   postaládát.
3. **Már aktivált idegen fiók, kijelentkezve.** Nincs grant. Levél: lépj be,
   majd kérd újra belépve. A nyilvános HTTP ettől még `{ ok: true }`. A
   képernyő vendégnél a postaládát ígéri (anti-enum); a levél szövege az igazság.

Staff saját magának: `next: 'blocked'`, **„Ezzel a fiókkal nem adható hozzá a
kurzus”**.

## E2E-E — Szerkesztői hibák a lejátszóban

Adminban, egy teszt-kurzuson (ne éles vevő tananyagán):

| Beállítás                                         | Amit a vevő lát                                                          |
| ------------------------------------------------- | ------------------------------------------------------------------------ |
| Videó állapota: Feldolgozás alatt (GUID megvan)   | „Hamarosan elérhető”, nem indul, a haladásba nem számít                  |
| Video ID üres, állapot Kész                       | „Hamarosan” / nem játszható; a csukott admin-soron **még nem játszható** |
| Hossz (másodperc) üres, GUID + Kész               | A lejátszás **elindul**; a jegy 24 órás. Ne 503.                         |
| Publikus tár GUID-ja védett leckébe               | A jegy a védett kulccsal készül, a videó némán nem indul                 |
| Védett GUID a Bemutató videó azonosítójába        | A nyilvános oldal jegy nélkül kéri, fekete lejátszó                      |
| Egyetlen új modul egy leckével a régi Videók fölé | A régi lista elrejtődik. Átemelés csak `npm run kurzus:videok-modulba`   |

Nem-vevő: `/kurzusaim/{id}` 403, a GUID nincs az RSC-payloadban. Lásd E2E-03.

Hiányzó Bunny env: 503, „A videólejátszás ideiglenesen nem érhető el”; az app
ettől még fut. A Videótár panel env nélkül „nem tölthető be”.

## E2E-03 — Paywall: illetéktelen hozzáférés 403

> Feltétel: a kurzushoz tartozik Bunny-videó (`BUNNY_STREAM_TOKEN_AUTH_KEY` +
> `NEXT_PUBLIC_BUNNY_STREAM_LIBRARY_ID` beállítva, demó-epizód feltöltve).
> Ha még nincs videó, ez a teszt SKIP — jelöld így is.

1. Lépj ki / használj inkognitóablakot.
2. Kérd le bejelentkezett, NEM vásárló felhasználóként a videó-token endpointot
   (a Kurzusaim oldalról másolt URL) → **403**.
3. Nem-vásárló accounttal a lejátszóoldal nem jeleníti meg az epizódot.

**Várható:** 403 / hozzáférés-megtagadó UI, token sosem szervernélküli kliensből.

## E2E-05 — Refund (visszatérítés)

1. E2E-01-gyel készíts egy `paid` rendelést.
2. Admin → Orders → a rendelés → Refund (teljes összeg).
3. Barion sandbox felületen is ellenőrizd: a tranzakció visszatérítve.

**Várható állapot:**

- Orders: `refunded`
- Az ügyfél `purchases` listájából a termék kikerül → `/kurzusaim` már nem mutatja,
  a paywall ismét zár (403)

## E2E-10 — Idempotencia (dupla callback)

1. E2E-01 happy path után a Barion sandboxból küldd újra ugyanazt a callbacket
   (vagy játszd le újra a fizetés-visszaigazolást ugyanazzal a PaymentId-vel).

**Várható állapot:**

- A második callbackre `{duplicate: true}` jellegű 200 válasz, hiba nélkül
- Az ügyfél `purchases` listájában **továbbra is 1 db** termék
- Orders státusz nem változik, nem jön létre új esemény

## E2E-12 — Késleltetett callback (polling-út)

1. Fizess tesztkártyával, de a thank-you oldalon figyeld a pollingot: ha a
   callback késik, 2 perc után **„A fizetésed feldolgozása folyamatban…”**
   állapot + „e-mailben értesítünk” szöveg.
2. Amikor a callback megérkezik (retry-ladder: 2/6/18/54/102 mp), az admin-ban
   `paid` lesz; az oldal frissítésével a siker-állapot is megjelenik.

**Várható:** sosem `payment_failed` tévesen; a rendszer a v4 GetPaymentState
alapján dönt, nem a callback payload alapján.

---

## Sikertelenség-kezelő kártyatesztek (kiegészítő)

| Kártya                | Várható UI                    | Orders státusz   |
| --------------------- | ----------------------------- | ---------------- |
| `4444 8888 8888 4446` | fizetési hiba, újrapróbálható | `payment_failed` |
| `4444 8888 8888 9999` | fedezethiány                  | `payment_failed` |
| `4444 8888 8888 1111` | elutasítva                    | `payment_failed` |

## Lezárás

Ha az 5 fő fizetési teszt **és** az E2E-G / E2E-F / E2E-E zöld: a staging
lánc a Bunnytól a lejátszóig **elfogadott**. SKIP-elt lépést (nincs videó,
nincs e-mail provider, staging host 404) a jegyzőkönyvben nevezd meg, ne
jelöld késznek. A jegyzőkönyvet (screenshotokkal) archiváld a `docs/` alá
vagy a projekt-tárolóba.
