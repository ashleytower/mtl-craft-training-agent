# Dependency triage — production exposure

2026-08-31. Every classification below was checked against what is actually
installed and actually imported, not against advisory counts.

## The headline correction

The earlier handoff reported **"57 total, 2 critical, 17 high"** from
`npm audit`. That figure was wrong, because **`npm audit` was reading a stray
`package-lock.json` that did not describe what is installed.** This repo is
pnpm-authoritative (`packageManager: pnpm@10.4.1`, with a patched `wouter`), and
`pnpm audit` reports a different, larger tree.

`package-lock.json` has been removed. It was tracked in git and actively
harmful: it made `npm audit` report a phantom tree, and `npm install` against it
silently skips the `wouter@3.7.1` patch — a bug this estate has hit before.

## The decisive fact: this server is not deployed

No `vercel.json`, `railway.json`, `Dockerfile`, `Procfile`, `fly.toml`,
`render.yaml`, or CI workflow exists in this repository. The server runs locally
and Brix reaches it at `http://localhost:3000`. "Production exposure" for this
repo therefore means *reachable in the local server bundle*, not internet-facing.

## Criticals

| package | verdict | evidence |
|---|---|---|
| `vitest` | **no exposure** | Dev-only. The advisory requires the Vitest **UI server** to be listening; the script is `vitest run`, which starts no server. |
| `tar` | **no exposure, now gone** | Was dev-only via `@tailwindcss/vite` → `@tailwindcss/oxide`, i.e. build-time CSS tooling. No longer reported after the updates below. |
| `fast-xml-parser` | **eliminated at the root** | Came in via `@aws-sdk/client-s3`, a dependency **never imported anywhere in source** and absent from `dist/index.js`. Both AWS packages removed — `pnpm why fast-xml-parser` now returns no dependents. |

**Both original criticals were dev-only. Neither was ever in the server bundle.**

## Highs that are genuinely production-reachable

| package | verdict | action |
|---|---|---|
| `axios` | **fixed** | 1.12.2 → 1.20.0. Was not in `dist` anyway (0 refs). |
| `nanoid` | **fixed** | 5.1.6 → 5.1.16. In the bundle; advisory needs an attacker-controlled non-integer `size`. |
| `jws` | **BLOCKED upstream** | Production, via `googleapis` → `google-auth-library` → `gtoken` → `jws@4.0.0`. `googleapis` is genuinely used (`server/googleSheets.ts`). Updated `google-auth-library` 10.5.0 → 10.9.1; **it still pins `jws@4.0.0`**, so this cannot be cleared in range. Needs upstream to move. |
| `@trpc/server` | **not exposed** | The advisory is prototype pollution in `experimental_nextAppDirCaller`. That adapter is never referenced in this repo. |
| `drizzle-orm` | **inert, needs a major** | SQL injection advisory. In the bundle, but `getDb()` returns `null` unless `DATABASE_URL` is set, and it is not set — the legacy MySQL path has been dead since the Manus export. Fix requires a major upgrade; deferred rather than bundled into a security pass. |

## Highs that are dev-tooling only

`vite`, `postcss`, `rollup`, `pnpm`, `glob`, `minimatch`, `picomatch`,
`brace-expansion`, `lodash`, `lodash-es`, `form-data`, `path-to-regexp`, `tar`.
None reach the server bundle; they are build and test tooling on a machine that
does not serve traffic.

## What changed

- Removed `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` — declared
  dependencies, never imported. `server/storage.ts` uses the Manus forge HTTP
  proxy, not S3.
- Removed the stray tracked `package-lock.json`.
- `axios` → 1.20.0, `nanoid` → 5.1.16, `google-auth-library` → 10.9.1.

Verified after: `tsc --noEmit` clean, **211 tests passing**, `npm run build`
clean.

## Not done, deliberately

- A blanket `pnpm update` fails with `ERR_PNPM_PATCH_NOT_APPLIED` on
  `wouter@3.7.1` — the pinned patch stops the tree moving wholesale. Updates
  here were therefore surgical, by package.
- `drizzle-orm` and `vite`/`vitest` majors are dependency-upgrade work of their
  own, not a security pass.
- Four declared production dependencies are never imported in source —
  `dotenv`, `framer-motion`, `openai`, `tailwindcss-animate`. Removing them
  would shrink the surface further, but none currently carries a high or
  critical advisory, so they were left alone rather than widened into this pass.
