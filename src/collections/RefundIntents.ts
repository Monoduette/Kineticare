import { APIError, type Access, type CollectionConfig } from 'payload'

import { parseRefundIntentActorIdentity, REFUND_INTENT_STATES } from '../lib/refund/refund-intent'

const isOwner: Access = ({ req }) => req.user?.role === 'owner'

/**
 * Közös owner/system refund főkönyv. Írás kizárólag a domain store-on át,
 * tartós CAS és activeOrderKey mellett; a unique mezők DB-hátvédet adnak.
 * V1 actor=owner kompatibilis; V2 rendszerfolyamat nem személyes user actor.
 */
export const RefundIntents: CollectionConfig = {
  slug: 'refund-intents',
  lockDocuments: false,
  labels: { singular: 'Visszatérítési szándék', plural: 'Visszatérítési szándékok' },
  admin: {
    useAsTitle: 'requestHash',
    defaultColumns: ['order', 'state', 'requestedAmountHuf', 'refundSequence', 'createdAt'],
    group: 'Rendszer',
    description: 'Csak olvasható visszatérítési főkönyv és helyreállítási állapotok.',
  },
  access: {
    read: isOwner,
    create: () => false,
    update: () => false,
    delete: () => false,
  },
  hooks: {
    beforeValidate: [
      ({ data, originalDoc }) => {
        if (!data) return data
        const record = { ...originalDoc, ...data }
        try {
          parseRefundIntentActorIdentity({
            schemaVersion: record.schemaVersion,
            actor: record.actor,
            actorKind: record.actorKind,
            systemActor: record.systemActor,
          })
        } catch {
          throw new APIError('A visszatérítési szándék kezdeményezője nem igazolható.', 400)
        }
        return data
      },
    ],
  },
  fields: [
    { name: 'order', type: 'relationship', relationTo: 'orders', required: true, index: true },
    { name: 'actor', type: 'relationship', relationTo: 'users', index: true },
    {
      name: 'actorKind',
      type: 'select',
      options: [
        { label: 'Tulajdonos', value: 'owner' },
        { label: 'Rendszer', value: 'system' },
      ],
    },
    { name: 'systemActor', type: 'text', maxLength: 64 },
    { name: 'requestedAmountHuf', type: 'number', required: true, min: 1 },
    {
      name: 'provider',
      type: 'select',
      required: true,
      options: [{ label: 'Barion', value: 'barion' }],
    },
    { name: 'providerPaymentId', type: 'text', required: true },
    { name: 'providerTransactionId', type: 'text', required: true },
    {
      name: 'state',
      type: 'select',
      required: true,
      index: true,
      options: REFUND_INTENT_STATES.map((state) => ({ label: state, value: state })),
    },
    { name: 'requestHash', type: 'text', required: true, index: true },
    { name: 'idempotencyKeyHash', type: 'text', required: true, unique: true, index: true },
    { name: 'activeOrderKey', type: 'text', unique: true, index: true },
    { name: 'schemaVersion', type: 'number', required: true, min: 1, max: 2 },
    { name: 'refundSequence', type: 'number', required: true, min: 1 },
    { name: 'currency', type: 'select', required: true, options: [{ label: 'HUF', value: 'HUF' }] },
    { name: 'reason', type: 'textarea', maxLength: 1000 },
    { name: 'providerStartedAt', type: 'date' },
    { name: 'providerResolvedAt', type: 'date' },
    { name: 'committedAt', type: 'date' },
    { name: 'reconciliationCheckedAt', type: 'date' },
    { name: 'reconciliationReference', type: 'text' },
  ],
}
