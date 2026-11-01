-- Minimal shape of the pre-Drizzle CineTogether schema. CI applies this fixture before
-- the additive baseline to verify an upgrade without deleting existing records.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uid text NOT NULL UNIQUE,
  email text NOT NULL,
  display_name text NOT NULL,
  avatar_url text,
  preferred_theme text DEFAULT 'midnight-violet' NOT NULL,
  created_at timestamp DEFAULT now() NOT NULL,
  updated_at timestamp DEFAULT now() NOT NULL
);

CREATE TABLE media_items (
  id text PRIMARY KEY,
  tmdb_id integer NOT NULL,
  media_type text NOT NULL,
  title text NOT NULL,
  year text NOT NULL,
  rating double precision NOT NULL,
  duration_minutes integer NOT NULL,
  genres text NOT NULL,
  language text DEFAULT 'English' NOT NULL,
  overview text NOT NULL,
  poster_url text NOT NULL,
  backdrop_url text NOT NULL,
  seasons integer DEFAULT 1,
  episodes integer DEFAULT 1,
  created_at timestamp DEFAULT now() NOT NULL
);

CREATE TABLE watch_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_code text NOT NULL UNIQUE,
  room_type text NOT NULL,
  title text NOT NULL,
  description text DEFAULT '' NOT NULL,
  host_user_id text NOT NULL,
  current_media_id text NOT NULL,
  current_media_type text DEFAULT 'movie' NOT NULL,
  current_season integer DEFAULT 1 NOT NULL,
  current_episode integer DEFAULT 1 NOT NULL,
  is_private boolean DEFAULT true NOT NULL,
  password_hash text,
  max_participants integer DEFAULT 2 NOT NULL,
  collaborative_controls boolean DEFAULT false NOT NULL,
  room_theme text DEFAULT 'rose-nebula' NOT NULL,
  status text DEFAULT 'waiting' NOT NULL,
  created_at timestamp DEFAULT now() NOT NULL,
  expires_at timestamp
);

CREATE TABLE watchlists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  name text DEFAULT 'My Watchlist' NOT NULL,
  room_id uuid REFERENCES watch_rooms(id) ON DELETE CASCADE,
  is_shared boolean DEFAULT false NOT NULL,
  created_at timestamp DEFAULT now() NOT NULL
);

CREATE TABLE watchlist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  watchlist_id uuid REFERENCES watchlists(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  media_id text NOT NULL,
  media_title text NOT NULL,
  media_type text NOT NULL,
  poster_url text NOT NULL,
  year text NOT NULL,
  rating double precision DEFAULT 8 NOT NULL,
  added_at timestamp DEFAULT now() NOT NULL
);

CREATE TABLE room_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES watch_rooms(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  display_name text NOT NULL,
  avatar_color text DEFAULT '#8b5cf6' NOT NULL,
  role text DEFAULT 'member' NOT NULL,
  is_online boolean DEFAULT true NOT NULL,
  joined_at timestamp DEFAULT now() NOT NULL
);

CREATE TABLE playback_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL UNIQUE REFERENCES watch_rooms(id) ON DELETE CASCADE,
  media_id text NOT NULL,
  media_type text DEFAULT 'movie' NOT NULL,
  status text DEFAULT 'paused' NOT NULL,
  position_seconds double precision DEFAULT 0 NOT NULL,
  playback_rate double precision DEFAULT 1 NOT NULL,
  host_id text NOT NULL,
  revision integer DEFAULT 1 NOT NULL,
  updated_at timestamp DEFAULT now() NOT NULL
);

CREATE TABLE chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES watch_rooms(id) ON DELETE CASCADE,
  sender_id text NOT NULL,
  sender_name text NOT NULL,
  content text NOT NULL,
  message_type text DEFAULT 'chat' NOT NULL,
  video_timestamp_seconds integer DEFAULT 0 NOT NULL,
  created_at timestamp DEFAULT now() NOT NULL
);

CREATE TABLE room_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES watch_rooms(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  user_name text NOT NULL,
  emoji text NOT NULL,
  created_at timestamp DEFAULT now() NOT NULL
);

CREATE TABLE room_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES watch_rooms(id) ON DELETE CASCADE,
  media_id text NOT NULL,
  media_title text NOT NULL,
  voter_id text NOT NULL,
  voter_name text NOT NULL,
  created_at timestamp DEFAULT now() NOT NULL
);

CREATE TABLE watch_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  room_id uuid REFERENCES watch_rooms(id) ON DELETE SET NULL,
  media_id text NOT NULL,
  media_title text NOT NULL,
  media_type text DEFAULT 'movie' NOT NULL,
  room_type text DEFAULT 'solo' NOT NULL,
  progress_seconds integer DEFAULT 0 NOT NULL,
  duration_seconds integer DEFAULT 7200 NOT NULL,
  started_at timestamp DEFAULT now() NOT NULL,
  ended_at timestamp
);

INSERT INTO profiles (id, uid, email, display_name)
VALUES ('11111111-1111-4111-8111-111111111111', 'legacy-migration-user', 'legacy@example.invalid', 'Legacy Member');

INSERT INTO watch_rooms (id, room_code, room_type, title, host_user_id, current_media_id)
VALUES ('22222222-2222-4222-8222-222222222222', 'LEGACY-MIGRATION', 'group', 'Legacy Room', 'legacy-migration-user', 'legacy-film');

INSERT INTO room_members (id, room_id, user_id, display_name, role)
VALUES ('33333333-3333-4333-8333-333333333333', '22222222-2222-4222-8222-222222222222', 'legacy-migration-user', 'Legacy Member', 'host');

INSERT INTO watch_sessions (id, user_id, media_id, media_title, progress_seconds)
VALUES ('44444444-4444-4444-8444-444444444444', 'legacy-migration-user', 'legacy-film', 'Legacy Film', 125);
