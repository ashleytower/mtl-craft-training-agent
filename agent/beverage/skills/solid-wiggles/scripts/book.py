#!/usr/bin/env python3
"""Ask the Solid Wiggles sources a question. Read-only.

`beverage.py knowledge` searches the whole governed corpus. This wraps it for one
purpose, questions about the cookbook Solid Wiggles, and does two things in code
that the model must not be trusted to remember:

  1. It keeps only the book's sources, and applies the limit AFTER that, so
     course passages ranked above the book cannot use up the results.
  2. It attaches the provenance. Every one of these sources is a summary another
     tool compiled from the book and nobody has checked it against the book. The
     service marks every passage `quotable: true`, which is true of a course
     transcript and false of these, so this script overrides it. An agent that
     reads `quotable: true` will read a summary out as the authors' words.

It reuses beverage.py for the profile environment, the service-token header and
the refusal handling, so it can never reach the API any other way.

Usage:
  book.py query --query "what gelatin does the book use"
  book.py query --query "how do I clear juice" --limit 5

Tests: python3 -m unittest agent/beverage/skills/solid-wiggles/scripts/test_book.py
"""
import argparse
import json
import os
import sys
import urllib.parse

# The two skills are siblings both in the profile (skills/beverage/) and in the
# committed mirror (agent/beverage/skills/), so the same relative path works in both.
_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(_HERE, "..", "..", "formula-scaling", "scripts")))
import beverage  # noqa: E402

# Every source whose key starts with this belongs to the book. scripts/brix-status.sh
# checks that a source with this prefix still exists: rename them and this script
# would answer "empty" to everything, which reads as "the book does not cover it".
BOOK_PREFIX = "solid-wiggles"

# Sources under BOOK_PREFIX that hold the authors' own words verbatim: the passages the
# owner pasted from the Kindle edition. The rest are summaries another tool compiled. A
# source not listed here is treated as a summary, which is the safe direction to be wrong
# in. Listing one makes its passages come back with the service's own `quotable` flag and
# no `provenance`; SKILL.md says so.
VERBATIM_SOURCES = frozenset({"solid-wiggles"})

SUMMARY_PROVENANCE = (
    "Summary compiled by another tool from the book. Not the authors' words and not "
    "checked against the book."
)

# KEEP IN SYNC with what is actually ingested. This is the one place the agent learns what
# the book sources do and do not hold. A section pasted in without editing this is invisible
# to its "not held" answers, and a section named here that was never ingested is a lie.
COVERAGE_NOTE = (
    "Held in the authors' own words (pasted by the owner, page numbers not recorded): "
    "Clarification, Blooming Gelatin, Unmolding (Hot Towel and Dip N' Flip), Slicing, and "
    "Storage + Service. Held only as summaries another tool compiled (Kindle pp. 14-24): the "
    "opening guidance and the Ingredients, Equipment + Tools chapter. Not held: the design "
    "methods (splatter, linear, lattice and floral designs, layering, scraping and torching), "
    "the jelly and cake recipes themselves, and anything else in the book."
)

EMPTY = "Nothing in the Solid Wiggles sources answers that."

# The service caps a search at 25. Ask for all of it: the book is a small slice of
# the corpus and the filter runs here.
_SEARCH_WIDTH = 25
_MAX_RESULTS = 10


def shape(payload, limit):
    """Keep the book's passages, correct their labels, and say what is not held.

    The limit is clamped here, not by the caller: a limit below one would otherwise
    never match `len(kept)` and this would return every row.
    """
    limit = max(1, min(int(limit), _MAX_RESULTS))
    kept = []
    for result in payload.get("results", []):
        key = str(result.get("source_key", ""))
        if not key.startswith(BOOK_PREFIX):
            continue
        verbatim = key in VERBATIM_SOURCES
        item = dict(result)
        item["quotable"] = bool(result.get("quotable")) and verbatim
        if not verbatim:
            item["provenance"] = SUMMARY_PROVENANCE
        kept.append(item)
        if len(kept) == limit:
            break

    out = {
        "ok": True,
        "book": BOOK_PREFIX,
        "query": payload.get("query"),
        "search_mode": payload.get("search_mode"),
        "count": len(kept),
        "coverage_note": COVERAGE_NOTE,
        "boundary": payload.get("boundary"),
        "results": kept,
    }
    if not kept:
        out["empty"] = EMPTY
    return out


def cmd_query(args):
    base, token = beverage._config()
    path = f"{base}/api/hermes/knowledge?q=" + urllib.parse.quote(args.query) + f"&limit={_SEARCH_WIDTH}"
    payload = beverage._call(path, token)
    print(json.dumps(shape(payload, args.limit), indent=2, ensure_ascii=False))


def main():
    parser = argparse.ArgumentParser(description="Ask the Solid Wiggles sources a question.")
    sub = parser.add_subparsers(dest="command", required=True)
    query = sub.add_parser("query", help="Search the book's sources")
    query.add_argument("--query", required=True, help="A plain-language question")
    query.add_argument("--limit", type=int, default=5, help=f"Results to return (max {_MAX_RESULTS})")
    query.set_defaults(func=cmd_query)
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
