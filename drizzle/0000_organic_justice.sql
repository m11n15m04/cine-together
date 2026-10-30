CREATE TABLE IF NOT EXISTS "chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"sender_id" text NOT NULL,
	"sender_name" text NOT NULL,
	"content" text NOT NULL,
	"message_type" text DEFAULT 'chat' NOT NULL,
	"video_timestamp_seconds" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "media_items" (
	"id" text PRIMARY KEY NOT NULL,
	"tmdb_id" integer NOT NULL,
	"media_type" text NOT NULL,
	"title" text NOT NULL,
	"year" text NOT NULL,
	"rating" double precision NOT NULL,
	"duration_minutes" integer NOT NULL,
	"genres" text NOT NULL,
	"language" text DEFAULT 'English' NOT NULL,
	"overview" text NOT NULL,
	"poster_url" text NOT NULL,
	"backdrop_url" text NOT NULL,
	"seasons" integer DEFAULT 1,
	"episodes" integer DEFAULT 1,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "playback_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"media_id" text NOT NULL,
	"media_type" text DEFAULT 'movie' NOT NULL,
	"status" text DEFAULT 'paused' NOT NULL,
	"position_seconds" double precision DEFAULT 0 NOT NULL,
	"playback_rate" double precision DEFAULT 1 NOT NULL,
	"host_id" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "playback_states_room_id_unique" UNIQUE("room_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"uid" text NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"avatar_url" text,
	"preferred_theme" text DEFAULT 'midnight-violet' NOT NULL,
	"preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_uid_unique" UNIQUE("uid")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "room_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"display_name" text NOT NULL,
	"avatar_color" text DEFAULT '#8b5cf6' NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"is_online" boolean DEFAULT true NOT NULL,
	"joined_at" timestamp DEFAULT now() NOT NULL,
	"left_at" timestamp,
	"is_banned" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "room_reactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"user_name" text NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "room_votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"media_id" text NOT NULL,
	"media_title" text NOT NULL,
	"voter_id" text NOT NULL,
	"voter_name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "watch_rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_code" text NOT NULL,
	"room_type" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"host_user_id" text NOT NULL,
	"current_media_id" text NOT NULL,
	"current_media_type" text DEFAULT 'movie' NOT NULL,
	"current_season" integer DEFAULT 1 NOT NULL,
	"current_episode" integer DEFAULT 1 NOT NULL,
	"is_private" boolean DEFAULT true NOT NULL,
	"password_hash" text,
	"max_participants" integer DEFAULT 2 NOT NULL,
	"collaborative_controls" boolean DEFAULT false NOT NULL,
	"is_locked" boolean DEFAULT false NOT NULL,
	"room_theme" text DEFAULT 'rose-nebula' NOT NULL,
	"couple_partner_note" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp,
	CONSTRAINT "watch_rooms_room_code_unique" UNIQUE("room_code")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "watch_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"room_id" uuid,
	"media_id" text NOT NULL,
	"media_title" text NOT NULL,
	"media_type" text DEFAULT 'movie' NOT NULL,
	"room_type" text DEFAULT 'solo' NOT NULL,
	"progress_seconds" integer DEFAULT 0 NOT NULL,
	"duration_seconds" integer DEFAULT 7200 NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"last_watched_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"ended_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "watchlist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"watchlist_id" uuid,
	"user_id" text NOT NULL,
	"media_id" text NOT NULL,
	"media_title" text NOT NULL,
	"media_type" text NOT NULL,
	"poster_url" text NOT NULL,
	"year" text NOT NULL,
	"rating" double precision DEFAULT 8 NOT NULL,
	"added_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "watchlists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text DEFAULT 'My Watchlist' NOT NULL,
	"room_id" uuid,
	"is_shared" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "preferences" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "watch_rooms" ADD COLUMN IF NOT EXISTS "is_locked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "watch_rooms" ADD COLUMN IF NOT EXISTS "couple_partner_note" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "room_members" ADD COLUMN IF NOT EXISTS "left_at" timestamp;--> statement-breakpoint
ALTER TABLE "room_members" ADD COLUMN IF NOT EXISTS "is_banned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "watch_sessions" ADD COLUMN IF NOT EXISTS "last_watched_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "watch_sessions" ADD COLUMN IF NOT EXISTS "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_messages_room_id_watch_rooms_id_fk') THEN ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_room_id_watch_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."watch_rooms"("id") ON DELETE cascade ON UPDATE no action; END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'playback_states_room_id_watch_rooms_id_fk') THEN ALTER TABLE "playback_states" ADD CONSTRAINT "playback_states_room_id_watch_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."watch_rooms"("id") ON DELETE cascade ON UPDATE no action; END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'room_members_room_id_watch_rooms_id_fk') THEN ALTER TABLE "room_members" ADD CONSTRAINT "room_members_room_id_watch_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."watch_rooms"("id") ON DELETE cascade ON UPDATE no action; END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'room_reactions_room_id_watch_rooms_id_fk') THEN ALTER TABLE "room_reactions" ADD CONSTRAINT "room_reactions_room_id_watch_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."watch_rooms"("id") ON DELETE cascade ON UPDATE no action; END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'room_votes_room_id_watch_rooms_id_fk') THEN ALTER TABLE "room_votes" ADD CONSTRAINT "room_votes_room_id_watch_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."watch_rooms"("id") ON DELETE cascade ON UPDATE no action; END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'watch_sessions_room_id_watch_rooms_id_fk') THEN ALTER TABLE "watch_sessions" ADD CONSTRAINT "watch_sessions_room_id_watch_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."watch_rooms"("id") ON DELETE set null ON UPDATE no action; END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'watchlist_items_watchlist_id_watchlists_id_fk') THEN ALTER TABLE "watchlist_items" ADD CONSTRAINT "watchlist_items_watchlist_id_watchlists_id_fk" FOREIGN KEY ("watchlist_id") REFERENCES "public"."watchlists"("id") ON DELETE cascade ON UPDATE no action; END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'watchlists_room_id_watch_rooms_id_fk') THEN ALTER TABLE "watchlists" ADD CONSTRAINT "watchlists_room_id_watch_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."watch_rooms"("id") ON DELETE cascade ON UPDATE no action; END IF; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_messages_room_created_idx" ON "chat_messages" USING btree ("room_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_items_type_idx" ON "media_items" USING btree ("media_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "playback_states_room_idx" ON "playback_states" USING btree ("room_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "profiles_uid_idx" ON "profiles" USING btree ("uid");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "room_members_room_user_unique" ON "room_members" USING btree ("room_id","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "room_members_room_idx" ON "room_members" USING btree ("room_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "room_members_user_idx" ON "room_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "room_reactions_room_idx" ON "room_reactions" USING btree ("room_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "room_votes_room_media_voter_unique" ON "room_votes" USING btree ("room_id","media_id","voter_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "room_votes_room_idx" ON "room_votes" USING btree ("room_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "watch_rooms_code_idx" ON "watch_rooms" USING btree ("room_code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "watch_rooms_host_idx" ON "watch_rooms" USING btree ("host_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "watch_sessions_user_last_watched_idx" ON "watch_sessions" USING btree ("user_id","last_watched_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "watchlist_items_user_media_unique" ON "watchlist_items" USING btree ("user_id","media_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "watchlist_items_user_idx" ON "watchlist_items" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "watchlist_items_media_idx" ON "watchlist_items" USING btree ("media_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "watchlists_user_unique" ON "watchlists" USING btree ("user_id");
