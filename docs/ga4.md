# Google Analytics 4 — beállítás és működés

> A GA4 (gtag.js) a MEGLÉVŐ consent-állapotgépre van kötve, ugyanúgy, mint a
> PostHog (docs/posthog.md). A gtag.js kizárólag `granted` hozzájárulás UTÁN
> töltődik be; visszavonáskor a mérés leáll.

## 1. Mérési azonosító beszerzése (~2 perc)

1. <https://analytics.google.com> → **Admin → Adatfolyamok (Data streams)** →
   webes adatfolyam kiválasztása/létrehozása.
2. A **Mérési azonosító** (`G-…`) kimásolása. Ez NYILVÁNOS, kliensoldali
   azonosító — nem titok, minden GA-t használó oldal HTML-jében benne van.
   (A Measurement Protocol API secret ettől KÜLÖN dolog; azt ide ne tedd.)

## 2. Bekötés a környezetbe

| Változó | Érték |
|---|---|
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` | a mérési azonosító (`G-…`) |

Üres/hiányzó érték = a GA teljesen kikapcsolt (néma no-op, semmi nem töltődik
be). Formailag hibás érték (nem `G-` + 4–24 alfanumerikus jel) ugyanígy
viselkedik — ez védi az injekció ellen is, mert az azonosító a script URL-jébe
és egy globális kapcsoló nevébe kerül.

**A kulcs `NEXT_PUBLIC_`, tehát BUILD-időben ég bele az oldalba.** Railway-en a
változó beállítása után ÚJRA KELL BUILDELNI — és mivel a CSP-fejléc is
build-időben dől el (lásd lent), enélkül a GA némán blokkolódna.

## 3. Hogyan működik (architektúra)

- **Consent-kapu:** `src/components/analytics/GoogleAnalytics.tsx` (a
  `(frontend)` layoutban mountolva) betöltéskor a TÁROLT consentet olvassa, majd
  a `kc:analytics-consent` eseményre kapcsol be/ki oldalfrissítés nélkül.
  Az állapotgép közös a PostHoggal: `src/lib/analytics/consent.ts`
  (`kc_analytics_consent` localStorage-kulcs).
- **Betöltés:** `granted` esetén `src/lib/analytics/ga4.ts` szúr be egy async
  `<script src="https://www.googletagmanager.com/gtag/js?id=…">` elemet. A
  szerver-HTML-ben SOSEM szerepel GA-hivatkozás — hozzájárulás nélkül nincs mit
  blokkolni.
- **Consent Mode:** az első dataLayer-parancs mindig
  `consent default` (minden tároló `denied`), és csak utána megy ki a
  `consent update` (`analytics_storage: 'granted'`). Hirdetési tárolót
  (`ad_storage`, `ad_user_data`, `ad_personalization`) sosem engedélyezünk.
- **Visszavonás:** `denied` esetén a Google által dokumentált
  `window['ga-disable-<ID>'] = true` kapcsoló áll be (a már betöltött gtag.js
  ettől kezdve semmit nem küld), mellé `consent update` → `denied`. Ha a
  látogató elutasít, `dataLayer` létre sem jön.
- **Oldalletöltések:** a GA4 „Enhanced measurement" a böngésző-előzmény
  változására magától küld `page_view`-t, ezért — a PostHoggal ellentétben —
  itt NINCS kézi $pageview-küldés. (A PostHognál azért van, mert ott az
  automatikus pageview szándékosan kikapcsolt.)

## 4. CSP

A Google hostjai KIZÁRÓLAG beállított, érvényes mérési azonosító mellett
kerülnek a `Content-Security-Policy` fejlécbe (`src/lib/security/csp.ts`) —
GA nélkül a politika marad a lehető legszűkebb:

| Direktíva | GA-forrás |
|---|---|
| `script-src` | `https://www.googletagmanager.com` (a gtag.js) |
| `connect-src` | `https://*.google-analytics.com`, `https://*.analytics.google.com`, `https://www.googletagmanager.com` |
| `img-src` | `https://*.google-analytics.com`, `https://www.googletagmanager.com` |

A joker itt kötelező: a GA4 régió-specifikus gyűjtőhostokra küld
(`region1.google-analytics.com` stb.), pontos hostot nem lehet felsorolni. A
joker szabályos — a legbaloldalibb, TELJES címke helyén áll (a `vz-*` típusú,
érvénytelen jokerről lásd `src/lib/security/csp.ts`).

## 5. Ellenőrzés

1. Állítsd be a `NEXT_PUBLIC_GA_MEASUREMENT_ID`-t, majd **buildelj újra** és
   indítsd az appot.
2. Consent ELŐTT: a Network-fülön NEM szabad `googletagmanager.com` kérésnek
   lennie, és a `window.dataLayer` `undefined`.
3. A süti-sávon „Elfogadom" → azonnal (oldalfrissítés nélkül) megjelenik a
   `gtag/js?id=G-…` kérés, és indulnak a `google-analytics.com/g/collect`
   hívások.
4. Elutasítás/visszavonás után: `window['ga-disable-G-…'] === true`, és nem megy
   több `collect` kérés.
5. GA4 **Riportok → Valós idejű** nézetben perceken belül látszik a látogatás.

## 6. Mit NEM mérünk

- Semmit hozzájárulás nélkül (a kulcs beállítása önmagában nem indít mérést).
- Hirdetési/remarketing adatot (a Consent Mode `ad_*` jelzései sosem nyílnak meg).
- Fizetési/kártyaadatot (a Barion-folyamat külön szigeten fut).

## 7. Search Console és Google Ads (kineticare.hu)

A domain-átállás, a Search Console tulajdon és az Ads-fiók (ügyfélazonosító
822-497-2386, NEM `AW-…` címke) a `docs/kineticare-hu-atallas.md` runbookja.
A `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` üresen nincs meta; értéket a
GSC ad, a repóba nem írjuk. A `NEXT_PUBLIC_GOOGLE_ADS_ID` üresen marad,
amíg az `ad_storage` tiltása él — a kód nem nyit reklám-sütit.
