# accessGrants backfill — hiányzó óra-kezdőpont

Egyszeri, kapus script: időkorlátos kurzussal rendelkező vevőknél pótolja a
hiányzó `users.accessGrants.grantedAt` értéket, **kizárólag** a vevő saját
paid rendelésének dátumából.

## Mikor kell

A `resolveCourseAccess` akkor tud lejáratot számolni, ha a terméken van
pozitív `accessDurationDays`, ÉS ismert a kezdőpont: paid rendelés
`createdAt` vagy `accessGrants.grantedAt`. Ha a kezdőpont hiányzik, a
hozzáférés **fail-open**: a vevő korlátlanul bent marad
(`unknown-purchase-date`).

Ilyen sor keletkezhetett, amikor a `purchases` mezőt adminból pipálták
(2026-08-16–23, azóta a mező írása zárt), vagy régi import/grant csak a
SKU-listát írta, órát nem.

## Mit NEM csinál a script

- Nem találgat dátumot. Nincs paid rendelés → a sor **kihagyva**, jelentésben
  nevesítve. Nem a mai nap, nem a fiók `createdAt`-je.
- Nem nyúl meglévő `grantedAt`-hez (idempotens).
- Nem ír `purchases`-t, rendelést, árat. A termék `priceInHUF` mezőjét nem
  olvassa.
- Korlátlan SKU-t (üres / 0 / negatív nap) kihagy: azoknak nincs órájuk.

## Használat

```bash
npm run backup:db                          # éles írás előtt kötelező
npm run backfill:access-grants             # próbafutás
OWNER_BACKFILL_CONFIRM=igen npm run backfill:access-grants
```

A kapu szándékosan ugyanaz, mint az ár-snapshot backfillé
(`OWNER_BACKFILL_CONFIRM=igen`). Próbafutásban egyetlen `users` sor sem
íródik.

Opcionális: `--max=500` a felhasználó-lapozás felső korlátja.

## A kihagyott sorok

A `nincs-paid-datum` jelentés azt jelenti: a vevőnél ott van az időkorlátos
kurzus a purchasesben, de paid rendelés nincs. Ez ajándék vagy kézi pipa.
Ilyenkor a **Kurzus ajándékozása** panel / `npm run grant:purchase` a helyes
út — az beírja a `grantedAt`-et a mostani időpontra, és az óra onnan indul.
A backfill ezt szándékosan nem teszi meg, mert a „most” kitalált kezdet
lenne a régi hozzáféréshez.

## Kilépési kód

- `0` — végigment (a kihagyások nem hibák)
- `1` — írási hiba, vagy a beolvasás a felső korlátnál csonkult
