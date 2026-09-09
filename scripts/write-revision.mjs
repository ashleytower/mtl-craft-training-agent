/**
 * Stamp the built bundle with the revision it was built from.
 *
 * Read back by `server/buildRevision.ts` and reported by
 * `GET /api/hermes/health`, so "which code is the running service executing?"
 * has an answer that does not depend on remembering what was deployed.
 *
 * Two refusals matter more than the happy path:
 *
 *   - A DIRTY tree produces no stamp. The SHA would name a commit whose code
 *     is not what was bundled, and a health payload asserting that commit is
 *     worse than admitting the revision is unknown — it looks checkable and is
 *     wrong. Health then reports `unavailable`, which is true.
 *   - No git, no stamp. Same reasoning; nothing is invented.
 *
 * Neither refusal fails the build. The build is still valid; only the claim
 * about its provenance is withheld.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const stamp = resolve(root, "dist", "REVISION");

function git(...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

try {
  const revision = git("rev-parse", "HEAD");
  // `--porcelain` prints one line per changed path; empty means clean. Includes
  // untracked files, which can absolutely change a bundle (a new module the
  // entrypoint imports), so they count as dirty here.
  const dirty = git("status", "--porcelain") !== "";

  if (dirty) {
    // Remove any stamp left by an earlier clean build. Without this, a dirty
    // rebuild would silently keep asserting the previous revision.
    rmSync(stamp, { force: true });
    console.warn(
      "[write-revision] working tree is dirty — no revision stamped; " +
        "/api/hermes/health will report revision_source=unavailable"
    );
    process.exit(0);
  }

  if (!/^[0-9a-f]{40}$/.test(revision)) {
    rmSync(stamp, { force: true });
    console.warn(`[write-revision] unexpected rev-parse output; no stamp written`);
    process.exit(0);
  }

  mkdirSync(dirname(stamp), { recursive: true });
  writeFileSync(stamp, `${revision}\n`, "utf8");
  console.log(`[write-revision] dist/REVISION = ${revision}`);
} catch (error) {
  rmSync(stamp, { force: true });
  console.warn(
    `[write-revision] could not read git revision (${
      error instanceof Error ? error.message.split("\n")[0] : error
    }) — no stamp written`
  );
}
