CREATE TABLE "tmdb_catalog_cache" (
	"cache_key" text PRIMARY KEY NOT NULL,
	"payload" jsonb NOT NULL,
	"refreshed_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE INDEX "tmdb_catalog_cache_expires_idx" ON "tmdb_catalog_cache" USING btree ("expires_at");