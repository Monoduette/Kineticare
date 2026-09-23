import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "pages_blocks_film_hero" ADD COLUMN "captions_mid_title" varchar;
  ALTER TABLE "pages_blocks_film_hero" ADD COLUMN "captions_mid_body" varchar;
  ALTER TABLE "pages_blocks_film_hero" ADD COLUMN "captions_end_title" varchar;
  ALTER TABLE "pages_blocks_film_hero" ADD COLUMN "captions_end_body" varchar;
  ALTER TABLE "pages_blocks_film_hero" ADD COLUMN "captions_end_body_without_free_sos" varchar;
  ALTER TABLE "_pages_v_blocks_film_hero" ADD COLUMN "captions_mid_title" varchar;
  ALTER TABLE "_pages_v_blocks_film_hero" ADD COLUMN "captions_mid_body" varchar;
  ALTER TABLE "_pages_v_blocks_film_hero" ADD COLUMN "captions_end_title" varchar;
  ALTER TABLE "_pages_v_blocks_film_hero" ADD COLUMN "captions_end_body" varchar;
  ALTER TABLE "_pages_v_blocks_film_hero" ADD COLUMN "captions_end_body_without_free_sos" varchar;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "pages_blocks_film_hero" DROP COLUMN "captions_mid_title";
  ALTER TABLE "pages_blocks_film_hero" DROP COLUMN "captions_mid_body";
  ALTER TABLE "pages_blocks_film_hero" DROP COLUMN "captions_end_title";
  ALTER TABLE "pages_blocks_film_hero" DROP COLUMN "captions_end_body";
  ALTER TABLE "pages_blocks_film_hero" DROP COLUMN "captions_end_body_without_free_sos";
  ALTER TABLE "_pages_v_blocks_film_hero" DROP COLUMN "captions_mid_title";
  ALTER TABLE "_pages_v_blocks_film_hero" DROP COLUMN "captions_mid_body";
  ALTER TABLE "_pages_v_blocks_film_hero" DROP COLUMN "captions_end_title";
  ALTER TABLE "_pages_v_blocks_film_hero" DROP COLUMN "captions_end_body";
  ALTER TABLE "_pages_v_blocks_film_hero" DROP COLUMN "captions_end_body_without_free_sos";`)
}
