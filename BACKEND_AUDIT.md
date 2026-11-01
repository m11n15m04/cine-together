# CineTogether backend audit

Audited `main` at `8af79dd` on 2026-10-30 before implementation. The working branch is `codex/backend-database`.

## Current architecture and data

- `server.ts` owns Express routes, catalog fetching, Gemini calls, static serving, and both WebSocket protocols. Drizzle operations live in `src/db/repository.ts`; the separate `src/services/catalogService.ts` provider implementation is not wired into the server.
- `src/db/schema.ts` already defines profiles, media items, rooms, watchlists and items, room members, playback state, chat, reactions, votes, and watch sessions. Foreign keys exist for room-owned records, but watchlist membership and room membership lack uniqueness constraints. There is no migration directory or migration command.
- Room state and password hashes live in process memory. Writes reach PostgreSQL, but startup does not hydrate rooms, members, chat, or playback from PostgreSQL. Watch history is insert-only; no history read or progress-update operation exists.
- The server already binds `process.env.PORT` on `0.0.0.0`. `npm start` runs TypeScript directly with `node server.ts`; `npm run build` builds only the Vite client. There is no explicit Node version, health endpoint, migration step, Render manifest, or graceful shutdown handling.

## Findings

1. **Frontend/backend routes do not match.** The UI calls `/api/health/catalog`, `/api/catalog/feed`, `/api/catalog/search`, `/api/media/stream/:id`, and `/api/gemini/quick-recap`; none are registered in `server.ts`. Existing routes use `/api/nxsha/*`. The catalog service contains TMDB and Nxsha functions but is not connected to an API router.
2. **User identity and room access are not enforced.** `optionalAuth` accepts missing or invalid tokens as guests. Watchlist/profile APIs use caller-supplied IDs when no valid token is present. WebSocket joins trust client-supplied member IDs; room settings and member removal have no host check. The public room list returns complete in-memory room records, including messages and couple notes. Password verification is a separate HTTP check and is not enforced by WebSocket joins.
3. **Persistence is incomplete.** The in-memory room map is authoritative and is not restored after restart. Room membership and messages cannot be loaded for reconnection. Watch history is only recorded, not queried or updated. The startup seeder inserts demo catalog and default rooms without an environment guard.
4. **Database configuration and operations are incomplete.** `DATABASE_URL` is considered when reporting configuration but ignored by the `pg.Pool`; the Drizzle config also requires split `SQL_*` variables. The existing schema has no generated migrations, and deployment cannot safely migrate an existing database.
5. **Playback is simulated.** The synced player renders a generated canvas animation. Catalog entries generate `/api/media/stream/...` URLs, but no such handler or authorized media-source registry exists. There is no real MP4/HLS selection or availability contract.
6. **Production and validation gaps.** There is no central API error handler, structured request logging, rate limiting, or health route. The TypeScript project includes stale root-level copies alongside `src/`; some root imports resolve outside the repository. The README contains unresolved merge-conflict markers. A Firebase client configuration file with a project API key is tracked; client configuration should move to documented environment variables.

## Implementation focus

Keep the existing React experience and database tables; wire the catalog service into matching routes, add authenticated ownership and explicit guest behavior, persist and restore room state, add safe migrations and `DATABASE_URL` support, replace simulated playback with an authorized-source availability contract, and document/test the Render startup path. Existing data will be preserved; migration execution against a live database requires a configured database connection and will be reported separately.
