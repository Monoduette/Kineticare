import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "pages_blocks_accordion_items" ADD COLUMN "kep_id" integer;
  ALTER TABLE "_pages_v_blocks_accordion_items" ADD COLUMN "kep_id" integer;
  ALTER TABLE "pages_blocks_accordion_items" ADD CONSTRAINT "pages_blocks_accordion_items_kep_id_media_id_fk" FOREIGN KEY ("kep_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_pages_v_blocks_accordion_items" ADD CONSTRAINT "_pages_v_blocks_accordion_items_kep_id_media_id_fk" FOREIGN KEY ("kep_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "pages_blocks_accordion_items_kep_idx" ON "pages_blocks_accordion_items" USING btree ("kep_id");
  CREATE INDEX "_pages_v_blocks_accordion_items_kep_idx" ON "_pages_v_blocks_accordion_items" USING btree ("kep_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "pages_blocks_accordion_items" DROP CONSTRAINT "pages_blocks_accordion_items_kep_id_media_id_fk";
  
  ALTER TABLE "_pages_v_blocks_accordion_items" DROP CONSTRAINT "_pages_v_blocks_accordion_items_kep_id_media_id_fk";
  
  DROP INDEX "pages_blocks_accordion_items_kep_idx";
  DROP INDEX "_pages_v_blocks_accordion_items_kep_idx";
  ALTER TABLE "pages_blocks_accordion_items" DROP COLUMN "kep_id";
  ALTER TABLE "_pages_v_blocks_accordion_items" DROP COLUMN "kep_id";`)
}
