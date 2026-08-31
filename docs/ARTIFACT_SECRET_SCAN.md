# Local secret scan — recovered Manus artifacts

2026-08-31. **Locations and secret types only. No matched value is reproduced
here, and none was read except to classify its shape.**

## Scope

Everything recovered from the Manus share and held locally under
`data/knowledge/` (gitignored) — **37 files**:

| group | files |
|---|---|
| `art_of_drink_knowledge_chunks.jsonl` | 1 |
| `art_of_drink_lesson_manifest.csv` | 1 |
| `Public_External_Knowledge_Records.jsonl` | 1 |
| `Preservation_Knowledge_Source_Intake_Template.csv` | 1 |
| `batch1/` — 13 `.vtt` caption tracks, 14 saved lesson pages, `downloadable_assets.tsv`, 2 scripts, 2 docs, 1 jsonl, 1 csv | 33 |

## Patterns tested (16 types)

Private-key PEM blocks · 3-part JWTs · Google API keys (`AIza…`) · Google OAuth
client secrets (`GOCSPX-…`) · AWS access key IDs (`AKIA…`) · OpenAI keys
(`sk-…`) · Stripe live keys (`sk_live_…`) · GitHub tokens (`ghp_/gho_/ghu_/ghs_/ghr_`)
· Slack tokens (`xox[baprs]-…`) · Twilio account SIDs (`AC…`) · bearer tokens ·
Postgres connection URLs with inline credentials · `service_role` ·
session cookies · `password=` style assignments · `Authorization:` headers.

## Result

**No credentials found.**

| finding | files | type | disposition |
|---|---|---|---|
| `password`-assignment pattern | 14 × `batch1/authorized_lesson_pages/lesson_*.html` | **false positive — accounted for** | see below |
| everything else | — | — | zero hits across all 16 patterns |

The four top-level artifacts (`*.jsonl`, `*.csv`) and all 13 `.vtt` caption
tracks are **completely clean** — zero hits of any type.

### The 14 hits, traced

Every lesson page produced exactly one `password`-shaped match. Both sources are
benign, and neither is a credential:

1. **WordPress i18n UI labels** — `"i18n_password_show":"Show password"` and
   `"i18n_password_hide":"Hide password"`. Interface strings for a
   show/hide-password toggle.
2. **Manus's own injected script** — the enclosing element is
   `id="manus-action-mask-host"`. That is Manus's browser-automation *action
   mask*, which enumerates field types including `password` precisely so it can
   **mask** them during automation. Its presence is a privacy feature of the
   capture, not a leak from it.

Classification was done by structure and enclosing context — script id, key
names, value shape — not by reading values.

### Why the saved pages were the thing to check

`batch1/authorized_lesson_pages/*.html` were captured from an **authenticated**
Art of Drink session. Saved authenticated pages are exactly where session
cookies, nonces or inline API keys leak into an artifact. They were scanned for
session-cookie and bearer-token patterns specifically: **zero hits**.

## What this scan does NOT cover

- **The Manus share's other ~85 files and its conversation transcript.** Those
  are not held locally. Scanning them means downloading or reading them, which
  is the opposite of checking without exposing. The GCP key reported in
  `.manus-recovery/SOURCES.md` was pasted into **the transcript**, not a file —
  `pasted_content.txt` was checked and contains only Firecrawl documentation.
- Shortlist worth a human glance once signed in: the two `.sql` migrations,
  `auto_sync_graph.sh`, `install_auto_sync_hooks.sh`, the two `.skill` files,
  `inventory_app_beverage_integration_map.json`, the two `.zip` bundles, and the
  transcript itself.
