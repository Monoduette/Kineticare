import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_pages_blocks_offer_cards_kartyak_ikon" AS ENUM('kepzes', 'szakkonyv', 'nincs');
  CREATE TYPE "public"."enum_pages_blocks_offer_cards_kartyak_gomb_suly" AS ENUM('elsodleges', 'masodlagos');
  CREATE TYPE "public"."enum_pages_blocks_offer_cards_section_settings_hatter" AS ENUM('feher', 'tint', 'sotet');
  CREATE TYPE "public"."enum__pages_v_blocks_offer_cards_kartyak_ikon" AS ENUM('kepzes', 'szakkonyv', 'nincs');
  CREATE TYPE "public"."enum__pages_v_blocks_offer_cards_kartyak_gomb_suly" AS ENUM('elsodleges', 'masodlagos');
  CREATE TYPE "public"."enum__pages_v_blocks_offer_cards_section_settings_hatter" AS ENUM('feher', 'tint', 'sotet');
  CREATE TABLE "pages_blocks_offer_cards_kartyak_tenyek" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"szoveg" varchar
  );
  
  CREATE TABLE "pages_blocks_offer_cards_kartyak" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"ikon" "enum_pages_blocks_offer_cards_kartyak_ikon" DEFAULT 'nincs',
  	"kicker" varchar,
  	"cim" varchar,
  	"szoveg" varchar,
  	"felirat" varchar,
  	"url" varchar,
  	"uj_ablakban" boolean DEFAULT false,
  	"gomb_suly" "enum_pages_blocks_offer_cards_kartyak_gomb_suly" DEFAULT 'masodlagos',
  	"jegyzet" varchar,
  	"hamarosan" boolean DEFAULT false,
  	"allapot_szoveg" varchar
  );
  
  CREATE TABLE "pages_blocks_offer_cards" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"eyebrow" varchar,
  	"title" varchar,
  	"lead" varchar,
  	"section_settings_visible" boolean DEFAULT true,
  	"section_settings_anchor_id" varchar,
  	"section_settings_hatter" "enum_pages_blocks_offer_cards_section_settings_hatter" DEFAULT 'feher',
  	"block_name" varchar
  );
  
  CREATE TABLE "_pages_v_blocks_offer_cards_kartyak_tenyek" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"szoveg" varchar,
  	"_uuid" varchar
  );
  
  CREATE TABLE "_pages_v_blocks_offer_cards_kartyak" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"ikon" "enum__pages_v_blocks_offer_cards_kartyak_ikon" DEFAULT 'nincs',
  	"kicker" varchar,
  	"cim" varchar,
  	"szoveg" varchar,
  	"felirat" varchar,
  	"url" varchar,
  	"uj_ablakban" boolean DEFAULT false,
  	"gomb_suly" "enum__pages_v_blocks_offer_cards_kartyak_gomb_suly" DEFAULT 'masodlagos',
  	"jegyzet" varchar,
  	"hamarosan" boolean DEFAULT false,
  	"allapot_szoveg" varchar,
  	"_uuid" varchar
  );
  
  CREATE TABLE "_pages_v_blocks_offer_cards" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"eyebrow" varchar,
  	"title" varchar,
  	"lead" varchar,
  	"section_settings_visible" boolean DEFAULT true,
  	"section_settings_anchor_id" varchar,
  	"section_settings_hatter" "enum__pages_v_blocks_offer_cards_section_settings_hatter" DEFAULT 'feher',
  	"_uuid" varchar,
  	"block_name" varchar
  );
  
  ALTER TABLE "pages_blocks_course_cards" ADD COLUMN "hatter_felirat" varchar;
  ALTER TABLE "pages_blocks_cta_banner" ADD COLUMN "kep_id" integer;
  ALTER TABLE "_pages_v_blocks_course_cards" ADD COLUMN "hatter_felirat" varchar;
  ALTER TABLE "_pages_v_blocks_cta_banner" ADD COLUMN "kep_id" integer;
  ALTER TABLE "pages_blocks_offer_cards_kartyak_tenyek" ADD CONSTRAINT "pages_blocks_offer_cards_kartyak_tenyek_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."pages_blocks_offer_cards_kartyak"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "pages_blocks_offer_cards_kartyak" ADD CONSTRAINT "pages_blocks_offer_cards_kartyak_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."pages_blocks_offer_cards"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "pages_blocks_offer_cards" ADD CONSTRAINT "pages_blocks_offer_cards_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_pages_v_blocks_offer_cards_kartyak_tenyek" ADD CONSTRAINT "_pages_v_blocks_offer_cards_kartyak_tenyek_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_pages_v_blocks_offer_cards_kartyak"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_pages_v_blocks_offer_cards_kartyak" ADD CONSTRAINT "_pages_v_blocks_offer_cards_kartyak_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_pages_v_blocks_offer_cards"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_pages_v_blocks_offer_cards" ADD CONSTRAINT "_pages_v_blocks_offer_cards_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_pages_v"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "pages_blocks_offer_cards_kartyak_tenyek_order_idx" ON "pages_blocks_offer_cards_kartyak_tenyek" USING btree ("_order");
  CREATE INDEX "pages_blocks_offer_cards_kartyak_tenyek_parent_id_idx" ON "pages_blocks_offer_cards_kartyak_tenyek" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_offer_cards_kartyak_order_idx" ON "pages_blocks_offer_cards_kartyak" USING btree ("_order");
  CREATE INDEX "pages_blocks_offer_cards_kartyak_parent_id_idx" ON "pages_blocks_offer_cards_kartyak" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_offer_cards_order_idx" ON "pages_blocks_offer_cards" USING btree ("_order");
  CREATE INDEX "pages_blocks_offer_cards_parent_id_idx" ON "pages_blocks_offer_cards" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_offer_cards_path_idx" ON "pages_blocks_offer_cards" USING btree ("_path");
  CREATE INDEX "_pages_v_blocks_offer_cards_kartyak_tenyek_order_idx" ON "_pages_v_blocks_offer_cards_kartyak_tenyek" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_offer_cards_kartyak_tenyek_parent_id_idx" ON "_pages_v_blocks_offer_cards_kartyak_tenyek" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_blocks_offer_cards_kartyak_order_idx" ON "_pages_v_blocks_offer_cards_kartyak" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_offer_cards_kartyak_parent_id_idx" ON "_pages_v_blocks_offer_cards_kartyak" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_blocks_offer_cards_order_idx" ON "_pages_v_blocks_offer_cards" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_offer_cards_parent_id_idx" ON "_pages_v_blocks_offer_cards" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_blocks_offer_cards_path_idx" ON "_pages_v_blocks_offer_cards" USING btree ("_path");
  ALTER TABLE "pages_blocks_cta_banner" ADD CONSTRAINT "pages_blocks_cta_banner_kep_id_media_id_fk" FOREIGN KEY ("kep_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_pages_v_blocks_cta_banner" ADD CONSTRAINT "_pages_v_blocks_cta_banner_kep_id_media_id_fk" FOREIGN KEY ("kep_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "pages_blocks_cta_banner_kep_idx" ON "pages_blocks_cta_banner" USING btree ("kep_id");
  CREATE INDEX "_pages_v_blocks_cta_banner_kep_idx" ON "_pages_v_blocks_cta_banner" USING btree ("kep_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "pages_blocks_offer_cards_kartyak_tenyek" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "pages_blocks_offer_cards_kartyak" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "pages_blocks_offer_cards" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_pages_v_blocks_offer_cards_kartyak_tenyek" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_pages_v_blocks_offer_cards_kartyak" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_pages_v_blocks_offer_cards" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "pages_blocks_offer_cards_kartyak_tenyek" CASCADE;
  DROP TABLE "pages_blocks_offer_cards_kartyak" CASCADE;
  DROP TABLE "pages_blocks_offer_cards" CASCADE;
  DROP TABLE "_pages_v_blocks_offer_cards_kartyak_tenyek" CASCADE;
  DROP TABLE "_pages_v_blocks_offer_cards_kartyak" CASCADE;
  DROP TABLE "_pages_v_blocks_offer_cards" CASCADE;
  ALTER TABLE "pages_blocks_cta_banner" DROP CONSTRAINT "pages_blocks_cta_banner_kep_id_media_id_fk";
  
  ALTER TABLE "_pages_v_blocks_cta_banner" DROP CONSTRAINT "_pages_v_blocks_cta_banner_kep_id_media_id_fk";
  
  DROP INDEX "pages_blocks_cta_banner_kep_idx";
  DROP INDEX "_pages_v_blocks_cta_banner_kep_idx";
  ALTER TABLE "pages_blocks_course_cards" DROP COLUMN "hatter_felirat";
  ALTER TABLE "pages_blocks_cta_banner" DROP COLUMN "kep_id";
  ALTER TABLE "_pages_v_blocks_course_cards" DROP COLUMN "hatter_felirat";
  ALTER TABLE "_pages_v_blocks_cta_banner" DROP COLUMN "kep_id";
  DROP TYPE "public"."enum_pages_blocks_offer_cards_kartyak_ikon";
  DROP TYPE "public"."enum_pages_blocks_offer_cards_kartyak_gomb_suly";
  DROP TYPE "public"."enum_pages_blocks_offer_cards_section_settings_hatter";
  DROP TYPE "public"."enum__pages_v_blocks_offer_cards_kartyak_ikon";
  DROP TYPE "public"."enum__pages_v_blocks_offer_cards_kartyak_gomb_suly";
  DROP TYPE "public"."enum__pages_v_blocks_offer_cards_section_settings_hatter";`)
}
