import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_refund_intents_provider" AS ENUM('barion');
  CREATE TYPE "public"."enum_refund_intents_state" AS ENUM('prepared', 'provider_started', 'provider_failed', 'provider_unknown', 'provider_succeeded', 'committed', 'manual_review');
  CREATE TYPE "public"."enum_refund_intents_currency" AS ENUM('HUF');
  CREATE TABLE "refund_intents" (
    "id" serial PRIMARY KEY NOT NULL,
    "order_id" integer NOT NULL,
    "actor_id" integer NOT NULL,
    "requested_amount_huf" numeric NOT NULL,
    "provider" "enum_refund_intents_provider" NOT NULL,
    "provider_payment_id" varchar NOT NULL,
    "provider_transaction_id" varchar NOT NULL,
    "state" "enum_refund_intents_state" NOT NULL,
    "request_hash" varchar NOT NULL,
    "idempotency_key_hash" varchar NOT NULL,
    "active_order_key" varchar,
    "schema_version" numeric NOT NULL,
    "refund_sequence" numeric NOT NULL,
    "currency" "enum_refund_intents_currency" NOT NULL,
    "reason" varchar,
    "provider_started_at" timestamp(3) with time zone,
    "provider_resolved_at" timestamp(3) with time zone,
    "committed_at" timestamp(3) with time zone,
    "reconciliation_checked_at" timestamp(3) with time zone,
    "reconciliation_reference" varchar,
    "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  ALTER TABLE "refund_intents" ADD CONSTRAINT "refund_intents_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "refund_intents" ADD CONSTRAINT "refund_intents_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "refund_intents_order_idx" ON "refund_intents" USING btree ("order_id");
  CREATE INDEX "refund_intents_actor_idx" ON "refund_intents" USING btree ("actor_id");
  CREATE INDEX "refund_intents_state_idx" ON "refund_intents" USING btree ("state");
  CREATE INDEX "refund_intents_request_hash_idx" ON "refund_intents" USING btree ("request_hash");
  CREATE UNIQUE INDEX "refund_intents_idempotency_key_hash_idx" ON "refund_intents" USING btree ("idempotency_key_hash");
  CREATE UNIQUE INDEX "refund_intents_active_order_key_idx" ON "refund_intents" USING btree ("active_order_key");
  CREATE INDEX "refund_intents_updated_at_idx" ON "refund_intents" USING btree ("updated_at");
  CREATE INDEX "refund_intents_created_at_idx" ON "refund_intents" USING btree ("created_at");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE "refund_intents" CASCADE;
  DROP TYPE "public"."enum_refund_intents_provider";
  DROP TYPE "public"."enum_refund_intents_state";
  DROP TYPE "public"."enum_refund_intents_currency";`)
}
