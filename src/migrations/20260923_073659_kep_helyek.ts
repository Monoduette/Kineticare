import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "pages_blocks_course_cards" ADD COLUMN "scene_photos_left_id" integer;
  ALTER TABLE "pages_blocks_course_cards" ADD COLUMN "scene_photos_middle_id" integer;
  ALTER TABLE "pages_blocks_course_cards" ADD COLUMN "scene_photos_right_id" integer;
  ALTER TABLE "pages_blocks_about" ADD COLUMN "frieze_photo1_id" integer;
  ALTER TABLE "pages_blocks_about" ADD COLUMN "frieze_photo2_id" integer;
  ALTER TABLE "pages_blocks_about" ADD COLUMN "frieze_photo3_id" integer;
  ALTER TABLE "pages_blocks_about" ADD COLUMN "frieze_photo4_id" integer;
  ALTER TABLE "_pages_v_blocks_course_cards" ADD COLUMN "scene_photos_left_id" integer;
  ALTER TABLE "_pages_v_blocks_course_cards" ADD COLUMN "scene_photos_middle_id" integer;
  ALTER TABLE "_pages_v_blocks_course_cards" ADD COLUMN "scene_photos_right_id" integer;
  ALTER TABLE "_pages_v_blocks_about" ADD COLUMN "frieze_photo1_id" integer;
  ALTER TABLE "_pages_v_blocks_about" ADD COLUMN "frieze_photo2_id" integer;
  ALTER TABLE "_pages_v_blocks_about" ADD COLUMN "frieze_photo3_id" integer;
  ALTER TABLE "_pages_v_blocks_about" ADD COLUMN "frieze_photo4_id" integer;
  ALTER TABLE "pages_blocks_course_cards" ADD CONSTRAINT "pages_blocks_course_cards_scene_photos_left_id_media_id_fk" FOREIGN KEY ("scene_photos_left_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "pages_blocks_course_cards" ADD CONSTRAINT "pages_blocks_course_cards_scene_photos_middle_id_media_id_fk" FOREIGN KEY ("scene_photos_middle_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "pages_blocks_course_cards" ADD CONSTRAINT "pages_blocks_course_cards_scene_photos_right_id_media_id_fk" FOREIGN KEY ("scene_photos_right_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "pages_blocks_about" ADD CONSTRAINT "pages_blocks_about_frieze_photo1_id_media_id_fk" FOREIGN KEY ("frieze_photo1_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "pages_blocks_about" ADD CONSTRAINT "pages_blocks_about_frieze_photo2_id_media_id_fk" FOREIGN KEY ("frieze_photo2_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "pages_blocks_about" ADD CONSTRAINT "pages_blocks_about_frieze_photo3_id_media_id_fk" FOREIGN KEY ("frieze_photo3_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "pages_blocks_about" ADD CONSTRAINT "pages_blocks_about_frieze_photo4_id_media_id_fk" FOREIGN KEY ("frieze_photo4_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_pages_v_blocks_course_cards" ADD CONSTRAINT "_pages_v_blocks_course_cards_scene_photos_left_id_media_id_fk" FOREIGN KEY ("scene_photos_left_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_pages_v_blocks_course_cards" ADD CONSTRAINT "_pages_v_blocks_course_cards_scene_photos_middle_id_media_id_fk" FOREIGN KEY ("scene_photos_middle_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_pages_v_blocks_course_cards" ADD CONSTRAINT "_pages_v_blocks_course_cards_scene_photos_right_id_media_id_fk" FOREIGN KEY ("scene_photos_right_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_pages_v_blocks_about" ADD CONSTRAINT "_pages_v_blocks_about_frieze_photo1_id_media_id_fk" FOREIGN KEY ("frieze_photo1_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_pages_v_blocks_about" ADD CONSTRAINT "_pages_v_blocks_about_frieze_photo2_id_media_id_fk" FOREIGN KEY ("frieze_photo2_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_pages_v_blocks_about" ADD CONSTRAINT "_pages_v_blocks_about_frieze_photo3_id_media_id_fk" FOREIGN KEY ("frieze_photo3_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_pages_v_blocks_about" ADD CONSTRAINT "_pages_v_blocks_about_frieze_photo4_id_media_id_fk" FOREIGN KEY ("frieze_photo4_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "pages_blocks_course_cards_scene_photos_scene_photos_left_idx" ON "pages_blocks_course_cards" USING btree ("scene_photos_left_id");
  CREATE INDEX "pages_blocks_course_cards_scene_photos_scene_photos_midd_idx" ON "pages_blocks_course_cards" USING btree ("scene_photos_middle_id");
  CREATE INDEX "pages_blocks_course_cards_scene_photos_scene_photos_righ_idx" ON "pages_blocks_course_cards" USING btree ("scene_photos_right_id");
  CREATE INDEX "pages_blocks_about_frieze_frieze_photo1_idx" ON "pages_blocks_about" USING btree ("frieze_photo1_id");
  CREATE INDEX "pages_blocks_about_frieze_frieze_photo2_idx" ON "pages_blocks_about" USING btree ("frieze_photo2_id");
  CREATE INDEX "pages_blocks_about_frieze_frieze_photo3_idx" ON "pages_blocks_about" USING btree ("frieze_photo3_id");
  CREATE INDEX "pages_blocks_about_frieze_frieze_photo4_idx" ON "pages_blocks_about" USING btree ("frieze_photo4_id");
  CREATE INDEX "_pages_v_blocks_course_cards_scene_photos_scene_photos_l_idx" ON "_pages_v_blocks_course_cards" USING btree ("scene_photos_left_id");
  CREATE INDEX "_pages_v_blocks_course_cards_scene_photos_scene_photos_m_idx" ON "_pages_v_blocks_course_cards" USING btree ("scene_photos_middle_id");
  CREATE INDEX "_pages_v_blocks_course_cards_scene_photos_scene_photos_r_idx" ON "_pages_v_blocks_course_cards" USING btree ("scene_photos_right_id");
  CREATE INDEX "_pages_v_blocks_about_frieze_frieze_photo1_idx" ON "_pages_v_blocks_about" USING btree ("frieze_photo1_id");
  CREATE INDEX "_pages_v_blocks_about_frieze_frieze_photo2_idx" ON "_pages_v_blocks_about" USING btree ("frieze_photo2_id");
  CREATE INDEX "_pages_v_blocks_about_frieze_frieze_photo3_idx" ON "_pages_v_blocks_about" USING btree ("frieze_photo3_id");
  CREATE INDEX "_pages_v_blocks_about_frieze_frieze_photo4_idx" ON "_pages_v_blocks_about" USING btree ("frieze_photo4_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "pages_blocks_course_cards" DROP CONSTRAINT "pages_blocks_course_cards_scene_photos_left_id_media_id_fk";
  
  ALTER TABLE "pages_blocks_course_cards" DROP CONSTRAINT "pages_blocks_course_cards_scene_photos_middle_id_media_id_fk";
  
  ALTER TABLE "pages_blocks_course_cards" DROP CONSTRAINT "pages_blocks_course_cards_scene_photos_right_id_media_id_fk";
  
  ALTER TABLE "pages_blocks_about" DROP CONSTRAINT "pages_blocks_about_frieze_photo1_id_media_id_fk";
  
  ALTER TABLE "pages_blocks_about" DROP CONSTRAINT "pages_blocks_about_frieze_photo2_id_media_id_fk";
  
  ALTER TABLE "pages_blocks_about" DROP CONSTRAINT "pages_blocks_about_frieze_photo3_id_media_id_fk";
  
  ALTER TABLE "pages_blocks_about" DROP CONSTRAINT "pages_blocks_about_frieze_photo4_id_media_id_fk";
  
  ALTER TABLE "_pages_v_blocks_course_cards" DROP CONSTRAINT "_pages_v_blocks_course_cards_scene_photos_left_id_media_id_fk";
  
  ALTER TABLE "_pages_v_blocks_course_cards" DROP CONSTRAINT "_pages_v_blocks_course_cards_scene_photos_middle_id_media_id_fk";
  
  ALTER TABLE "_pages_v_blocks_course_cards" DROP CONSTRAINT "_pages_v_blocks_course_cards_scene_photos_right_id_media_id_fk";
  
  ALTER TABLE "_pages_v_blocks_about" DROP CONSTRAINT "_pages_v_blocks_about_frieze_photo1_id_media_id_fk";
  
  ALTER TABLE "_pages_v_blocks_about" DROP CONSTRAINT "_pages_v_blocks_about_frieze_photo2_id_media_id_fk";
  
  ALTER TABLE "_pages_v_blocks_about" DROP CONSTRAINT "_pages_v_blocks_about_frieze_photo3_id_media_id_fk";
  
  ALTER TABLE "_pages_v_blocks_about" DROP CONSTRAINT "_pages_v_blocks_about_frieze_photo4_id_media_id_fk";
  
  DROP INDEX "pages_blocks_course_cards_scene_photos_scene_photos_left_idx";
  DROP INDEX "pages_blocks_course_cards_scene_photos_scene_photos_midd_idx";
  DROP INDEX "pages_blocks_course_cards_scene_photos_scene_photos_righ_idx";
  DROP INDEX "pages_blocks_about_frieze_frieze_photo1_idx";
  DROP INDEX "pages_blocks_about_frieze_frieze_photo2_idx";
  DROP INDEX "pages_blocks_about_frieze_frieze_photo3_idx";
  DROP INDEX "pages_blocks_about_frieze_frieze_photo4_idx";
  DROP INDEX "_pages_v_blocks_course_cards_scene_photos_scene_photos_l_idx";
  DROP INDEX "_pages_v_blocks_course_cards_scene_photos_scene_photos_m_idx";
  DROP INDEX "_pages_v_blocks_course_cards_scene_photos_scene_photos_r_idx";
  DROP INDEX "_pages_v_blocks_about_frieze_frieze_photo1_idx";
  DROP INDEX "_pages_v_blocks_about_frieze_frieze_photo2_idx";
  DROP INDEX "_pages_v_blocks_about_frieze_frieze_photo3_idx";
  DROP INDEX "_pages_v_blocks_about_frieze_frieze_photo4_idx";
  ALTER TABLE "pages_blocks_course_cards" DROP COLUMN "scene_photos_left_id";
  ALTER TABLE "pages_blocks_course_cards" DROP COLUMN "scene_photos_middle_id";
  ALTER TABLE "pages_blocks_course_cards" DROP COLUMN "scene_photos_right_id";
  ALTER TABLE "pages_blocks_about" DROP COLUMN "frieze_photo1_id";
  ALTER TABLE "pages_blocks_about" DROP COLUMN "frieze_photo2_id";
  ALTER TABLE "pages_blocks_about" DROP COLUMN "frieze_photo3_id";
  ALTER TABLE "pages_blocks_about" DROP COLUMN "frieze_photo4_id";
  ALTER TABLE "_pages_v_blocks_course_cards" DROP COLUMN "scene_photos_left_id";
  ALTER TABLE "_pages_v_blocks_course_cards" DROP COLUMN "scene_photos_middle_id";
  ALTER TABLE "_pages_v_blocks_course_cards" DROP COLUMN "scene_photos_right_id";
  ALTER TABLE "_pages_v_blocks_about" DROP COLUMN "frieze_photo1_id";
  ALTER TABLE "_pages_v_blocks_about" DROP COLUMN "frieze_photo2_id";
  ALTER TABLE "_pages_v_blocks_about" DROP COLUMN "frieze_photo3_id";
  ALTER TABLE "_pages_v_blocks_about" DROP COLUMN "frieze_photo4_id";`)
}
