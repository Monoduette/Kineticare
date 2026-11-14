import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "products_materials" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"label" varchar,
  	"protected_file_id" integer
  );
  
  CREATE TABLE "_products_v_version_materials" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"label" varchar,
  	"protected_file_id" integer,
  	"_uuid" varchar
  );
  
  ALTER TABLE "products_materials" ADD CONSTRAINT "products_materials_protected_file_id_course_files_id_fk" FOREIGN KEY ("protected_file_id") REFERENCES "public"."course_files"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "products_materials" ADD CONSTRAINT "products_materials_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_products_v_version_materials" ADD CONSTRAINT "_products_v_version_materials_protected_file_id_course_files_id_fk" FOREIGN KEY ("protected_file_id") REFERENCES "public"."course_files"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_products_v_version_materials" ADD CONSTRAINT "_products_v_version_materials_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_products_v"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "products_materials_order_idx" ON "products_materials" USING btree ("_order");
  CREATE INDEX "products_materials_parent_id_idx" ON "products_materials" USING btree ("_parent_id");
  CREATE INDEX "products_materials_protected_file_idx" ON "products_materials" USING btree ("protected_file_id");
  CREATE INDEX "_products_v_version_materials_order_idx" ON "_products_v_version_materials" USING btree ("_order");
  CREATE INDEX "_products_v_version_materials_parent_id_idx" ON "_products_v_version_materials" USING btree ("_parent_id");
  CREATE INDEX "_products_v_version_materials_protected_file_idx" ON "_products_v_version_materials" USING btree ("protected_file_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE "products_materials" CASCADE;
  DROP TABLE "_products_v_version_materials" CASCADE;`)
}
