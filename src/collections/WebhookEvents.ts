import type { Access, CollectionConfig } from 'payload'

/**
 * Webhook-events collection (T-014) — fizetési/ügyfél-események idempotens
 * feldolgozásának nyilvántartása.
 *
 * Minden bejövő provider-webhook (Barion, videó-szolgáltató, Számlázz.hu) itt
 * kap egy rekordot a feldolgozás előtt; a (provider, externalId) pár egyedi,
 * így ugyanaz az esemény sosem dolgozódhat fel kétszer — a deduplikációs
 * logika az src/lib/idempotency.ts-ben él.
 *
 * Access-politika: owner és staff olvashatja (hibakeresés/audit), de API-n
 * kívülről nem hozható létre, nem módosítható és nem törölhető — kizárólag
 * rendszerfolyamat írja (overrideAccess-szel).
 */
const isOwnerOrStaff: Access = ({ req }) => req.user?.role === 'owner' || req.user?.role === 'staff'

export const WebhookEvents: CollectionConfig = {
  slug: 'webhook-events',
  labels: {
    singular: 'Rendszeresemény',
    plural: 'Rendszeresemények',
  },
  admin: {
    useAsTitle: 'externalId',
    defaultColumns: ['provider', 'externalId', 'eventType', 'status', 'attempts', 'updatedAt'],
    group: 'Rendszer',
    description:
      'A fizetési, számlázási és videós szolgáltatók értesítései, hibakereséshez. Ide nem kell nyúlnod.',
  },
  access: {
    read: isOwnerOrStaff,
    create: () => false,
    update: () => false,
    delete: () => false,
  },
  // Egyedi összetett kulcs: ugyanattól a providertől ugyanaz az externalId csak
  // egyszer szerepelhet — ez a deduplikáció adatbázis-szintű garanciája.
  indexes: [
    {
      fields: ['provider', 'externalId'],
      unique: true,
    },
  ],
  fields: [
    {
      name: 'provider',
      type: 'select',
      required: true,
      label: 'Szolgáltató',
      options: [
        { label: 'Barion', value: 'barion' },
        // A tárolt ÉRTÉK szándékosan marad 'stream' (szolgáltató-független, és
        // a séma sem változik tőle); csak a felületi címke követi a Bunnyra
        // állást.
        { label: 'Bunny Stream', value: 'stream' },
        { label: 'Számlázz.hu', value: 'szamlazz' },
      ],
    },
    {
      name: 'externalId',
      type: 'text',
      required: true,
      index: true,
      label: 'Külső azonosító',
    },
    {
      name: 'eventType',
      type: 'text',
      label: 'Esemény típusa',
    },
    {
      // K01: a Payload json-szerkesztője (Monaco, CDN-ről) a CSP miatt 0 px
      // magas maradt; az adatot csak olvasni kell, ezért formázott, görgethető
      // szövegdoboz mutatja (src/components/admin/JsonReadOnlyField.tsx).
      // A korábbi „Nyers üzenet” felirat nem volt igaz: a Barion-callback
      // szándékosan csak a kinyert fizetésazonosítót tárolja, a nyers bodyt
      // nem (src/lib/barion-callback/route-handler.ts).
      name: 'payload',
      type: 'json',
      label: 'Az értesítés tárolt adatai',
      admin: {
        components: {
          Field: '/components/admin/JsonReadOnlyField#JsonReadOnlyField',
        },
        description:
          'Az értesítésből kinyert adatok, például a Barion fizetésazonosító. A teljes nyers üzenetet a rendszer szándékosan nem tárolja.',
      },
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'received',
      index: true,
      label: 'Feldolgozottság',
      options: [
        { label: 'Beérkezett', value: 'received' },
        { label: 'Feldolgozva', value: 'processed' },
        { label: 'Sikertelen', value: 'failed' },
      ],
    },
    {
      name: 'attempts',
      type: 'number',
      defaultValue: 0,
      label: 'Próbálkozások száma',
    },
    {
      name: 'lastError',
      type: 'text',
      label: 'Utolsó hiba',
    },
    {
      name: 'requestId',
      type: 'text',
      label: 'Kérésazonosító',
    },
    {
      // A feldolgozás VÉGLEGES üzleti kimenetelének ideje — csak sikeres/
      // elutasított lezáráskor töltődik; hiba esetén NULL marad, hogy az
      // esemény újrapróbálható legyen (retry-job).
      name: 'processedAt',
      type: 'date',
      label: 'Feldolgozás időpontja',
      admin: {
        readOnly: true,
        // K25: magyar, 24 órás alak (a globális admin.dateFormat mintája).
        date: { displayFormat: 'yyyy. MM. dd. HH:mm', timeFormat: 'HH:mm' },
        description:
          'A sikeres vagy végleges feldolgozás időpontja. Hiba esetén üres, így az esemény újrapróbálható.',
      },
    },
    {
      // Az utolsó feldolgozás üzleti kimenetele (géppel szűrhető nyom).
      name: 'result',
      type: 'select',
      label: 'Üzleti kimenetel',
      options: [
        { label: 'Fizetve (a rendelés kifizetve, a hozzáférés megadva)', value: 'paid' },
        { label: 'Lemondva (a rendelés lemondva)', value: 'cancelled' },
        { label: 'Függőben (a rendszer később újra rákérdez)', value: 'pending_repoll' },
        { label: 'Elutasítva (a rendelés már más állapotban volt)', value: 'rejected' },
        { label: 'Sikertelen feldolgozás (újrapróbálható)', value: 'failed' },
      ],
      admin: {
        readOnly: true,
        description:
          'Az utolsó feldolgozás üzleti kimenetele. A „Függőben” azt jelenti, hogy a fizetés még nem dőlt el: a rendszer később magától újra rákérdez a szolgáltatónál.',
      },
    },
  ],
}
