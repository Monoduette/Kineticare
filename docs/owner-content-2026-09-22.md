# Tulajdonosi tartalom-javítás, 2026-09-22

A `npm run content:owner` (`src/scripts/apply-owner-content.ts`) új szabálya.
Alapból próbafutás; írni csak `OWNER_CONTENT_CONFIRM=igen` mellett ír.

## `diagnozis-tagmondat`

Tulajdonosi kérés a „Rendelői kezelések" ajtó szövegéről: „ebből a szövegből
mindenhol […] kivenném, hogy ez nem diagnózis a webről".

- Mit tesz: a `services` blokkok soraiban a PONTOSAN
  „A pontos tervet vizsgálat után állítjuk össze; ez nem diagnózis a webről."
  mondatot „A pontos tervet vizsgálat után állítjuk össze." mondatra cseréli.
  A sor többi szövege nem változik.
- Hol fut: a kezdőlap és a /rolunk szekciósorának láncában, a lánc végén.
  Élesben a mondat 2026-09-22-én csak a /rolunk „Így tudunk segíteni"
  szekciójában állt (mérve a `/api/pages` válaszán); a kezdőlap CMS-szövege
  nem tartalmazta.
- Feltétel: betűre egyező mondat. Ha a szöveg már javított: „MÁR" kihagyás.
  Ha a szerkesztő másként fogalmazott: csendes, indokolt kihagyás.
- A kód oldali tartalékszöveg (`src/lib/home-help-states.ts`) ugyanebben a
  körben kapta meg a javított mondatot.

Őr: `src/__tests__/owner-content-diagnozis.test.ts`.

## `harom-ajto-fotok` és `kocsis-cv-foto`

Tulajdonosi kérés: az új fotók „mindenhol" jelenjenek meg. A kódbeli tartalék
magától mutatja az új képet ott, ahol a CMS-ben a fotó mezője üres (a
kezdőlap és a /szolgaltatasok háromajtós sora, élesben mérve 2026-09-22-én).
A CMS-ben MENTETT régi képeket ez a két szabály cseréli.

### `harom-ajto-fotok`

- Mit tesz: a háromajtós sín (`services`, pontosan három sor, `sin`
  elrendezés vagy a kezdőlapi, sínné alakítható hármas) sorainak fotóját az
  ajtó új képére cseréli: rendelő `help-rendelo-szalag.webp`, otthoni program
  `help-otthoni-video.webp`, szakmai képzés `help-szakmai-tablet.webp`. Az
  ajtót a sor jelentése dönti el (cím, majd URL; `homeHelpDoorIndex`), nem a
  pozíciója.
- Feltétel: csak akkor cserél, ha a mai kép a régi, seed által írt kép
  (`help-zart-img-7541`, `help-nyilo-syl-9297`, `help-nyitott-syl-9260`,
  pontos törzs vagy a Payload `-N` utótagja). Üres fotó-mezőt nem tölt ki
  (csendes kihagyás, ott a tartalék már az új kép). Szerkesztői képet nem ír
  felül, és nem található rekordnál sem találgat (hangos kihagyás). Második
  futásra „MÁR" kihagyás.
- Hol fut: a kezdőlap láncának végén (élesben a sorok üresek, nincs teendő)
  és a /rolunk láncának végén (élesben a Médiatár 36/37/38. rekordja áll a
  három soron: mindhárom cserélődik).
- A képrekord: ha még nincs a Médiatárban, élesben a script hozza létre a
  `content/home-images/brand` fájlból, a kódban mért fókuszponttal
  (`focalX`/`focalY`: 50/40, 50/20, 50/15). Ugyanebből a fájlból ugyanezt a
  rekordot az induláskori seed (`ensureHomeImages`) is létrehozza, így a
  deploy után a job rendszerint már meglévő rekordot talál. A régi képek a
  Médiatárban maradnak.

### `kocsis-cv-foto`

- Mit tesz: Kocsis Kata régi közeli portréját az új CV-fotóra cseréli
  (`kocsis-kata-cv-1500.webp`, 1500×2000, 3:4, alt: „Kocsis Kata
  gyógytornász sötét blézerben, karba tett kézzel."), mindhárom helyen, ahol
  a lap mutatja:
  1. a `teamMembers` blokkban a „Kocsis Kata" nevű tag fotóján;
  2. az önéletrajz-harmonikában (`accordion`) az ő sorának kis kerek képén
     (a sor `kep` mezője);
  3. ugyanennek a sornak a lenyitott tartalmában, a Médiatár-képet hordozó
     upload-csomópontokon (a sor `tartalom` mezője, a teljes Lexical-fa).
- Miért mindhárom: élesben (/rolunk, mérve 2026-09-22) a régi kép mindhárom
  helyen áll. Ha csak a kártya cserélődne, egy lapon két különböző arc állna
  ugyanahhoz a névhez, és a kártya „Nézd meg a szakmai hátterét"
  hivatkozása épp a régi képhez vinne.
- Feltétel: csak akkor cserél, ha az adott helyen a régi oldal közeli
  portréja áll (`67b3c6e9e315f_KocsisKatakozeli`, pontos törzs vagy a
  Payload `-N` utótagja; a Médiatár 5. rekordja élesben). A harmonika-sort a
  cím azonosítja: a nevével kezdődik (a mai „Kocsis Kata szakmai
  önéletrajza" és a 2026-09-07 előtti alak is). Kiss Kata kártyája és sora
  érintetlen, akkor is, ha a régi Kocsis-portré áll náluk.
- Kihagyások: a kártyán és a sor kép-mezőjében álló más kép a szerkesztő
  döntése, ahogy a nem található rekord is: hangos kihagyás. A sor
  tartalmában álló más kép (pl. egy oklevél fotója) nem portré-hely, ezért
  csendes kihagyás; a nem található rekordra mutató tartalombeli kép viszont
  hangos. Üres mezőt nem tölt ki: a kártya üres fotója hangos, a
  harmonika-sor üres képe csendes (a sor kép nélkül is teljes). Második
  futásra minden helyen „MÁR" kihagyás.
- Hol fut: a /rolunk láncának végén, a /kapcsolat láncában a
  szakember-szekció beszúrása után (egy most beszúrt kártyát is elér), és a
  /szolgaltatasok láncának végén. Ez utóbbin élesben ma nincs
  szakemberkártya (csendes kihagyás), de a legacy-visszaépítő
  (`npm run seed:legacy`) a régi portréval építi fel a bejelentkezés
  szekcióját, így a csere ott is érvényes.
- A képrekord kezelt (manifestes) kép: ha még nincs a Médiatárban, élesben a
  script hozza létre a `public/media/team` fájlból, eredetigazolással.
- A megjelenítés: a szakemberkártya a Médiatár `md` méretét (legfeljebb
  1280 px) tölti, nem az `sm`-et (640 px). A 288 CSS px-es keret DPR 3-as
  telefonon 864 eszközpixel, a 640 px-es forrás ott 1,35-szörös nagyítás
  lett volna (mérve 2026-09-22, 390 px). Őr-teszt a
  `foto-bekotes-2026-09-22.test.tsx`-ben.

Próbafutásban egyik szabály sem hoz létre rekordot és nem ír: a naplóban a
tervezett csere és a tervezett létrehozás áll.

Őrök: `src/__tests__/owner-content-fotok.test.ts` (a két szabály és a
futtató), `src/__tests__/foto-bekotes-2026-09-22.test.tsx` (a kódbeli
bekötés, a fájlok és a vágások geometriája).
