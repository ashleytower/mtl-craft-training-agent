/**
 * Which revision of this code the running process is actually executing.
 *
 * "Deployed" and "loaded by a running process" are different states, and the
 * only way to tell them apart from outside is to ask the process itself. So the
 * build stamps a revision file and the health route reads it back.
 *
 * The honesty requirement is `source`. A revision guessed from the working
 * directory is not evidence that the *running* bundle was built from it — the
 * process could have been started days ago from different code. So every answer
 * says where it came from, and a caller that needs proof (the release check)
 * accepts only `build_stamp`.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Where the revision came from, so a guess is never mistaken for a stamp. */
export type RevisionSource = "env" | "build_stamp" | "unavailable";

export type LoadedRevision = {
  /** Full 40-character git SHA, or null when genuinely unknown. */
  revision: string | null;
  source: RevisionSource;
};

const SHA = /^[0-9a-f]{40}$/;

/**
 * Parse a revision stamp. Anything that is not a full SHA is rejected rather
 * than passed through: a truncated or decorated value ("4303a75", "v2-dirty")
 * would still *look* like an answer in a health payload while being useless for
 * comparing against a merge commit.
 */
export function parseRevision(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return SHA.test(trimmed) ? trimmed : null;
}

function readStamp(): string | null {
  // The stamp sits beside the bundle, so it is found relative to this module
  // rather than to the process working directory — launchd sets the cwd for
  // dotenv's benefit and it must not also decide which revision we report.
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [join(here, "REVISION"), join(here, "..", "REVISION")]) {
    try {
      const parsed = parseRevision(readFileSync(candidate, "utf8"));
      if (parsed) return parsed;
    } catch {
      // Absent in development, where the server runs from source via tsx.
      // That is not a failure; it is reported as `unavailable`.
    }
  }
  return null;
}

/**
 * Resolved once per process. A long-running service must not report a revision
 * that changes under it while the loaded code does not.
 */
let cached: LoadedRevision | null = null;

export function resolveRevision(
  env: NodeJS.ProcessEnv = process.env,
  stampReader: () => string | null = readStamp
): LoadedRevision {
  const fromEnv = parseRevision(env.BEVERAGE_BUILD_REVISION);
  if (fromEnv) return { revision: fromEnv, source: "env" };

  const stamped = stampReader();
  if (stamped) return { revision: stamped, source: "build_stamp" };

  return { revision: null, source: "unavailable" };
}

export function loadedRevision(): LoadedRevision {
  cached ??= resolveRevision();
  return cached;
}

/** Test seam — the cache would otherwise leak between cases. */
export function resetLoadedRevisionCache(): void {
  cached = null;
}
