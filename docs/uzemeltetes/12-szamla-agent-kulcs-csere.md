# 12 Számla Agent kulcs cseréje

**Mikor:** évente egyszer tervezetten, és **azonnal**, ha a kulcs
kiszivároghatott (rossz helyre másoltad, elhagyott gépen volt, volt munkatárs
látta).

**Miért fontos** (docs.szamlazz.hu, Agent, Authentication):

- „Az Agent kulcsok nem járnak le”, és „Egy fiók összes Agent kulcsa azonos
  jogosultságokkal rendelkezik”: aki a kulcsot ismeri, a cég nevében számlát
  és stornót állíthat ki, és letöltheti az összes számlát a vevők adataival.
- „A rendszer csak kisbetűs kulcsot fogad el”: nagybetűs kulccsal minden
  számla hibára fut.
- „Ha egy kulcs illetéktelen kézbe kerül, azonnal töröld”; „a törlés azonnal
  érvényes”.

## Tervezett csere

1. Olyan időpontot válassz, amikor nincs folyamatban vásárlás vagy
   visszatérítés (például kora reggel).
2. A Számlázz.hu felületén hozz létre új Agent kulcsot. Nézd meg, hogy csupa
   kisbetűs.
3. Railway → Kineticare → Variables: a `SZAMLAZZ_AGENT_KEY` értékét cseréld az
   új kulcsra (idézőjel és szóköz nélkül). A kulcsot ne küldd el senkinek, ne
   írd le máshová.
4. Mentés után a Railway újraindítja a szolgáltatást. A fejlesztővel nézd meg,
   hogy a deploy tényleg lefutott (valódi build, sikeres healthcheck).
5. A következő fizetett rendelés számláját figyeld: a rendelésen a „Számla
   állapota” „Kiállítva” legyen, és ne jöjjön `a-szamlazz-hu-konfiguracio-hibas`
   vagy számlakiállítási riasztás.
6. Ha az első számla rendben kiment, a Számlázz.hu-ban töröld a régi kulcsot.

## Kiszivárgott kulcs

1. A Számlázz.hu-ban **azonnal töröld** a kiszivárgott kulcsot, és hozz létre
   újat.
2. Folytasd a tervezett csere 3–5. lépésével. Amíg az új kulcs nincs a
   Railway-ben, a számlák nem készülnek el. A „Nincs” és „Függőben” állapotú
   számlákat a rendszer az új kulcs beállítása után ötpercenként magától újra
   sorba állítja; ami közben „Sikertelen” lett, azt kézzel kell kiállítani
   ([05](05-szamla-storno-helyesbito-kezi.md)).
3. Nézd át a Számlázz.hu-ban az utolsó napok bizonylatait: van-e olyan számla
   vagy stornó, amelyet nem a rendszer állított ki. Ha van, azonnal szólj a
   könyvelőnek és a fejlesztőnek.
4. A csere után a Figyelmet igényel blokkban és a napi összesítőben nézd meg,
   maradt-e számla nélküli fizetett rendelés.
