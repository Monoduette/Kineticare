import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "pages_faq" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"question" varchar,
  	"answer" varchar
  );
  
  CREATE TABLE "_pages_v_version_faq" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"question" varchar,
  	"answer" varchar,
  	"_uuid" varchar
  );
  
  ALTER TABLE "pages" ADD COLUMN "author_id" integer;
  ALTER TABLE "pages" ADD COLUMN "reviewed_by_id" integer;
  ALTER TABLE "pages" ADD COLUMN "reviewed_at" timestamp(3) with time zone;
  ALTER TABLE "pages" ADD COLUMN "next_review_at" timestamp(3) with time zone;
  ALTER TABLE "_pages_v" ADD COLUMN "version_author_id" integer;
  ALTER TABLE "_pages_v" ADD COLUMN "version_reviewed_by_id" integer;
  ALTER TABLE "_pages_v" ADD COLUMN "version_reviewed_at" timestamp(3) with time zone;
  ALTER TABLE "_pages_v" ADD COLUMN "version_next_review_at" timestamp(3) with time zone;
  ALTER TABLE "pages_faq" ADD CONSTRAINT "pages_faq_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_pages_v_version_faq" ADD CONSTRAINT "_pages_v_version_faq_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_pages_v"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "pages_faq_order_idx" ON "pages_faq" USING btree ("_order");
  CREATE INDEX "pages_faq_parent_id_idx" ON "pages_faq" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_version_faq_order_idx" ON "_pages_v_version_faq" USING btree ("_order");
  CREATE INDEX "_pages_v_version_faq_parent_id_idx" ON "_pages_v_version_faq" USING btree ("_parent_id");
  ALTER TABLE "pages" ADD CONSTRAINT "pages_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "pages" ADD CONSTRAINT "pages_reviewed_by_id_users_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_pages_v" ADD CONSTRAINT "_pages_v_version_author_id_users_id_fk" FOREIGN KEY ("version_author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_pages_v" ADD CONSTRAINT "_pages_v_version_reviewed_by_id_users_id_fk" FOREIGN KEY ("version_reviewed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "pages_author_idx" ON "pages" USING btree ("author_id");
  CREATE INDEX "pages_reviewed_by_idx" ON "pages" USING btree ("reviewed_by_id");
  CREATE INDEX "_pages_v_version_version_author_idx" ON "_pages_v" USING btree ("version_author_id");
  CREATE INDEX "_pages_v_version_version_reviewed_by_idx" ON "_pages_v" USING btree ("version_reviewed_by_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "pages_faq" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_pages_v_version_faq" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "pages_faq" CASCADE;
  DROP TABLE "_pages_v_version_faq" CASCADE;
  ALTER TABLE "pages" DROP CONSTRAINT "pages_author_id_users_id_fk";
  
  ALTER TABLE "pages" DROP CONSTRAINT "pages_reviewed_by_id_users_id_fk";
  
  ALTER TABLE "_pages_v" DROP CONSTRAINT "_pages_v_version_author_id_users_id_fk";
  
  ALTER TABLE "_pages_v" DROP CONSTRAINT "_pages_v_version_reviewed_by_id_users_id_fk";
  
  DROP INDEX "pages_author_idx";
  DROP INDEX "pages_reviewed_by_idx";
  DROP INDEX "_pages_v_version_version_author_idx";
  DROP INDEX "_pages_v_version_version_reviewed_by_idx";
  ALTER TABLE "pages" DROP COLUMN "author_id";
  ALTER TABLE "pages" DROP COLUMN "reviewed_by_id";
  ALTER TABLE "pages" DROP COLUMN "reviewed_at";
  ALTER TABLE "pages" DROP COLUMN "next_review_at";
  ALTER TABLE "_pages_v" DROP COLUMN "version_author_id";
  ALTER TABLE "_pages_v" DROP COLUMN "version_reviewed_by_id";
  ALTER TABLE "_pages_v" DROP COLUMN "version_reviewed_at";
  ALTER TABLE "_pages_v" DROP COLUMN "version_next_review_at";`)
}
