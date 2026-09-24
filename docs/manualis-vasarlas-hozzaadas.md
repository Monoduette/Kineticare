# Kézi kurzus-hozzáférés (ajándékozás)

> **Mire való:** egy vevőnek rendelés és fizetés nélkül adunk hozzáférést
> egy kurzushoz: ajándék, jóvátétel, a régi rendszerből áthozott hozzáférés.
>
> **Elsődleges eszköz:** az admin **Kurzus ajándékozása** panelje
> (Fiókok → Felhasználók → a vevő → Kurzus ajándékozása).
> **Tartalék:** a `src/scripts/grant-purchase.ts` parancssori szkript (4. pont),
> csak fejlesztőnek.
>
> Frissítve: 2026-09-24 (a-riasztas-14, a-cms-5).

---

## 1. Soha ne használd olyan vevőnél, aki fizetett

Ha a vevő **fizetett**, de nem kapott hozzáférést, NE ajándékozz neki kurzust.
Az ajándék:

- nem hoz létre rendelést, és nem állít ki számlát, tehát a Barionnál
  beérkezett pénzről NAV-számla nem készül;
- a fizetett rendelést sem zárja le: a rendelés „Fizetésre vár” vagy
  „Lemondva” állapotban marad, a statisztika és a visszatérítés nem tud róla;
- időkorlát nélküli kurzusnál (2026-09-24-én ilyen mindkét fizetős kurzus) a panel
  elutasítja („Ehhez a kurzushoz nincs megadva, hány napig él az ajándék…”).
  Ilyenkor **ne** állíts be hozzáférés-hosszt a kurzuson csak azért, hogy az
  ajándék átmenjen: az minden meglévő vevő hozzáférését időkorlátossá tenné.

A fizetett, de hozzáférés nélküli vevő teendői:
[`docs/uzemeltetes/02-fizetett-de-nincs-hozzaferes.md`](uzemeltetes/02-fizetett-de-nincs-hozzaferes.md).

## 2. Mikor használd

- **Ajándék vagy jóvátétel:** promóciós vagy kárpótló hozzáférés, pénz nélkül.
- **Migráció:** a régi rendszerben vásárolt hozzáférés pótlása, ha a
  vevő-import (`docs/vasarlo-migracio-terv.md`) nem hozta át.

**Ne használd:**

- normál vásárláshoz (arra a pénztár és a Barion-fizetés való);
- fizetett rendelés pótlására (lásd az 1. pontot);
- ha a vevőnek még nincs fiókja: az ajándék nem hoz létre felhasználót.

## 3. Az admin panel (elsődleges út)

1. Fiókok → **Felhasználók** → nyisd meg a vevőt.
2. A **Kurzus ajándékozása** panelen válaszd ki a kurzust, és írd be az
   ajándékozás okát (kötelező, a Műveletnaplóba kerül).
3. Kattints az **Ajándékozom a kurzust** gombra, és erősítsd meg.

Mit ír be: a vevő **Megvásárolt kurzusok** listájába a kurzust, és időkorlátos
kurzusnál a hozzáférés kezdőpontját (`accessGrants`, önálló ajándék
eredettel). Az ajándék az adminban nem vonható vissza. Már meglévő kurzusnál
nem változtat semmit (idempotens).

Ha a panel hibát ír, magyarul mondja meg, mi hiányzik (nincs kiválasztott
kurzus, nincs ok, a kurzusnak nincs hozzáférés-hossza). Az utóbbinál lásd az

1. pont figyelmeztetését.

## 4. Parancssori szkript (tartalék, csak fejlesztőnek)

A panel ugyanazt a szolgáltatást hívja (`src/lib/grant-purchase.ts`), mint a
szkript. Szkriptet csak akkor futtass, ha a panel nem érhető el.

```bash
npx tsx src/scripts/grant-purchase.ts --email=<vevő-email> --product=<sku-vagy-id> [--reason=<indoklás>]
```

| Argumentum  | Kötelező | Jelentés                                                                           |
| ----------- | -------- | ---------------------------------------------------------------------------------- |
| `--email`   | igen     | A vevő regisztrált e-mail-címe (users kollekció).                                  |
| `--product` | igen     | A termék **sku**-ja vagy numerikus adatbázis-**id**-je.                            |
| `--reason`  | nem      | Indoklás; a strukturált naplóba és a Műveletnaplóba kerül. Élesben mindig add meg. |

A szkript a Payload configon át olvassa az adatbázis-kapcsolatot, és
**közvetlenül az adott környezet adatbázisát írja**. Élesben csak jóváhagyott
esetben, `--reason` megadásával futtasd, előtte `npm run backup:db`.

Viselkedése a panelével azonos: idempotens (már meglévő kurzusnál „Már
megvan…” és 0-s kilépési kód), a meglévő hozzáféréseket megőrzi, időkorlát
nélküli kurzusnál új ajándékot nem ír (`duration-required`).

## 5. Hibakódok (szkript)

| Kilépési kód | Jelentés                                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `0`          | Siker: a hozzáférés beírásra került **vagy** már megvolt.                                                                 |
| `1`          | Hiba: hiányzó vagy hibás argumentum, ismeretlen e-mail vagy termék, hozzáférés-hossz nélküli kurzus, vagy adatbázis-hiba. |

Tipikus hibák:

- `a --email és a --product argumentum kötelező` → hiányzó argumentum;
- `Nincs ilyen felhasználó: …` → az e-mail nem regisztrált;
- `Nincs ilyen termék (sku: …)` / `(id: …)` → elgépelt sku vagy rossz id.
