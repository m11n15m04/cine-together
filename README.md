# CineTogether

CineTogether is an existing Vite/React application served by an Express and TypeScript backend. The backend owns PostgreSQL persistence, Firebase token verification, guest sessions, watch party APIs, and authenticated WebSocket room state. The frontend remains in this repository and uses the same API origin in production.

## Requirements

- Node.js 24.12 or newer (the repository pins Node 24.22.1 in `.node-version`).
- PostgreSQL for persistence.
- Firebase Admin credentials for Firebase-authenticated user APIs. Guest room access works independently.

## Local setup

```sh
npm ci
cp .env.example .env
# Fill in local values in .env.
npm run db:migrate
npm run dev
```

The development server serves Vite and the API on the same port. It binds to `0.0.0.0` and uses `PORT` (default `3000`). If PostgreSQL is not configured in development, the app starts with a warning; persistence endpoints and `/api/health` report the database as unavailable.

## Production build and start

```sh
npm ci
npm run build
npm start
```

`npm run build` builds the existing Vite client to `dist/` and bundles the TypeScript Express server to `dist-server/`. `npm start` runs that server, which serves the static client, `/api/*`, and WebSockets. Production startup requires a reachable PostgreSQL database and `AUTH_TOKEN_SECRET` with at least 32 bytes. The app exits if either requirement is missing.

## Environment variables

Copy `.env.example` and configure only the features you use. TMDB catalog access uses a server-only API Read Access Token. Never put this token in a `VITE_*` variable or frontend bundle.

| Variable | Purpose |
| --- | --- |
| `NODE_ENV` | Set `production` on Render; defaults to development locally. |
| `PORT` | HTTP and WebSocket listener port. Render supplies this value. |
| `DATABASE_URL` | Preferred PostgreSQL connection URL. `POSTGRES_URL` and legacy `SQL_HOST`, `SQL_PORT`, `SQL_DB_NAME`, `SQL_USER`, and `SQL_PASSWORD` are also supported. |
| `DATABASE_SSL` | Set to `require` if the database requires TLS. `DATABASE_SSL_REJECT_UNAUTHORIZED` defaults to `true`; do not disable certificate validation in production. |
| `PG_POOL_MAX`, `PG_CONNECT_TIMEOUT_MS` | PostgreSQL pool size and connection timeout. |
| `AUTH_TOKEN_SECRET` | Random secret of 32+ bytes for signed guest and room access tokens. Keep it stable across deploys so current sessions continue to work. |
| `FIREBASE_PROJECT_ID` | Firebase Admin project ID. `VITE_FIREBASE_PROJECT_ID` is accepted as a fallback. |
| `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` | Optional Firebase service account credentials. Set both or neither. Newlines in the private key may be written as `\\n`. Application Default Credentials are used when these are omitted. |
| `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID` | Public Firebase web SDK configuration used by the existing frontend. These are build-time Vite variables, not Admin credentials. |
| `GEMINI_API_KEY` | Optional server-side Gemini analysis, recommendations, and live voice companion. |
| `TMDB_API_READ_ACCESS_TOKEN` | Server-only TMDB API v3 Read Access Token sent as `Authorization: Bearer …`. Required for live movie and TV metadata. Never expose it to Vite/browser code. |
| `TMDB_REQUEST_TIMEOUT_MS` | Optional TMDB request timeout in milliseconds; defaults to 8000 and is capped at 60000. |
| `AUTHORIZED_MEDIA_SOURCES_JSON`, `AUTHORIZED_MEDIA_HOSTS` | Optional playback allowlist. Configure only sources CineTogether is authorized to play. Sources must use HTTPS (HTTP is allowed only for local development), match the allowlisted host, and end in `.mp4` or `.m3u8` for direct playback. External links use manual sync. |
| `DATABASE_SSL_REJECT_UNAUTHORIZED`, `SQL_ADMIN_USER`, `SQL_ADMIN_PASSWORD`, `APP_URL`, `DISABLE_HMR` | Optional TLS, migration-role, application URL, and local development settings. |

Do not commit `.env` files, credentials, service account JSON files, database URLs, or backups. `.env.example` contains empty placeholders only.

## Database schema and migrations

Drizzle schema definitions are in [`src/db/schema.ts`](src/db/schema.ts). The database contains:

- `profiles` — Firebase UID, email, display name, theme, preferences, timestamps.
- `media_items` — catalog metadata; no playback URLs.
- `nxsha_catalog_cache` — legacy cache table retained for compatibility; the TMDB integration does not read or write it.
- `tmdb_catalog_cache` — TMDB JSON API payloads keyed by a SHA-256 digest, with refresh and expiry timestamps. Short TTLs are used for search/list data and longer TTLs for details and genres.
- `watchlists` and `watchlist_items` — per-user saved titles with uniqueness constraints.
- `watch_rooms` and `room_members` — room configuration, host, status, membership, connection and ban state.
- `playback_states` — one authoritative state per room, including revision and position.
- `chat_messages`, `room_reactions`, and `room_votes` — durable room activity.
- `watch_sessions` — per-user playback history and resume progress.

The initial Drizzle baseline is [`drizzle/0000_organic_justice.sql`](drizzle/0000_organic_justice.sql). This repository predates Drizzle migrations. The baseline uses `CREATE TABLE IF NOT EXISTS`, adds the fields introduced here with `ADD COLUMN IF NOT EXISTS`, and creates indexes without dropping or truncating tables. It can initialize a fresh database or add these changes to the existing CineTogether tables.

Generate and apply migrations with:

```sh
npm run db:generate
npm run db:migrate
```

Before the first migration on an existing database, take a backup and check whether the new uniqueness constraints would encounter duplicate records:

```sql
SELECT room_id, user_id, count(*) FROM room_members GROUP BY room_id, user_id HAVING count(*) > 1;
SELECT room_id, media_id, voter_id, count(*) FROM room_votes GROUP BY room_id, media_id, voter_id HAVING count(*) > 1;
SELECT user_id, media_id, count(*) FROM watchlist_items GROUP BY user_id, media_id HAVING count(*) > 1;
SELECT user_id, count(*) FROM watchlists GROUP BY user_id HAVING count(*) > 1;
```

Resolve duplicates only after deciding which records to preserve. The migration intentionally does not delete or merge data; PostgreSQL will stop if a unique index cannot be created. Re-run the migration after the data is reconciled. Do not run migrations against production until the database backup and duplicate checks are complete.

### Backup and recovery

Use the PostgreSQL provider’s point-in-time recovery or scheduled backups when available. Also keep encrypted, access-controlled logical backups outside the repository:

```sh
pg_dump --format=custom --no-owner --file=cinetogether-YYYYMMDD.dump "$DATABASE_URL"
```

Verify a backup with `pg_restore --list cinetogether-YYYYMMDD.dump`. For recovery, restore to a new or explicitly selected target database first, then validate the app before changing the production connection:

```sh
pg_restore --no-owner --dbname="$RESTORE_DATABASE_URL" cinetogether-YYYYMMDD.dump
```

Keep credentials out of shell history and logs. Store backups encrypted and restrict access. Do not use `pg_restore --clean` against a database whose existing data must be preserved.

## API contract

All routes below are under `/api`. Successful responses are JSON; errors use `{ "error": "..." }`. Private user routes require `Authorization: Bearer <Firebase ID token>`. Room routes accept either a verified Firebase ID token or a signed guest session token. Request bodies are JSON objects capped at 128 KB.

| Method and path | Access | Purpose |
| --- | --- | --- |
| `GET /health` | Public | PostgreSQL readiness. Returns 503 when the database is unavailable. |
| `GET /health/catalog`, `GET /catalog/status` | Public | TMDB metadata token configuration status. Returns 503 when the server token is missing. Reports Nxsha playback as a separate provider. |
| `POST /auth/guest-session` | Public, rate limited | Creates a signed 24-hour guest session. Body: `{ "displayName": "..." }`. |
| `GET /catalog/movies/popular?page=…`, `/catalog/movies/trending?window=day\|week`, `/catalog/movies/top-rated`, `/catalog/movies/now-playing`, `/catalog/movies/upcoming` | Public, rate limited | TMDB movie lists. Responses include `provider`, `state`, `items`, and pagination fields. |
| `GET /catalog/movies/discover?page=…&genre=…&year=…` | Public, rate limited | TMDB movie discovery with validated genre ID and release year filters. |
| `GET /catalog/movies/search?q=…&page=…&year=…` | Public, rate limited | TMDB movie search. Query length is 1–120 characters. |
| `GET /catalog/movies/:tmdbId`, `/catalog/movies/:tmdbId/recommendations?page=…` | Public, rate limited | TMDB movie detail or recommendation list. IDs must be positive numeric TMDB IDs. |
| `GET /catalog/genres/movie`, `/catalog/genres/tv` | Public, rate limited | TMDB genre lists used by discovery filters. |
| `GET /catalog/tv/popular`, `/catalog/tv/trending?window=day\|week`, `/catalog/tv/discover`, `/catalog/tv/search` | Public, rate limited | TMDB TV lists, TV search, and genre/year discovery. |
| `GET /catalog/tv/:tmdbId`, `/catalog/tv/:tmdbId/seasons`, `/catalog/tv/:tmdbId/seasons/:seasonNumber`, `/catalog/tv/:tmdbId/seasons/:seasonNumber/episodes` | Public, rate limited | TMDB TV details and season/episode metadata. The two season routes return the same season payload for compatibility. |
| `GET /catalog/feed?section=…&page=…`, `GET /catalog/search?q=…&type=movie\|tv\|all&page=…` | Public, rate limited | Compatibility contracts backed only by TMDB. `section` supports movie, tv, trending, tv-trending, top-rated, now-playing, upcoming, and all. Anime is not a separate TMDB catalog and is not fabricated. |
| `GET /catalog/:providerId`, `/catalog/:providerId/seasons`, `/catalog/:providerId/seasons/:season/episodes` | Public, rate limited | Compatibility detail routes accept IDs scoped as `tmdb:movie:<id>` or `tmdb:tv:<id>`. |
| `GET /media/availability/:id?season=...&episode=...` | Public | Reports `metadata-only`, `synced-ready`, or `external-watch`; only configured authorized sources are playable. |
| `GET /party/rooms` | Public | Lists active public rooms. |
| `POST /party/rooms` | Firebase or guest | Creates a room and returns a room access token. |
| `POST /party/rooms/:roomCode/verify` | Firebase or guest | Verifies a room password, when set, and issues a room access token. |
| `GET /watchlist`, `POST /watchlist`, `POST /watchlist/toggle`, `DELETE /watchlist/:mediaId` | Firebase | Reads and changes only the authenticated user’s watchlist. |
| `GET /profile`, `PATCH /profile`, `POST /profile/preferences` | Firebase | Reads or updates the authenticated user’s profile and preferences. Email comes from the verified Firebase token. |
| `GET /watch-history?limit=...`, `POST /watch-history`, `PATCH /watch-history/:sessionId` | Firebase | Reads history, records a session, and updates owned playback progress. `POST /sessions/record` remains as a compatibility alias. |
| `POST /gemini/analyze`, `/gemini/quick-recap`, `/gemini/recommend` | Public, rate limited | Optional Gemini features; return 503 when no server key is configured. |

### Catalog contract migration

The former `/nxsha/feed`, `/nxsha/search`, and `/nxsha/tv/:providerId/seasons` catalog routes were removed because they represented an undocumented Nxsha catalog API. Clients should use `/catalog/movies/*`, `/catalog/tv/*`, `/catalog/genres/:mediaType`, or the TMDB-backed compatibility routes `/catalog/feed` and `/catalog/search`. Generic details and season routes now require an explicitly namespaced `tmdb:movie:<id>` or `tmdb:tv:<id>` identifier; the backend does not reinterpret provider IDs. User, watchlist, history, room, and WebSocket APIs are unchanged.

### WebSocket protocol

Connect to `/ws/party` or `/ws/live` on the same origin. Send `{ "type": "auth", "token": "..." }` first. Party clients then send `room:join` with the room code and room access token returned by the room API. The server sends an authoritative `room:state` snapshot after joining and after persisted updates. Playback messages are revision checked; only the host can control playback unless collaborative controls are enabled. Messages are bounded and rate limited. Clients should reconnect with a new connection, authenticate again, verify/join the room again, and use the returned snapshot as current state. A heartbeat removes dead connections and disconnected members are marked offline.

TMDB supplies metadata only. Artwork URLs use TMDB image paths. Catalog results are never treated as playable: playback availability is checked separately and requires a configured, allowlisted authorized MP4/HLS source or explicitly configured external link. External sources use manual synchronization. The server does not proxy streams or derive a playback URL from a TMDB ID. TMDB cache writes are additive and do not alter user, watchlist, history, room, or playback data.

TMDB catalog pagination accepts pages 1–500. Movie and TV `discover` routes accept `genre` as a positive TMDB genre ID and `year` as a 4-digit year. Search accepts `q`/`query`, requires 1–120 characters, and supports a page parameter. TMDB 429 responses preserve `Retry-After`; timeouts, missing/invalid tokens, and upstream errors return explicit JSON errors.

### TMDB attribution

The app displays the TMDB logo and required notice in its About and Credits footer. The metadata API, images, genres, ratings, and identifiers remain TMDB-supplied data. See [TMDB's official attribution requirements](https://developer.themoviedb.org/docs/faq).

## Catalog and playback separation

TMDB is the metadata provider for movie and TV discovery. The backend calls official TMDB v3 list, search, details, recommendations, genre, TV season, and episode endpoints. It sends the server-only bearer token, caches upstream JSON in `tmdb_catalog_cache`, and normalizes provider IDs as `tmdb:movie:<id>` / `tmdb:tv:<id>`. The legacy `nxsha_catalog_cache` table remains untouched and is not used by the TMDB integration.

Metadata records contain no synthesized playback links. Nxsha playback stays a separate integration: an embed is used only when a playback integration explicitly supplies embed and watch URLs. Otherwise the result remains metadata-only. Configured MP4/HLS or external sources are separately validated by the existing allowlist and availability contract. A TMDB ID or availability in TMDB never proves playback.

## Tests and verification

```sh
npm run lint
npm run build
npm test
npm audit --omit=dev --audit-level=moderate
```

The TMDB service and HTTP route tests use mocked TMDB responses and cover the v3 list/search/details/recommendations/genre/TV-season routes, Bearer auth, pagination and filters, image URLs, cache expiry, missing credentials, rate limits, timeouts, and malformed responses. They do not verify a live TMDB token. Other unit and HTTP tests cover token signing, playback-source validation, private-route authorization, guest sessions, metadata-only availability, and health behavior. The PostgreSQL migration, repository, and WebSocket persistence tests are skipped unless `TEST_DATABASE_URL` points to a dedicated disposable database whose name contains `test`, and `CINETEST_DATABASE_ALLOW_WRITE=true` is set. Apply migrations to that database first. The integration tests create uniquely named test rows and remove them afterward. Do not point `TEST_DATABASE_URL` at a production database.

The reviewed lockfile has no production advisories under `npm audit --omit=dev`. The full audit still reports four moderate advisories in Drizzle Kit's development-only legacy esbuild config loader; Drizzle Kit is not loaded by the production server or the `db:migrate` runner. No forced downgrade was applied.

## Preview deployment

Use the PR preview service for `antigravity/frontend-redesign`; do not edit or deploy the production Render service for this change. Configure `TMDB_API_READ_ACCESS_TOKEN` only in the preview service’s server environment. Use a disposable preview PostgreSQL database, run `npm run db:migrate` only against that preview database if the cache migration is pending, and test `/api/health/catalog`, popular/search movie routes, TV routes, and playback availability. Do not point preview at the production database. The service build/start commands are `npm ci && npm run build` and `npm start`; the health path is `/api/health`. If PR previews are not enabled, an owner can configure a separate preview service without changing production. A deployment is not considered verified until the preview URL and its API responses are checked.

## Branch workflow

This integration updates the existing `antigravity/frontend-redesign` branch/PR #3 to keep the frontend API contract together. PR #2 (`codex/backend-database`) and PR #3 must remain open; do not merge either PR as part of this work. No production deployment or production migration is authorized.
