import type { Config, Plugin } from 'payload'
import { deepMergeSimple } from 'payload/shared'
import type { enTranslations as EcommerceAngol } from '@payloadcms/plugin-ecommerce/translations/languages/en'
import type { enTranslations as UrlapAngol } from '@payloadcms/plugin-form-builder/translations/languages/en'
import type { enTranslations as AlapAngol } from '@payloadcms/translations/languages/en'

/**
 * A Payload magyar admin-fordításának javításai (admin-audit K15 és K24).
 *
 * MIT JAVÍT. A @payloadcms/translations 3.88.0 magyar fájljában
 * (node_modules/@payloadcms/translations/dist/languages/hu.js) négy
 * helyőrzőt is lefordítottak, ezért nincs behelyettesítés, és a felület a
 * kapcsos zárójeleket mutatja: general.showAllLabel (:399, „{{címke}}”),
 * upload.sizesFor (:499), version.noRowsSelected (:564) és
 * general.movingCount (:339, „{{Count}}”). Az Irányítópult 16 kártyalinkjének
 * hozzáférhető neve így „Mutasd az összes {{címke}}” volt (WCAG 2.2 SC 2.4.4,
 * 4.1.2). A fájl ezen felül magáz, miközben a saját szövegeink tegeznek, egy
 * állapotra több szót használ, és van benne félrefordítás („Termés” a kivágás
 * helyett, „Jelölje ki az összes sort” a kijelölés MEGSZÜNTETÉSÉRE).
 *
 * HOGYAN ÉR CÉLT. A Payload a config `i18n.translations.hu` értékét a
 * nyelvfájl FÖLÉ fésüli, a config nyer (translations/dist/utilities/init.js:90,
 * `deepMergeSimple(translations, config.translations[language])`). Ide tehát
 * csak az eltérő kulcsok kellenek, a többit a nyelvfájl adja.
 *
 * MIÉRT A PLUGIN-LÁNC VÉGÉN. A pluginok a config tömb sorrendjében futnak
 * (payload/dist/config/build.js:7-13, a kísérleti `order` alapértéke 0, a
 * rendezés stabil), a szanitizálás a lánc UTÁN veszi át a fordításokat
 * (payload/dist/config/sanitize.js:133). A két plugin nem egyformán bánik a
 * config fordításaival:
 *  - a form-builder a saját fordítása FÖLÉ fésüli a configét, tehát a
 *    configban már meglévő érték megmarad
 *    (plugin-form-builder/dist/index.js:56);
 *  - az ecommerce viszont a fésülés után FELÜLÍRJA a teljes
 *    `translations[nyelv]['plugin-ecommerce']` névteret a saját példányával
 *    (plugin-ecommerce/dist/index.js:208, majd :214-229). Ami ezt megelőzően
 *    került a configba, az ebben a névtérben elveszik.
 * Ezért a javítás nem a config i18n-blokkjában, hanem egy plugin-láncot záró
 * pluginban fut: így a pluginok által betett névterekben is a mi értékünk nyer.
 *
 * AMI ÍGY NEM ÉRHETŐ EL. A Lexical szerkesztő fordításait a szanitizálás a
 * plugin-lánc UTÁN fésüli rá (sanitize.js:369-371, az editor nyer), ezért a
 * `lexical:*` kulcsokat ez a modul nem írhatja felül.
 *
 * NYELVI SZABÁLYOK (docs/ui-sztenderdek.md §2.7, §3.1, P-1 és a §8
 * Admin-szótár): tegező megszólítás; a felhasználó saját, elkötelező
 * cselekvését kimondó gomb és jelölőnégyzet E/1 („Maradok ezen az oldalon”,
 * „Megerősítem”), a megerősítő ablakot csak megnyitó gomb főnévi, a Payload
 * „Törlés” és „Visszaállítás” gombjával párhuzamosan; számnév után egyes szám
 * áll („3 elem”, nem „3 elemek”), ezért a számláló üzenetekben a címke a
 * kettőspont elé vagy zárójelbe kerül; magyar idézőjel („…”) és három pont
 * (…); gondolatjel-halmozás, felkiáltójel, „Kérjük” és a címkéző „érvénytelen”
 * nélkül. A megerősítő ablak nem kérdez rá („Biztos vagy benne?”, „Biztosan
 * …?”, „Biztos, hogy …?”), hanem kijelentő mondatban kimondja a következményt,
 * és ha van visszaút, azt is, hogy hol (NN/g, Confirmation Dialogs:
 * https://www.nngroup.com/articles/confirmation-dialog/). Egy fogalom, egy
 * szó, egy ablakon belül is (WCAG 2.2 SC 3.2.4): piszkozat, közzététel,
 * módosítás, szemetes, vásárló, duplikálás, visszatérés a közzétetthez. A
 * helyőrzők ({{…}}) és a <n> jelölők halmaza minden kulcsban azonos az angol
 * forráséval.
 *
 * A MEGERŐSÍTŐ ABLAKOK (ConfirmationModal). A jóváhagyó gomb szövege a
 * confirmLabel, ha nincs, a general.confirm (ui/dist/elements/
 * ConfirmationModal/index.js:119). Az elérhető ablakok jóváhagyó gombja E/1:
 * „Megerősítem”, „Elvetem”, „Duplikálom mentés nélkül”, „Továbblépek mentés
 * nélkül”. Három indokolt kivétel van. A tétlenségi ablak „Kijelentkezés”
 * gombja (StayLoggedIn/index.js:73) az authentication.logOut kulcsot a
 * navigáció kijelentkező ikonjával (Logout/index.js:40, :48) és a jogosultság
 * nélküli nézettel (next/dist/views/Unauthorized/index.js:42) osztja, a
 * docs/ui-sztenderdek.md §3.2 32. sora pedig főnévi (P-1c) alakot ír elő. A
 * mappa-áthelyezés (general.move) és az API-kulcs (authentication.generate)
 * ablaka ki van kapcsolva. A teljes listát az admin-forditas.test.ts söpri a
 * dist-forrásból, és a kivételeket a valódi configon igazolja. A
 * folyamatban-felirat nélküli ablakok (tétlenség, továbblépés, duplikálás,
 * irányítópult) a megerősítés alatt a Payload beégetett „Betöltés...”
 * szövegét mutatják (`${t('general:loading')}...`, ConfirmationModal/
 * index.js:119; mérve a duplikálásnál): ASCII három pont, fordítással nem
 * javítható.
 * A szövegek jelentését a hívási hely adja, nem a kulcs neve: a
 * general.unsavedChanges például a duplikáló ablak CÍMSORA.
 *
 * A KÖR. Csak a projektben elérhető felületek szövegei szerepelnek. A
 * mappák, a nyelvi változatok és az API-kulcs ki vannak kapcsolva; a szemetes
 * csak a Kurzusokon él, mert a plugin-ecommerce a products gyűjteményen
 * bekapcsolja (plugin-ecommerce/dist/collections/products/
 * createProductsCollection.js:52). Minden kulcs felhasználási helyét a ui,
 * next, richtext-lexical, plugin és payload dist-forrásban ellenőriztük (a nagy
 * exports-bundle-ök nélkül); felhasználó nélküli kulcs nem kerül ide.
 *
 * AZ ŐR. A src/__tests__/admin-forditas.test.ts nem csak a felülírt kulcsokat
 * nézi: a nyelvfájlt, a két plugin magyar fájlját és ezt a modult ugyanúgy
 * fésüli egybe, mint a Payload (init.js:90), és az írásszabályokat az ÖSSZES
 * kulcson ellenőrzi. Kivétel csak az ott felsorolt, indokolt és forrássorral
 * igazolt NEM_ELERHETO kulcs lehet (kikapcsolt funkció vagy hívás nélküli
 * kulcs); a teszt a kikapcsolást a valódi configon, a hívás hiányát a
 * dist-forrás söprésével ellenőrzi.
 *
 * Kivételek a „csak elérhető” szabály alól:
 *  - a form-builder fizetési mezőjének árfeltételei: a backlog (K24) a
 *    feltételt és az osztást kérte, a másik két művelet ugyanabban a listában
 *    áll; a mező ma ki van kapcsolva (plugin-form-builder/dist/index.js:20);
 *  - a K15 két kulcsa, a general.movingCount és a version.noRowsSelected: a
 *    3.88.0 felülete nem hívja őket (csak a translations/dist/clientKeys.js
 *    sorolja fel), de a hu.js-ben lefordított, tehát törött a helyőrzőjük.
 *    Ha egy későbbi verzió használni kezdi őket, ne kapcsos zárójelet mutasson;
 *  - a szemetes két piszkozat nélküli alakja, a general.aboutToRestore és az
 *    aboutToRestoreCount: a Kurzusokon van piszkozat, ezért ott a
 *    RestoreButton/index.js:150 és a RestoreMany/index.js:175 az „AsDraft”
 *    párjukat mutatja. Magázó, „Biztosan így szeretné?” szövegük azonban
 *    megjelenne, ha egy piszkozat nélküli gyűjteményen is lenne szemetes.
 */

/** Egy fordítási névtér: a forrás bármely kulcsa, szöveges értékkel. */
type ForditasiNevter<T> = { readonly [Kulcs in keyof T]?: string }

type AlapForditas = typeof AlapAngol

/**
 * A felülírás alakja: csak a forrásban létező névtér és kulcs írható, így a
 * gépelési hiba vagy a kivezetett kulcs már a típusellenőrzésen elbukik.
 */
export type HuAdminForditas = {
  readonly [Nevter in keyof AlapForditas]?: ForditasiNevter<AlapForditas[Nevter]>
} & {
  readonly 'plugin-ecommerce'?: ForditasiNevter<(typeof EcommerceAngol)['plugin-ecommerce']>
  readonly 'plugin-form-builder'?: ForditasiNevter<(typeof UrlapAngol)['plugin-form-builder']>
}

/** A Config `i18n.translations.hu` helyének típusa. */
type HuForditasHelye = NonNullable<NonNullable<NonNullable<Config['i18n']>['translations']>['hu']>

export const HU_ADMIN_FORDITAS = {
  authentication: {
    // Belépés, jelszó-visszaállítás, kijelentkezés és a tétlenségi ablak.
    alreadyLoggedIn: 'Már be vagy jelentkezve',
    beginCreateFirstUser: 'Kezdésként hozd létre az első felhasználót.',
    checkYourEmailForPasswordReset:
      'Ha ehhez az e-mail-címhez tartozik fiók, hamarosan megkapod a jelszó visszaállításához szükséges levelet. Ha nem látod a beérkezett levelek között, nézd meg a levélszemét mappát is.',
    emailNotValid: 'Adj meg egy teljes e-mail-címet (pl. nev@pelda.hu).',
    forgotPasswordEmailInstructions:
      'Add meg az e-mail-címed. Küldünk egy levelet, amelyben leírjuk, hogyan állíthatsz be új jelszót.',
    forgotPasswordQuestion: 'Elfelejtetted a jelszavad?',
    logBackIn: 'Jelentkezz be újra',
    loggedInChangePassword: 'A jelszavadat a <0>fiókodban</0> tudod megváltoztatni.',
    loggedOutInactivity: 'Mivel egy ideje nem csináltál semmit, kijelentkeztettünk.',
    loggedOutSuccessfully: 'Kijelentkeztél.',
    // A kijelentkezés közbeni töltőréteg (next/dist/views/Logout/LogoutClient.js:131).
    loggingOut: 'Kijelentkezés…',
    // A tétlenségi ablak címe ÉS a maradás gombja ugyanez a kulcs
    // (ui/dist/elements/StayLoggedIn/index.js:72-74), ezért E/1.
    stayLoggedIn: 'Bejelentkezve maradok',
    youAreInactive:
      'Egy ideje nem csináltál semmit, ezért a biztonságod érdekében hamarosan kijelentkeztetünk. Bejelentkezve maradsz?',
  },
  dashboard: {
    // Az Irányítópult szerkesztő módja (a morzsamenü „Irányítópult” lenyílója).
    addButton: 'Hozzáadás +',
    addWidget: 'Panel hozzáadása',
    deleteWidget: 'Panel törlése: {{id}}',
    // A szerkesztő mód „Mégsem” gombja (DashboardStepNav.js:115-118) ezt az
    // ablakot nyitja, ha az elrendezés változott (useDashboardLayout.js:58-70;
    // cím :159, szöveg :157, jóváhagyó gomb :158). Az elvetés csak a
    // képernyőn visszaállítja a kiinduló elrendezést (:54-57), preferenciát nem
    // ír: a mentetlen módosítás így valóban elvész. A visszaút a „Mégsem”,
    // utána a sáv „Módosítások mentése” gombja (fields.saveChanges,
    // DashboardStepNav.js:113).
    discardConfirmLabel: 'Elvetem',
    discardMessage:
      'Ha elveted, az irányítópult elrendezésén végzett, mentetlen módosításaid elvesznek. Ha megtartanád őket, válaszd a „Mégsem”, majd a „Módosítások mentése” gombot.',
    discardTitle: 'Elveted a módosításokat?',
    editDashboard: 'Irányítópult szerkesztése',
    editingDashboard: 'Az irányítópult szerkesztése',
    noItems: 'Az irányítópulton nincs panel. A felső sáv „Irányítópult” menüjéből adhatsz hozzá.',
    searchWidgets: 'Panel keresése…',
  },
  error: {
    // A mentési hibaüzenet első kettőspontja választja le a mezőlistát
    // (ui/dist/elements/Toasts/fieldErrors.js, createErrorsFromMessage), ezért
    // a két alak pontosan egy kettősponttal, a végén zárul.
    correctInvalidFields: 'Javítsd a hibát jelző mezőket.',
    deletingTitle:
      'Nem sikerült törölni ezt: {{title}}. Ellenőrizd az internetkapcsolatot, és próbáld újra.',
    documentNotFound:
      'Nem található dokumentum ezzel az azonosítóval: {{id}}. Lehet, hogy törölték, sosem létezett, vagy nincs hozzá jogosultságod.',
    followingFieldsInvalid_one: 'Javítsd ezt a mezőt:',
    followingFieldsInvalid_other: 'Javítsd ezeket a mezőket:',
    invalidClipboardData: 'A vágólapon lévő tartalom ide nem illeszthető be.',
    invalidFileType: 'Ez a fájltípus nem tölthető fel ide.',
    notAllowedToAccessPage: 'Ehhez az oldalhoz nincs hozzáférésed.',
    notAllowedToPerformAction: 'Ehhez a művelethez nincs jogosultságod.',
    // A szemetesből visszaállítás hibája (ui/dist/elements/RestoreButton/
    // index.js:62), a deletingTitle párja.
    restoringTitle:
      'Nem sikerült visszaállítani ezt: {{title}}. Ellenőrizd az internetkapcsolatot, és próbáld újra.',
    unauthorized: 'Ehhez be kell jelentkezned.',
    unauthorizedAdmin: 'Ezzel a fiókkal nem lehet belépni az adminba.',
    // A tömeges törlés és módosítás részleges hibája (payload/dist/collections/
    // endpoints/delete.js:42-46, update.js:48-52): {{count}} a sikertelen, a
    // {{total}} az összes elem, a címke 1 elemnél egyes, különben többes számú.
    unableToDeleteCount: '{{label}}: {{count}} elemet nem sikerült törölni ({{total}} elemből).',
    unableToUpdateCount: '{{label}}: {{count}} elemet nem sikerült módosítani ({{total}} elemből).',
  },
  fields: {
    chooseBetweenCustomTextOrDocument:
      'Adj meg egy URL-t, vagy válassz egy dokumentumot, amelyre a link mutasson.',
    chooseDocumentToLink: 'Válaszd ki a dokumentumot, amelyre a link mutasson',
    chooseFromExisting: 'Válassz a meglévők közül',
    // A tömb- és blokkmezők fejlécének két gombja: a felhasználó saját
    // cselekvése, ezért E/1, egymással párhuzamos alakban.
    collapseAll: 'Mindet összecsukom',
    editRelationship: 'Kapcsolat szerkesztése',
    enterURL: 'Add meg az URL-t',
    selectFieldsToEdit: 'Válaszd ki a szerkesztendő mezőket',
    showAll: 'Mindet kinyitom',
    swapRelationship: 'Kapcsolat cseréje',
    swapUpload: 'Feltöltés cseréje',
    // A kinyitó gomb neve a nyitott és a csukott állapotban is ez
    // (ui/dist/elements/Collapsible/index.js:99-106), ezért mindkettőt mondja.
    toggleBlock: 'Kinyitás vagy összecsukás',
  },
  general: {
    // A leggyakoribb törlő ablak: minden szemetes nélküli gyűjtemény
    // „Törlés” menüpontja (ui/dist/elements/DeleteDocument/index.js:148), a
    // {{label}} egyes számú, a {{title}} a cím vagy az azonosító (:151-152).
    // A tömeges párja a DeleteMany/index.js:358. A törlés a verziókat is
    // törli (payload/dist/collections/operations/deleteByID.js:98-101,
    // delete.js:125-128), visszaút nincs. Kijelentő mondat, a szemetes
    // ablakcsalád (aboutToPermanentlyDelete*) szerkezetével párhuzamosan.
    aboutToDelete:
      'Véglegesen törlöd ezt: <1>{{title}}</1> ({{label}}). A törlés nem vonható vissza.',
    aboutToDeleteCount_many:
      '{{count}} elemet törölsz véglegesen ({{label}}). A törlés nem vonható vissza.',
    aboutToDeleteCount_one:
      '{{count}} elemet törölsz véglegesen ({{label}}). A törlés nem vonható vissza.',
    aboutToDeleteCount_other:
      '{{count}} elemet törölsz véglegesen ({{label}}). A törlés nem vonható vissza.',
    // A SZEMETES. Csak a Kurzusokon él (a modul fejkommentje). A szemetesbe
    // tett elemet a find és a findByID alapból kizárja (payload/dist/utilities/
    // appendNonTrashedFilter.js, collections/operations/find.js:81-86), a
    // kapcsolatból pedig null lesz (fields/hooks/afterRead/
    // relationshipPopulationPromise.js:43-46): a kurzusoldal és a vásárló
    // lejátszója (kurzusaim/[id]) is eltűnik. Ezt a törlő ablak kimondja.
    // A DeleteDocument/index.js:148 és a DeleteMany/index.js:355 mutatja; a
    // {{label}} egy elemnél egyes, többnél többes számú. Ugyanebben az
    // ablakban áll a „Véglegesen törlöm, nem teszem a szemetesbe”
    // jelölőnégyzet (DeleteDocument/index.js:154-163, DeleteMany/index.js:
    // 362-371); bejelölve a törlés végleges, a szöveg viszont nem változik.
    // Ezért mindkét ágat kimondja („kivéve, ha bejelölöd…”). A négyzet ott
    // van, ahol ez a szöveg: a szemetes- és a törlési jogot ugyanaz az
    // access.delete adja (next/dist/views/Document/getDocumentPermissions.js:
    // 47-66, a lista is ezt hívja: next/dist/views/List/index.js:262-266), a
    // Kurzusokon ez az adatfüggetlen isAdmin.
    aboutToTrash:
      'A szemetesbe teszed ezt: <1>{{title}}</1> ({{label}}), kivéve, ha bejelölöd a lenti négyzetet: akkor véglegesen törlöd, és ez nem vonható vissza. Amíg a szemetesben van, a weboldalon senki nem éri el, a vásárlók sem, és onnan visszaállíthatod.',
    aboutToTrashCount:
      '{{count}} elemet teszel a szemetesbe ({{label}}), kivéve, ha bejelölöd a lenti négyzetet: akkor véglegesen törlöd őket, és ez nem vonható vissza. Ami a szemetesben van, azt a weboldalon senki nem éri el, a vásárlók sem, és onnan visszaállíthatod.',
    // A szemetesben lévő elem „Végleges törlés” gombja
    // (PermanentlyDeleteButton/index.js:127-137), valamint a szemetes lista
    // tömeges törlése és „Szemetes ürítése” gombja (DeleteMany/index.js:349,
    // ListEmptyTrashButton.js:157).
    aboutToPermanentlyDelete:
      'Véglegesen törlöd ezt: <1>{{title}}</1> ({{label}}). Utána senki nem éri el, a vásárlók sem, és a törlés nem vonható vissza.',
    aboutToPermanentlyDeleteTrash:
      'A szemetesből <0>{{count}}</0> elemet törölsz véglegesen (<1>{{label}}</1>). A törlés nem vonható vissza.',
    // Visszaállítás a szemetesből (RestoreButton/index.js:150, RestoreMany/
    // index.js:175). Piszkozatos gyűjteményben a PATCH _status: 'draft'-ot
    // küld, a jelölőnégyzettel 'published'-et (RestoreButton/index.js:92,
    // RestoreMany/index.js:121).
    aboutToRestore:
      'Visszaállítod ezt: <1>{{title}}</1> ({{label}}). Utána a weboldalon újra elérhető.',
    aboutToRestoreAsDraft:
      'Visszaállítod ezt: <1>{{title}}</1> ({{label}}). Piszkozatként kerül vissza, a látogatók csak a közzététele után látják. Ha rögtön közzé is tennéd, jelöld be a lenti négyzetet.',
    aboutToRestoreAsDraftCount:
      'A szemetesből {{count}} elemet állítasz vissza piszkozatként ({{label}}). A piszkozatot a látogatók nem látják. Ha rögtön közzé is tennéd, jelöld be a lenti négyzetet.',
    aboutToRestoreCount: 'A szemetesből {{count}} elemet állítasz vissza ({{label}}).',
    // A lista füle `${all} ${többes címke}` alakban (ui/dist/elements/
    // DefaultListViewTabs/index.js:76, :113): „Összes: Kurzusok”. A fül
    // id-je is ebből képződik („összes:-kurzusok”), a src/ nem hivatkozik rá.
    all: 'Összes:',
    // A szűrőpanel ÉS-kapcsolata (ui/dist/elements/WhereBuilder/index.js:177).
    and: 'és',
    // A „mentés nélkül távozol” ablak: cím = leaveWithoutSaving, szöveg =
    // changesNotSaved, maradás = stayOnThisPage, továbblépés = leaveAnyway
    // (ui/dist/elements/LeaveWithoutSaving/index.js:138-141).
    changesNotSaved: 'A módosításaid nincsenek mentve. Ha most továbblépsz, elvesznek.',
    // A saját confirmLabel nélküli megerősítő ablakok jóváhagyó GOMBJA
    // (ui/dist/elements/ConfirmationModal/index.js:119: törlés, szemetes,
    // visszaállítás, közzététel visszavonása, verzió visszaállítása,
    // visszatérés a közzétetthez, beállítások visszaállítása), és a tömeges
    // közzétételé (PublishMany/DrawerContent.js:149): a felhasználó
    // elkötelező cselekvése, ezért E/1 (P-1a).
    confirm: 'Megerősítem',
    confirmRestoration: 'Visszaállítás megerősítése',
    // A {{label}} négy helyen kap értéket, egyszer többes, háromszor egyes
    // számú gyűjteménynevet:
    //  - ui/dist/widgets/CollectionCards/index.js:111, az Irányítópult „+”
    //    gombjának aria-labelje, többes szám („Új létrehozása: Képek”);
    //  - ui/dist/elements/ListHeader/TitleActions/ListCreateNewDocButton.js:28,
    //    a lista fejlécgombjának aria-labelje, egyes szám; a gomb látható
    //    szövege a general.createNew („Új létrehozása”), a név tehát azzal
    //    kezdődik (WCAG 2.2 SC 2.5.3);
    //  - ui/dist/views/List/index.js:201-207, az üres lista gombja, egyes szám;
    //  - ui/dist/elements/RelationshipTable/index.js:244, a kapcsolat-táblázat
    //    üres állapotának gombja, egyes szám.
    // A címke a kettőspont után mindkét számban helyes, ragot nem kap.
    createNewLabel: 'Új létrehozása: {{label}}',
    createdAt: 'Létrehozva',
    // A törlő ablak jelölőnégyzete a szemetes helyett (DeleteDocument/
    // index.js:159, DeleteMany/index.js:367): saját döntés, ezért E/1.
    deletePermanently: 'Véglegesen törlöm, nem teszem a szemetesbe',
    // A szemetes rejtett deletedAt mezőjének címkéje
    // (payload/dist/collections/config/sanitize.js:143), és a szemetesben
    // lévő elem fejlécének dátumcímkéje (ui/dist/elements/DocumentControls/
    // index.js:200, „Szemetesbe helyezve: 2026. 09. 23. 01:38”). A „Törölt”
    // tévesen végleges törlést sugallna.
    deleted: 'Szemetesbe helyezve',
    deletedAt: 'Szemetesbe helyezve',
    // A számláló üzenetekben a címke elöl, kettőspont után a szám és az
    // egyes számú „elem” áll, mert a {{label}} a darabszámtól függően egyes
    // vagy többes (DeleteMany/index.js:250-262, RestoreMany/index.js:137-141,
    // PublishMany/DrawerContent.js:109-113, collections/endpoints/
    // delete.js:25-27, update.js:31-33, ListEmptyTrashButton.js:109-111).
    deletedCountSuccessfully: '{{label}}: {{count}} elem törölve.',
    deleting: 'Törlés…',
    deselectAllRows: 'Kijelölés megszüntetése az összes soron',
    // A szemetesben lévő elem sávja (ui/dist/elements/TrashBanner/index.js:31,
    // egyes számú címke); a gomb neve a general.restore („Visszaállítás”).
    documentIsTrashed:
      'Ez az elem ({{label}}) a szemetesben van, ezért csak olvasható. Szerkesztéshez előbb állítsd vissza a Visszaállítás gombbal.',
    // A DUPLIKÁLÓ ABLAK (ui/dist/elements/DuplicateDocument/index.js:152-157):
    // a „Duplikálás” menüpont (:137, :151) csak mentetlen módosításnál nyitja
    // (:143-144), címe a general.unsavedChanges, szövege az
    // unsavedChangesDuplicate, jóváhagyó gombja ez. A jóváhagyás után a
    // szerver a legutóbb MENTETT állapotot duplikálja (POST /<gyűjtemény>/<id>/
    // duplicate, :86-96; payload/dist/collections/operations/create.js:55-63
    // getDuplicateDocumentData), az admin a módosítás-jelzőt törli (:106), és
    // az új elemre navigál (:107-111): a mentetlen módosítás így nem kerül a
    // duplikátumba, és az eredeti elemen sem marad meg. Egy ablakban egy
    // fogalomra egy szó: duplikálás (a menüpont „Duplikálás”), nem másolás.
    duplicateWithoutSaving: 'Duplikálom mentés nélkül',
    // A tömeges szerkesztés fiókjának címe (EditMany/DrawerContent.js:347-350,
    // BulkUpload/EditMany/DrawerContent.js:131-134): count > 1 esetén többes
    // számú címke („3 Oldalak” helyett „Oldalak: 3 elem”).
    editingLabel_many: '{{label}}: {{count}} elem szerkesztése',
    editingLabel_one: '{{label}}: {{count}} elem szerkesztése',
    editingLabel_other: '{{label}}: {{count}} elem szerkesztése',
    // A szemetes lista gombja megerősítő ablakot nyit, ezért főnévi, mint az
    // „Új létrehozása”. Az aria-labelje (ListEmptyTrashButton.js:132-134,
    // többes címke) a látható szöveggel kezdődik (WCAG 2.2 SC 2.5.3).
    emptyTrash: 'Szemetes ürítése',
    emptyTrashLabel: 'Szemetes ürítése: {{label}}',
    enterAValue: 'Adj meg egy értéket',
    // Az egyetlen felhasználás: „{szám} {hiba}” a hibajelző címkén
    // (ui/dist/elements/ErrorPill/index.js:26); számnév után egyes szám.
    errors: 'hiba',
    // A szűrőpanel fejléce, többes számú címkével (ui/dist/elements/
    // WhereBuilder/index.js:156): „Oldalak szűrése, ahol:”.
    filterWhere: '{{label}} szűrése, ahol:',
    leaveAnyway: 'Továbblépek mentés nélkül',
    leaveWithoutSaving: 'Továbblépsz mentés nélkül?',
    movingCount: '{{label}}: {{count}} elem áthelyezése',
    noLabel: '({{label}} nincs megadva)',
    noResultsDescription:
      'Még nincs ilyen elem, vagy egyik sem felel meg a keresésnek és a szűrőknek. Próbálj más keresőszót, vagy töröld a szűrőket.',
    // Az üres szemetes, többes számú címkével (ui/dist/views/List/index.js:212).
    noTrashResults: 'A szemetes üres ({{label}}).',
    // Mondat közben álló kötőszó (ui/dist/elements/ListControls/index.js:70, a
    // kereső helyőrzője: „… Cím vagy Webcím”; WhereBuilder/index.js:166, :210;
    // Upload/index.js:393, :408; fields/Upload/Input.js:574, :593), ezért
    // kisbetűs. A szűrőpanel „+ vagy” gombján is ez áll.
    or: 'vagy',
    // A szemetesben lévő elem gombja: megerősítő ablakot nyit, főnévi, mint a
    // mellette álló „Visszaállítás” (PermanentlyDeleteButton/index.js:127).
    permanentlyDelete: 'Végleges törlés',
    permanentlyDeletedCountSuccessfully: '{{label}}: {{count}} elem véglegesen törölve.',
    // A visszaállító ablak jelölőnégyzete (RestoreButton/index.js:161,
    // RestoreMany/index.js:183): saját döntés, ezért E/1.
    restoreAsPublished: 'Visszaállítom, és rögtön közzé is teszem',
    restoredCountSuccessfully: '{{label}}: {{count}} elem visszaállítva.',
    // A Kurzusok szemetesének visszaállító gombjai mutatják (ui/dist/elements/
    // RestoreButton/index.js:168, RestoreMany/index.js:190). A hu.js:385-ben
    // itt egy gépi fordító utasítás-szövege maradt a fordítás helyén.
    restoring: 'Visszaállítás…',
    // Az autosave-es szerkesztők állapotsora, a version.lastSavedAgo helyén
    // (ui/dist/elements/Autosave/index.js:199).
    saving: 'Mentés…',
    // Egyetlen elérhető felhasználás: a lista tömeges kiválasztó gombja
    // „{select} {szám}” alakban (ui/dist/elements/SelectMany/index.js:28),
    // így „Kiválasztás: 3”. A másik hely, a MoveToFolder mentés gombja
    // (FolderView/Drawers/MoveToFolder/index.js:319) csak mappás
    // gyűjteményben jelenik meg, és a projektben egy gyűjteményen sincs mappa.
    select: 'Kiválasztás:',
    // A listában „minden oldal kijelölése” gomb (ui/dist/views/List/
    // ListSelection/index.js:57-67). A {{count}} zárójeles összeg („(25)”); a
    // látható szöveg ÜRES címkét kap, az aria-label a többes számút. A címke
    // ezért a szám ELÉ kerül: látható „Az összes kijelölése (25)”, a név
    // „Az összes kijelölése Oldalak (25)”, a látható szöveg szavaival
    // kezdődik (WCAG 2.2 SC 2.5.3), és számnév után nem áll többes címke.
    selectAll: 'Az összes kijelölése {{label}} {{count}}',
    selectAllRows: 'Az összes sor kijelölése',
    selectValue: 'Válassz egy értéket',
    // A {{label}} a gyűjtemény többes számú neve (ui/dist/widgets/
    // CollectionCards/index.js:65-68): „Képek listájának megnyitása”. A látható
    // kártyacím a név elején áll (WCAG 2.2 SC 2.5.3).
    showAllLabel: '{{label}} listájának megnyitása',
    sorryNotFound:
      'Ezen a címen nincs oldal az adminban. Ellenőrizd a címet, vagy menj vissza az irányítópultra.',
    stayOnThisPage: 'Maradok ezen az oldalon',
    // Az űrlap mentésének toast-ja (ui/dist/forms/Form/index.js:240).
    submitting: 'Beküldés…',
    titleDeleted: '{{label}} törölve: „{{title}}”.',
    titleRestored: '{{label}} visszaállítva: „{{title}}”.',
    titleTrashed: '{{label}} a szemetesbe került: „{{title}}”.',
    // A lista füle, a morzsamenü és a böngészőfül címe (DefaultListViewTabs/
    // index.js:128, views/List/index.js:137, next/dist/views/CollectionTrash/
    // metadata.js:15).
    trash: 'Szemetes',
    trashedCountSuccessfully: '{{label}}: {{count}} elem a szemetesbe került.',
    // A duplikáló ablak CÍMSORA (DuplicateDocument/index.js:155), az egyetlen
    // elérhető hívás: a CopyLocaleData/index.js:161 csak nyelvi változatoknál
    // fut. A cím a jóváhagyó gombra kérdez, mint a „Továbblépsz mentés
    // nélkül?” ablak.
    unsavedChanges: 'Duplikálod mentés nélkül?',
    unsavedChangesDuplicate:
      'A duplikátum a legutóbb mentett állapotból jön létre. A mentetlen módosításaid nem kerülnek bele, és a duplikálás után ebből az elemből is elvesznek. Ha meg akarod tartani őket, válaszd a „Mégsem” gombot, és előbb mentsd a módosításokat.',
    updatedAt: 'Módosítva',
    updatedCountSuccessfully: '{{label}}: {{count}} elem módosítva.',
    // Az első felhasználó létrehozásának címe (next/dist/views/
    // CreateFirstUser/index.js:76).
    welcome: 'Üdvözlünk',
  },
  upload: {
    crop: 'Kivágás',
    cropToolDescription:
      'Húzd a kijelölt terület sarkait, rajzolj új területet, vagy állítsd be a lenti értékeket.',
    // Mindhárom helyen „{vagy} {húzz…}” formában áll (ui/dist/elements/Upload/
    // index.js:408, fields/Upload/Input.js:593, BulkUpload/AddFilesView:55),
    // a general.or után, ezért kisbetűvel indul.
    dragAndDrop: 'húzz ide egy fájlt',
    focalPointDescription:
      'Húzd a fókuszpontot közvetlenül az előnézeten, vagy állítsd be a lenti értékeket.',
    // A választó fiók gyűjtemény-választója, ha több gyűjteményből lehet
    // választani (ui/dist/elements/ListHeader/DrawerRelationshipSelect/
    // index.js:67): a rich text alapfunkciói közül a kapcsolat és a feltöltés.
    selectCollectionToBrowse: 'Válaszd ki a gyűjteményt, amelyben keresel',
    selectFile: 'Válassz egy fájlt',
    setCropArea: 'Kivágási terület beállítása',
    setFocalPoint: 'Fókuszpont beállítása',
    sizesFor: 'Méretek: {{label}}',
  },
  validation: {
    emailAddress: 'Adj meg egy teljes e-mail-címet (pl. nev@pelda.hu).',
    enterNumber: 'Adj meg egy számot.',
    invalidBlock: 'Ez a blokk itt nem használható: „{{block}}”.',
    invalidInput: 'A mezőben megadott érték nem megfelelő. Javítsd, és próbáld újra.',
    invalidSelection: 'Ez a választás itt nem használható. Válassz a listából.',
    invalidSelections: 'Ezek a választások itt nem használhatók:',
    limitReached: 'Elérted a korlátot: legfeljebb {{max}} elem adható hozzá.',
    notValidDate: 'Ez nem értelmezhető dátumként: „{{value}}”. Válaszd ki a dátumot a naptárból.',
    required: 'Ez a mező nem maradhat üres.',
    // A tömb- és blokkmezők sorszám-korlátja (payload/dist/fields/
    // validations.js:266-280, fields/Array/index.js:420-423, fields/Blocks/
    // index.js:436-439). A {{label}} a mező egyes vagy többes címkéje, vagy a
    // general.rows / general.row („Sorok”, „Sor”), ezért zárójelben áll, a
    // számnév után pedig az egyes számú „elem”. Elérhető: Pages.ts:321,
    // Posts.ts:254 és :265 (maxRows), CoursePackage.ts:14 (minRows).
    requiresAtLeast: 'Adj hozzá legalább {{count}} elemet ({{label}}).',
    requiresNoMoreThan:
      'Itt legfeljebb {{count}} elem lehet ({{label}}). Törölj közülük, amíg ennyi nem marad.',
  },
  version: {
    // A megerősítő ablakok nem kérdeznek rá („Biztos vagy benne?”), hanem
    // kimondják a következményt (NN/g, Confirmation Dialogs:
    // https://www.nngroup.com/articles/confirmation-dialog/).
    // Tömeges közzététel: a PATCH ?draft=true _status: 'published' a
    // legutóbbi mentett verziót teszi közzé (PublishMany/DrawerContent.js:92-101).
    aboutToPublishSelection:
      'Közzéteszed a kijelölt elemeket ({{label}}). A látogatók azonnal a legutóbb mentett verziójukat látják.',
    // A VERZIÓ VISSZAÁLLÍTÁSA (next/dist/views/Version/Restore/index.js). Egy
    // ablak, egy szöveg (:42-45, :96-102), három ág, mindegyikre igaz:
    //  (a) közzétett verzió, fő gomb („A verzió visszaállítása”, :94):
    //      POST …/versions/<id>?draft=false (:54); a restoreVersion a verzió
    //      _status-át tartja meg és a fő dokumentumot átírja (payload/dist/
    //      collections/operations/restoreVersion.js:206-215), a weboldalon
    //      azonnal ez a verzió látszik;
    //  (b) közzétett verzió, „Visszaállítás piszkozatként” (a fő gomb
    //      lenyílója, :88-93, csak ha canRestoreAsDraft, :46): ?draft=true,
    //      a fő dokumentum nem íródik (:207), csak új piszkozat verzió
    //      készül (:219), a weboldal nem változik;
    //  (c) piszkozat verzió, fő gomb: lenyíló nincs (:46, status !==
    //      'draft'), ?draft=false, a fő dokumentum piszkozat lesz (:206), a
    //      lap a weboldalon nem látszik (mérve: anonim 404), amíg a
    //      „Módosítások közzététele” (version.publishChanges, PublishButton/
    //      index.js:63) gombbal közzé nem teszik.
    // A szöveg nyilat nem említ (piszkozat verziónál nincs), a két
    // gombnevet betűre idézi (version.restoreAsDraft, version.publishChanges),
    // és a következményt ugyanazokkal a szavakkal mondja, mint az
    // ElonezetAllapot doboza („piszkozat verzió”, „nem látszik a
    // weboldalon”, SC 3.2.4). A {{label}} gyűjteménynév (Oldal,
    // Blogbejegyzés, Kurzus), ezért zárójelben áll, névelő nélkül.
    // Upstream hiba (3.88, K53-típusú): a lenyíló a draft állapotot true-ra
    // állítja (:90), a Mégsem nem állítja vissza (:38, a ConfirmationModal
    // onCancel nélkül). Ugyanabban a nézetben a fő gomb ezután is
    // piszkozatként állít vissza (mérve: POST …/versions/<id>?draft=true), a
    // (b) ág fut, a weboldal nem változik. A szöveg feltétele („kivéve, ha …
    // választottad”) erre az útra is igaz, de a fő gombtól közzétételt váró
    // szerkesztőt meglepheti; ez fordítással nem javítható. A lenyíló nyíl
    // gombjának nincs hozzáférhető neve (csak ikon, aria-label nélkül:
    // ui/dist/elements/Button/index.js:157-173, Popup/PopupTrigger/
    // index.js:41-48; mérve a DOM-ban), ez is upstream.
    aboutToRestore:
      'Ezt a dokumentumot ({{label}}) erre a verzióra állítod vissza: {{versionDate}}. Közzétett verziónál a weboldalon azonnal ez látszik, kivéve, ha a „Visszaállítás piszkozatként” lehetőséget választottad: akkor a weboldal nem változik. Piszkozat verzió visszaállítása után a lap nem látszik a weboldalon, amíg a „Módosítások közzététele” gombbal közzé nem teszed.',
    // A „Visszatérés a közzétetthez” ablaka (ui/dist/elements/Status/
    // index.js:135-148, csak „Közzé nem tett módosítás” állapotban). A
    // jóváhagyás a közzétett dokumentumot kéri le (:78, draft nélkül), és
    // draft nélkül visszaküldi (:85, PATCH): a közzétett tartalom változatlanul
    // újra közzé kerül, a szerkesztő ezt tölti be (:101). Semmi nem törlődik: a
    // piszkozat verziók a Verziók között megmaradnak (mérve). A visszaút egy
    // piszkozat verzió visszaállítása, ennek következménye a (c) ág.
    aboutToRevertToPublished:
      'A szerkesztőbe a közzétett verzió töltődik be, a weboldalon továbbra is ez látszik. A piszkozat verziók nem vesznek el, a Verziók között megmaradnak. Ha egyet közülük visszaállítasz, a lap nem látszik a weboldalon, amíg a „Módosítások közzététele” gombbal közzé nem teszed.',
    aboutToUnpublish:
      'Ha visszavonod a közzétételt, a látogatók nem látják többé. A tartalma piszkozatként megmarad, később újra közzéteheted.',
    aboutToUnpublishSelection:
      'Ha visszavonod a kijelölt elemek közzétételét ({{label}}), a látogatók nem látják többé őket. A tartalmuk piszkozatként megmarad, később újra közzéteheted őket.',
    changed: 'Közzé nem tett módosítás',
    changedFieldsCount_one: '{{count}} módosított mező',
    changedFieldsCount_other: '{{count}} módosított mező',
    // A „Visszatérés a közzétetthez” ablakának címe (Status/index.js:145). A
    // megnyitó gomb szövege a core version.revertToPublished („Visszatérés a
    // közzétetthez”, :141), ezért a cím és a folyamatban-felirat is
    // „Visszatérés”: egy fogalomra egy szó, és nem keverhető a verzió
    // „Visszaállítás”-ával (SC 3.2.4).
    confirmRevertToSaved: 'Visszatérés a közzétett verzióhoz',
    currentDraft: 'Jelenlegi piszkozat',
    draftHasPublishedVersion: 'Közzétéve, közzé nem tett módosítással',
    // Az autosave-es szerkesztők állapotsora (ui/dist/elements/Autosave/
    // index.js:200). A {{distance}}-t a formatTimeToNow adja
    // (ui/dist/utilities/formatDocTitle/formatDateTitle.js:24-31), amely a
    // date-fns formatDistanceToNow-t addSuffix NÉLKÜL hívja, ezért a magyar
    // kimenet alanyeset: „kevesebb mint 1 perc”, „5 perc”, „körülbelül 1 óra”
    // (date-fns/locale/hu/_lib/formatDistance.js, withoutSuffixes). Az
    // „ezelőtt” -val/-vel ragot kívánna („5 perccel ezelőtt”), a változóra
    // viszont ragot nem tehetünk. Ezért áll a mondat végén, rag és utótag
    // nélkül, egy olyan szerkezetben, amelyben az alanyeset helyes.
    lastSavedAgo: 'Utolsó mentés óta: {{distance}}',
    modifiedOnly: 'Csak a módosított mezők',
    // A verzió-összehasonlító lenyíló utolsó eleme (next/dist/views/Version/
    // SelectComparison/index.js:32).
    moreVersions: 'További verziók…',
    noLabelGroup: 'Névtelen csoport',
    noRowsSelected: 'Nincs kijelölt elem ({{label}})',
    previousVersion: 'Előző verzió',
    // A szemetesben lévő, sosem közzétett elem állapota (ui/dist/elements/
    // Status/index.js:60, `version:${displayStatusKey}`), a
    // previouslyPublished párja.
    previouslyDraft: 'Korábban piszkozat',
    previouslyPublished: 'Korábban közzétéve',
    published: 'Közzétéve',
    // A megerősítő ablakok folyamatban-feliratai (P-1d): Version/Restore/
    // index.js:98, Status/index.js:144, UnpublishButton/index.js:187,
    // UnpublishMany/DrawerContent.js:140. A reverting a „Visszatérés a
    // közzétett verzióhoz” ablaké (confirmRevertToSaved, Status/index.js:144).
    restoring: 'Visszaállítás…',
    reverting: 'Visszatérés…',
    selectVersionToCompare: 'Válassz egy verziót az összehasonlításhoz',
    unpublishedSuccessfully: 'A közzététel visszavonva.',
    unpublishing: 'Közzététel visszavonása…',
    // A verzió-összehasonlító két időcímkéje (next/dist/views/Version/Default/
    // index.js:134-145). A {{distance}} ugyanúgy alanyeset, mint a
    // lastSavedAgo-nál (formatTimeToNow, addSuffix nélkül), ezért nem
    // „{{distance}} ezelőtt”, hanem egy alanyesetet kívánó szerkezet.
    versionAgo: 'Mentése óta eltelt: {{distance}}',
  },
  'plugin-ecommerce': {
    customer: 'Vásárló',
    customerEmail: 'Vásárló e-mail-címe',
  },
  'plugin-form-builder': {
    // A fizetési mező árfeltételei (a backlog kérése); a négy művelet egy
    // listában áll, ezért egységes főnévi alakot kap.
    add: 'Összeadás',
    condition: 'Feltétel',
    divide: 'Osztás',
    multiply: 'Szorzás',
    // Az Űrlapok szerkesztőjének látható szövegei.
    checkboxPlural: 'Jelölőnégyzetek',
    chooseConfirmationType:
      'Válaszd ki, hogy beküldés után üzenet jelenjen meg az oldalon, vagy a látogató egy másik oldalra kerüljön.',
    documentToLinkTo: 'Hivatkozott dokumentum',
    emailFrom: 'Feladó',
    emailTo: 'Címzett',
    emailsDescription:
      'Az űrlap beküldésekor egyedi e-maileket küldhetsz. Ha ugyanazt a levelet több címzettnek küldenéd, vesszővel válaszd el a címeket. Ha az űrlap egy mezőjének értékére hivatkoznál, írd a mező nevét dupla kapcsos zárójelbe, például {{firstName}}. A {{*}} az összes adatot beilleszti, a {{*:table}} pedig HTML-táblázatként formázza őket a levélben.',
    messageDescription: 'Írd be a levélben elküldendő üzenetet.',
    replyTo: 'Válaszcím',
    selectOptions: 'A legördülő lista elemei',
    selectPlural: 'Legördülő listák',
    selectSingular: 'Legördülő lista',
    statePlural: 'Állammezők',
    stateSingular: 'Állam',
    submitButton: 'A küldés gomb felirata',
    textareaPlural: 'Többsoros szövegmezők',
    textareaSingular: 'Többsoros szöveg',
    urlToRedirectTo: 'Átirányítás címe (URL)',
  },
} satisfies HuAdminForditas

/**
 * A plugin-láncot ZÁRÓ plugin: a HU_ADMIN_FORDITAS-t mélyen a `hu` nyelvbe
 * fésüli, a mi értékünk nyer. A többi nyelv és a nem felülírt kulcsok
 * érintetlenek; kétszeri futtatás ugyanazt adja (idempotens). A bemeneti
 * config és a HU_ADMIN_FORDITAS nem módosul: a fésülés másolatra fut.
 */
export const huAdminForditasPlugin: Plugin = (config) => {
  const forditasok = config.i18n?.translations ?? {}
  const meglevoHu: object = forditasok.hu ?? {}
  return {
    ...config,
    i18n: {
      ...config.i18n,
      translations: {
        ...forditasok,
        hu: deepMergeSimple<HuForditasHelye>(meglevoHu, structuredClone(HU_ADMIN_FORDITAS)),
      },
    },
  }
}
