import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_pages_blocks_services_elrendezes" AS ENUM('tabla', 'sin');
  CREATE TYPE "public"."enum__pages_v_blocks_services_elrendezes" AS ENUM('tabla', 'sin');
  ALTER TABLE "pages_blocks_services_rows" ADD COLUMN "osszefoglalo" varchar;
  ALTER TABLE "pages_blocks_services_rows" ADD COLUMN "photo_id" integer;
  ALTER TABLE "pages_blocks_services" ADD COLUMN "lead" varchar;
  ALTER TABLE "pages_blocks_services" ADD COLUMN "elrendezes" "enum_pages_blocks_services_elrendezes" DEFAULT 'tabla';
  ALTER TABLE "_pages_v_blocks_services_rows" ADD COLUMN "osszefoglalo" varchar;
  ALTER TABLE "_pages_v_blocks_services_rows" ADD COLUMN "photo_id" integer;
  ALTER TABLE "_pages_v_blocks_services" ADD COLUMN "lead" varchar;
  ALTER TABLE "_pages_v_blocks_services" ADD COLUMN "elrendezes" "enum__pages_v_blocks_services_elrendezes" DEFAULT 'tabla';
  ALTER TABLE "pages_blocks_services_rows" ADD CONSTRAINT "pages_blocks_services_rows_photo_id_media_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_pages_v_blocks_services_rows" ADD CONSTRAINT "_pages_v_blocks_services_rows_photo_id_media_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "pages_blocks_services_rows_photo_idx" ON "pages_blocks_services_rows" USING btree ("photo_id");
  CREATE INDEX "_pages_v_blocks_services_rows_photo_idx" ON "_pages_v_blocks_services_rows" USING btree ("photo_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "pages_blocks_services_rows" DROP CONSTRAINT "pages_blocks_services_rows_photo_id_media_id_fk";
  
  ALTER TABLE "_pages_v_blocks_services_rows" DROP CONSTRAINT "_pages_v_blocks_services_rows_photo_id_media_id_fk";
  
  DROP INDEX "pages_blocks_services_rows_photo_idx";
  DROP INDEX "_pages_v_blocks_services_rows_photo_idx";
  ALTER TABLE "pages_blocks_services_rows" DROP COLUMN "osszefoglalo";
  ALTER TABLE "pages_blocks_services_rows" DROP COLUMN "photo_id";
  ALTER TABLE "pages_blocks_services" DROP COLUMN "lead";
  ALTER TABLE "pages_blocks_services" DROP COLUMN "elrendezes";
  ALTER TABLE "_pages_v_blocks_services_rows" DROP COLUMN "osszefoglalo";
  ALTER TABLE "_pages_v_blocks_services_rows" DROP COLUMN "photo_id";
  ALTER TABLE "_pages_v_blocks_services" DROP COLUMN "lead";
  ALTER TABLE "_pages_v_blocks_services" DROP COLUMN "elrendezes";
  DROP TYPE "public"."enum_pages_blocks_services_elrendezes";
  DROP TYPE "public"."enum__pages_v_blocks_services_elrendezes";`)
}
