import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "pages_seo_keywords" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"phrase" varchar
  );
  
  CREATE TABLE "_pages_v_version_seo_keywords" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"phrase" varchar,
  	"_uuid" varchar
  );
  
  CREATE TABLE "posts_seo_keywords" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"phrase" varchar
  );
  
  CREATE TABLE "_posts_v_version_seo_keywords" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"phrase" varchar,
  	"_uuid" varchar
  );
  
  ALTER TABLE "pages_seo_keywords" ADD CONSTRAINT "pages_seo_keywords_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_pages_v_version_seo_keywords" ADD CONSTRAINT "_pages_v_version_seo_keywords_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_pages_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "posts_seo_keywords" ADD CONSTRAINT "posts_seo_keywords_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_posts_v_version_seo_keywords" ADD CONSTRAINT "_posts_v_version_seo_keywords_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_posts_v"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "pages_seo_keywords_order_idx" ON "pages_seo_keywords" USING btree ("_order");
  CREATE INDEX "pages_seo_keywords_parent_id_idx" ON "pages_seo_keywords" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_version_seo_keywords_order_idx" ON "_pages_v_version_seo_keywords" USING btree ("_order");
  CREATE INDEX "_pages_v_version_seo_keywords_parent_id_idx" ON "_pages_v_version_seo_keywords" USING btree ("_parent_id");
  CREATE INDEX "posts_seo_keywords_order_idx" ON "posts_seo_keywords" USING btree ("_order");
  CREATE INDEX "posts_seo_keywords_parent_id_idx" ON "posts_seo_keywords" USING btree ("_parent_id");
  CREATE INDEX "_posts_v_version_seo_keywords_order_idx" ON "_posts_v_version_seo_keywords" USING btree ("_order");
  CREATE INDEX "_posts_v_version_seo_keywords_parent_id_idx" ON "_posts_v_version_seo_keywords" USING btree ("_parent_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE "pages_seo_keywords" CASCADE;
  DROP TABLE "_pages_v_version_seo_keywords" CASCADE;
  DROP TABLE "posts_seo_keywords" CASCADE;
  DROP TABLE "_posts_v_version_seo_keywords" CASCADE;`)
}
