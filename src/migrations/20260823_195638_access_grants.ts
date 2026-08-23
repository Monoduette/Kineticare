import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "users_access_grants" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"product_id" integer NOT NULL,
  	"granted_at" timestamp(3) with time zone NOT NULL
  );
  
  ALTER TABLE "users_access_grants" ADD CONSTRAINT "users_access_grants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "users_access_grants" ADD CONSTRAINT "users_access_grants_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "users_access_grants_order_idx" ON "users_access_grants" USING btree ("_order");
  CREATE INDEX "users_access_grants_parent_id_idx" ON "users_access_grants" USING btree ("_parent_id");
  CREATE INDEX "users_access_grants_product_idx" ON "users_access_grants" USING btree ("product_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE "users_access_grants" CASCADE;`)
}
