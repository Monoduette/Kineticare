# Tudástár: technikai és SEO/GEO mesterterv (B-fázis)

> **Mi ez?** A cikklista és a cikkoldal **implementációs terve**: komponensek,
> CSS, adatmodell, schema.org, GEO-réteg és őr-tesztek, olyan pontossággal,
> hogy az implementáló ügynökök vita nélkül dolgozhassanak. Kódot nem
> tartalmaz, döntéseket igen.
>
> **Viszonya az A-fázishoz:** a `docs/tudastar-ux-terv.md` a MIT és MIÉRT
> (kutatással és méréssel), ez a dokumentum a HOGYAN és KI. Ahol az A-terv
> nyitott kérdést hagyott (K1–K7), ott ez a terv dönt vagy kimondja, hogy a
> döntés a vezetőé marad (11. fejezet).
>
> **Kötelező előolvasmány az implementálónak:**
> `docs/tudastar-ux-terv.md` (a mért küszöbök), `docs/tudastar-hangnem-es-technika.md`
> (2. rész: adatút és Lexical), `docs/seo-geo-llm.md` (2. fejezet),
> `docs/orvosi-forrasbazis.md` (0. fejezet), `docs/ui-sztenderdek.md` (§3.1, §3.2),
> `CLAUDE.md` (TILOS ZÓNÁK).
>
> **Készült:** 2026-08-21 · a repó kódjának teljes felderítése után
> (minden hivatkozott fájl és sor ellenőrizve ezen a napon).

---

## 0. Döntés-összefoglaló

| # | Döntés | Hol részletezve |
|---|---|---|
| D1 | A cikkoldal strukturált adata **egy** node: `@type: ['Article', 'MedicalWebPage']`, `lastReviewed` + `reviewedBy` WebPage-tulajdonságokkal, Person-szerzővel; szerző hiányában Organization-tartalék (a mai `Person{name:'Kineticare'}` típushiba javítása). | 6.1–6.3 |
| D2 | A „Mások ezt is kérdezik" réteg **strukturált `faq` mező** a posts-on (a `products.faq` bevált mintája), látható „Gyakori kérdések" szekcióval; a `faqPageJsonLd` helper változatlanul újrahasznált. | 2.1, 3.4, 6.4 |
| D3 | **Egyetlen séma-bővítő kör** (egy generált migráció): `posts.faq`, `posts.ctaCourse`, `posts.reviewedBy`, `posts.reviewedAt`, `posts.nextReviewAt`; `users.credentials`, `users.bioShort`, `users.portrait`. Ez feloldja az A-terv K1/K2 kérdésének technikai felét. | 2. fejezet |
| D4 | Címsor-horgonyok: új tiszta modul (`src/lib/lexical-outline.ts`), a serializer **opt-in** (`headingAnchors`) kapcsolóval kapja; csak a cikkoldal kapcsolja be, így a kurzus- és jogi oldalak meglévő `id`-ivel nincs ütközés. | 4. fejezet |
| D5 | Olvasási idő: a szó-számlálás **csak text-csomópontokból** (a mai bejárás a `'ltr'`, `'text'`, `'normal'` mező-értékeket is szónak számolja); 200 szó/perc marad, forrás-kommenttel; felirat: „kb. n perc olvasás". | 4.4 |
| D6 | `PostCard`: `variant: 'list' | 'compact' | 'featured'` + `headingLevel: 'h2' | 'h3'`; a link **csak a címben** él, `::after` overlay-jel; pontosan **egy** kategória-címke; rács: `.kc-card-grid--posts`. | 3.1, 5.1 |
| D7 | Új cikkoldal-komponensek: `PostToc`, `PostFaq`, `PostAuthorBox`, `PostCourseCta`, `Breadcrumb`; a cikk-specifikus CSS új lapra (`styles/blocks/post-view.css`) kerül, a kártya/rács/morzsa a `knowledge.css`-ben marad. | 3., 5. fejezet |
| D8 | Kurzus-CTA: egy panel a törzs után; `ctaCourse`-szal „Nyisd meg a kurzusoldalt" (secondary), anélkül „Nézd meg a kurzusokat" (primary); laponként legfeljebb 1 primary, őr-teszttel; a panel és a kapcsolódó blokk távolsága tokenből mérve 56 px (küszöb: ≤ 72). | 3.5, 5.2 |
| D9 | Források: **nem** komponens, hanem Lexical-konvenció (H2 „Források" + számozott lista + mondatba ágyazott, nevesített linkek), amit a cikk-lint kényszerít ki; nyomtatásban a href kiírása a `.kc-post-body` alatt. | 3.6, 8. fejezet |
| D10 | Cikk-lint: `src/lib/tudastar-cikk-lint.ts`, seed-időben futó, végrehajtható tartalom-őr (címhossz, Források-szakasz, kvirtmínusz, h5/h6, önálló-link-bekezdés, GYIK-korlátok, tiltott ígéret-frázisok). | 8. fejezet |
| D11 | GEO-réteg: a `docs/seo-geo-llm.md` 2. fejezetének minden pontja konkrét markuphoz, mezőhöz vagy lint-szabályhoz rendelve. | 7. fejezet |
| D12 | Lista-oldal: `featuredSplit` (kiemelt kártya 4 cikktől), `shouldShowCategoryFilter` (≥ 3 kategória cikkel VAGY ≥ 5 cikk); a `/blog`-on nincs eyebrow (a H1-gyel azonos szó zaj lenne), a kategória-oldalon van („Tudástár") + látható morzsa. | 3.2, 3.3 |

---

## 1. A rendszer rétegei

```
   séma-kör (E)                 kimeneti réteg (A)            SEO-réteg (D)
   Posts.ts + Users.ts          lexical-outline.ts (ÚJ)       seo.ts: articleJsonLd v2
   + generált migráció          serialize.tsx (id-k)          (Article+MedicalWebPage,
   + payload-types regen        RichText.tsx (opt-in)          Person/Org, lastReviewed)
        │                       reading-time.ts (javítás)          │
        └──────────────┬────────────────┬──────────────────────────┘
                       ▼                ▼
        lista-csomag (B)          cikkoldal-csomag (C)
        PostCard 3 változat       PostView újraszervezve
        blog/page + kategória     PostToc · PostFaq · PostAuthorBox
        Breadcrumb (ÚJ)           PostCourseCta (ÚJ)
        knowledge.css rács        post-view.css (ÚJ)
        lib/tudastar.ts           lib/tudastar-cikk.ts (ÚJ)
                       │                │
                       └────────┬───────┘
                                ▼
                    őr-tesztek + cikk-lint (8–9. fejezet)
```

A betűjelek a 10. fejezet munkacsomagjai. A nyilak függést jelentenek: az
E-csomag (séma + típus-regenerálás) mindenki előtt fut, az A és D egymástól
független, a B és C az előzőekre épül.

---

## 2. Adatmodell-bővítés (E-csomag)

### 2.1 Miért egy körben

Az A-terv K2 kérdése a lektorálás-mezőket javasolta „külön körben". A GYIK
(D2) és a kurzus-CTA (D8) szintén mezőt igényel. Három külön migráció három
deploy-kockázat; **egy** generált migráció egyben viszi az egészet, és minden
frontend-elem eleve úgy épül, hogy üres mezőnél némán elmarad (graceful),
tehát a séma és a felület egymástól függetlenül is élesíthető.

### 2.2 Új mezők a `posts` collectionben (`src/collections/Posts.ts`)

A meglévő mezősor VÉGÉRE, a `relatedPosts` után, ebben a sorrendben:

| Mező | Típus | Kötelező | Admin-leírás (magyarul, a meglévő stílusban) |
|---|---|:--:|---|
| `faq` | array (`question` text kötelező, `answer` textarea kötelező), `maxRows: 6` | nem | „Mások ezt is kérdezik: 2–6 rövid kérdés-válasz a cikk végére. A válasz önmagában is megálljon (2–4 mondat), mert a keresők és az AI-válaszok pontosan ezt idézik." |
| `ctaCourse` | relationship → `products` | nem | „A cikk végi ajánló erre a kurzusra mutat. Üresen hagyva az ajánló a kurzuslistára visz." |
| `reviewedBy` | relationship → `users` | nem | „A gyógytornász, aki a cikk klinikai állításait a forrásokkal együtt ellenőrizte." |
| `reviewedAt` | date | nem | „Az utolsó szakmai ellenőrzés napja. Csak akkor töltsd ki, ha az ellenőrzés tényleg megtörtént." |
| `nextReviewAt` | date | nem | „A következő tervezett ellenőrzés napja (az NHS-minta szerint jellemzően 2 év)." |

A `maxRows: 6` az NHS felsorolás-plafonjának (legfeljebb 6 elem) technikai
leképezése; ugyanez a szám a cikk-lintben is él (8. fejezet).

### 2.3 Új mezők a `users` collectionben (`src/collections/Users.ts`)

| Mező | Típus | Kötelező | Mire való |
|---|---|:--:|---|
| `credentials` | text | nem | Végzettség/titulus, pl. „gyógytornász, kézterapeuta". A byline, a szerző-blokk és a `Person.jobTitle` forrása. |
| `bioShort` | textarea | nem | 1–2 mondat a szakterületről a szerző-blokkba. Csak igazolható állítás (lásd `docs/tudastar-hangnem-es-technika.md` 1.7). |
| `portrait` | upload → `media` | nem | Arckép a szerző-blokkba. Az NN/g mérése szerint a valódi portré az egyetlen kép-típus, amit az olvasók ténylegesen néznek. |

**Szigorú tilalom:** a Users-módosítás **kizárólag mező-hozzáadás** lehet.
Access-szabályhoz, auth-hookhoz, meglévő mezőhöz nyúlni tilos (`CLAUDE.md`
TILOS ZÓNA 4); a PR-leírásban külön sor igazolja, hogy a diff access-t nem
érint, és merge előtt emberi review kötelező.

### 2.4 Publikus kitettség (biztonsági jegyzet)

A `getPostBySlug` `depth: 2` + `overrideAccess: true` hívása a szerzőt TELJES
user-dokumentumként populálja. Ez ma nem szivárog, mert a `PostView`
szerver-komponens, és csak a nevet rendereli. A szabály a bővítés után is:

1. A szerző-blokk kizárólag `name`, `credentials`, `bioShort`, `portrait`
   mezőt olvashat.
2. A nyers `author`/`reviewedBy` objektum **soha nem kerülhet kliens-komponens
   propjába** (a RSC-payload azt a böngészőbe vinné). A C-csomag minden új
   komponense szerver-komponens marad.

### 2.5 Migráció

- Generálás: `./node_modules/.bin/payload migrate:create tudastar_szerzoi_reteg`, helyi
  Postgresszel (a `CLAUDE.md` 22b tanulsága szerinti `pgrun`-os indítás).
- Kézzel migrációt írni, szerkeszteni tilos (TILOS ZÓNA 3, G3/G4 őrök).
- A `src/payload-types.ts` újragenerálódik; ez az E-csomag kimenete, amire a
  C és D csomag típusai épülnek.
- Deploy: a migráció a start-parancs része
  (`./node_modules/.bin/payload migrate && exec ./node_modules/.bin/next start`),
  a deploy-logban `Migrating:`/`Migrated:` sor igazolja (14. üzemeltetési pont).

### 2.6 Amit tudatosan NEM veszünk fel

| Nem lesz | Miért |
|---|---|
| `posts.readingTime` mező | Számolt érték, mező nélkül (D5). |
| `posts.sources` strukturált mező | A források a törzs részei (D9): mondatba ágyazott linkek + záró jegyzék. Külön mező kettős igazságforrást adna, és a szerkesztő két helyen tartaná karban. |
| Lábjegyzet-csomópont a Lexicalban | A-terv K3: a nevesített inline link + záró jegyzék ugyanazt az ellenőrizhetőséget adja, új szerkesztő-feature nélkül. |
| `TableFeature` | Külön feature- és serializer-munka; a cikkek felsorolással fejezik ki a táblázatos adatot (`docs/tudastar-hangnem-es-technika.md` 2.6). Ha később kell, önálló kör. |

---

## 3. Komponens-terv

A vezérelv: **újraírás helyett újrahasználat.** Ami már létezik és jó
(`Card`, `Badge`, `Section`, `Container`, `MediaImage`, `JsonLd`,
`CategoryFilter`, `PostsEmptyState`, `AnchorScroll`, a `kc-faq` GYIK-nyelv,
a kurzusoldali morzsa-minta), azt használjuk; új komponens csak ott születik,
ahol nincs meglévő.

### 3.1 `PostCard` — MÓDOSUL (`src/components/content/PostCard.tsx`)

**Új props:**

```ts
export interface PostCardProps {
  post: Pick<Post, 'id' | 'title' | 'slug' | 'excerpt' | 'heroImage'
    | 'publishedAt' | 'categories' | 'status' | 'content'>
  /** 'list' (alap): kivonattal · 'compact': kivonat nélkül · 'featured': vízszintes kiemelt */
  variant?: 'list' | 'compact' | 'featured'
  /** A kártyacím szintje a lap címhierarchiájában. Alap: 'h2'. */
  headingLevel?: 'h2' | 'h3'
}
```

**DOM-váz (a hozzáférhető kártya-minta, A-terv 3.5):**

```
<Card as="article" class="kc-post-card [kc-post-card--compact|--featured]" interactive padded={false}>
  [<span class="kc-post-card__cover"> <MediaImage …/> </span>]     ← csak ha van heroImage (A-terv K1: tartalék lentebb)
  <span class="kc-post-card__body">
    [<span class="kc-post-card__categories"><Badge tone="info">ELSŐ kategória</Badge></span>]
    <h2|h3 class="kc-post-card__title">
      <Link class="kc-post-card__title-link" href="/blog/slug">A cikk címe</Link>
    </h2|h3>
    [<span class="kc-post-card__excerpt">…</span>]                 ← CSAK 'list' és 'featured'
    <span class="kc-post-card__foot">
      [<time …>2026. augusztus 21.</time>] · <span>kb. 6 perc olvasás</span>
      <span aria-hidden="true" class="kc-post-card__arrow">→</span>
    </span>
  </span>
</Card>
```

Pontosítások:

1. **A link csak a cím szövegét tartalmazza.** Semmilyen `aria-label` nem
   kerül rá: a hozzáférhető név magától a cím lesz (A-terv mérése: 279
   karakterről 49-re). A kattintható felület a CSS `::after` overlay (5.1).
2. **A cím címsor-elem lesz** (`h2` alap, `h3` prop-pal), nem `span` — ez a
   feltétele annak, hogy a link a címsorban éljen. A `/blog` és a
   kategória-oldal `h2`-t használ (a lap H1-e alatt), a kezdőlapi
   `KnowledgeSection` és a cikkoldali kapcsolódó blokk `h3`-at (ott a szekció
   címe a h2).
3. **Kategória-címke: pontosan egy**, a `categories[0]`. A mai
   `categoryTitles(...).map(...)` helyére egy `firstCategoryTitle` segéd lép.
4. **Olvasási idő a kártya-lábban:** `kb. {estimateReadingMinutes(post.content)}
   perc olvasás` — ehhez kell a `content` a Pick-be. A meta-sor elválasztója
   középpont (`·`) vagy külön flex-elem; kvirtmínusz tilos (§3.1.2).
5. **Borító-tartalék (A-terv K1 feloldása):** ha nincs `heroImage`, a kártya
   ugyanabban a 16:9 keretben tipográfiai tartalékot mutat: a
   `kc-post-card__cover kc-post-card__cover--text` elem a tint felületen az
   ELSŐ kategória nevét (annak hiányában a „Tudástár" szót) hozza,
   `aria-hidden="true"`-val (a név a badge-ben már ott van, kétszer nem kell
   felolvasni). Séma-változás nincs, a rács ritmusa megmarad.
6. **`featured` változat:** ugyanaz a DOM, `kc-post-card--featured` módosító
   osztállyal; a vízszintes elrendezés tisztán CSS (5.2). Csak a `/blog`
   használja, csak a legfrissebb cikkre, csak 4+ cikknél.
7. A `formatPostDate` export változatlan marad (a `home-cms.test.ts` importálja).

### 3.2 `/blog` lista — MÓDOSUL (`src/app/(frontend)/blog/page.tsx`)

Fentről lefelé (az A-terv 4.1 váza szerint):

1. H1 „Tudástár" + lead (a meglévő `LEAD` konstans `kc-page-hero__lead`
   osztállyal). **Eyebrow nincs**: az A-terv vázán az eyebrow és a H1 azonos
   szava állt, ami ismétlés; információt nem hordozó elem nem kerül fel.
   (A kategória-oldalon az eyebrow VAN, mert ott mást mond, mint a H1.)
2. `CategoryFilter` — csak ha `shouldShowCategoryFilter(...)` igaz (3.7).
3. Kiemelt kártya — `featuredSplit(posts)` (3.7): 4+ cikknél az első cikk
   `<PostCard variant="featured" headingLevel="h2" />`, alatta a maradék.
4. Rács: `<div className="kc-card-grid kc-card-grid--posts">`, benne
   `<PostCard variant="list" headingLevel="h2" />` kártyák.
5. Üres állapot: `PostsEmptyState` változatlanul.
6. `blogJsonLd` változatlanul, csak a szűretlen nézeten (a mai logika marad).

Lapozás: a szabály marad az A-terv 4.4 pontja (12 cikk felett számozott
lapozó), megvalósítása a Tudástár feltöltése utáni kör. A `getPosts` 60-as
limitje addig változatlan.

### 3.3 Kategória-oldal — MÓDOSUL (`src/app/(frontend)/blog/kategoria/[slug]/page.tsx`)

1. Látható morzsa a lap tetején: `<Breadcrumb items={[{name:'Tudástár',
   href:'/blog'}, {name: category.title}]} />` (3.8). A `breadcrumbJsonLd`
   már ma is kimegy, változatlan.
2. Eyebrow: `<p className="kc-eyebrow">Tudástár</p>`, alatta H1 a kategória
   neve, alatta a téma egymondatos leírása (a meta-description már ma is
   generál ilyet; a látható lead ugyanaz a mondat, egy helyen definiálva).
3. Rács: `.kc-card-grid--posts`, kiemelt kártya NÉLKÜL (A-terv 2.3).
4. `CategoryFilter` ide továbbra sem kerül (a mai állapot); a szűrt nézetek
   közti váltás útja a `/blog` chip-sora.

### 3.4 `PostFaq` — ÚJ (`src/components/content/PostFaq.tsx`)

A `FaqBlock` (`src/components/blocks/FaqBlock.tsx`) mintájának cikkoldali,
szűk-konténeres párja. **Nem** a `FaqBlock` újrahívása, mert az Section-t
renderel blokk-beállításokkal; itt a szekció a cikk törzsének része.

```ts
export interface PostFaqProps {
  items: ReadonlyArray<{ question: string; answer: string }>
  /** A címsor horgonyához és a nav-hoz. Fix: 'gyakori-kerdesek'. */
  headingId?: string
}
```

- Render: `<section aria-labelledby>` + `<h2 id="gyakori-kerdesek">Gyakori
  kérdések</h2>` + `details/summary` tételek a **meglévő** `kc-faq__item`,
  `kc-faq__question`, `kc-faq__answer` osztályokkal és a
  `styles/blocks/faq.css` importjával. Új CSS nem készül.
- A komponens maga rendereli a `<JsonLd data={faqPageJsonLd(items)} />`
  blokkot (a `FaqBlock` pontos precedense): így a látható lista és a séma
  fizikailag nem tud szétcsúszni.
- Hiányos tétel (üres kérdés vagy válasz) kiszűrve mindkettőből; nulla
  érvényes tételnél a komponens `null`.
- A címke „Gyakori kérdések" — azonos a kezdőlapi és a kurzusoldali
  szekcióval (WCAG 3.2.4 Consistent Identification).

### 3.5 `PostCourseCta` — ÚJ (`src/components/content/PostCourseCta.tsx`)

```ts
export interface PostCourseCtaProps {
  /** A posts.ctaCourse populált terméke, vagy null. */
  course: Product | null
}
```

Két ág, mindkettő kompakt panel (fehér `Card` a tint sávon, kép nélkül):

| | `course` van | `course` nincs |
|---|---|---|
| H2 | a kurzus címe (`courseTitle(product)`, `src/lib/courses.ts`) | „Hogyan tovább?" *(lektorálandó javaslat, 11. fejezet K-B3)* |
| Szöveg | a kurzus `shortDescription`-je (meglévő, jóváhagyott sales-mondat) | egy mondat arról, hogy a kurzusok a cikkek rendszerezett folytatásai *(lektorálandó)* |
| Ár-tény | `coursePriceBadgeKind` szerint: ár (`formatPriceHuf`) vagy „ingyenes" badge, a gomb KÖZVETLEN közelében (B6.2) | nincs |
| Gomb | `ctaLabel('course-sales-open')` = „Nyisd meg a kurzusoldalt", **secondary**, `href: courseHref(product)` | `ctaLabel('course-list-open')` = „Nézd meg a kurzusokat", **primary**, `href: '/kurzusok'` |

Szabályok:

- Minden felirat a `src/lib/cta-vocabulary.ts`-ből (`ctaLabel`), új felirat
  tilos; az őr a meglévő `cta-a-termekben` / `cms-nem-nyomja-el-a-szotart`
  mintát követi.
- A panelben tilos: gyógyulási arány, gyógyulási idő, „garantált", számláló,
  sürgetés (A-terv 5.8 + a mért vevőhang).
- Laponként legfeljebb **1** `kc-button--primary` (őr: a
  `tudastar-racs-es-cta.test.ts` primary-számláló állítása, 9.1). A kurzusos
  ág secondary gombja pont ezért secondary: a cikk elsődleges cselekvése
  ilyenkor is egyetlen marad.
- `resolveCourseCta`/archivált kurzus: ha a kapcsolt kurzus nem `published`,
  a komponens a kurzus-nélküli ágra esik vissza (nem mutatunk halott linket).

### 3.6 `PostToc` — ÚJ (`src/components/content/PostToc.tsx`)

```ts
export interface PostTocProps {
  /** A cikk H2-szintű szakaszai dokumentum-sorrendben (lexical-outline). */
  items: ReadonlyArray<{ id: string; text: string }>
}
```

- Render (A-terv 5.4 anatómiája): `<nav aria-labelledby="tudastar-toc-cim"
  class="kc-post-toc">` + `<h2 id="tudastar-toc-cim">Ezen az oldalon</h2>` +
  `<ol>` számozott lista, tételenként `<a href="#{id}">` link, 44 px-es
  érintőcéllel (5.2 CSS).
- A megjelenítésről a `PostView` dönt a `shouldShowToc` szabállyal (3.9);
  a komponens üres listára `null`.
- Nem ragadós, a lead után áll a szűk konténerben. A kattintás utáni
  fókusz- és görgetés-viselkedést a globálisan bekötött `AnchorScroll` már
  adja (a `layout.tsx` mountolja), új kód nem kell.
- A lista a TELJES lapot tükrözi: a tartalmi H2-k (a „Források" is, hiszen az
  a törzs része) a `headingsOf` kimenetéből jönnek, és ha van GYIK, a
  `PostView` a lista VÉGÉRE fűzi a `{ id: 'gyakori-kerdesek', text: 'Gyakori
  kérdések' }` tételt (a PostFaq címsora nem a Lexical-tartalomban él, ezért
  a bejáró nem látja). A `shouldShowToc` `h2Count`-ja viszont csak a tartalmi
  H2-ket számolja.

### 3.7 Lista-segédek — `src/lib/tudastar.ts` (MÓDOSUL, B-csomag tulajdona)

A meglévő tiszta-függvény modul bővül (DB-független, fixture-ből tesztelhető):

```ts
/** Kiemelt kártya: 4+ cikknél az első leválik; alatta a maradék. */
export function featuredSplit<T>(posts: readonly T[]): { featured: T | null; rest: T[] }

/** B4.3: a chip-sor akkor jelenik meg, ha ≥3 kategóriának van cikke VAGY ≥5 cikk van. */
export function shouldShowCategoryFilter(categoriesWithPostCount: number, postCount: number): boolean
```

A `categoriesWithPostCount` a MEGLÉVŐ `categoriesWithPosts(categories,
posts).length` hívásból jön (ugyanaz a függvény, amit a sitemap használ),
tehát új bejárás nem készül.

### 3.8 `Breadcrumb` — ÚJ (`src/components/content/Breadcrumb.tsx`)

A kurzusoldal bevált morzsa-markupja (`kurzusok/[slug]/page.tsx` 483–490. sor)
komponensbe emelve:

```ts
export interface BreadcrumbProps {
  /** Az utolsó elem a jelenlegi lap (href nélkül, aria-current="page"). */
  items: ReadonlyArray<{ name: string; href?: string }>
}
```

Render: `<nav aria-label="Morzsamenü" class="kc-post-breadcrumb"><ol
role="list">…</ol></nav>`; az osztály a `knowledge.css`-ben kapja a
kurzusoldali szabályok token-hű másolatát (5.1). A kurzusoldal mostani inline
markupját ez a kör NEM cseréli le (más csapat fájlja); az egységesítés
szüret-utáni vezetői feladat (11. fejezet K-B2).

### 3.9 `PostView` — MÓDOSUL (`src/components/content/PostView.tsx`)

Az oldal karmestere. Szakasz-sorrend (A-terv 5.1):

```
JsonLd: articleJsonLd v2  ·  JsonLd: breadcrumbJsonLd (marad)
HERO (Section tint, Container narrow):
  1 kategória-badge (categories[0], linkkel) · H1 · lead (excerpt)
  meta-sor: „Írta: {név}, {credentials}" · <time> · „kb. {n} perc olvasás"
BORÍTÓ (marad a mai feltételes Section)
TÖRZS (Section, Container narrow, wrapper: <div class="kc-post-body">):
  PostToc  ← ha shouldShowToc(wordCount, h2Count)
  RichText content headingAnchors   ← a „Források" H2 a törzs utolsó szakasza
  PostFaq (posts.faq-ból)           ← a GYIK-válaszok forrásai is a Forrásokra mutatnak
  PostAuthorBox                     ← a törzs-szekció UTOLSÓ eleme
KURZUS-CTA: Section tint, className: 'kc-post-cta' (+ ' kc-post-cta--elotte-kapcsolodo',
  ha van kapcsolódó cikk)
  PostCourseCta (ctaCourse-ból)
KAPCSOLÓDÓ: Section className="kc-post-related"
  H2: relatedHeading(post, related)
  .kc-card-grid (hármas, közös)  ·  PostCard variant="compact" headingLevel="h3"
```

Pontosítás a sorrendhez (az A-terv 5.1 vázával azonosan): a szerző-blokk a
törzs-szekció záróköve (az NHS-minta szerint a fő tartalomhoz közel, nem a
láblécben), utána jön a CTA-sáv, majd a kapcsolódó blokk. Ha nincs
kapcsolódó cikk, a `--elotte-kapcsolodo` módosító nem kerül fel, a CTA-sáv a
lap utolsó szekciója, és az alap szekció-padding érvényes (5.2).

`relatedHeading` és `shouldShowToc` az új `src/lib/tudastar-cikk.ts`-ből
(C-csomag tulajdona):

```ts
/** >800 szó VAGY ≥5 H2 esetén kell tartalomjegyzék (B2.3). */
export function shouldShowToc(wordCount: number, h2Count: number): boolean

/** „További cikkek a témában: X", ha MINDEN megjelenített kapcsolódó cikk
 *  tartalmazza a poszt első kategóriáját; különben „További cikkek a Tudástárból". */
export function relatedHeading(
  post: Pick<Post, 'categories'>,
  related: ReadonlyArray<Pick<Post, 'categories'>>,
): string

/** Byline: „Írta: Kocsis Kata, gyógytornász, kézterapeuta" — credentials nélkül csak név. */
export function bylineOf(name: string, credentials?: string | null): string

/** A populált author/reviewedBy user-objektumból {name, credentials} | undefined —
 *  típusszűkítéssel (any tilos), KIZÁRÓLAG a 2.4-ben engedett mezőket olvassa. */
export function authorPersonOf(post: Post): { name: string; credentials?: string | null } | undefined
export function reviewerPersonOf(post: Post): { name: string; credentials?: string | null } | undefined
```

### 3.10 `PostAuthorBox` — ÚJ (`src/components/content/PostAuthorBox.tsx`)

```ts
export interface PostAuthorBoxProps {
  author: { name: string; credentials?: string | null; bioShort?: string | null
    portraitUrl?: string | null; portraitAlt?: string | null } | null
  reviewer: { name: string; credentials?: string | null } | null
  reviewedAt?: string | null    // ISO; formázás a formatPostDate-tel
  nextReviewAt?: string | null
}
```

- Render: fehér `Card`; cím: ha van lektorálási adat (reviewer VAGY
  reviewedAt), `<h2>A cikket írta és ellenőrizte</h2>`, enélkül csak
  `<h2>A cikket írta</h2>` (a cím nem állíthat olyan ellenőrzést, ami nem
  történt meg); arckép (ha van, `kc-post-author__portrait`); név +
  credentials; `bioShort`; link: `ctaLabel('about-open')` = „Ismerd meg a
  hátterünket" → `/rolunk`.
- Ha `reviewer` létezik és neve eltér a szerzőétől: külön sor
  „Szakmailag ellenőrizte: {név}, {credentials}".
- Dátum-sor hajszálvonal fölött: „Utoljára ellenőrizve: {dátum}" és
  „Következő ellenőrzés: {dátum}" — **kizárólag akkor renderel, ha az érték
  létezik**. Ellenőrzés-dátum ellenőrzés nélkül tilos (A-terv 8. fejezet);
  őr: a `tudastar-cikkoldal-seo.test.ts` „együtt vagy sehogy" állítása (9.1).
- Ha se szerző, se dátum nincs: a komponens `null` (a cikk ettől még él,
  a séma szerzője az Organization-tartalék).

### 3.11 Kezdőlapi `KnowledgeSection` — MINIMÁLIS MÓDOSÍTÁS

`<PostCard post={post} variant="compact" headingLevel="h3" />` — két prop,
más nem változik. A hármas `.kc-card-grid` marad (a kezdőlap ritmusa közös
más szekciókkal, A-terv 3.1).

---

## 4. Kimeneti réteg: címsor-horgony és olvasási idő (A-csomag)

### 4.1 `src/lib/lexical-outline.ts` — ÚJ, tiszta modul

React-mentes, függőség nélküli bejáró. Export:

```ts
export interface HeadingEntry { tag: 'h2'|'h3'|'h4'|'h5'|'h6'; text: string; id: string }

/** A lap saját (nem tartalmi) horgonyai — ütközésük a tartalommal tilos. */
export const RESERVED_ANCHOR_IDS: ReadonlyArray<string> // = ['tartalom', 'tudastar-toc-cim', 'gyakori-kerdesek']

/** Címsorok dokumentum-sorrendben, kiosztott id-vel. A h1 ITT IS h2-ként
 *  szerepel (a serializer h1→h2 lágyítását tükrözi, hogy a TOC és a DOM
 *  ugyanazt mondja). */
export function headingsOf(content: unknown): HeadingEntry[]

/** Ugyanabból a bejárásból: csomópont → id, a serializernek. */
export function headingIdMapOf(content: unknown): WeakMap<object, string>

/** Csak a text-csomópontok szövege, szóközzel fűzve. */
export function plainTextOf(content: unknown): string

/** Szó-szám a plainTextOf kimenetéből. */
export function wordCountOf(content: unknown): number
```

Id-kiosztás szabályai (determinisztikus, mindkét export ugyanazon a belső
függvényen fut, ezért nem tud szétcsúszni — pontosan az A-terv 5.4/4. pontja):

1. Alap: a MEGLÉVŐ `slugify` (`src/lib/slugify.ts`; magyar ékezeteket
   helyesen kezel).
2. Üres eredménynél (csak írásjel, emoji): `szakasz-{sorszám}`.
3. Ütközésnél `-2`, `-3`… utótag; a foglalt halmaz a `RESERVED_ANCHOR_IDS`
   elemeivel INDUL, így tartalmi címsor sosem kaphatja a `tartalom` id-t
   (a skip-link célja a `layout.tsx`-ben).
4. A bejárás TELJES mélységű (listaelemben, idézetben álló címsort is lát),
   sorrendje a serializer gyermek-bejárásával azonos.

### 4.2 `serialize.tsx` — MÓDOSUL (közös fájl, óvatos, visszafelé kompatibilis)

- `renderLexicalContent(content, options?: { headingIds?: WeakMap<object, string> })` —
  az opcionális második paraméter az egyetlen API-változás.
- A belső render-függvények (renderChildren/renderNode/renderHeading) egy
  `ctx` paramétert fűznek végig; `renderHeading` a `ctx.headingIds`-ből
  olvassa a csomóponthoz tartozó id-t, és ha van, `id` attribútumot ad a
  címsor-elemre. **Map nélkül a kimenet bájtra azonos a maival** — a kurzus-
  és jogi oldalak viselkedése nem változik, a meglévő
  `lexical-renderer.test.ts` esetei zölden maradnak.
- Modul-szintű mutálható állapot tilos (a WeakMap kívülről, paraméterként
  érkezik).

### 4.3 `RichText.tsx` — MÓDOSUL

```ts
export interface RichTextProps {
  content: unknown
  className?: string
  /** Címsor-horgonyok bekapcsolása (lexical-outline id-k). Alap: false. */
  headingAnchors?: boolean
}
```

`headingAnchors` esetén a komponens `headingIdMapOf(content)`-et épít és
továbbadja. Csak a `PostView` kapcsolja be.

### 4.4 `reading-time.ts` — MÓDOSUL

- A szó-számlálás a `wordCountOf`-ra vált (csak text-csomópontok). A mai
  bejárás minden string-mezőt számol (`type: 'paragraph'`, `direction:
  'ltr'`, `mode: 'normal'`), ami csomópontonként 2–3 fantomszó; egy 1600
  szavas cikknél ez a kijelzett időt 1–2 perccel tolja fölfelé.
- A 200 szó/perc marad; a fájl fejlécébe kerül a forrás és a becslés-jelleg:
  Brysbaert (2019), *How many words do we read per minute?*, J. Mem. Lang.
  109, 104047 — 238 szó/perc angol nem-fikcióra; a magyar hosszabb szavai
  miatt a 200 védhető becslés, validált magyar érték nincs (A-terv 7.3).
- A megjelenítés mindenhol „**kb.** n perc olvasás" (PostView meta-sor,
  PostCard láb).
- A `home-cms.test.ts` 764–767. sorának esetei változatlanul zöldek kell
  legyenek (tiszta szöveg-fixture); ha a fixture mező-stringjei miatt mégis
  mozdulna az érték, a teszt VÁRT értéke igazítható, a képlet nem.

---

## 5. CSS-terv

Zéró új szín, betű, betűméret; minden érték `var(--kc-*)` token. A
három-méretes skálát a meglévő `tipografia-harom-meret.test.ts` őrzi.

### 5.1 `styles/blocks/knowledge.css` — MÓDOSUL (B-csomag tulajdona)

**a) Poszt-rács.** A kurzus-rács pontos mintája (`course-cards.css` 78–81. sor),
a mért track-korlátokkal (A-terv 2.2):

```css
.kc-card-grid.kc-card-grid--posts {
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 26rem), 34rem));
  justify-content: center;
}
```

Nincs médialekérdezés: a kétosztályos szelektor specificitásból veri a közös
`.kc-card-grid` 640/900 px-es töréspontjait minden szélességen (ugyanaz a
mechanizmus, mint a `--courses` változatnál). A hasábszám a geometriából
adódik: 1 hasáb 903 px-ig, 2 hasáb 904 px-től, 3. hasáb matematikailag
kizárva (3 × 416 + 2 × 24 = 1296 > 1072).

**b) A hozzáférhető kártya-link.**

```css
.kc-post-card { position: relative; display: flex; flex-direction: column; height: 100%; }
.kc-post-card__title-link { color: inherit; text-decoration: none; }
.kc-post-card__title-link::after { content: ''; position: absolute; inset: 0;
  border-radius: var(--kc-radius-lg); }
.kc-post-card__title-link:focus-visible { outline: none; }
.kc-post-card__title-link:focus-visible::after {
  outline: 3px solid var(--kc-color-focus); outline-offset: 2px; }
```

A fókuszgyűrű így a TELJES kártyát rajzolja körbe (a globális gyűrű-vastagság
és szín tokenjeivel); az `outline: none` kizárólag azért engedett, mert
ugyanabban a blokkban a `::after`-en pótoljuk (Kitty Giraudel / Nomensa
minta, A-terv 3.5). A `kc-card--interactive` hover/focus-within kiemelése
változatlanul működik.

**c) Kártya-szöveg.**

```css
.kc-post-card .kc-post-card__title { margin: 0; text-wrap: balance; hyphens: auto; overflow-wrap: anywhere; }
.kc-post-card__excerpt { display: -webkit-box; -webkit-line-clamp: 3;
  -webkit-box-orient: vertical; line-clamp: 3; overflow: hidden;
  hyphens: auto; overflow-wrap: anywhere; }
```

(A kivonat 3 soros plafonja az A-terv 3.2 táblájából; a `-webkit-` prefix a
széles támogatottságú alak, a prefix nélküli a szabványos jövőkép.)

**d) Tipográfiai tartalék-borító.**

```css
.kc-post-card__cover--text { display: flex; align-items: center; justify-content: center;
  background: var(--kc-color-surface-tint); color: var(--kc-color-text);
  font-family: var(--kc-font-heading); font-size: var(--kc-font-m);
  letter-spacing: var(--kc-tracking-eyebrow); text-transform: uppercase; }
```

(Kontraszt: ink a tinten 13,53:1 — a tokens.css jegyzőkönyvéből.)

**e) Kiemelt kártya** — a `.kc-product-card--featured` geometriájának
token-hű másolata poszt-osztályokkal:

```css
@media (min-width: 900px) {
  .kc-post-card.kc-post-card--featured { display: grid;
    grid-template-columns: minmax(0, 5fr) minmax(0, 7fr); align-items: stretch; }
  .kc-post-card.kc-post-card--featured:not(:has(> .kc-post-card__cover)) {
    grid-template-columns: minmax(0, 1fr); }
  .kc-post-card--featured .kc-post-card__cover { height: 100%; aspect-ratio: auto;
    border-radius: var(--kc-radius-lg) 0 0 var(--kc-radius-lg); }
  .kc-post-card--featured .kc-post-card__body { justify-content: center;
    gap: var(--kc-space-4); padding: clamp(2rem, 3.2vw, 3rem); }
  .kc-post-card--featured .kc-post-card__excerpt,
  .kc-post-card--featured .kc-post-card__title { max-width: var(--kc-measure); }
}
```

(A gyökér-szelektor kétosztályos — `.kc-post-card.kc-post-card--featured` —,
hogy a b) pont `display: flex` alapszabályát specificitásból, ne
forrás-sorrendből írja felül; ugyanaz az elv, mint a rács-módosítónál.)

900 px alatt a kiemelt kártya automatikusan a normál, függőleges kártya
(nincs külön szabály — a rács-módosító osztály nem érinti). A mért sorhosszak
az A-terv 4.2 táblájában.

**f) Morzsa.** `.kc-post-breadcrumb` — a `kurzusok.css` 229–244. sorának
másolata (flex `ol`, `--kc-font-s`, `text-muted`, `/` elválasztó a
`li + li::before`-ban), poszt-névtérrel.

**g) Grid-osztálycsere:** a mai `.kc-card-grid` hivatkozások a `/blog` és a
kategória-oldal rácsán `--posts` módosítót kapnak; a kezdőlapi szekció és a
kapcsolódó blokk hármas rácsa változatlan.

### 5.2 `styles/blocks/post-view.css` — ÚJ (C-csomag tulajdona)

A `PostView` importálja. Tartalma:

```css
/* Tartalomjegyzék */
.kc-post-toc { border: 1px solid var(--kc-color-border); border-radius: var(--kc-radius-md);
  padding: var(--kc-space-5); background: var(--kc-color-surface-raised);
  margin-bottom: var(--kc-space-6); }
.kc-post-toc__title { margin: 0 0 var(--kc-space-3); font-family: var(--kc-font-body);
  font-size: var(--kc-font-m); font-weight: var(--kc-font-weight-bold); }
.kc-post-toc ol { margin: 0; padding-left: var(--kc-space-6); }
.kc-post-toc a { display: inline-flex; align-items: center; min-height: 2.75rem; /* 44px cél */
  color: var(--kc-color-link); text-decoration: underline;
  text-decoration-thickness: 1px; text-underline-offset: 0.25em; }
.kc-post-toc a:hover { color: var(--kc-color-link-hover); }

/* Szerző- és lektor-blokk */
.kc-post-author { margin-top: var(--kc-space-7); }
.kc-post-author__head { display: flex; gap: var(--kc-space-4); align-items: flex-start; }
.kc-post-author__portrait { width: var(--kc-space-8); height: var(--kc-space-8);
  border-radius: var(--kc-radius-full); object-fit: cover; flex: none; }
.kc-post-author__name { font-weight: var(--kc-font-weight-bold); }
.kc-post-author__credentials, .kc-post-author__bio { color: var(--kc-color-text-muted);
  font-size: var(--kc-font-m); }
.kc-post-author__reviewed { margin-top: var(--kc-space-4); padding-top: var(--kc-space-4);
  border-top: 1px solid var(--kc-color-border);
  font-size: var(--kc-font-s); color: var(--kc-color-text-muted); }

/* Kurzus-CTA sáv: szűkített padding, hogy a kapcsolódó blokk címe 72 px-en belül legyen */
.kc-section.kc-post-cta--elotte-kapcsolodo { padding-block-end: var(--kc-space-5); }
.kc-section.kc-post-related { padding-block-start: var(--kc-space-6); }

/* Nyomtatás: a forrás-linkek visszakereshetők papíron is (A-terv 5.7) */
@media print {
  .kc-post-body a[href^='http']::after { content: ' (' attr(href) ')';
    font-size: var(--kc-font-s); }
}
```

Mért állítás a CTA-térközről: a panel alja és a kapcsolódó H2 közti üres táv
= `--kc-space-5` (24 px) + `--kc-space-6` (32 px) = **56 px ≤ 72 px** (A-terv
5.8 küszöbe), minden nézetablakon, mert a felülírás médialekérdezés nélküli.
Ha nincs kapcsolódó blokk, a `--elotte-kapcsolodo` módosító nem kerül fel,
és a CTA-sáv az alap szekció-paddinggel zár.

### 5.3 Amihez NEM nyúlunk

| Fájl | Miért |
|---|---|
| `styles/tokens.css` | Nincs új token. |
| `styles/content.css` | Közös lap. A `.kc-card-grid` alap, a `.kc-richtext` és a poszt-alaposztályok maradnak. A `.kc-post-card__link` szelektor-fél a refaktor után holt kóddá válik: kivétele a vezető szüret-utáni, egy soros feladata (K-B2), nem az ügynöké. A bekezdésköz 16→24 px javaslata (A-terv K4) továbbra is vezetői döntés. |
| `styles/blocks/faq.css` | A PostFaq változtatás nélkül használja. |
| `kurzusok/kurzusok.css` | Más csapat fájlja; a morzsa-szabályt másoljuk, nem mozgatjuk. |

---

## 6. Schema.org réteg (D-csomag)

Alapszabály változatlanul: **a séma minden mezője a látható tartalomból jön**
(`docs/seo-geo-llm.md` 1. fejezet), és egy dologról egy entitás beszél (a
kurzusoldali `['Course','Product']` precedens).

### 6.1 `articleJsonLd` v2 (`src/lib/seo.ts`)

Új szignatúra (a hívó egyetlen komponens, a `PostView` — a régi `authorName`
paraméter megszűnik):

```ts
export function articleJsonLd(args: {
  post: Pick<Post, 'title' | 'excerpt' | 'publishedAt' | 'updatedAt'>
  path: string
  author?: { name: string; credentials?: string | null }
  reviewer?: { name: string; credentials?: string | null }
  lastReviewed?: string        // a posts.reviewedAt ISO-értéke
  imageUrl?: string
}): Record<string, unknown>
```

Kimenet (a maihoz képest a változások kiemelve):

```jsonc
{
  "@context": "https://schema.org",
  "@type": ["Article", "MedicalWebPage"],          // ← VOLT: "Article"
  "headline": "<title>",
  "description": "<excerpt>",                       // csak ha van
  "inLanguage": "hu-HU",
  "mainEntityOfPage": "<abszolút URL>",
  "datePublished": "<publishedAt>",
  "dateModified": "<updatedAt>",
  "image": ["<og-kép>"],                            // csak ha van
  "author": {                                       // ← Person, gazdagítva
    "@type": "Person",
    "name": "Kocsis Kata",
    "jobTitle": "gyógytornász, kézterapeuta",       // users.credentials; csak ha van
    "url": "<abszolút /rolunk>"                     // a szerző-blokk látható linkje
  },
  "reviewedBy": {                                   // ← ÚJ; csak ha a posts.reviewedBy létezik
    "@type": "Person", "name": "…", "jobTitle": "…", "url": "<abszolút /rolunk>"
  },
  "lastReviewed": "<reviewedAt>",                   // ← ÚJ; csak ha van
  "publisher": { "@type": "Organization", "name": "Kineticare", "url": "<abszolút />" }
}
```

**Miért kettős típus és nem két node.** A blogcikk-oldal egyetlen dolgot ír
le; a repó saját tanulsága szerint két node ugyanarról két entitásnak
látszana (a kezdőlapi duplikált Organization hibája). A `MedicalWebPage` a
WebPage altípusa, a WebPage és az Article egyaránt CreativeWork-leszármazott,
tehát a kettős típus érvényes; az Article-tag a Google Article rich result
jogosultságát viszi, a MedicalWebPage-tag pedig két dolgot ad:

1. kimondja a gépi olvasónak, hogy egészségügyi (YMYL) tartalomról van szó
   (E-E-A-T kontextus), és
2. **érvényessé teszi a `lastReviewed` és `reviewedBy` tulajdonságot**,
   amelyek a schema.org szerint WebPage-tulajdonságok (domain: WebPage;
   ellenőrizve 2026-08-21: https://schema.org/lastReviewed — Date;
   https://schema.org/reviewedBy — Person vagy Organization). Pusztán
   Article típuson e két mező érvénytelen lenne.

**A dátumok jelentése szét van választva:** `dateModified` = a dokumentum
utolsó módosítása (CMS `updatedAt`, mint ma); `lastReviewed` = az utolsó
SZAKMAI ellenőrzés (posts.reviewedAt). A kettő nem keverhető; ellenőrizetlen
cikknél `lastReviewed` egyszerűen nincs.

**Szerző-tartalék javítása:** szerző nélkül a mai kód `Person{name:
'Kineticare'}`-t ír, ami típushiba (a Kineticare nem személy). Az új
tartalék: `{"@type": "Organization", "name": "Kineticare", "url": …}` —
a schema.org `author` mindkét típust engedi.

**Amit tudatosan NEM veszünk fel:**

| Nem lesz | Miért |
|---|---|
| `about: MedicalCondition` (tünetekkel, terápiákkal) | Gépi formában kódolt klinikai állítás lenne; az orvosi tartalom-szabály (minden állításhoz forrás, semmi diagnózis sajátként) a strukturált adatra is áll. |
| `citation` automatikus kinyerése a Források listából | A Lexical-fából nem azonosítható megbízhatóan, melyik lista a forrásjegyzék; a hibás kinyerés rosszabb, mint a hiány. A látható HTML `<ol>` a gépi olvasónak így is kivonatolható. Későbbi kör, ha a Források kap saját mezőt. |
| `aggregateRating` / `review` | Nincs értékelés-adat; kitalálni tilos (fogyasztóvédelem + Google-irányelv, a kurzus-séma precedense). |
| `speakable` | A Google-nál évek óta beta, hír-fókuszú; nincs mérhető haszna. |
| `medicalAudience` | Nincs rá látható, kimondott megfelelő a lapon; a minimalizmus-szabály (látható tartalomból) itt is erősebb. |

### 6.2 A `PostView` hívása

```ts
articleJsonLd({
  post,
  path: `/blog/${post.slug}`,
  author: authorPersonOf(post),        // {name, credentials} | undefined — users.name + users.credentials
  reviewer: reviewerPersonOf(post),    // posts.reviewedBy populált user-jéből
  lastReviewed: typeof post.reviewedAt === 'string' ? post.reviewedAt : undefined,
  imageUrl: resolveOgImageUrl(post),
})
```

A `breadcrumbJsonLd` (Tudástár → cikk) változatlan. A lap ld+json blokkjai
tehát: Article+MedicalWebPage, BreadcrumbList, és HA van GYIK, FAQPage —
három különböző dologról három node, ez nem duplikáció.

### 6.3 Operatív előfeltétel (a vezetőnek és a tulajnak)

A Person-szerző akkor él, ha a két gyógytornásznak van `users` rekordja
kitöltött `name` (és a séma-kör után `credentials`) mezővel, és a cikkek
`author`/`reviewedBy` mezője rájuk mutat. Enélkül a séma az
Organization-tartalékra esik, ami érvényes, de E-E-A-T-ben gyengébb
(`docs/tudastar-hangnem-es-technika.md` nyitott kérdés 3). → 11. fejezet K-B4.

### 6.4 FAQPage a cikkeken

- Forrás: `posts.faq` (2.2); helper: a MEGLÉVŐ `faqPageJsonLd` változtatás
  nélkül (teljes válasz-szöveg, csonkolás tilos — a fejléc-komment már
  kimondja).
- A node-ot a `PostFaq` komponens emitálja a látható listával közös
  adatból (a `FaqBlock` és a kurzusoldal pontos precedense) — üres mezőnél
  se szekció, se séma.
- **Elvárás-kezelés, kimondva:** a Google a FAQ rich resultot 2023
  augusztusa óta csak „well-known, authoritative government and health
  websites" körben jeleníti meg (ellenőrizve 2026-08-21:
  https://developers.google.com/search/docs/appearance/structured-data/faqpage).
  A Kineticare-nek tehát a találati kártya nem cél; a FAQPage haszna a
  GEO-oldal: a kérdés-válasz pár a leggyakrabban kivonatolt egység az
  AI-válaszokban (`docs/seo-geo-llm.md` 1. fejezet). A válaszoknak a lapon
  elérhetőnek kell lenniük: a `details/summary` tartalma a DOM-ban van és
  egy kattintásra olvasható, ugyanaz a minta, ami a kezdőlapon és a
  kurzusoldalon már él.
- A GYIK-válaszokban klinikai állítás csak úgy állhat, hogy a forrás neve a
  válasz szövegében megnevezett, és a teljes hivatkozás a cikk Források
  szakaszában szerepel (8. fejezet lint-szabálya + lektor).

### 6.5 Lista- és kategória-oldal

Változatlan séma (`Blog` + `BlogPosting` bejegyzések, `BreadcrumbList` a
kategórián). A `Blog.blogPost` elemei BlogPosting típusúak, a cikkoldal
Article típusa ennek szülője, tehát a két leírás gépi olvasónak konzisztens.
A kiemelt kártya nem sémakérdés: a `blogPost` lista továbbra is minden
megjelenített cikket tartalmaz, a kiemeltet is.

### 6.6 Sitemap, robots, canonical

Nem változik semmi: a posztok, kategóriák már benne vannak a sitemapban
(`tudastar-sitemap.test.ts` védi), az AI-crawler-engedélyek élnek
(`seo-structured-data.test.ts`), a canonical lánc a `buildPageMetadata`-ból
jön. Az A-terv K7 (URL: `/blog` vs „Tudástár") kérdését ez a terv nem nyitja
ki (11. fejezet).

---

## 7. GEO/LLM-réteg: követelmény → megvalósítás

A `docs/seo-geo-llm.md` 2. fejezetének minden checklist-pontja ide van
rendelve. Három oszlop: mit ad a KÓD (egyszer megépítjük, minden cikkre áll),
mit ad a MEZŐ (cikkenkénti adat), mit ad a SZERKESZTŐI szabály (a cikkíró
ügynök + a lektor dolga, ahol lehet, lint-tel kényszerítve).

| GEO-követelmény (seo-geo-llm.md) | Kód | Mező | Szerkesztői + lint |
|---|---|---|---|
| 2.1 Minden szakasz álljon meg önmagában | H2–H6 **horgony-id** (4.1): a szakasz önállóan címezhető és idézhető URL-t kap | — | kérdés-alakú H2 (a kampányterv 4. pontjának „Mások ezt is kérdezik" kérdései szó szerint); az alcím alatti ELSŐ mondat a válasz; nincs „mint fentebb említettük" |
| 2.1 Rövid bekezdések | — | — | 2–4 mondat / bekezdés; szó/alcím arány ≤ 150 (lint: 8. fejezet) |
| 2.1 Lista/táblázat HTML-ben, sosem képként | a serializer `<ul>/<ol>` + gyakorlatlista (`kc-richtext__exercise-list`) | — | táblázat-feature nincs: táblázatos adat felsorolásként (2.6 korlát kimondva) |
| 2.2 Konkrét, forrásmegjelölt adat | — | — | az `docs/orvosi-forrasbazis.md` 0.2 szabálya: pontos szám + forrás + év; lint: Források-szakasz kötelező |
| 2.2 Frissesség jelölve a szövegben is | „Utoljára ellenőrizve" LÁTHATÓ sor (PostAuthorBox) + `lastReviewed` séma | `reviewedAt` | dátum csak valós ellenőrzés után |
| 2.3 Szerzői bio minden cikknél | PostAuthorBox + byline + `Person.jobTitle` | `users.credentials`, `bioShort`, `portrait` | csak igazolható állítás (1.7) |
| 2.3 Orvosi felelősség egyértelmű | — | — | „mindig a kezelőorvosod jóváhagyásával" hangnem; vörös zászlók szakasz minden cikkben (`orvosi-forrasbazis.md` 1. fejezet) |
| 2.4 CEP: helyzet-címek | — | — | cím = a beteg helyzete a saját szavaival; ≤ 65 karakter (lint) |
| 2.5 Tartalmi hub | kategória-oldalak + `relatedPosts`/`getRelatedPosts` + kapcsolódó blokk + `ctaCourse` belső link + morzsa (látható + séma) | `categories`, `relatedPosts`, `ctaCourse` | kategória-bontás a cikkírás ELŐTT (hangnem-doksi nyitott kérdés 2) |
| GYIK-kivonatolhatóság | PostFaq + FAQPage séma | `faq` | 2–6 pár, önmagában megálló válaszok |
| Amit NEM csinálunk | `llms.txt` továbbra sem (seo-geo-llm.md 4. fejezet); kulcsszó-halmozás soha | | |

Az idézhetőség mércéje a meglévő mérési terv (seo-geo-llm.md 3. fejezet,
prompt-portfólió); ez a kör azon nem változtat.

---

## 8. Cikk-lint: végrehajtható tartalom-őr (E-csomag)

Új tiszta modul: `src/lib/tudastar-cikk-lint.ts`. A cikk-seed minden
létrehozás ELŐTT futtatja, és nem üres hibalistánál a cikket kihagyja +
naplózza (`payload.logger` / `src/lib/logger.ts`, sosem `console.log`).

```ts
export interface CikkLintInput {
  title: string; excerpt?: string | null; content: unknown
  faq?: ReadonlyArray<{ question?: string | null; answer?: string | null }> | null
}
/** Üres tömb = a cikk formailag rendben. A klinikai TARTALMAT a lektor nézi, nem ez. */
export function lintTudastarCikk(input: CikkLintInput): string[]
```

Szabályok (mindegyik determinisztikus, a `lexical-outline` bejáróira építve):

| # | Szabály | Küszöb / minta | Forrás |
|---|---|---|---|
| L1 | Cím legfeljebb 65 karakter | `title.length ≤ 65` | NHS h1-ajánlás (A-terv 5.3) |
| L2 | Kivonat 1–170 karakter, és nem tartalmaz kvirtmínuszt | hossz + U+2014 tilalom | A-terv 3.2 (kártya 3 sor ≈ 150–170) + §3.1.2 |
| L3 | Kvirtmínusz sehol a tartalom text-csomópontjaiban, a címben, a GYIK-ben | 0 db U+2014 | §3.1.2, tulajdonosi kikötés |
| L4 | Van legalább 1 db H2 a törzsben | `h2Count ≥ 1` | réteges olvashatóság (A-terv 5.5) |
| L5 | Szó / (H2+H3) arány ≤ 150 | `wordCountOf / alcímszám ≤ 150` | NN/g layer-cake, B2.1 |
| L6 | Nincs h5 és h6 | 0 db | NHS Formatting (A-terv 5.5) |
| L7 | Van „Források" H2, és utána számozott lista legalább 1 tétellel | címsor-szöveg egyezés + `ol` a szakaszban | orvosi alapszabály (D9) |
| L8 | Minden Források-tétel tartalmaz linket ÉS „Hozzáférés:" szövegrészt; a link szövege nem `http`-vel kezdődik | tételenkénti ellenőrzés | `orvosi-forrasbazis.md` 0.1 + WCAG 2.4.9 |
| L9 | Önálló-link-bekezdés (amit a serializer primary CTA-gombbá alakítana) a törzsben: 0 db | a `significantChildren`-szabály tükrözése | B6.5 (max 1 primary/lap; render-oldali őr: 9.1) |
| L10 | Tiltott ígéret-frázisok fix listája: „garantált", „garantáljuk", „biztos gyógyulás", „100%-ban gyógyul", „mindenkinél működik" | kisbetűsített részstring-egyezés | a mért vevőhang + a feladatkiírás 5. szabálya. A lista szándékosan szűk: a forrásolt százalék legitim, azt a lektor ítéli meg, nem regex. |
| L11 | GYIK: 2–6 tétel; minden kérdés `?`-re végződik; válasz 1–500 karakter | mezőnkénti ellenőrzés | NHS lista-plafon + FAQPage teljes-válasz elv |
| L12 | A tartalom első szakasza (az első H2 előtt) legfeljebb 120 szó | `wordCountOf` az első H2-ig | „a választ kezdd" elv (seo-geo-llm 2.1); a hosszú felvezetés a chunk-önállóság ellensége |

A lint kimondott NEM-célja: klinikai helyesség, forrás-valódiság, hangnem.
Az a lektoré (a cikk addig piszkozat, amíg a két gyógytornász jóvá nem
hagyta — a publikálási állapot-szabály a hangnem-doksi 2.5 pontja).

---

## 9. Őr-tesztek

Az A-terv G-T1–G-T9 sorát konkrét fájlokra és bukás-feltételekre képezzük.
Minden teszt determinisztikus, DB nélküli (fixture + `renderToStaticMarkup`,
a `seo-structured-data.test.ts` kezdőlap-blokkjának bevált mintája).

### 9.1 Új tesztfájlok

**`src/__tests__/tudastar-cimsor-horgony.test.ts`** (A-csomag; G-T4, G-T5)

| Állítás | Bukás-feltétel |
|---|---|
| `headingsOf` magyar ékezetes címből a `slugify` szerinti id-t adja | eltérő id |
| két azonos szövegű H2 → `-2` utótag; harmadik → `-3` | duplikált id |
| üres/írásjeles címsor → `szakasz-{n}` | üres id |
| „Tartalom" szövegű H2 id-je NEM `tartalom` (foglalt: skip-link cél) | ütközés a `RESERVED_ANCHOR_IDS`-szel |
| h1-es tartalmi címsor a kimenetben h2-ként, id-vel szerepel | a TOC és a DOM szétcsúszása |
| `renderLexicalContent` a `headingIds` map-pel `id` attribútumos H2-t ad, és az id azonos a `headingsOf` értékével | render ≠ outline |
| map NÉLKÜL a kimenet id-mentes és bájtra azonos a maival | opt-in sérülése (kurzus/jogi oldalak védelme) |
| `shouldShowToc`: (801, 0) → true; (800, 4) → false; (0, 5) → true; (0, 4) → false | küszöb-elcsúszás |
| `wordCountOf` egy 3 bekezdés × 10 szavas fixture-re pontosan 30 (a `'ltr'`/`'text'` mező-stringek nem számítanak) | fantomszavak visszatérése |

**`src/__tests__/tudastar-kartya-link.test.ts`** (B-csomag; G-T1, G-T2)

| Állítás | Bukás-feltétel |
|---|---|
| a renderelt kártyában PONTOSAN 1 `<a>` van, és annak szöveges tartalma karakterre a cikk címe | a link nevébe idegen tartalom (alt, kivonat, dátum) kerül |
| a link-elemen nincs `aria-label` és `title` attribútum | a hozzáférhető név felülírása |
| 3 kategóriás fixture-nél is pontosan 1 badge, az első kategóriáé | címke-sor visszatérése (A-terv L5 megállapítása) |
| `variant="compact"`-nál nincs `kc-post-card__excerpt`; `list`-nél van | mező-készlet keveredés |
| a mezők DOM-sorrendje: cover → categories → title → excerpt → foot (indexOf-lánc) | B4.1 sérülése |
| `headingLevel="h3"`-mal `<h3>`, alapból `<h2>` a kártyacím | címhierarchia-törés |
| heroImage nélkül a `kc-post-card__cover--text` tartalék jelenik meg `aria-hidden`-nel | vegyes rács (Baymard-elv) |
| draft posztra a kártya `null` | publikálatlan tartalom szivárgása |

**`src/__tests__/tudastar-racs-es-cta.test.ts`** (B+C közös témájú, de a
fájlt a B-csomag hozza létre, a CTA-blokkot a C egészíti ki; G-T3, G-T6, G-T7)

| Állítás | Bukás-feltétel |
|---|---|
| a `knowledge.css` `.kc-card-grid--posts` szabálya `auto-fit` + `minmax(min(100%, X), Y)` alakú, ahol X ≥ 26rem és Y ≤ 34rem (regex + számkiolvasás a deklarációból) | a 3. hasáb visszacsúszása vagy óriáskártya |
| a `post-view.css`-ből feloldva: space-5 + space-6 ≤ 72 px (a `css-geometria` helperrel tokenből számolva) | hamis lapvég (NN/g related content) |
| a PostView renderelt HTML-jében legfeljebb 1 `kc-button--primary`, `ctaCourse`-szal és anélkül is | B6.5 sérülése |
| a Tudástár-komponensfájlok (`PostCard`, `PostView`, `PostToc`, `PostFaq`, `PostAuthorBox`, `PostCourseCta`, `Breadcrumb`, a két blog-page) forrásában nincs U+2014 string-literálban | gondolatjel-tilalom (§3.1.2) |
| a CTA-panel feliratai a `ctaLabel('course-sales-open')` ill. `ctaLabel('course-list-open')` értékei | szótáron kívüli felirat |

**`src/__tests__/tudastar-cikkoldal-seo.test.ts`** (C-csomag, a D-csomag
seo.ts-e után; ez az új „a séma = a látható tartalom" render-őr)

| Állítás | Bukás-feltétel |
|---|---|
| a PostView kimenetében pontosan 1 ld+json node tartalmazza az `Article` típust, és annak `@type`-ja tartalmazza a `MedicalWebPage`-et is | típus-regresszió vagy duplikált entitás |
| `headline` === a fixture címe; `author.name` === a fixture szerző-neve; `author['@type']` === 'Person'; `jobTitle` === credentials | séma ≠ látható byline |
| `lastReviewed` és a látható „Utoljára ellenőrizve:" sor EGYÜTT léteznek vagy EGYÜTT hiányoznak | dátum ellenőrzés nélkül (A-terv 8. fej. tilalma) |
| `reviewedBy` csak akkor, ha a fixture-ben van lektor | kitalált lektor |
| szerző nélküli fixture-nél `author['@type']` === 'Organization' | Person-típushiba visszatérése |
| FAQPage node akkor és csak akkor, ha van `faq`, és `mainEntity` hossza = tétel-szám, a válaszok csonkolatlanok; a látható `kc-faq__item`-ek száma ugyanannyi | séma ≠ látható GYIK |
| BreadcrumbList 2 elemű (Tudástár → cikk) | morzsa-regresszió |
| a meta-sorban „kb. " előtag az olvasási idő előtt | becslés-jelleg elhallgatása |
| `related` üresen: nincs kapcsolódó szekció, és a CTA-sávon nincs `--elotte-kapcsolodo` módosító | zsákutca- ill. térköz-hiba |

**`src/__tests__/tudastar-cikk-lint.test.ts`** (E-csomag): az L1–L12 mindegyike
legalább egy buktató és egy átengedő esettel.

### 9.2 Meglévő tesztek, amiket a csomagok frissítenek

| Fájl | Mi változik | Csomag |
|---|---|---|
| `tudastar-strukturalt-adat.test.ts` | `@type` állítás tömb-tartalmazásra vált; szerző-tartalék esete Organization-re; új esetek: `lastReviewed`/`reviewedBy` jelenlét-feltételei | D |
| `lexical-renderer.test.ts` | ÚJ esetek az opt-in id-render viselkedésre; a meglévő esetek változatlanul zöldek (opt-in nélkül bájtra azonos kimenet) | A |
| `home-cms.test.ts` | `formatPostDate` import érintetlen; a reading-time esetek elvárása csak akkor igazítható, ha a fixture fantomszavai miatt mozdul (4.4) | A |
| `tudastar-kategoria-oldal.test.ts` | morzsa + eyebrow + `--posts` rács jelenléte | B |
| `tudastar-ures-allapot.test.tsx` | változatlan (az üres állapothoz nem nyúlunk) | — |

### 9.3 Ami kézi/böngészős kör marad

Az A-terv 6.3 hét lépése (Tab-bejárás, képernyőolvasós link-lista, 320 px,
200%, reduced-motion, nyomtatás, kognitív séta) az implementáció ZÁRÓ
ellenőrzése, a `docs/ui-sztenderdek.md` §6.1 Chromium-harnessével. A G-T8
(320 px reflow) böngészős mérése ide tartozik; a `reflow-hasabmeres.test.ts`
statikus modellje a `.kc-richtext`-et már fedi.

---

## 10. Munkamegosztás, sorrend, elfogadás

### 10.1 Csomagok és fájl-tulajdon (átfedés-mentes)

| Csomag | Fájlok (mind kizárólagos tulajdon) |
|---|---|
| **E — séma + lint** | `src/collections/Posts.ts`, `src/collections/Users.ts` (CSAK mező-hozzáadás!), generált migráció, `src/payload-types.ts` (regen), `src/lib/tudastar-cikk-lint.ts` (ÚJ), `src/__tests__/tudastar-cikk-lint.test.ts` (ÚJ) |
| **A — kimeneti réteg** | `src/lib/lexical-outline.ts` (ÚJ), `src/components/lexical/serialize.tsx`, `src/components/lexical/RichText.tsx`, `src/lib/reading-time.ts`, `src/__tests__/tudastar-cimsor-horgony.test.ts` (ÚJ), `lexical-renderer.test.ts` bővítés |
| **D — SEO** | `src/lib/seo.ts` (articleJsonLd v2), `src/__tests__/tudastar-strukturalt-adat.test.ts` frissítés |
| **B — kártya + lista** | `src/components/content/PostCard.tsx`, `src/components/content/Breadcrumb.tsx` (ÚJ), `src/app/(frontend)/blog/page.tsx`, `src/app/(frontend)/blog/kategoria/[slug]/page.tsx`, `src/components/content/home/KnowledgeSection.tsx` (2 prop), `src/app/(frontend)/styles/blocks/knowledge.css`, `src/lib/tudastar.ts`, `src/__tests__/tudastar-kartya-link.test.ts` (ÚJ), `src/__tests__/tudastar-racs-es-cta.test.ts` (ÚJ, CTA-esetek TODO-val), `tudastar-kategoria-oldal.test.ts` frissítés |
| **C — cikkoldal** | `src/components/content/PostView.tsx`, `PostToc.tsx`, `PostFaq.tsx`, `PostAuthorBox.tsx`, `PostCourseCta.tsx` (mind ÚJ), `src/app/(frontend)/styles/blocks/post-view.css` (ÚJ), `src/lib/tudastar-cikk.ts` (ÚJ), `src/__tests__/tudastar-cikkoldal-seo.test.ts` (ÚJ), a `tudastar-racs-es-cta.test.ts` CTA-eseteinek kitöltése |

### 10.2 Sorrend (a ~2 párhuzamos ügynök korláttal tervezve)

1. **1. hullám:** E + A (függetlenek egymástól).
2. **2. hullám:** D + B (D-nek a payload-típusok, B-nek az A-beli PostCard-
   olvasásiidő-igény miatt kell az 1. hullám).
3. **3. hullám:** C (mindenre épül).
4. Vezetői kör: teljes tesztfuttatás, typecheck, lint, build; böngészős 6.3
   kör; a content.css holt szelektor-fél kitakarítása (K-B2); merge után CI +
   Railway figyelés (CLAUDE.md 23.).

### 10.3 Elfogadási feltételek (minden csomagra)

- `npm run test`, `npm run typecheck`, `npm run lint`, `npm run build` zöld.
- `any` nincs; `console.log` nincs; `.env*` érintetlen; migráció csak
  generált; `confirmOrder` sehol.
- Minden felirat a CTA-szótárból (`ctaLabel`) vagy e terv rögzített
  címkéiből („Ezen az oldalon", „Források", „Gyakori kérdések", „A cikket
  írta és ellenőrizte", „Utoljára ellenőrizve", „Következő ellenőrzés",
  „További cikkek…"); kvirtmínusz sehol (őr: a `tudastar-racs-es-cta.test.ts`
  U+2014 állítása).
- A csomag SAJÁT őr-tesztjei megírva és zölden.
- Strukturált beszámoló a vezetőnek: mit, fájllista, hogyan ellenőrizve,
  mért számok, nyitott kérdések.

---

## 11. Nyitott kérdések a vezetőnek

| # | Kérdés | Állapot |
|---|---|---|
| K-B1 | A `.kc-richtext p` bekezdésköz 16 → 24 px emelése (A-terv K4). | Továbbra is vezetői döntés: közös lapot (content.css) érint, a kurzus-leírásokat és jogi oldalakat is átrajzolja. A cikkoldal e nélkül is megfelel (a mai tartalék +0,97 px), de az emelés ajánlott. |
| K-B2 | A `content.css` `.kc-post-card__link` szelektor-felének kitakarítása és (később) a kurzusoldali morzsa egységesítése a `Breadcrumb` komponensre. | Szüret-utáni, vezetői egysoros(ok) — az ügynök-körben tilos a közös fájlhoz nyúlni. |
| K-B3 | A CTA-panel kurzus-nélküli ágának két mikroszövege (H2 „Hogyan tovább?" + egy mondat). | Javaslat áll (3.5), de vevői szöveg: a hangnem-szabályzat szerinti lektorált, natív magyar végleges szöveg kell, mielőtt élesbe megy. |
| K-B4 | A két gyógytornász `users` rekordja élesben (name + credentials + portrait), és annak eldöntése, ki melyik cikk szerzője/lektora. | Üzemeltetési + tartalmi előfeltétel; enélkül a szerző-blokk és a Person-séma a szegényebb tartalékon fut. |
| K-B5 | URL-kérdés: `/blog` vs „Tudástár" (A-terv K7). | Változatlanul nyitva; ez a terv a `/blog`-ra épít, az esetleges váltás külön átirányítási kör. |
| K-B6 | A kategória-bontás (hangnem-doksi nyitott kérdés 2): a 8 cikkhez 3–4 témakör a cikkírás ELŐTT. | Tartalmi döntés; a slug utólagos átírása webcímet tör. |

---

## 12. Források

Minden hivatkozás 2026-08-21-én ellenőrizve.

**Schema.org és Google (a 6. fejezet döntéseihez):**

- schema.org, *MedicalWebPage*: https://schema.org/MedicalWebPage
- schema.org, *lastReviewed* (domain: WebPage, érték: Date; a definíció:
  „Date on which the content on this web page was last reviewed for accuracy
  and/or completeness."): https://schema.org/lastReviewed
- schema.org, *reviewedBy* (domain: WebPage, érték: Person/Organization):
  https://schema.org/reviewedBy
- Google Search Central, *Article structured data* (Article/NewsArticle/
  BlogPosting jogosultság): https://developers.google.com/search/docs/appearance/structured-data/article
- Google Search Central, *FAQPage* — „the feature is only shown for
  well-known, authoritative government and health websites":
  https://developers.google.com/search/docs/appearance/structured-data/faqpage
- Google Search Central, *Changes to HowTo and FAQ rich results* (2023-08):
  https://developers.google.com/search/blog/2023/08/howto-faq-changes
- Google Search Central, *Structured data general policies* (a séma és a
  látható tartalom egyezése): https://developers.google.com/search/docs/appearance/structured-data/sd-policies
- Google Search Central, *Creating helpful, reliable, people-first content*
  (E-E-A-T, YMYL): https://developers.google.com/search/docs/fundamentals/creating-helpful-content

**Akadálymentes kártya-link (5.1):** Kitty Giraudel, *Accessible Cards*
(https://kittygiraudel.com/2022/04/02/accessible-cards/) · Nomensa, *How to
build accessible cards, block links*
(https://www.nomensa.com/blog/how-build-accessible-cards-block-links/) —
mindkettő az A-terv 3.5 pontjában részletezve.

**Olvasási sebesség (4.4):** Brysbaert, M. (2019). *How many words do we read
per minute? A review and meta-analysis of reading rate.* Journal of Memory
and Language, 109, 104047. https://doi.org/10.1016/j.jml.2019.104047

**A repó saját kutatásai és szabályzatai:** `docs/tudastar-ux-terv.md`
(mért küszöbök, G-T őrök) · `docs/tudastar-hangnem-es-technika.md` (adatút,
Lexical-építők, publikálási csapda) · `docs/seo-geo-llm.md` ·
`docs/orvosi-forrasbazis.md` (0. fejezet hivatkozás-alak) ·
`docs/kulcsszavak.md` (8 cikk, kurzus-híd) ·
`docs/kampanyterv-mert-adatokbol.md` (4. pont: a PAA-kérdések mint H2-k) ·
`docs/ui-sztenderdek.md` (§3.1, §3.2) · `docs/ux-belso-oldalak-kutatas.md`
(B-szabályok) · `CLAUDE.md` (TILOS ZÓNÁK, üzemeltetési tanulságok 14, 22b, 23).
