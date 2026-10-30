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

Copy `.env.example` and configure only the features you use. Nxsha catalog API credentials are intentionally absent until Nxsha provides an official catalog API contract and authorization.

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
| `AUTHORIZED_MEDIA_SOURCES_JSON`, `AUTHORIZED_MEDIA_HOSTS` | Optional playback allowlist. Configure only sources CineTogether is authorized to play. Sources must use HTTPS (HTTP is allowed only for local development), match the allowlisted host, and end in `.mp4` or `.m3u8` for direct playback. External links use manual sync. |
| `DATABASE_SSL_REJECT_UNAUTHORIZED`, `SQL_ADMIN_USER`, `SQL_ADMIN_PASSWORD`, `APP_URL`, `DISABLE_HMR` | Optional TLS, migration-role, application URL, and local development settings. |

Do not commit `.env` files, credentials, service account JSON files, database URLs, or backups. `.env.example` contains empty placeholders only.

## Database schema and migrations

Drizzle schema definitions are in [`src/db/schema.ts`](src/db/schema.ts). The database contains:

- `profiles` — Firebase UID, email, display name, theme, preferences, timestamps.
- `media_items` — catalog metadata; no playback URLs.
- `nxsha_catalog_cache` — JSON catalog responses keyed by a digest, with refresh and expiry timestamps. Only use for responses obtained through an authorized Nxsha catalog integration.
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
| `GET /health/catalog` | Public | Nxsha catalog API availability. Returns 503 while official catalog API access is unavailable; documented player embed support is reported separately. |
| `POST /auth/guest-session` | Public, rate limited | Creates a signed 24-hour guest session. Body: `{ "displayName": "..." }`. |
| `GET /catalog/feed?section=...&page=...&pageSize=...` | Public | Nxsha-only feed contract for movie, TV, anime, categories, trending, and pagination. Returns unexpired PostgreSQL cache data; returns 503 when cache is missing/expired and the official Nxsha API cannot refresh it. |
| `GET /catalog/search?q=...&type=...&page=...` | Public | Nxsha-only search contract. No TMDB or other provider fallback. |
| `GET /catalog/:providerId`, `/catalog/:providerId/seasons`, `/catalog/:providerId/seasons/:season/episodes` | Public | Cached Nxsha details, seasons, and episode data keyed by the native Nxsha provider ID. No Nxsha ID is converted to a TMDb/IMDb ID. |
| `GET /nxsha/feed?tab=...`, `GET /nxsha/search?q=...`, `GET /nxsha/tv/:providerId/seasons` | Public | Legacy aliases to the Nxsha-only cached contract. No undocumented Nxsha requests are made. |
| `GET /media/availability/:id?season=...&episode=...` | Public | Reports `metadata-only`, `synced-ready`, or `external-watch`; only configured authorized sources are playable. |
| `GET /party/rooms` | Public | Lists active public rooms. |
| `POST /party/rooms` | Firebase or guest | Creates a room and returns a room access token. |
| `POST /party/rooms/:roomCode/verify` | Firebase or guest | Verifies a room password, when set, and issues a room access token. |
| `GET /watchlist`, `POST /watchlist`, `POST /watchlist/toggle`, `DELETE /watchlist/:mediaId` | Firebase | Reads and changes only the authenticated user’s watchlist. |
| `GET /profile`, `PATCH /profile`, `POST /profile/preferences` | Firebase | Reads or updates the authenticated user’s profile and preferences. Email comes from the verified Firebase token. |
| `GET /watch-history?limit=...`, `POST /watch-history`, `PATCH /watch-history/:sessionId` | Firebase | Reads history, records a session, and updates owned playback progress. `POST /sessions/record` remains as a compatibility alias. |
| `POST /gemini/analyze`, `/gemini/quick-recap`, `/gemini/recommend` | Public, rate limited | Optional Gemini features; return 503 when no server key is configured. |

### WebSocket protocol

Connect to `/ws/party` or `/ws/live` on the same origin. Send `{ "type": "auth", "token": "..." }` first. Party clients then send `room:join` with the room code and room access token returned by the room API. The server sends an authoritative `room:state` snapshot after joining and after persisted updates. Playback messages are revision checked; only the host can control playback unless collaborative controls are enabled. Messages are bounded and rate limited. Clients should reconnect with a new connection, authenticate again, verify/join the room again, and use the returned snapshot as current state. A heartbeat removes dead connections and disconnected members are marked offline.

Playback availability is checked separately from catalog metadata. Only configured, allowlisted authorized MP4/HLS sources or explicitly configured external links can be presented as available. External provider links use manual synchronization. The server does not proxy streams or fabricate source URLs.

## Nxsha integration status

Nxsha is the sole intended provider for movie, TV, and anime discovery. The public [Nxsha Embed documentation](https://web.nxsha.space/embed) documents `/embed/movie/{tmdb_or_imdb_id}` and `/embed/tv/{tmdb_or_imdb_id}/{season}/{episode}` player routes, plus the `server`, `one_server`, `sub`, `lang`, `disable_dl_button`, and `disable_app_ad` player options. It also documents `/dl/movie/...` and `/dl/tv/...` download routes. Those are player/download integration methods, not a catalog API. The app constructs a player route only from a TMDb or IMDb identifier actually supplied in metadata; Nxsha's native catalog identifier stays separate. A documented route does not verify playback availability. The public [Nxsha Terms of Use](https://nxsha.app/terms-of-use) prohibit scraping, redistribution, and reverse engineering.

No official public catalog API contract was found for discovery feeds, search, categories, trending, title details, seasons, or episodes. The `/api/*` URLs formerly used by the app were undocumented and have been removed. Accordingly, **none of those catalog discovery features is live** until Nxsha grants API access and supplies documentation. The API returns an explicit unavailable state and does not substitute TMDB or another provider. Support contact is still pending; no API response, credentials, or schema are available to implement against.

The additive `nxsha_catalog_cache` migration and TTL-aware repository methods are ready to cache an authorized catalog response in PostgreSQL. The cache is not populated until an official adapter can be implemented. Existing `media_items`, accounts, watchlists, watch history, and Watch Party data are left untouched. No production database migration was run.

## Tests and verification

```sh
npm run lint
npm run build
npm test
npm audit --omit=dev --audit-level=moderate
```

The unit and HTTP tests cover token signing, playback-source validation, private-route authorization, guest sessions, metadata-only availability, and health behavior. The PostgreSQL migration, repository, and WebSocket persistence tests are skipped unless `TEST_DATABASE_URL` points to a dedicated disposable database whose name contains `test`, and `CINETEST_DATABASE_ALLOW_WRITE=true` is set. Apply migrations to that database first. The integration tests create uniquely named test rows and remove them afterward. Do not point `TEST_DATABASE_URL` at a production database.

The reviewed lockfile has no production advisories under `npm audit --omit=dev`. The full audit still reports four moderate advisories in Drizzle Kit's development-only legacy esbuild config loader; Drizzle Kit is not loaded by the production server or the `db:migrate` runner. No forced downgrade was applied.

## Render deployment

For the existing Render web service:

1. Keep the service on the `codex/backend-database` PR branch until review and merge; do not point the frontend branch at this backend branch without agreeing on the API contract.
2. Set the runtime to Node 24. Render reads `.node-version` or `NODE_VERSION`; use Node 24.22.1 or newer.
3. Set the build command to `npm ci && npm run build` and the start command to `npm start`.
4. Set the health check path to `/api/health`.
5. Configure `DATABASE_URL`, `AUTH_TOKEN_SECRET`, the Firebase Admin credentials (or application credentials), and any optional Gemini/media-source variables in Render’s environment settings. Use the Render PostgreSQL internal URL when the services share a region/network. Set `DATABASE_SSL=require` when the selected database connection requires TLS.
6. Run `npm run db:migrate` as a pre-deploy/release command before the new server version starts. If the existing Render plan does not provide a pre-deploy command, run the migration once as a controlled release step; avoid concurrent migration runs from multiple web instances.
7. Confirm the deployment logs show the service listening on `0.0.0.0` and verify `/api/health` returns HTTP 200 with `database: "connected"`. Also verify an authenticated user flow and a room WebSocket before treating the deployment as ready.

Render’s current [Blueprint reference](https://render.com/docs/blueprint-spec), [Node runtime guide](https://render.com/docs/language-support), and [deploy guide](https://render.com/docs/deploys) describe service commands, Node selection, pre-deploy commands, and health checks. No deployment has been performed by this branch.

## Branch workflow

Backend and database work belongs on `codex/backend-database`. Antigravity frontend changes should remain on its own branch; agree on the API contract before merging the branches. This PR targets `main` and does not deploy the application.
