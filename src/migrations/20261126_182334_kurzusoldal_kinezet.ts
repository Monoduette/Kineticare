import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_products_page_layout" AS ENUM('standard', 'landing');
  CREATE TYPE "public"."enum__products_v_version_page_layout" AS ENUM('standard', 'landing');
  ALTER TABLE "products" ADD COLUMN "page_layout" "enum_products_page_layout" DEFAULT 'standard';
  ALTER TABLE "_products_v" ADD COLUMN "version_page_layout" "enum__products_v_version_page_layout" DEFAULT 'standard';`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "products" DROP COLUMN "page_layout";
  ALTER TABLE "_products_v" DROP COLUMN "version_page_layout";
  DROP TYPE "public"."enum_products_page_layout";
  DROP TYPE "public"."enum__products_v_version_page_layout";`)
}
