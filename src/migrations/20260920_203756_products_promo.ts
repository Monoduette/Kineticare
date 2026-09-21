import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "products" ADD COLUMN "promo_enabled" boolean DEFAULT false;
  ALTER TABLE "products" ADD COLUMN "promo_start" timestamp(3) with time zone;
  ALTER TABLE "products" ADD COLUMN "promo_end" timestamp(3) with time zone;
  ALTER TABLE "products" ADD COLUMN "promo_original_price_huf" numeric;
  ALTER TABLE "_products_v" ADD COLUMN "version_promo_enabled" boolean DEFAULT false;
  ALTER TABLE "_products_v" ADD COLUMN "version_promo_start" timestamp(3) with time zone;
  ALTER TABLE "_products_v" ADD COLUMN "version_promo_end" timestamp(3) with time zone;
  ALTER TABLE "_products_v" ADD COLUMN "version_promo_original_price_huf" numeric;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "products" DROP COLUMN "promo_enabled";
  ALTER TABLE "products" DROP COLUMN "promo_start";
  ALTER TABLE "products" DROP COLUMN "promo_end";
  ALTER TABLE "products" DROP COLUMN "promo_original_price_huf";
  ALTER TABLE "_products_v" DROP COLUMN "version_promo_enabled";
  ALTER TABLE "_products_v" DROP COLUMN "version_promo_start";
  ALTER TABLE "_products_v" DROP COLUMN "version_promo_end";
  ALTER TABLE "_products_v" DROP COLUMN "version_promo_original_price_huf";`)
}
