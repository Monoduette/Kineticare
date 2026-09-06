import { describe, expect, it } from 'vitest'

import {
  CTA_PROGRESS_LABELS,
  CTA_VOCABULARY,
  ctaEntry,
  ctaPatternEntry,
  type CtaAction,
} from '@/lib/cta-vocabulary'

import {
  BEJARASI_GYOKEREK,
  KIHAGYOTT_RESZFAK,
  gyujtsCtaFeliratokat,
  type CtaTalalat,
} from './helpers/cta-forras'
import { BARE_FORBIDDEN_LABELS, EM_DASH, EN_DASH, pusztaAlak } from './helpers/cta-mikroszoveg'

/**
 * G-UI2 — CTA-ŐR A TERMÉKEN (`docs/ui-sztenderdek.md` §3.2, §6.3).
 * A G-UI1 őr (`cta-vocabulary-guard.test.ts`) HÁROM fájlt olvas:
 * `src/lib/cta-vocabulary.ts`, `docs/ui-sztenderdek.md`, `docs/gomb-inventar.md`.
 * Egyetlen komponenst sem. Vagyis azt bizonyítja, hogy a szótár egyezik
 * önmagával — a felületről semmit nem mond.
 */

const { talalatok, dinamikusHelyek, bejartFajlok, kihagyottFajlok } = gyujtsCtaFeliratokat()

/** A ZÁRT L-1 folyamatban-lista feliratai (P-1d: rendszerállapot, nem cselekvés). */
const L1_FELIRATOK: ReadonlySet<string> = new Set<string>(Object.values(CTA_PROGRESS_LABELS))

/** A §3.2 szótár + a zárt L-1 folyamatban-lista — ezek a jóváhagyott feliratok. */
const JOVAHAGYOTT_FELIRATOK: ReadonlySet<string> = new Set<string>([
  ...CTA_VOCABULARY.map((entry) => entry.label),
  ...Object.values(CTA_PROGRESS_LABELS),
])

/**
 * Jóváhagyott-e a felirat: BITRE szótári, vagy egy MINTÁZATOS (C-6) sor
 * szabályos változata (`Vissza a <hova>`, `Letöltöm a <mit>`, `Hívd <Nevet>`).
 *
 * A mintázat-illesztés 2026-08-18-án került a szótárba (`CtaEntry.pattern`).
 * Előtte kilenc élő `Vissza a …` felirat kivétel-soron ült „mintázat-jelölt"
 * címkével, mert az őr nem tudta eldönteni, szabályos változat-e. A W3C
 * Understanding SC 3.2.4 ezt kifejezetten megengedi: „Text alternatives that
 * are 'consistent' are not always 'identical.'"
 * https://www.w3.org/WAI/WCAG22/Understanding/consistent-identification.html
 */
const jovahagyott = (felirat: string): boolean =>
  JOVAHAGYOTT_FELIRATOK.has(felirat) || ctaPatternEntry(felirat) !== null

/**
 * A kivétel-sor kategóriája. A kategória nem dísz: eldönti, milyen további
 * bizonyítást kér az őr a sortól.
 * A `mintazat-jelolt` kategória KIKERÜLT. Kilenc sor ült rajta („Vissza a
 * kezdőlapra", „Vissza a belépéshez", „Vissza a kurzusaimhoz", „Vissza a
 * Tudástárba"), és mind a kilenc azért, mert a §3.2 #15 MINTÁZATA csak
 */
type KivetelKategoria =
  /** Van rá §3.2 sor, a felirat mégis más. KÖTELEZŐ megnevezni a célzott sort. */
  | 'szotartol-elter'
  /** Valódi cselekvés, de a §3.2-ben nincs rá sor — a szótár bővítése tervezési kérdés. */
  | 'nincs-szotari-sor'
  /** Nem cselekvés-felirat: menücímke, morzsa, folyószövegbe ágyazott hivatkozás, logó, cím. */
  | 'nem-cta'

interface FeliratKivetel {
  /** A vevőnek megjelenő felirat, bitre. */
  readonly felirat: string
  /** A `src/`-hez képest relatív fájl — ugyanaz a felirat máshol MÁS elbírálást kaphat. */
  readonly fajl: string
  readonly kategoria: KivetelKategoria
  /** `szotartol-elter` esetén kötelező: melyik §3.2 sorra kell vezetni. */
  readonly celzottAkcio?: CtaAction
  /** Egy mondat, amiért ma még így áll. Üresen hagyni nem lehet — az őr méri. */
  readonly indok: string
}

/**
 * A MAI ÁLLAPOT, soronként indokolva (2026-08-18-i mérés).
 * A lista 96 sorról 42-re csökkent, kategóriánként:
 * szotartol-elter ... 27 → 0   (mind a 27 javított felirat a §3.2 szótárból olvas)
 * mintazat-jelolt ...  9 → 0   (a kategória megszűnt: `CtaEntry.pattern`)
 * nincs-szotari-sor . 20 → 0   (a §3.2 tizenegy új sorral bővült: #28–#38)
 */
const FELIRAT_KIVETELEK: readonly FeliratKivetel[] = [
  // ── 1. SZÓTÁRTÓL ELTÉRŐ CTA-k — a javítandók listája ───────────────────────
  // ÜRES (2026-08-27). A maradék „Belépés a fizetéshez" a kosár vendég-sávján
  // a §3.2 #21 (`cart-to-checkout`, „Menj a pénztárhoz") alakra javult: a
  // /penztar vendég-vásárlást is fogad, belépőfal nincs.

  // ── 2. NINCS §3.2 SOR — a szótár bővítése tervezési kérdés ────────────────
  // ÜRES, és ez a szakasz ÉRTELME. A 2026-08-17-i mérés húsz ilyen feliratot
  // talált (kijelentkezés, újranézés, kurzus befejezése, profil-mentés,
  // kapcsolatfelvétel, süti-beállítások, jelszó-visszaállítás kezdeményezése,
  // ingyenes pénztár-ág, „rólunk", tudástár, kártya-CTA…). Mind a húsz szótári
  // sorra került: §3.2 #28–#38, plusz a L-1 lista `Kijelentkezés…` eleme, és a
  // pénztár ingyenes ága a meglévő #26-ra (ugyanaz a funkció, ugyanaz a szó).

  // ── 3. NEM CTA — menücímke, morzsa, folyószöveg, logó, cím ────────────────
  // A §3.2 N-3 kifejezetten kimondja: a főmenü menüpontjának neve NEM CTA.
  // Ugyanez áll a morzsára, a folyószövegbe ágyazott hivatkozásra, a logóra és
  // az e-mail-címre: ezek nem cselekvésgombok, tehát nem a §3.2 hatálya alá
  // esnek. A puszta („Tovább", „Bővebben"…) és a gondolatjeles feliratok
  // viszont ITT SEM engedettek — arra külön, szűkebb kivétel-lista van.
  {
    felirat: 'Kurzusok',
    fajl: 'components/layout/HeaderCoursesNav.tsx',
    kategoria: 'nem-cta',
    indok: 'A főmenü menüpontja — a §3.2 #10 kifejezett kivétele („menücímke, nem CTA — N-3").',
  },
  {
    felirat: 'Kurzusok',
    fajl: 'app/(frontend)/kurzusok/[slug]/page.tsx',
    kategoria: 'nem-cta',
    indok: 'Morzsa (breadcrumb) elem a kurzusoldalon — helyjelölő, nem cselekvés.',
  },
  {
    felirat: 'Tudástár',
    fajl: 'components/content/PostArticle.tsx',
    kategoria: 'nem-cta',
    indok:
      'Morzsa (breadcrumb) elem a cikkoldalon (2026-08-21) — helyjelölő, nem cselekvés; pontosan ugyanaz a szerep, mint a kurzusoldal „Kurzusok" morzsa-elemének. A gyűjtőoldal NEVE a főmenüben is „Tudástár" (§3.2 N-3: menücímke, nem CTA).',
  },
  {
    felirat: 'Kurzusaim',
    fajl: 'components/layout/AccountNav.tsx',
    kategoria: 'nem-cta',
    indok: 'A fiókmenü menüpontja — N-3 szerint menücímke, nem CTA.',
  },
  {
    felirat: 'Kurzusaim',
    fajl: 'components/account/CoursePlayer.tsx',
    kategoria: 'nem-cta',
    indok: 'A lejátszó fejlécének morzsa-szerepű vissza-linkje (nyíl + cím), nem cselekvésgomb.',
  },
  {
    felirat: 'Kapcsolat',
    fajl: 'components/layout/Footer.tsx',
    kategoria: 'nem-cta',
    indok: 'Lábléc-menüpont — N-3 szerint menücímke, nem cselekvés-felirat.',
  },
  {
    felirat: 'Kapcsolat',
    fajl: 'components/error/not-found-content.ts',
    kategoria: 'nem-cta',
    indok: 'A 404-oldal „vagy folytasd innen" cél-listájának menüpontja, nem cselekvésgomb.',
  },
  {
    felirat: 'Tudástár',
    fajl: 'components/error/not-found-content.ts',
    kategoria: 'nem-cta',
    indok:
      'A 404-oldal „vagy folytasd innen" cél-listájának menüpontja — helyjelölő névsor, nem cselekvésgomb.',
  },
  {
    felirat: 'Összes',
    fajl: 'app/(frontend)/kurzusok/page.tsx',
    kategoria: 'nem-cta',
    indok:
      'A kurzuslista kategóriaszűrőjének „minden kategória" címkéje — szűrő-állapot, nem cselekvés-felirat.',
  },
  {
    felirat: 'Összes',
    fajl: 'components/content/CategoryFilter.tsx',
    kategoria: 'nem-cta',
    indok:
      'A tudástár kategóriaszűrőjének „minden kategória" címkéje — szűrő-állapot, nem cselekvés-felirat.',
  },
  {
    felirat: 'Kineti care',
    fajl: 'components/layout/Header.tsx',
    kategoria: 'nem-cta',
    indok: 'A logó szövege (két tipográfiai elemre bontva), nem felirat.',
  },
  {
    felirat: 'Kineti care',
    fajl: 'app/global-not-found.tsx',
    kategoria: 'nem-cta',
    indok: 'A logó szövege a keretek nélküli 404-oldalon.',
  },
  {
    felirat: 'Kineticare kezdőlap',
    fajl: 'components/layout/Header.tsx',
    kategoria: 'nem-cta',
    indok: 'A logó hozzáférhető neve (WCAG 2.2 · 4.1.2), nem látható gombfelirat.',
  },
  {
    felirat: 'Kineticare kezdőlap',
    fajl: 'app/global-not-found.tsx',
    kategoria: 'nem-cta',
    indok:
      'A logó hozzáférhető neve a 404-oldalon. 2026-08-18 óta BITRE egyezik a `Header.tsx`-ével: a korábbi „Kineticare — kezdőlap" U+2014-et tartalmazott (§3.1.1), és ugyanarra az elemre két nevet adott.',
  },
  {
    felirat: 'Ugrás a tartalomra',
    fajl: 'app/(frontend)/layout.tsx',
    kategoria: 'nem-cta',
    indok: 'Skip-link (WCAG 2.2 · 2.4.1 Bypass Blocks) — kötelező elem, nem termék-CTA.',
  },
  {
    felirat: 'Ugrás a tartalomra',
    fajl: 'app/global-not-found.tsx',
    kategoria: 'nem-cta',
    indok: 'Skip-link a keretek nélküli 404-oldalon.',
  },
  {
    felirat: 'Menü megnyitása',
    fajl: 'components/layout/MobileNav.tsx',
    kategoria: 'nem-cta',
    indok: 'A mobilmenü kapcsolójának hozzáférhető neve (állapotfüggő), nem termék-CTA.',
  },
  {
    felirat: 'Menü bezárása',
    fajl: 'components/layout/MobileNav.tsx',
    kategoria: 'nem-cta',
    indok: 'A mobilmenü kapcsolójának zárt állapotú hozzáférhető neve.',
  },
  {
    felirat: 'Elindítom a logósort',
    fajl: 'components/blocks/LogoRail.tsx',
    kategoria: 'nem-cta',
    indok:
      'Tulajdonos által jóváhagyott helyi mozgásvezérlő: csak a logósor folyamatos CSS-mozgását indítja. Nem értékesítési CTA, nem navigál, nem módosít fiók- vagy vásárlási adatot; kizárólag e komponens felirata mentesül.',
  },
  {
    felirat: 'Megállítom a logósort',
    fajl: 'components/blocks/LogoRail.tsx',
    kategoria: 'nem-cta',
    indok:
      'Tulajdonos által jóváhagyott helyi szüneteltető: a logósor mozgását állítja meg, nem a kurzuslejátszót vezérli. Hozzáférhetőségi kapcsoló, nem értékesítési CTA; kizárólag e komponens felirata mentesül.',
  },
  {
    felirat: 'Tananyag bezárása',
    fajl: 'components/account/CoursePlayer.tsx',
    kategoria: 'nem-cta',
    indok:
      'A lejátszó tananyag-paneljének bezáró gombja (rejtett szöveg az ikon mellett), felületi kapcsoló.',
  },
  {
    felirat: 'Minden lecke kész',
    fajl: 'components/account/player/navigation.ts',
    kategoria: 'nem-cta',
    indok:
      'A lejátszó LETILTOTT gombjának állapotszövege, nem cselekvés (`disabled: true` a mezői közt).',
  },
  {
    felirat: 'Adatkezelési és adatvédelmi szabályzat',
    fajl: 'components/layout/Footer.tsx',
    kategoria: 'nem-cta',
    indok: 'Jogi dokumentum hivatkozása a láblécben — dokumentumnév, nem cselekvés.',
  },
  {
    felirat: 'Adatkezelési és adatvédelmi szabályzat',
    fajl: 'app/global-not-found.tsx',
    kategoria: 'nem-cta',
    indok: 'Jogi dokumentum hivatkozása a 404-oldal láblécében.',
  },
  {
    felirat: 'Adatkezelési és adatvédelmi szabályzat',
    fajl: 'components/blocks/AppointmentForm.tsx',
    kategoria: 'nem-cta',
    indok: 'A hozzájáruló mondat dokumentum-hivatkozása az időpontkérő űrlapon.',
  },
  {
    felirat: 'Adatkezelési és adatvédelmi szabályzat',
    fajl: 'components/courses/FreeCourseRequestForm.tsx',
    kategoria: 'nem-cta',
    indok: 'A hozzájáruló mondat dokumentum-hivatkozása az ingyenes kurzus űrlapján.',
  },
  {
    felirat: 'Adatkezelési és adatvédelmi szabályzat',
    fajl: 'components/layout/NewsletterForm.tsx',
    kategoria: 'nem-cta',
    indok: 'A hírlevél hozzájáruló mondatának dokumentum-hivatkozása.',
  },
  {
    felirat: 'Adatkezelési és adatvédelmi szabályzatban',
    fajl: 'app/(frontend)/kapcsolat/_components/ContactForm.tsx',
    kategoria: 'nem-cta',
    indok: 'Folyószövegbe ragozott dokumentum-hivatkozás a kapcsolat-űrlap alatt.',
  },
  {
    felirat: 'Általános szerződési feltételek',
    fajl: 'components/layout/Footer.tsx',
    kategoria: 'nem-cta',
    indok: 'Jogi dokumentum hivatkozása a láblécben.',
  },
  {
    felirat: 'Általános szerződési feltételek',
    fajl: 'app/global-not-found.tsx',
    kategoria: 'nem-cta',
    indok: 'Jogi dokumentum hivatkozása a 404-oldal láblécében.',
  },
  {
    felirat: 'Általános szerződési feltételek',
    fajl: 'components/checkout/CheckoutForm.tsx',
    kategoria: 'nem-cta',
    indok: 'Az ÁSZF-elfogadó jelölőnégyzet melletti dokumentum-hivatkozás a pénztárban.',
  },
  {
    felirat: 'Impresszum',
    fajl: 'components/layout/Footer.tsx',
    kategoria: 'nem-cta',
    indok: 'Jogi dokumentum menüpontja a láblécben — dokumentumnév, nem cselekvés-felirat.',
  },
  {
    felirat: 'Impresszum',
    fajl: 'app/global-not-found.tsx',
    kategoria: 'nem-cta',
    indok: 'Jogi dokumentum menüpontja a 404-oldal láblécében — dokumentumnév, nem cselekvés.',
  },
  {
    felirat: 'adatvédelmi tájékoztatóban',
    fajl: 'components/analytics/ConsentBanner.tsx',
    kategoria: 'nem-cta',
    indok: 'A süti-sáv magyarázó mondatába ágyazott hivatkozás, nem gomb.',
  },
  {
    felirat: 'be is jelentkezhetsz',
    fajl: 'components/checkout/CheckoutForm.tsx',
    kategoria: 'nem-cta',
    indok: 'Folyószövegbe ágyazott hivatkozás a pénztár magyarázó mondatában.',
  },
  {
    felirat: 'kapcsolati oldalon',
    fajl: 'app/(frontend)/error.tsx',
    kategoria: 'nem-cta',
    indok: 'Folyószövegbe ágyazott hivatkozás a hibaoldal magyarázatában.',
  },
  {
    felirat: 'kapcsolati oldalon',
    fajl: 'app/global-error.tsx',
    kategoria: 'nem-cta',
    indok: 'Folyószövegbe ágyazott hivatkozás a globális hibaoldalon.',
  },
  {
    felirat: 'info@kineticare.hu',
    fajl: 'components/layout/Footer.tsx',
    kategoria: 'nem-cta',
    indok: 'E-mail-cím `mailto:` hivatkozásként — a cím maga a felirat, nem CTA.',
  },
  {
    felirat: 'info@kineticare.hu',
    fajl: 'components/error/NotFoundView.tsx',
    kategoria: 'nem-cta',
    indok: 'E-mail-cím `mailto:` hivatkozásként a 404-oldalon.',
  },
  {
    felirat: 'Általános szerződési feltételeket (új lapon nyílik)',
    fajl: 'components/checkout/CheckoutForm.tsx',
    kategoria: 'nem-cta',
    indok:
      'A pénztári ÁSZF-elfogadó jelölőnégyzet FELIRATÁBA ágyazott jogi hivatkozás, nem cselekvés-gomb: a mondat tárgya, nem CTA. A zárójeles toldat a képernyőolvasónak szóló rejtett figyelmeztetés (WCAG 2.2 · 3.2.5, G201), nem látható felirat.',
  },
  {
    felirat: 'Adatkezelési és adatvédelmi szabályzatot (új lapon nyílik)',
    fajl: 'components/checkout/CheckoutForm.tsx',
    kategoria: 'nem-cta',
    indok:
      'Ugyanannak a jelölőnégyzet-feliratnak a második beágyazott jogi hivatkozása. Az ÁSZF 22. bekezdése EGY jelölőnégyzetet ír le két dokumentumra, ezért a felirat két linket tartalmaz.',
  },
  {
    felirat: 'Google Analytics',
    fajl: 'lib/admin/web-analytics-config.ts',
    kategoria: 'nem-cta',
    indok:
      'Külső elemző-felület TULAJDONNEVE az admin Webanalitika-fül link-során (2026-08-27) — a link neve maga a célfelület, mint a §3.2 N-3 menücímkéi: helyjelölő, nem cselekvés. Admin-belső felület, nem vevői.',
  },
  {
    felirat: 'Search Console',
    fajl: 'lib/admin/web-analytics-config.ts',
    kategoria: 'nem-cta',
    indok:
      'Külső elemző-felület tulajdonneve az admin Webanalitika-fülön — ugyanaz a szerep, mint a „Google Analytics" soré: a link a megnevezett külső eszközre visz, nem cselekvésgomb.',
  },
  {
    felirat: 'Google Ads',
    fajl: 'lib/admin/web-analytics-config.ts',
    kategoria: 'nem-cta',
    indok:
      'Külső elemző-felület tulajdonneve az admin Webanalitika-fülön — ugyanaz a szerep, mint a „Google Analytics" soré: a link a megnevezett külső eszközre visz, nem cselekvésgomb.',
  },
  {
    felirat: 'PostHog',
    fajl: 'lib/admin/web-analytics-config.ts',
    kategoria: 'nem-cta',
    indok:
      'Külső elemző-felület tulajdonneve az admin Webanalitika-fülön — ugyanaz a szerep, mint a „Google Analytics" soré: a link a megnevezett külső eszközre visz, nem cselekvésgomb.',
  },
  {
    felirat: 'Időpontfoglalás',
    fajl: 'lib/header-appointment.ts',
    kategoria: 'nem-cta',
    indok:
      'N-3 fejléc-főnév, Norbert 2026-09-06: a régi menü mellé outline gomb (`/kapcsolat#idopontkeres`). Nem menüpont, nem naptáras foglaló, nem a §3.2 #24 igei CTA.',
  },
]
/**
 * FELSŐ KORLÁT. A 2026-08-17-i mérés 98 sort talált, a 2026-08-18-i kör után
 * 42 maradt; ezt a számot csak LEFELÉ szabad átírni. Ha egy javítás elfogyaszt
 * egy sort, a korlát is csökken — így a lista visszahízása külön, látható
 * mozdulatot kíván.
 *
 * 2026-08-21: 42 → 43, EGYETLEN sorral, és NEM felirat-adósság miatt. A
 * cikkoldal megkapta a látható morzsamenüjét (WCAG 2.2 **3.2.3** Consistent
 * Navigation: a kurzusoldalnak volt morzsája, a cikkoldalnak nem), és a morzsa
 * gyűjtőoldal-eleme a lap NEVÉT viseli: „Tudástár". Ez pontosan ugyanaz a
 * szerep, mint a kurzusoldal morzsájának „Kurzusok" eleme, ami a 184–187.
 * soron már ott áll — helyjelölő, nem cselekvés (§3.2 N-3). Új CTA-felirat
 * NEM keletkezett. A növelést a vezetőnek jóvá kell hagynia.
 *
 * 2026-08-27: 43 → 47, NÉGY sorral, mind nem-CTA. Az admin Webanalitika-fül
 * (tulajdonosi kérés) négy külső elemző-felületre mutató linket kapott, és a
 * link szövege a célfelület TULAJDONNEVE (Google Analytics, Search Console,
 * Google Ads, PostHog) — pontosan az N-3 menücímke-szerep: megnevez, nem
 * cselekszik. Ráadásul admin-belső felület, nem vevői. Új CTA-felirat itt sem
 * keletkezett; a vezetői jóváhagyás e kör kiírásának része.
 *
 * 2026-08-27 (kurzus-flow): a `CartView` „Belépés a fizetéshez" szótár-eltérés
 * kikerült. A webanalitika négy sorával együtt a lista 43, a korlát 47 → 43.
 *
 * 2026-09-05: 43 → 45, a tulajdonos kifejezett jóváhagyásával. Kizárólag a
 * LogoRail két helyi indítás/szünet felirata, nem értékesítési CTA; nincs
 * általános felmentés és nincs új szótári sor. A korlát pontosan a lista mérete.
 *
 * 2026-09-06: 45 → 46, Norbert zára. Az „Időpontfoglalás" fejléc-outline gomb
 * (régi menü + ez a gomb, NEM nav-injektálás), callback `/kapcsolat#idopontkeres`.
 * N-3 menücímke, mint a „Kurzusok"; új §3.2 igei sor NINCS.
 */
const KIVETEL_LISTA_FELSO_KORLAT = 46

/**
 * A „Tovább…"-tilalom (M-7) MAI sértései. SZŰK lista: az őr megköveteli, hogy
 * minden ide felvett felirat a fő kivétel-listán is szerepeljen, ÉS ott
 * `szotartol-elter` kategóriájú legyen. Ok: egy puszta „Tovább" sosem
 * legitimálható „nem CTA"-ként — legfeljebb elismerhető, hogy még nem javult.
 */
const TOVABB_KIVETELEK: readonly { readonly felirat: string; readonly fajl: string }[] = [
  // ÜRES (2026-08-18). A két mai sértés (`Tovább a kurzusaimhoz` a
  // `ThankYouView`-ban és a `resolveCourseCta` `purchased` ágán) a §3.2 #9
  // szótári alakjára javult. A lista üresen maradása ÁLLÍTÁS: a felületen
  // egyetlen „Tovább…" kezdetű felirat sincs — az alatta álló őr ezt méri.
]

/**
 * A kvirtmínusz/gondolatjel-tilalom (§3.1.1–3.1.2) MAI sértései. Szintén szűk
 * lista, és minden sorának szerepelnie kell a fő kivétel-listán is.
 */
const GONDOLATJEL_KIVETELEK: readonly { readonly felirat: string; readonly fajl: string }[] = [
  // ÜRES (2026-08-18). A két mai sértés megszűnt: az `Ingyenes — azonnal
  // eléred` a §3.2 #3 alakjára (`Elindítom ingyen`), a `Kineticare — kezdőlap`
  // hozzáférhető név pedig a `Header.tsx`-ével bitre egyező `Kineticare
  // kezdőlap`-ra javult. A vevői feliratokban innentől NULLA a kvirtmínusz.
]

/**
 * WCAG 2.2 · 3.2.4 — MAI cél-ütközések: egy `href`, több felirat.
 *
 * A `nem-cta` besorolású előfordulások NEM számítanak bele: egy morzsa, egy
 * menücímke és egy folyószöveges hivatkozás nem „ugyanaz a komponens" a
 * sikerkritérium értelmében (W3C Understanding SC 3.2.4). Ami itt marad, az
 * valódi, mérhető ütközés.
 *
 * A `feliratok` mező a TELJES mai halmaz — ha akár egy új felirat kerül
 * ugyanarra a célra, az őr kidől.
 */
const HREF_UTKOZES_KIVETELEK: readonly {
  readonly href: string
  readonly feliratok: readonly string[]
  readonly indok: string
}[] = [
  // A 2026-08-18-i kör után HAT helyett NÉGY cél ütközik, és MINDEGYIK a
  // BÖNGÉSZÉS ↔ VISSZALÉPÉS szándékos kettőssége (§3.2 #10 ↔ #15 mintája),
  // nem meg nem javított szinonima. A `/kapcsolat` (3 felirat) és az
  // `/elfelejtett-jelszo` (2 felirat) ütközése MEGSZŰNT: mindkettőre egyetlen
  // szótári sor lett (#33 és #37).
  {
    href: '/kurzusaim',
    feliratok: ['Nyisd meg a kurzusaidat', 'Vissza a kurzusaimhoz'],
    indok:
      'A mért „NÉGY felirat egy célra" hiba (docs/gomb-inventar.md §5) KETTŐRE csökkent, és a maradék kettő SZÁNDÉKOS: a #9 („Nyisd meg a kurzusaidat") a navigáció, a #15 mintázata („Vissza a kurzusaimhoz") a lejátszóból való VISSZALÉPÉS. A W3C SC 3.2.4 magyarázata a mintázatos alakot kifejezetten megengedi.',
  },
  {
    href: '/kurzusok',
    feliratok: ['Nézd meg a kurzusokat', 'Vissza a kurzusokhoz'],
    indok:
      'A mért „NYOLC felirat egy célra" hiba KETTŐRE csökkent. A `Nézd meg a kurzusokat` (#10) és a `Vissza a kurzusokhoz` (#15) SZÁNDÉKOSAN két sor: böngészés vs. visszalépés — a másik hat felirat megszűnt.',
  },
  {
    href: '/belepes',
    feliratok: ['Belépés', 'Vissza a belépéshez'],
    indok:
      'A #5 („Belépés") mellett a #15 mintázatának alakja áll a jelszó-visszaállító lapon: ott a látogató VISSZALÉP oda, ahonnan jött. Ugyanaz a szándékos kettősség, mint a /kurzusok és a /kurzusaim célon.',
  },
  {
    href: '/blog',
    feliratok: ['Nézd meg a tudástárat', 'Vissza a Tudástárba'],
    indok:
      'A #35 („Nézd meg a tudástárat") a kezdőlapról BÖNGÉSZÉSRE visz, a #15 mintázata („Vissza a Tudástárba") pedig az üres kategória-oldalról VISSZALÉP a listára — két különböző eredmény, tehát nem „same functionality" (W3C Understanding SC 3.2.4).',
  },
]

/**
 * CMS-BŐL FELÜLÍRHATÓ CTA-k — a 2026-08-17-i mérés.
 *
 * Itt a kódbeli felirat csak TARTALÉK: ha a szerkesztő kitölti a mezőt, az
 * övé nyer (`cmsErtek?.label?.trim() || KODBELI_FELIRAT`). Következmény: a
 * kódbeli javítás ÉLESBEN HATÁSTALAN lehet, tehát a szótár betartatása
 * önmagában a kódban NEM elég.
 *
 * Ez a lista RÖGZÍTETT: új felülírható hely felvétele tudatos döntés kell
 * legyen (a szerkesztő legyőzheti-e a szótárt?), ezért az őr kidől tőle.
 * A kérdés eldöntése tulajdonosi/vezetői hatáskör — ez az őr csak jelent.
 */
const CMS_FELULIRHATO_HELYEK: readonly { readonly fajl: string; readonly felirat: string }[] = [
  // ÜRES — és ez a lista ÉRTELME. A 2026-08-18-i körben a tulajdonos döntése
  // szerint a SZÓTÁRI cselekvéseknél a kód nyer: az `AppointmentForm` és a
  // `FreeSos` CMS-felülírása megszűnt (`ctaLabel(...)` a `?? felülírás` helyett),
  // ezért mind a négy korábbi sor kikerült. A lista üresen maradása állítás:
  // egyetlen §3.2-beli cselekvés feliratát sem írhatja felül a szerkesztő.
  //
  // A `CtaBanner`, `FilmHero`, `RenderBlocks.linkFrom` és `TeamMembers`
  // SZÁNDÉKOSAN nincs itt: ott a felirat kizárólag a szerkesztőé (nincs
  // kódbeli tartalék, és a hívóhely nem ismer `CtaAction`-t — egy CTA-sáv
  // bárhova mutathat). A szerkesztő elnémítása ott felirat NÉLKÜLI gombot
  // adna. Azokat a helyeket külön őr méri (cms-nem-nyomja-el-a-szotart).
]

// ---------------------------------------------------------------------------
// Segédek
// ---------------------------------------------------------------------------

/**
 * Összetett kulcs (felirat + fájl) elválasztója: U+001F (unit separator).
 * Azért nem szóköz, mert a feliratban is van szóköz — így két különböző
 * (felirat, fájl) pár soha nem eshet egybe.
 */
const KULCS_ELVALASZTO = '\u001F'

const kivetelKulcs = (felirat: string, fajl: string): string =>
  `${felirat}${KULCS_ELVALASZTO}${fajl}`

const KIVETEL_INDEX: ReadonlyMap<string, FeliratKivetel> = new Map(
  FELIRAT_KIVETELEK.map((kivetel) => [kivetelKulcs(kivetel.felirat, kivetel.fajl), kivetel]),
)

const kivetelhez = (talalat: CtaTalalat): FeliratKivetel | undefined =>
  KIVETEL_INDEX.get(kivetelKulcs(talalat.felirat, talalat.fajl))

const hely = (talalat: CtaTalalat): string =>
  `${talalat.fajl}:${talalat.sor} — „${talalat.felirat}" (${talalat.forras}/${talalat.elem})`

// ---------------------------------------------------------------------------
// 0. HATÓKÖR — a bejáró ne tudjon némán összemenni
// ---------------------------------------------------------------------------

/**
 * Egy hatókör-szűkítés (egy gyökér elhagyása, egy kihagyó-előtag tágítása) az
 * őrt látszólag zölden hagyná, miközben megszűnne mérni. Ezért a hatókör maga
 * is mért: gyökerek, fájlszám-küszöb és névvel megnevezett őrszem-fájlok.
 */
const ORSZEM_FAJLOK: readonly string[] = [
  'components/checkout/CartView.tsx',
  'components/checkout/ThankYouView.tsx',
  'components/checkout/CheckoutForm.tsx',
  'components/analytics/ConsentBanner.tsx',
  'components/content/home/FreeSos.tsx',
  'components/account/course-list-order.ts',
  'app/(frontend)/penztar/page.tsx',
  'app/(frontend)/kosar/page.tsx',
  'lib/courses.ts',
]

describe('G-UI2 — hatókör: a bejáró tényleg végigméri a felületet', () => {
  it('a bejárási gyökerek halmaza pontosan a rögzített három', () => {
    // Közvetlen hatókör-őr: ha valaki kiveszi az `app`-ot a bejárásból, az őr
    // látszólag zöld maradna, miközben a fél felületet nem méri. Mérve: az
    // `app` elhagyásával hét állítás dől ki, de EZ mondja ki, MI a baj.
    expect([...BEJARASI_GYOKEREK].sort(), 'a bejárás gyökerei megváltoztak').toEqual([
      'app',
      'components',
      'lib',
    ])
  })

  it('mindhárom bejárási gyökér ad fájlt (components, app, lib)', () => {
    const uresGyokerek = BEJARASI_GYOKEREK.filter(
      (gyoker) => !bejartFajlok.some((fajl) => fajl.startsWith(`${gyoker}/`)),
    )
    expect(uresGyokerek, 'olyan bejárási gyökér, amelyből egyetlen fájl sem jött').toEqual([])
  })

  it('a bejárt fájlok száma nem esett a küszöb alá (hatókör-szűkülés elleni őr)', () => {
    // 2026-08-17-i mérés: 303 fájl. A küszöb alatta van, hogy a normál
    // fájltörlés ne buktassa, de egy egész könyvtár elvesztése igen.
    expect(bejartFajlok.length, `bejárt fájlok: ${bejartFajlok.length}`).toBeGreaterThanOrEqual(260)
  })

  it('minden őrszem-fájl bent van a bejárásban', () => {
    const hianyzo = ORSZEM_FAJLOK.filter((fajl) => !bejartFajlok.includes(fajl))
    expect(hianyzo, 'őrszem-fájl kimaradt a bejárásból').toEqual([])
  })

  it('minden kihagyott részfához tartozik valódi fájl (elavult kivétel nem tágíthat)', () => {
    const ureskezu = KIHAGYOTT_RESZFAK.filter(
      ({ eloTag }) => !kihagyottFajlok.some((fajl) => fajl.startsWith(eloTag)),
    ).map(({ eloTag }) => eloTag)
    expect(ureskezu, 'olyan kihagyott részfa, amelyhez egyetlen fájl sem tartozik').toEqual([])
  })

  it('a kiolvasott feliratok száma nem esett a küszöb alá', () => {
    // 2026-08-17-i mérés: 136 találat. Ha az elemző elromlik (pl. egy
    // kifejezés-ág némán dinamikussá válik), ez a szám zuhan.
    expect(talalatok.length, `kiolvasott feliratok: ${talalatok.length}`).toBeGreaterThanOrEqual(
      115,
    )
  })
})

// ---------------------------------------------------------------------------
// 1. MINDEN ÉLŐ FELIRAT: szótárból vagy kivétellel
// ---------------------------------------------------------------------------

describe('G-UI2 — minden élő felirat a §3.2 szótárból való vagy indokolt kivétel', () => {
  it('nincs számon nem tartott felirat a felületen', () => {
    const ismeretlenek = talalatok
      .filter((talalat) => !jovahagyott(talalat.felirat) && kivetelhez(talalat) === undefined)
      .map(hely)
    expect(
      [...new Set(ismeretlenek)],
      'ÚJ, számon nem tartott felirat. Vagy a §3.2 szótárból vegyél feliratot ' +
        '(`ctaLabel(...)`), vagy — ha tervezési döntést kér — vedd fel a ' +
        'FELIRAT_KIVETELEK listára indoklással, és emeld a felső korlátot csak ' +
        'akkor, ha a vezető jóváhagyta.',
    ).toEqual([])
  })

  it('a kivétel-lista minden sora ÉL (elavult sort törölni kell — a lista csak csökkenhet)', () => {
    const eloKulcsok = new Set(
      talalatok.map((talalat) => kivetelKulcs(talalat.felirat, talalat.fajl)),
    )
    const elavultak = FELIRAT_KIVETELEK.filter(
      (kivetel) => !eloKulcsok.has(kivetelKulcs(kivetel.felirat, kivetel.fajl)),
    ).map((kivetel) => `${kivetel.fajl} — „${kivetel.felirat}" (${kivetel.indok})`)
    expect(
      elavultak,
      'ELAVULT kivétel-sor: a felirat már nem él ezen a helyen. Ez JÓ HÍR — ' +
        'a javítás megtörtént. Töröld a sort a FELIRAT_KIVETELEK listáról, és ' +
        'vidd lejjebb a KIVETEL_LISTA_FELSO_KORLAT értékét.',
    ).toEqual([])
  })

  it('nincs kivétel olyan feliratra, amely már a szótárban van (halott sor)', () => {
    const feleslegesek = FELIRAT_KIVETELEK.filter((kivetel) => jovahagyott(kivetel.felirat)).map(
      (kivetel) => `${kivetel.fajl} — „${kivetel.felirat}"`,
    )
    expect(
      feleslegesek,
      'a §3.2-ben szereplő (vagy MINTÁZATÁNAK megfelelő) feliratra nem kell kivétel',
    ).toEqual([])
  })

  it(`a kivétel-lista ma ${FELIRAT_KIVETELEK.length} soros, a felső korlát ${KIVETEL_LISTA_FELSO_KORLAT}`, () => {
    expect(
      FELIRAT_KIVETELEK.length,
      `A kivétel-lista MEGNŐTT (${FELIRAT_KIVETELEK.length} > ${KIVETEL_LISTA_FELSO_KORLAT}). ` +
        'A korlátot csak LEFELÉ szabad átírni; a növelés vezetői jóváhagyást kér.',
    ).toBeLessThanOrEqual(KIVETEL_LISTA_FELSO_KORLAT)
  })

  it('nincs két azonos kivétel-sor (felirat + fájl párra pontosan egy)', () => {
    expect(KIVETEL_INDEX.size, 'duplikált kivétel-sor a FELIRAT_KIVETELEK listán').toBe(
      FELIRAT_KIVETELEK.length,
    )
  })
})

// ---------------------------------------------------------------------------
// 2. A KIVÉTEL-LISTA HIGIÉNIÁJA — hogy munkalista maradjon, ne mentesítés
// ---------------------------------------------------------------------------

describe('G-UI2 — a kivétel-lista higiéniája', () => {
  it('minden sornak van érdemi indoklása', () => {
    const gyengek = FELIRAT_KIVETELEK.filter((kivetel) => kivetel.indok.trim().length < 40).map(
      (kivetel) => `${kivetel.fajl} — „${kivetel.felirat}"`,
    )
    expect(gyengek, 'túl rövid (érdemi tartalom nélküli) indoklás').toEqual([])
  })

  it('a „szotartol-elter" sorok megnevezik a §3.2 célsort, és az létezik', () => {
    const hibasak = FELIRAT_KIVETELEK.filter((kivetel) => kivetel.kategoria === 'szotartol-elter')
      .filter((kivetel) => {
        if (kivetel.celzottAkcio === undefined) return true
        try {
          ctaEntry(kivetel.celzottAkcio)
          return false
        } catch {
          return true
        }
      })
      .map((kivetel) => `${kivetel.fajl} — „${kivetel.felirat}"`)
    expect(
      hibasak,
      'a szótártól eltérő sornak meg KELL neveznie, melyik §3.2 cselekvésre kell vezetni',
    ).toEqual([])
  })

  it('a MINTÁZATOS (§3.2 C-6) sorok gépi alakja tényleg felismeri az élő változatokat', () => {
    // Ez a korábbi „mintazat-jelolt" kategória HELYÉBE lép. Nem elég, hogy a
    // szótár tárol egy `pattern` mezőt: bizonyítani kell, hogy a felületen élő
    // változatokat FEL IS ismeri — különben a mintázat bevezetése némán
    // visszahozná a kilenc kivétel-sort, csak épp „ismeretlen felirat" néven.
    //
    // NÉVSZERINT ellenőrzött élő alakok (2026-08-18-i mérés). Ha bármelyik
    // eltűnik a felületről, ez az állítás HANGOSAN kidől, és a listát frissíteni
    // kell — nem csendben tágul.
    const MERT_MINTAZATOS_ALAKOK: readonly string[] = [
      'Vissza a kezdőlapra',
      'Vissza a kurzusaimhoz',
      'Vissza a belépéshez',
      'Vissza a Tudástárba',
    ]
    const eloFeliratok = new Set(talalatok.map((talalat) => talalat.felirat))

    const hianyzok = MERT_MINTAZATOS_ALAKOK.filter((felirat) => !eloFeliratok.has(felirat))
    expect(hianyzok, 'mért mintázatos alak eltűnt a felületről — frissítsd a listát').toEqual([])

    const felnemismert = MERT_MINTAZATOS_ALAKOK.filter(
      (felirat) => ctaPatternEntry(felirat)?.action !== 'back-to-courses',
    )
    expect(
      felnemismert,
      'a §3.2 #15 `pattern` mezője nem ismeri fel a saját mintázatának élő változatát',
    ).toEqual([])

    // A puszta „Vissza" TILOS marad: a mintázat kötelező, nem üres tárgyat kér
    // (NN/g, Better Link Labels — „Substantial").
    expect(ctaPatternEntry('Vissza'), 'a puszta „Vissza" nem lehet mintázatos alak').toBeNull()
    expect(ctaPatternEntry('Vissza a '), 'üres tárgy nem elég').toBeNull()
  })

  it('a „nem-cta" és a „nincs-szotari-sor" sorok NEM neveznek meg célsort', () => {
    const hibasak = FELIRAT_KIVETELEK.filter(
      (kivetel) =>
        (kivetel.kategoria === 'nem-cta' || kivetel.kategoria === 'nincs-szotari-sor') &&
        kivetel.celzottAkcio !== undefined,
    ).map((kivetel) => `${kivetel.fajl} — „${kivetel.felirat}"`)
    expect(hibasak, 'ezeknél a kategóriáknál a célsor megnevezése ellentmondás').toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 3. M-7 — puszta és „Tovább…" kezdetű feliratok
// ---------------------------------------------------------------------------

describe('G-UI2 — M-7: a felirat mondja meg, mi történik', () => {
  it('egyetlen élő felirat sem puszta tiltott szó (Tovább, Küldés, OK, Bővebben, Részletek…)', () => {
    // A ZÁRT L-1 lista (`Küldés…`, `Mentés…`…) SZÁNDÉKOSAN kimarad: az M-7 a
    // CSELEKVÉS feliratára szól, a folyamatban-felirat viszont RENDSZERÁLLAPOT
    // (P-1d; NN/g 1. heurisztika, WCAG 4.1.3), és a §3.2 jóváhagyta. Enélkül az
    // őr a saját szótárára riasztana — mérve: öt hívóhely `Küldés…` gombján.
    const vetok = talalatok
      .filter((talalat) => !L1_FELIRATOK.has(talalat.felirat))
      .filter((talalat) => BARE_FORBIDDEN_LABELS.includes(pusztaAlak(talalat.felirat)))
      .map(hely)
    expect([...new Set(vetok)], 'puszta, célt nem nevező felirat a felületen').toEqual([])
  })

  it('egyetlen élő felirat sem kezdődik „Tovább"-bal (a mai sértések szűk listán)', () => {
    const engedett = new Set(
      TOVABB_KIVETELEK.map((kivetel) => kivetelKulcs(kivetel.felirat, kivetel.fajl)),
    )
    const vetok = talalatok
      .filter((talalat) => talalat.felirat.toLocaleLowerCase('hu').startsWith('tovább'))
      .filter((talalat) => !engedett.has(kivetelKulcs(talalat.felirat, talalat.fajl)))
      .map(hely)
    expect(
      [...new Set(vetok)],
      'ÚJ „Tovább…" kezdetű felirat. A §3.2 M-7 szerint a puszta „Tovább" nem ' +
        'mondja meg, mi történik — a szótárból válassz feliratot.',
    ).toEqual([])
  })

  it('a „Tovább…" kivételek MIND élnek, és mind elismert szótár-eltérések', () => {
    const eloKulcsok = new Set(
      talalatok.map((talalat) => kivetelKulcs(talalat.felirat, talalat.fajl)),
    )
    const bajok: string[] = []
    for (const kivetel of TOVABB_KIVETELEK) {
      const kulcs = kivetelKulcs(kivetel.felirat, kivetel.fajl)
      if (!eloKulcsok.has(kulcs)) {
        bajok.push(`ELAVULT (megjavult, töröld): ${kivetel.fajl} — „${kivetel.felirat}"`)
        continue
      }
      const fo = KIVETEL_INDEX.get(kulcs)
      if (fo === undefined || fo.kategoria !== 'szotartol-elter') {
        bajok.push(
          `„Tovább…" felirat csak szotartol-elter sorként ismerhető el: ${kivetel.fajl} — „${kivetel.felirat}"`,
        )
      }
    }
    expect(bajok, 'a „Tovább…" kivétel-lista nem áll rendben').toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 4. §3.1.1–3.1.2 — kvirtmínusz és gondolatjel a vevői feliratokban
// ---------------------------------------------------------------------------

describe('G-UI2 — §3.1: nincs kvirtmínusz/gondolatjel a vevői feliratokban', () => {
  it('egyetlen élő felirat sem tartalmaz U+2014-et vagy U+2013-at (a mai kettő szűk listán)', () => {
    const engedett = new Set(
      GONDOLATJEL_KIVETELEK.map((kivetel) => kivetelKulcs(kivetel.felirat, kivetel.fajl)),
    )
    const vetok = talalatok
      .filter((talalat) => talalat.felirat.includes(EM_DASH) || talalat.felirat.includes(EN_DASH))
      .filter((talalat) => !engedett.has(kivetelKulcs(talalat.felirat, talalat.fajl)))
      .map(hely)
    expect(
      [...new Set(vetok)],
      'ÚJ gondolatjeles/kvirtmínuszos vevői felirat. A magyar tipográfiában a ' +
        'kvirtmínusz nem írásjel, gombszövegben a gondolatjel is tiltott (§3.1.1–3.1.2).',
    ).toEqual([])
  })

  it('a gondolatjel-kivételek MIND élnek, és a fő kivétel-listán is rajta vannak', () => {
    const eloKulcsok = new Set(
      talalatok.map((talalat) => kivetelKulcs(talalat.felirat, talalat.fajl)),
    )
    const bajok = GONDOLATJEL_KIVETELEK.flatMap((kivetel) => {
      const kulcs = kivetelKulcs(kivetel.felirat, kivetel.fajl)
      if (!eloKulcsok.has(kulcs)) {
        return [`ELAVULT (megjavult, töröld): ${kivetel.fajl} — „${kivetel.felirat}"`]
      }
      return KIVETEL_INDEX.has(kulcs)
        ? []
        : [`hiányzik a fő kivétel-listáról: ${kivetel.fajl} — „${kivetel.felirat}"`]
    })
    expect(bajok, 'a gondolatjel-kivétel lista nem áll rendben').toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 5. WCAG 2.2 · 3.2.4 — egy cél, egy felirat
// ---------------------------------------------------------------------------

/**
 * A cél szerinti csoportosítás. A `nem-cta` besorolású előfordulások kimaradnak:
 * a morzsa, a menücímke és a folyószöveges hivatkozás nem „ugyanaz a
 * komponens" a sikerkritérium értelmében.
 */
function feliratokCelonkent(): ReadonlyMap<string, ReadonlySet<string>> {
  const terkep = new Map<string, Set<string>>()
  for (const talalat of talalatok) {
    if (talalat.href === null) continue
    if (kivetelhez(talalat)?.kategoria === 'nem-cta') continue
    const meglevo = terkep.get(talalat.href) ?? new Set<string>()
    meglevo.add(talalat.felirat)
    terkep.set(talalat.href, meglevo)
  }
  return terkep
}

describe('G-UI2 — WCAG 2.2 · 3.2.4: egy cselekvés-célhoz egy felirat', () => {
  const celonkent = feliratokCelonkent()

  it('nincs olyan cél, amelyre nem rögzített feliratkészlet mutat', () => {
    const kivetelIndex = new Map(
      HREF_UTKOZES_KIVETELEK.map((kivetel) => [kivetel.href, [...kivetel.feliratok].sort()]),
    )
    const bajok: string[] = []
    for (const [href, feliratok] of [...celonkent.entries()].sort()) {
      if (feliratok.size < 2) continue
      const mai = [...feliratok].sort()
      const rogzitett = kivetelIndex.get(href)
      if (rogzitett === undefined) {
        bajok.push(`${href} ← ${mai.join(' | ')} (nincs rögzítve)`)
        continue
      }
      if (rogzitett.join(KULCS_ELVALASZTO) !== mai.join(KULCS_ELVALASZTO)) {
        bajok.push(`${href} ← mai: ${mai.join(' | ')} ; rögzített: ${rogzitett.join(' | ')}`)
      }
    }
    expect(
      bajok,
      'ÚJ vagy megváltozott cél-ütközés: ugyanahhoz a `href`-hez több felirat ' +
        'tartozik (WCAG 2.2 SC 3.2.4 Consistent Identification). Ha egy felirat ' +
        'ELTŰNT a listáról, az javítás — vezesd át a HREF_UTKOZES_KIVETELEK sorát.',
    ).toEqual([])
  })

  it('minden rögzített cél-ütközés ÉL (elavult sort törölni kell)', () => {
    const elavultak = HREF_UTKOZES_KIVETELEK.filter(
      (kivetel) => (celonkent.get(kivetel.href)?.size ?? 0) < 2,
    ).map((kivetel) => kivetel.href)
    expect(elavultak, 'a cél már nem ütközik — töröld a HREF_UTKOZES_KIVETELEK sorát').toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 6. CMS-FELÜLÍRÁS — felderítés és jelentés (javítás NÉLKÜL)
// ---------------------------------------------------------------------------

describe('G-UI2 — CMS-ből felülírható CTA-feliratok (jelentés)', () => {
  const felulirhatoak = talalatok.filter((talalat) => talalat.cmsFelulirhato)

  it(`ma ${new Set(felulirhatoak.map((talalat) => talalat.fajl)).size} komponensben ${felulirhatoak.length} felirat írható felül CMS-ből`, () => {
    const mai = [
      ...new Set(
        felulirhatoak.map((talalat) => `${talalat.fajl}${KULCS_ELVALASZTO}${talalat.felirat}`),
      ),
    ].sort()
    const rogzitett = [
      ...new Set(
        CMS_FELULIRHATO_HELYEK.map((hely) => `${hely.fajl}${KULCS_ELVALASZTO}${hely.felirat}`),
      ),
    ].sort()
    expect(
      mai.map((sor) => sor.replace(KULCS_ELVALASZTO, ' — ')),
      'A CMS-ből felülírható CTA-k halmaza megváltozott. ÚJ felülírható hely ' +
        'tudatos döntés kell legyen: ott a szerkesztő mezője LEGYŐZI a §3.2 ' +
        'szótárt, tehát a kódbeli javítás élesben hatástalan. A döntés ' +
        '(nyerjen-e a kód) tulajdonosi/vezetői hatáskör — ez az őr csak jelent.',
    ).toEqual(rogzitett.map((sor) => sor.replace(KULCS_ELVALASZTO, ' — ')))
  })

  it('a felülírható helyek feliratai ma a szótárból valók (a tartalék ág rendben van)', () => {
    const rosszTartalek = felulirhatoak.filter((talalat) => !jovahagyott(talalat.felirat)).map(hely)
    expect(
      [...new Set(rosszTartalek)],
      'a CMS-felülírás TARTALÉK feliratának legalább a kódban a jóváhagyott ' +
        'alaknak kell lennie — különben sem a CMS, sem a kód nem a szótárt követi',
    ).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 7. AMIT A BEJÁRÓ NEM LÁT — a korlát kimondva, nem elhallgatva
// ---------------------------------------------------------------------------

describe('G-UI2 — a bejáró vak foltjai kimondva', () => {
  it(`ma ${dinamikusHelyek.length} olyan hely van, ahol a felirat futásidőben dől el`, () => {
    // Ez NEM hiba, hanem KORLÁT: adatbázisból jövő cím, CMS-mező,
    // `${}`-behelyettesítés statikusan nem oldható fel. A szám azért van
    // állításban, hogy a növekedése látszódjon: minél több a futásidőben
    // eldőlő felirat, annál kevesebbet ér a szótár betartatása a kódban.
    // 76: a REV C sín CTA a CMS `felirat` mezőt viszi a Button gyerekébe
    // (szótári #10/#40/#41 a seedben) — szándékos, nem kódba égetett.
    expect(
      dinamikusHelyek.length,
      `Futásidőben eldőlő feliratok: ${dinamikusHelyek.length}. Ha ez a szám ` +
        'megugrott, a felületről feliratok csúsztak át kódon kívülre — ' +
        'ellenőrizd, nem CMS-ből jön-e egy szótári cselekvés felirata.',
    ).toBeLessThanOrEqual(76)
  })
})
