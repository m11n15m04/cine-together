# CineTogether TMDB integration plan

## Branch and inputs

- Integration branch: codex/tmdb-integration.
- PR #2 input: 2767a7bd4b003a108d53eea9b0d5fa08aa678a97.
- PR #3 input: 716ff2d1a48f80131f5b67c096eefb7f839c5fc5.
- Both pull requests remain open. This branch does not modify main.

## Provider contract

1. Route movie and TV metadata through the Express catalog API and official TMDB v3.
2. Keep TMDB_API_READ_ACCESS_TOKEN server-side and send it as a Bearer token. Do not add VITE_TMDB variables.
3. Keep TMDB IDs and metadata separate from Nxsha playback URLs. Metadata does not imply authorized playback.
4. Remove Nxsha catalog routes, repository cache methods, schema, and UI discovery calls. Retain the separate Nxsha playback adapter and authorized-source validation.
5. Preserve loading, empty, error, and unavailable-provider states without fabricated live catalog results.

## Backend hardening retained

Keep PR #2 authentication and ownership checks, guest-session separation, PostgreSQL persistence, room permissions, online public-room counts, WebSocket revisions and reconnect behavior, rate limits, validation, structured errors, health endpoint, graceful startup/shutdown, and production build/start settings.

## Migration plan

- Keep migration 0001 as historical migration evidence for environments that may already have applied it.
- Keep migration 0002, which creates tmdb_catalog_cache.
- Add migration 0003 with DROP TABLE IF EXISTS nxsha_catalog_cache and no CASCADE.
- Verify migration 0003 leaves user and party tables intact in CI against PostgreSQL 16.
- Do not run this migration against production as part of this task.

## Security and CI

- Run npm audit and remediate vulnerable transitive packages with tested, pinned overrides.
- Run CI on this branch with Node 24.22.1 and a disposable PostgreSQL 16 database.
- CI loads the pre-existing-schema fixture, applies migrations, verifies the obsolete cache is absent, then runs lint and all tests.
- Do not merge either PR or deploy this branch to production.
