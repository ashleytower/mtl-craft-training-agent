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

## CORRECTION: deployment status is unproven, and the triage no longer rests on it

An earlier version of this document asserted **"this server is not deployed"** as
a decisive fact. That was not supported by the evidence, and the triage has been
restated so it no longer depends on the answer.

What is actually established:

| checked | result |
|---|---|
| `vercel.json` / `railway.json` / `Dockerfile` / `Procfile` / `fly.toml` / `render.yaml` | none present |
| CI workflows (`.github/workflows`) | none |
| GitHub Deployments API | 0 |
| GitHub Environments | 0 |
| Repo webhooks (Vercel/Railway install one when linked) | none |
| `.vercel/` project link | absent |
| launchd job running this server | none |
| local Railway/Vercel CLI state | none |

What is **not** established, and cannot be from here:

- **Railway and Vercel both require an interactive login** this session does not
  have, so their project lists were never read. Either can deploy a repo with no
  file in it, configured entirely from the dashboard.
- The repo carries a production-shaped `start` script
  (`NODE_ENV=production node dist/index.js`) and a real `build`.

So: *no deployment evidence was found in anything reachable, and several signals
point against one — but "not deployed" is not proven.* Ask Railway/Vercel
directly before relying on it.

**Because of that, every verdict below is argued on a deployment-independent
basis**: whether the package reaches the server bundle at all, and whether the
specific vulnerable code path is used. Those hold whether or not the server is
deployed. The one verdict that genuinely depended on deployment status is
`drizzle-orm`, and it is marked accordingly.

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
| `jws` | **RESOLVED — and the vulnerable path was never reachable** | See below. |
| `@trpc/server` | **not exposed** | The advisory is prototype pollution in `experimental_nextAppDirCaller`. That adapter is never referenced in this repo. |
| `drizzle-orm` | **DEPENDS ON DEPLOYMENT — treat as open** | SQL injection advisory, and it is in the bundle. `getDb()` returns `null` unless `DATABASE_URL` is set. It is not set in the local `.env`, so the path is dead **locally**. But a deployment environment could set it, and deployment status is unproven (above). The earlier "inert" verdict overstated this. Fix needs a major upgrade. Resolve the deployment question first. |

### `jws` — call path verified, then fixed anyway

Previously reported as "blocked upstream". That was true of the *version range*
but wrong as a conclusion, and it also overstated the risk.

**The vulnerable call path is not reachable here.** Advisory
[GHSA-869p-cjfg-cm3x](https://github.com/advisories/GHSA-869p-cjfg-cm3x) is
*"Improperly Verifies HMAC Signature"* (CWE-347) — it affects **`jws.verify`
with an HMAC algorithm**. Inspecting the built code of both dependents:

```
gtoken@8.0.0                 jws.sign x2      jws.verify x0
google-auth-library@10.5.0   jws.sign x1      jws.verify x0
google-auth-library@10.9.1   jws.sign x1      jws.verify x0
algorithm used:              'RS256'   (asymmetric — not HMAC)
```

Google only ever **signs** service-account assertions with RS256. It never
verifies, and never uses HMAC. So the advisory did not describe a reachable
weakness in this codebase.

**Fixed regardless**, because `jws@4.0.1` is published and the fix is a patch
bump. Adopted with a targeted `pnpm.overrides` entry — the *same* config object
that already held `tailwindcss>nanoid`, so no config mechanism changed:

```json
"pnpm": {
  "patchedDependencies": { "wouter@3.7.1": "patches/wouter@3.7.1.patch" },
  "overrides": { "tailwindcss>nanoid": "3.3.7", "jws": "4.0.1" }
}
```

Safety checks on the change:

- **wouter patch preserved** — the lockfile's `patchedDependencies` hash
  (`4e16e6ff…`) is byte-identical before and after, and `patches/` is intact.
- **Lockfile change is surgical** — the entire diff is two lines: the old `jws`
  integrity out, the new one in.
- **Functionally exercised through the real path**, not a stand-in: a
  `googleapis` → `google.auth.JWT` authorize (which drives `jws.sign`) followed
  by a live Sheets read returned `200`, with `jws version actually loaded: 4.0.1`
  resolved from `googleapis`' own tree.

## Highs that are dev-tooling only

`vite`, `postcss`, `rollup`, `pnpm`, `glob`, `minimatch`, `picomatch`,
`brace-expansion`, `lodash`, `lodash-es`, `form-data`, `path-to-regexp`, `tar`.
None reach the server bundle; they are build and test tooling on a machine that
does not serve traffic.

## What changed

- Removed `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`. This one
  **was** re-verified exhaustively after the correction above: a repo-wide
  search (every directory, not just `server/`) for `aws-sdk`, `S3Client`,
  `getSignedUrl` and `PutObjectCommand`, plus a dynamic-`import()`/`require()`
  scan, returns nothing outside this document. `server/storage.ts` uses the
  Manus forge HTTP proxy, not S3. The removal stands.
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
- **CORRECTION — an earlier version of this list was wrong.** It claimed four
  production dependencies were "never imported in source". `dotenv` **is
  imported**: `server/_core/index.ts:1` does `import "dotenv/config"`, a
  side-effect import the original grep pattern (`from "dotenv"`) could not match.

  Re-checked with a broader search, `framer-motion`, `openai` and
  `tailwindcss-animate` return no references. Note the near-miss that makes the
  point: `client/src/index.css` imports **`tw-animate-css`**, which is a
  *different package* from `tailwindcss-animate`.

  These three are therefore **"no static references found"**, not "unused" —
  dynamic or build-time use cannot be excluded by grep. None carries a high or
  critical advisory. **No removal is recommended on this evidence.**
