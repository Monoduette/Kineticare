import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "products" ADD COLUMN "promo_price_huf" numeric;
  ALTER TABLE "_products_v" ADD COLUMN "version_promo_price_huf" numeric;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "products" DROP COLUMN "promo_price_huf";
  ALTER TABLE "_products_v" DROP COLUMN "version_promo_price_huf";`)
}
