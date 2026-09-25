# 01 Napi ellenőrzés

**Mikor:** minden reggel, és ha megjön a „Kineticare napi összesítő” levél.
Az első éles hetekben este is.

## Mit küld magától a rendszer

- **Napi összesítő levél** reggel 7 óra után (magyar idő), az
  `OWNER_ALERT_EMAILS` címre, **csak ha van teendő**. Benne minden szám a
  szűrt admin-listára mutat.
- **Riasztás-levél**, ha valami azonnali beavatkozást kér (lásd
  [11 Riasztás és ügyelet](11-riasztas-es-ugyelet.md)). Ugyanarra a
  riasztásra legfeljebb óránként egy levél jön.
- **Figyelmet igényel blokk** az admin Irányítópultján, csak a tulajdonosnak.
  Ugyanazokat a számokat mutatja, mint a napi összesítő, bármikor.

Ha nem jött levél, az vagy azt jelenti, hogy nincs teendő, vagy azt, hogy a
levélküldés nem működik. Ezért a blokkot akkor is nézd meg, ha nem jött levél.

## Lépések (5 perc)

1. Nyisd meg az admin **Irányítópultját**, és nézd meg a **Figyelmet igényel**
   blokkot.
   - „Most nincs teendő…”: kész, a 4. lépéssel folytasd.
   - Ha van szám, kattints rá: a szűrt lista nyílik meg.
2. Kategóriánként:

   | Sor                                         | Teendő                                                                                    |
   | ------------------------------------------- | ----------------------------------------------------------------------------------------- |
   | fizetett rendelés számla nélkül             | Ha 2 óránál régebbi: [05](05-szamla-storno-helyesbito-kezi.md) 1. pont                    |
   | függő fizetés egy óránál régebben           | Ha a vevő jelentkezett: [02](02-fizetett-de-nincs-hozzaferes.md); egy nap után mindenképp |
   | sikertelen számla, stornó vagy helyesbítő   | [05](05-szamla-storno-helyesbito-kezi.md)                                                 |
   | elakadt visszatérítés                       | [06](06-visszaterites.md) 4. pont                                                         |
   | sikertelen vagy kimerült fizetési értesítés | Vesd össze a rendelést a Barion-fiókkal: [02](02-fizetett-de-nincs-hozzaferes.md) 2. pont |

3. Ami egy napnál régebben áll a „függő fizetés” sorban, azt ne hagyd a
   következő napra: nézd meg a Barion-fiókban, sikeres-e a fizetés, és ha igen,
   szólj a fejlesztőnek (a rendszernek magától le kellett volna zárnia).
4. Nézd meg az **Alanyi adómentes keret** sort (ha van). 70% fölött:
   [14](14-alanyi-adomentes-keret.md).
5. Nézz bele a postafiókba, ahová a Barion és a Számlázz.hu értesítései jönnek
   (Barion: a bolt regisztrált címe; a Barion 5 sikertelen értesítés-kézbesítés
   után ide ír).

## Hetente egyszer

- Railway → Kineticare → Logs, szűrő: `@alert:true`. Ha a héten volt riasztás,
  amit nem értettél, írd meg a fejlesztőnek a riasztáskódot (`alertCode`).
- Nézd meg, hogy a külső figyelő (Healthchecks.io vagy a választott
  szolgáltatás) zöld-e: a job-workerek élnek.

## A „Figyelmet igényel” számai pontosan

| Sor                                       | Feltétel                                                                                   |
| ----------------------------------------- | ------------------------------------------------------------------------------------------ |
| fizetett rendelés számla nélkül           | Fizetve, a számla „Nincs” vagy „Függőben”, és a rendelés 2 óránál régebbi                  |
| függő fizetés egy óránál régebben         | Fizetésre vár, 1 óránál régebben leadva (külön számolva: egy napnál régebbi)               |
| sikertelen számla, stornó vagy helyesbítő | Bármelyik bizonylat „Sikertelen”, és a rendelés az utolsó 14 napban változott              |
| elakadt visszatérítés                     | Visszatérítési szándék nem végállapotban, 15 percnél régebben, az utolsó 14 napban érintve |
| sikertelen vagy kimerült értesítés        | Barion-értesítés „Sikertelen” vagy 5 próbálkozás után is feldolgozatlan, utolsó 14 nap     |

A 14 napos ablak oka: a rendszerben nincs „kézzel rendezve” jelölés, ezért egy
kézzel már rendezett régi ügy különben örökké a levélben maradna. Ami 14 napnál
régebben áll, azt a havi egyeztetés ([08](08-havi-egyeztetes.md)) fogja meg.
