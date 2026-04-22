# Known Issues

## 1. Vite-bundled dist crashes on first channel-store use (`__filename is not defined`)

**Severity:** HIGH — blocks production use of the channel messaging HTTP API.

**Symptom.** Running `node bin/octogent` (the Vite-bundled production entry
point) and POSTing to `/api/channels/<terminalId>/messages` crashes the
dashboard with:

```
file:///.../dist/api/createApiServer-<hash>.js:2175
          if (fileName !== __filename) {
                           ^
ReferenceError: __filename is not defined
```

The crash also fires at startup if `channels.db` exists on disk (because
`ChannelStore`'s boot-time `recoverStale()` triggers the same native-binding
load path).

**Root cause.** `better-sqlite3` uses the `bindings` npm package to load its
native addon. `bindings` references the CommonJS `__filename` global, which
is not defined in ESM. Vite's API bundler (`vite.api.bundle.config.mts`)
emits ESM and inlines `bindings` into the bundle without polyfilling
`__filename`, so the reference explodes the first time the native module is
loaded.

**Workaround.** Run the API from `tsx` (non-bundled) until fixed:

```bash
cd apps/api
OCTOGENT_WORKSPACE_CWD=/abs/path/to/project \
OCTOGENT_API_PORT=8787 \
pnpm exec tsx src/server.ts
```

The dev-mode wrapper `scripts/dev.mjs` also runs through `tsx watch` and
does not exhibit the bug.

**Candidate fixes (in rough order of preference).**

1. Mark `better-sqlite3` + `bindings` as external in the Vite API bundle
   config so they're `require()`-loaded at runtime instead of inlined into
   the ESM bundle. This is the standard pattern for native deps.
2. Add a Vite `define` / `banner` that polyfills `__filename` via
   `fileURLToPath(import.meta.url)` for the emitted chunk.
3. Replace `better-sqlite3` with a pure-JS SQLite (e.g. `sql.js`) or a
   different native lib that doesn't depend on `bindings`.

**First observed.** 2026-04-22, Jarvis Session 32, during P1b-1 end-to-end
validation. Channel messaging had "worked" in Session 31 only because
`channels.db` pre-existed from prior sessions AND no external POST ever
exercised the channel HTTP route — the bug had been latent.

**Tracking:** No GitHub issue filed yet. Master-list reference in the
Jarvis repo: `memory/projects/project_master_everything_list_session_30.md`
under "Known Issues — Octogent".
