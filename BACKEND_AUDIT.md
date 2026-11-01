# CineTogether backend audit

## Scope and source branches

Compared PR #2 head 2767a7bd4b003a108d53eea9b0d5fa08aa678a97 (Nxsha-only catalog) with PR #3 head 716ff2d1a48f80131f5b67c096eefb7f839c5fc5 (TMDB catalog). The integration branch keeps PR #3 as its code baseline and retains the backend hardening present in both trees.

## Preserved backend hardening from PR #2

- Express production server, centralized errors, request limits, health handling, static build serving, PORT and 0.0.0.0 binding, and the dist-server npm start command.
- Firebase token verification, signed guest sessions, explicit public/private endpoint boundaries, request validation, and ownership checks using the authenticated actor.
- PostgreSQL/Drizzle persistence for profiles, watchlists, watch history, rooms, members, playback, chat, reactions, and votes.
- Room membership and host permission checks; public room listings include only online-member counts and do not expose private rooms.
- WebSocket authorization, disconnect/reconnect handling, persisted playback revisions, and stale update protection.
- Additive legacy-schema baseline, migration tooling outside production dependencies, and PostgreSQL-backed CI using Node 24 and PostgreSQL 16.
- Authorized playback-source validation and the separate Nxsha manual-sync/embed adapter.

## Integration decisions

- TMDB v3 is the only movie and TV metadata/discovery provider. The server sends TMDB_API_READ_ACCESS_TOKEN as a Bearer token; no Vite token is used.
- Nxsha catalog discovery, search, seasons, and catalog cache methods are removed. Nxsha remains only as a separate authorized playback adapter.
- TMDB responses use tmdb_catalog_cache with expiry. Historical migrations 0001 and 0002 remain unchanged; migration 0003 removes only nxsha_catalog_cache.
- User, watchlist, history, room, playback, and chat tables are outside the cache migration and remain untouched.

## Remaining verification

Run the integration-branch workflow against its disposable PostgreSQL 16 service. Do not apply migrations to production or deploy this branch to production. Live TMDB requests require TMDB_API_READ_ACCESS_TOKEN in a non-production service environment.
