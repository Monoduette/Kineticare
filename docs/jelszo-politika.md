# Jelszópolitika (password policy)

OWASP A07 (Identification and Authentication Failures) keményítés: erős
jelszó-szabályok kikényszerítése szerveroldalon.

## Szabályok

A politika a `src/lib/security/password-policy.ts` fájlban él, tiszta,
framework-független függvényként (`validatePasswordStrength`), magyar
hibaüzenetekkel:

| Szabály | Hibaüzenet |
| --- | --- |
| Legalább 12 karakter (Unicode kódpontban mérve) | „A jelszónak legalább 12 karakter hosszúnak kell lennie.” |
| Legalább egy kisbetű (ékezetes is jó) | „A jelszónak tartalmaznia kell legalább egy kisbetűt.” |
| Legalább egy nagybetű (ékezetes is jó) | „A jelszónak tartalmaznia kell legalább egy nagybetűt.” |
| Legalább egy szám | „A jelszónak tartalmaznia kell legalább egy számot.” |
| Nem tartalmazhatja az e-mail-cím local-partját (a `@` előtti rész, kis-/nagybetű-érzéketlenül, min. 3 karakteres local-part esetén) | „A jelszó nem tartalmazhatja az e-mail-címedet.” |

## Hol érvényesül?

A politikának **két** szerveroldali érvényesítési pontja van. Együtt a jelszó
minden beállítási útvonalát lefedik.

### 1. Users collection `beforeChange` hook

A `src/collections/Users.ts` collection **`beforeChange` hookja** hívja meg,
akkor is csak akkor, ha a mentendő adat tartalmaz `password` mezőt (új jelszó
beállítása vagy módosítása). Így lefedi:

- a nyilvános regisztrációt (`POST /api/users`),
- a profil jelszómódosítását (`PATCH /api/users/:id`),
- az adminfelületen történő jelszóadást.

Hiba esetén a hook `APIError`-t dob (HTTP 400) az összefűzött magyar
hibaüzenetekkel, így a felhasználó az űrlapon azonnal látja, mit kell
javítania.

### 2. Saját `POST /api/users/reset-password` végpont (C1)

A Payload 3.86 `resetPasswordOperation`-je **nem megy át a `beforeChange`
láncon**: maga hívja a `generatePasswordSaltHash`-t, és a már hash-elt rekordot
írja ki `payload.db.updateOne`-nal (a collection-hookok közül csak a
`beforeValidate` fut, az pedig már a hash-t látja). Emiatt a
jelszó-visszaállítás ágán a politika korábban megkerülhető volt: a végpont
közvetlen hívásával tetszőlegesen gyenge jelszó volt beállítható.

A rést a `src/lib/security/reset-password-route.ts` handlere zárja be, amelyet
a `src/app/(frontend)/api/users/reset-password/route.ts` köt be. A handler
**ugyanazt az útvonalat foglalja el**, amit eddig a Payload REST catch-all
(`src/app/(payload)/api/[...slug]/route.ts`) szolgált ki: a Next.js a konkrét
szegmenst statikus útvonalként veszi fel, a `[...slug]` pedig dinamikus, és a
statikus mindig előbb illeszkedik. Ezért `/api/users/reset-password`-re minden
kérés a saját handleren megy át — a nyilvános űrlapé, az admin
`/admin/reset/<token>` oldaláé és a kliens megkerülésével indított hívás is.
Nincs olyan út, amelyik a politika mellett elmenne. (Ellenőrizhető a build
`routes-manifest.json`-jában: a végpont a `staticRoutes`, az `/api/[...slug]` a
`dynamicRoutes` listán van.)

A handler lépései:

1. IP-alapú kérés-korlát (`password-reset` osztály, `src/lib/security/rate-limit.ts`);
2. törzs-beolvasás a kérés **klónjából** — az eredeti kérés törzse így
   érintetlen marad a továbbadáshoz. Két formátumot ért, ahogy a Payload
   `addDataAndFileToRequest` segédlete is: a nyilvános űrlap `application/json`
   törzsét, és az admin oldal `multipart/form-data` küldeményét, amelyben a
   `@payloadcms/ui` Form komponense `_payload` néven csomagolja a JSON-t;
3. a tokenhez tartozó e-mail-cím feloldása (best-effort, a
   `resetPasswordOperation` szűrőfeltételét tükrözve) — ez kell a politika
   „a jelszó ne tartalmazza az e-mail-címedet" szabályához;
4. `validatePasswordStrength` — sértés esetén HTTP 400, Payload REST alakú
   (`{ errors: [{ message }] }`) magyar hibaüzenettel;
5. siker esetén a kérés **változatlan továbbadása** a Payload beépített
   végpontjának: a token ellenőrzése, a hash-elés, a session-süti kiállítása és
   a válaszformátum végig a Payload dolga marad.

A tokent és a jelszót a handler sosem naplózza; a politika-sértésről csak a
sértések száma kerül a strukturált naplóba (`src/lib/logger.ts`, requestId-vel).

**Megmaradó, tudatosan vállalt korlát:** ha az e-mail feloldása nem sikerül
(adatbázis-hiba, illetve lejárt vagy ismeretlen token), a hossz- és
komplexitási szabályok akkor is érvényesülnek, csak az e-mail-szabály marad ki
— a token sorsáról ilyenkor úgyis a Payload dönt.

## Miért hook — és miért route-handler a reset-ágon?

A Payload 3.86 auth-konfigurációja nem ismeri a `passwordMinLength` vagy
hasonló natív beállítást, ezért a szabályokat kódból kell érvényesíteni.

A create/update műveleteknél a `beforeChange` a megfelelő pont: ott a
jelszó-hash-elés a collection-hookok **után** történik, tehát a hook még a nyers
jelszót látja, és a mentés előtt megakadályozhatja a gyenge jelszó
perzisztálását.

A reset-ág azért nem oldható meg hookkal, mert ott ez a sorrend nem áll fenn
(lásd feljebb). Route-handler lett belőle — nem Payload collection-endpoint —,
mert az utóbbi a Users kollekció konfigurációját módosítaná (annak
access-szabályai és auth-hookjai mellett), és a beépített auth-végponttal való
ütközés feloldása a Payload belső regisztrációs sorrendjén múlna. A
route-réteg viszont a repóban már bevált minta
(`src/lib/checkout/route-handler.ts`, `src/lib/grant-purchase-route.ts`):
függőség-injekcióval egységtesztelhető, és a Users kollekcióhoz hozzá sem nyúl.

## Hogyan bővíthető?

1. Új szabály felvétele a `validatePasswordStrength` függvénybe
   (`src/lib/security/password-policy.ts`), a magyar hibaüzenettel együtt —
   pl. szótári szavak szűrése, ismétlődő karakterek korlátozása, kiszivárgott
   jelszó-lista (haveibeenpwned) ellenőrzés.
2. A hozzá tartozó unit-teszt felvétele a
   `src/__tests__/security/password-policy.test.ts` fájlba (a függvény tiszta,
   mock nélkül tesztelhető).
3. A Users-hook, a reset-végpont és a hibaüzenet-összefűzés
   (`formatPasswordPolicyErrors`) változás nélkül működik tovább.

Ugyanezt a tiszta függvényt hívja a nyilvános visszaállító űrlap
(`src/components/auth/ResetPasswordForm.tsx`) is, hogy a felhasználó hálózati
kör nélkül pontosan azt a magyar üzenetet lássa, amit a szerver adna. Az
e-mail-szabályt a kliens nem tudja ellenőrizni (a visszaállító oldalon csak a
token van meg, a cím nem) — azt a szerver fogja meg.

## Kapcsolódó naplózás

A sikertelen bejelentkezéseket (hibás jelszó, zárolt fiók) a Users collection
`afterError` hookja naplózza strukturáltan (`src/lib/logger.ts`): e-mail-cím,
IP-cím (ha a proxy továbbítja), és az ok. Jelszó sosem kerül a naplóba — a
logger redact-listája az érzékeny kulcsokat minden környezetben maszkolja.
(A Payload 3.86-ban nincs `afterFailedLogin` hook; a REST login-hibák a
`routeError` segédleten át az `afterError` hookban landolnak.)

## Más eszközök kijelentkeztetése (J2)

Jelszó- vagy e-mail-csere után a Payload `users.sessions` tömbjéből csak a
cserét végző session marad (`req.user._sid`, resetnél a friss JWT `sid`).
A sima belépés nem nyúl a többi eszközhöz. Séma nincs; az írás
`payload.db.updateOne`, collection-hook nélkül. Részletek:
`src/lib/security/revoke-other-sessions.ts`.
