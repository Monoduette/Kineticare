import type { Access, CollectionConfig } from 'payload'

/**
 * Audit-logs collection (T-015) — pénzügyi és jogosultság-érzékeny műveletek
 * megváltoztathatatlan nyilvántartása (ki, mit, melyik entitáson, miről-mire).
 *
 * A bejegyzéseket kizárólag rendszerfolyamat írja (src/lib/audit.ts,
 * overrideAccess-szel); API-n kívülről sem létrehozni, sem módosítani, sem
 * törölni nem lehet — az audit-trail integritása így garantált. Olvasni csak
 * owner szerepkörrel szabad (a before/after tartalom személyes adatot is
 * hordozhat).
 *
 * GDPR-megjegyzés: az ipAddress személyes adat, a retention-jét (törlés/
 * anonimizálás a törvényi megőrzési idő letelte után) egy későbbi cleanup-job
 * kezeli — ez a ticket szándékosan nem implementálja.
 */
const isOwner: Access = ({ req }) => req.user?.role === 'owner'

export const AuditLogs: CollectionConfig = {
  slug: 'audit-logs',
  labels: {
    singular: 'Naplóbejegyzés',
    plural: 'Műveletnapló',
  },
  admin: {
    useAsTitle: 'action',
    defaultColumns: ['actor', 'action', 'entityType', 'entityId', 'createdAt'],
    group: 'Rendszer',
    description:
      'Ki, mikor, mit módosított a pénzügyi és jogosultsági műveletekben. Csak olvasható.',
  },
  access: {
    read: isOwner,
    create: () => false,
    update: () => false,
    delete: () => false,
  },
  fields: [
    {
      name: 'actor',
      type: 'relationship',
      relationTo: 'users',
      label: 'Ki csinálta',
      admin: {
        description: 'Ha üres, a műveletet a rendszer végezte, nem egy bejelentkezett felhasználó.',
      },
    },
    {
      name: 'action',
      type: 'text',
      required: true,
      index: true,
      label: 'Művelet',
      admin: {
        // K39: a tárolt kód (pl. „publish”) a listában magyarul látszik; a
        // kereső és a szűrő továbbra is a kódra keres.
        components: {
          Cell: '/components/admin/AuditActionCell#AuditActionCell',
          Description: '/components/admin/AuditActionCell#AuditActionDescription',
        },
      },
    },
    {
      name: 'entityType',
      type: 'text',
      index: true,
      label: 'Érintett típus',
      admin: {
        components: {
          Cell: '/components/admin/AuditActionCell#AuditEntityTypeCell',
          Description: '/components/admin/AuditActionCell#AuditEntityTypeDescription',
        },
      },
    },
    {
      name: 'entityId',
      type: 'text',
      label: 'Érintett azonosító',
    },
    {
      // K01: a Payload json-szerkesztője (Monaco, CDN-ről) a CSP miatt 0 px
      // magas maradt; a napló amúgy is csak olvasható, ezért formázott,
      // görgethető szövegdoboz mutatja (src/components/admin/JsonReadOnlyField.tsx).
      name: 'before',
      type: 'json',
      label: 'Előtte',
      admin: {
        components: {
          Field: '/components/admin/JsonReadOnlyField#JsonReadOnlyField',
        },
        description: 'A módosítás előtti állapot. Jelszó, token és más titok nem kerül a naplóba.',
      },
    },
    {
      name: 'after',
      type: 'json',
      label: 'Utána',
      admin: {
        components: {
          Field: '/components/admin/JsonReadOnlyField#JsonReadOnlyField',
        },
        description: 'A módosítás utáni állapot, ugyanígy titkok nélkül.',
      },
    },
    {
      name: 'requestId',
      type: 'text',
      label: 'Kérésazonosító',
      admin: {
        description:
          'Hibakereséshez: ezzel az azonosítóval a szervernaplóban megtalálható a kérés.',
      },
    },
    {
      // Lásd a GDPR-megjegyzést a fájl fejlécében: retention = későbbi cleanup-job.
      name: 'ipAddress',
      type: 'text',
      label: 'IP-cím',
      admin: {
        description: 'A műveletet indító gép IP-címe. Személyes adat, csak a tulajdonos látja.',
      },
    },
  ],
}
