import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_users_access_grants_source_kind" AS ENUM('order', 'independent');
  CREATE TYPE "public"."enum_refund_intents_actor_kind" AS ENUM('owner', 'system');
  CREATE TABLE "course_files" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"alt" varchar NOT NULL,
  	"course_id" integer NOT NULL,
  	"transfer_key" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"url" varchar,
  	"thumbnail_u_r_l" varchar,
  	"filename" varchar,
  	"mime_type" varchar,
  	"filesize" numeric,
  	"width" numeric,
  	"height" numeric,
  	"focal_x" numeric,
  	"focal_y" numeric,
  	"sizes_xs_url" varchar,
  	"sizes_xs_width" numeric,
  	"sizes_xs_height" numeric,
  	"sizes_xs_mime_type" varchar,
  	"sizes_xs_filesize" numeric,
  	"sizes_xs_filename" varchar,
  	"sizes_sm_url" varchar,
  	"sizes_sm_width" numeric,
  	"sizes_sm_height" numeric,
  	"sizes_sm_mime_type" varchar,
  	"sizes_sm_filesize" numeric,
  	"sizes_sm_filename" varchar,
  	"sizes_md_url" varchar,
  	"sizes_md_width" numeric,
  	"sizes_md_height" numeric,
  	"sizes_md_mime_type" varchar,
  	"sizes_md_filesize" numeric,
  	"sizes_md_filename" varchar,
  	"sizes_lg_url" varchar,
  	"sizes_lg_width" numeric,
  	"sizes_lg_height" numeric,
  	"sizes_lg_mime_type" varchar,
  	"sizes_lg_filesize" numeric,
  	"sizes_lg_filename" varchar,
  	"sizes_og_url" varchar,
  	"sizes_og_width" numeric,
  	"sizes_og_height" numeric,
  	"sizes_og_mime_type" varchar,
  	"sizes_og_filesize" numeric,
  	"sizes_og_filename" varchar
  );
  
  ALTER TABLE "refund_intents" ALTER COLUMN "actor_id" DROP NOT NULL;
  ALTER TABLE "products_modules_lessons_attachments" ADD COLUMN "protected_file_id" integer;
  ALTER TABLE "_products_v_version_modules_lessons_attachments" ADD COLUMN "protected_file_id" integer;
  ALTER TABLE "users_access_grants" ADD COLUMN "source_kind" "enum_users_access_grants_source_kind";
  ALTER TABLE "users_access_grants" ADD COLUMN "source_order_id" integer;
  ALTER TABLE "refund_intents" ADD COLUMN "actor_kind" "enum_refund_intents_actor_kind";
  ALTER TABLE "refund_intents" ADD COLUMN "system_actor" varchar;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "course_files_id" integer;
  ALTER TABLE "course_files" ADD CONSTRAINT "course_files_course_id_products_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "course_files_course_idx" ON "course_files" USING btree ("course_id");
  CREATE UNIQUE INDEX "course_files_transfer_key_idx" ON "course_files" USING btree ("transfer_key");
  CREATE INDEX "course_files_updated_at_idx" ON "course_files" USING btree ("updated_at");
  CREATE INDEX "course_files_created_at_idx" ON "course_files" USING btree ("created_at");
  CREATE UNIQUE INDEX "course_files_filename_idx" ON "course_files" USING btree ("filename");
  CREATE INDEX "course_files_sizes_xs_sizes_xs_filename_idx" ON "course_files" USING btree ("sizes_xs_filename");
  CREATE INDEX "course_files_sizes_sm_sizes_sm_filename_idx" ON "course_files" USING btree ("sizes_sm_filename");
  CREATE INDEX "course_files_sizes_md_sizes_md_filename_idx" ON "course_files" USING btree ("sizes_md_filename");
  CREATE INDEX "course_files_sizes_lg_sizes_lg_filename_idx" ON "course_files" USING btree ("sizes_lg_filename");
  CREATE INDEX "course_files_sizes_og_sizes_og_filename_idx" ON "course_files" USING btree ("sizes_og_filename");
  ALTER TABLE "products_modules_lessons_attachments" ADD CONSTRAINT "products_modules_lessons_attachments_protected_file_id_course_files_id_fk" FOREIGN KEY ("protected_file_id") REFERENCES "public"."course_files"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_products_v_version_modules_lessons_attachments" ADD CONSTRAINT "_products_v_version_modules_lessons_attachments_protected_file_id_course_files_id_fk" FOREIGN KEY ("protected_file_id") REFERENCES "public"."course_files"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "users_access_grants" ADD CONSTRAINT "users_access_grants_source_order_id_orders_id_fk" FOREIGN KEY ("source_order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_course_files_fk" FOREIGN KEY ("course_files_id") REFERENCES "public"."course_files"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "products_modules_lessons_attachments_protected_file_idx" ON "products_modules_lessons_attachments" USING btree ("protected_file_id");
  CREATE INDEX "_products_v_version_modules_lessons_attachments_protecte_idx" ON "_products_v_version_modules_lessons_attachments" USING btree ("protected_file_id");
  CREATE INDEX "users_access_grants_source_order_idx" ON "users_access_grants" USING btree ("source_order_id");
  CREATE INDEX "payload_locked_documents_rels_course_files_id_idx" ON "payload_locked_documents_rels" USING btree ("course_files_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "course_files" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "course_files" CASCADE;
  ALTER TABLE "products_modules_lessons_attachments" DROP CONSTRAINT "products_modules_lessons_attachments_protected_file_id_course_files_id_fk";
  
  ALTER TABLE "_products_v_version_modules_lessons_attachments" DROP CONSTRAINT "_products_v_version_modules_lessons_attachments_protected_file_id_course_files_id_fk";
  
  ALTER TABLE "users_access_grants" DROP CONSTRAINT "users_access_grants_source_order_id_orders_id_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_course_files_fk";
  
  DROP INDEX "products_modules_lessons_attachments_protected_file_idx";
  DROP INDEX "_products_v_version_modules_lessons_attachments_protecte_idx";
  DROP INDEX "users_access_grants_source_order_idx";
  DROP INDEX "payload_locked_documents_rels_course_files_id_idx";
  ALTER TABLE "refund_intents" ALTER COLUMN "actor_id" SET NOT NULL;
  ALTER TABLE "products_modules_lessons_attachments" DROP COLUMN "protected_file_id";
  ALTER TABLE "_products_v_version_modules_lessons_attachments" DROP COLUMN "protected_file_id";
  ALTER TABLE "users_access_grants" DROP COLUMN "source_kind";
  ALTER TABLE "users_access_grants" DROP COLUMN "source_order_id";
  ALTER TABLE "refund_intents" DROP COLUMN "actor_kind";
  ALTER TABLE "refund_intents" DROP COLUMN "system_actor";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "course_files_id";
  DROP TYPE "public"."enum_users_access_grants_source_kind";
  DROP TYPE "public"."enum_refund_intents_actor_kind";`)
}
