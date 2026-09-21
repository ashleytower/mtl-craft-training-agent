"""Tests for book.py. Run from the repo root:

    python3 -m unittest agent/beverage/skills/solid-wiggles/scripts/test_book.py

Every string below is invented. None of it is from any book.
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import book  # noqa: E402


def passage(source_key, quotable=True, text="invented passage", citation="invented citation"):
    return {
        "source_key": source_key,
        "quotable": quotable,
        "text": text,
        "citation": citation,
        "locator": {},
        "authority_tier": "tier_b_authorized_course",
        "citation_required": True,
        "operational_status": "pending_review",
        "review_status": "pending_review",
    }


def payload(*results, mode="hybrid"):
    return {
        "query": "q",
        "search_mode": mode,
        "count": len(results),
        "boundary": "never alters a formula",
        "results": list(results),
    }


class ShapeTests(unittest.TestCase):
    def test_keeps_only_the_books_sources(self):
        out = book.shape(
            payload(
                passage("aod-fbd-lesson-4746"),
                passage("solid-wiggles-tips"),
                passage("PUB-KK-002", quotable=False),
                passage("solid-wiggles-shopping-list"),
            ),
            limit=10,
        )
        self.assertEqual(
            [r["source_key"] for r in out["results"]],
            ["solid-wiggles-tips", "solid-wiggles-shopping-list"],
        )
        self.assertEqual(out["count"], 2)

    def test_a_summary_is_never_quotable_even_when_the_service_says_it_is(self):
        # THE POINT. The service marks every chunk quotable, and these chunks are a
        # summary another tool compiled. Left alone, that flag lets an agent read
        # them out as the authors' words.
        out = book.shape(payload(passage("solid-wiggles-tips", quotable=True)), limit=5)
        result = out["results"][0]
        self.assertIs(result["quotable"], False)
        self.assertIn("Not the authors' words", result["provenance"])
        self.assertIn("not checked against the book", result["provenance"])

    def test_an_unknown_book_source_is_treated_as_a_summary(self):
        # Safe direction: a source nobody has declared verbatim is a summary.
        out = book.shape(payload(passage("solid-wiggles-something-new")), limit=5)
        self.assertIs(out["results"][0]["quotable"], False)
        self.assertIn("provenance", out["results"][0])

    def test_a_declared_verbatim_source_keeps_the_services_flag(self):
        original = book.VERBATIM_SOURCES
        book.VERBATIM_SOURCES = frozenset({"solid-wiggles"})
        try:
            out = book.shape(payload(passage("solid-wiggles", quotable=True)), limit=5)
        finally:
            book.VERBATIM_SOURCES = original
        self.assertIs(out["results"][0]["quotable"], True)
        self.assertNotIn("provenance", out["results"][0])

    def test_limit_is_applied_after_the_filter(self):
        # Ten course passages ranked above the book must not use up the limit.
        rows = [passage("aod-fbd-lesson-1") for _ in range(10)]
        rows += [passage("solid-wiggles-tips", text=str(i)) for i in range(4)]
        out = book.shape(payload(*rows), limit=2)
        self.assertEqual([r["text"] for r in out["results"]], ["0", "1"])

    def test_nothing_found_says_so_and_still_states_what_is_not_held(self):
        out = book.shape(payload(passage("aod-fbd-lesson-4746")), limit=5)
        self.assertEqual(out["results"], [])
        self.assertEqual(out["count"], 0)
        self.assertEqual(out["empty"], book.EMPTY)
        self.assertIn("Kindle pp. 14-24", out["coverage_note"])

    def test_coverage_note_names_what_is_held_and_what_is_not(self):
        # REQUIREMENTS CHANGED, so this replaces the old assertion that the Techniques
        # chapter is not held: the owner has since pasted five technique sections in the
        # authors' own words, and a note that still said "not held" would send Brix away
        # from passages it now has.
        out = book.shape(payload(passage("solid-wiggles-tips")), limit=5)
        note = out["coverage_note"]
        for held in ("Clarification", "Blooming Gelatin", "Unmolding", "Slicing", "Storage + Service"):
            self.assertIn(held, note)
        self.assertIn("Kindle pp. 14-24", note)
        self.assertIn("Not held", note)
        self.assertIn("design", note.lower())
        self.assertNotIn("empty", out)

    def test_the_owners_pasted_passages_are_the_authors_words_and_stay_quotable(self):
        # 'solid-wiggles' holds the authors' own words verbatim, so it is not forced to
        # quotable false and carries no summary provenance.
        result = book.shape(payload(passage("solid-wiggles", quotable=True)), limit=5)["results"][0]
        self.assertIs(result["quotable"], True)
        self.assertNotIn("provenance", result)

    def test_a_summary_beside_the_verbatim_source_is_still_forced_not_quotable(self):
        out = book.shape(payload(passage("solid-wiggles"), passage("solid-wiggles-tips")), limit=5)
        by_key = {r["source_key"]: r for r in out["results"]}
        self.assertIs(by_key["solid-wiggles"]["quotable"], True)
        self.assertIs(by_key["solid-wiggles-tips"]["quotable"], False)
        self.assertIn("provenance", by_key["solid-wiggles-tips"])

    def test_the_search_mode_and_boundary_pass_through(self):
        out = book.shape(payload(passage("solid-wiggles-tips"), mode="text_only"), limit=5)
        self.assertEqual(out["search_mode"], "text_only")
        self.assertEqual(out["boundary"], "never alters a formula")

    def test_the_citation_is_passed_through_untouched(self):
        cite = 'Compiled from X, Kindle p. 21, "Pineapple jelly failing to set" — https://example.com'
        out = book.shape(payload(passage("solid-wiggles-tips", citation=cite)), limit=5)
        self.assertEqual(out["results"][0]["citation"], cite)

    def test_the_input_is_not_mutated(self):
        original = passage("solid-wiggles-tips", quotable=True)
        book.shape(payload(original), limit=5)
        self.assertIs(original["quotable"], True)
        self.assertNotIn("provenance", original)


class LimitTests(unittest.TestCase):
    def test_a_limit_below_one_still_returns_a_result_not_every_row(self):
        # Called directly, shape() must not depend on the caller having clamped.
        rows = [passage("solid-wiggles-tips", text=str(i)) for i in range(4)]
        self.assertEqual(len(book.shape(payload(*rows), limit=0)["results"]), 1)
        self.assertEqual(len(book.shape(payload(*rows), limit=-3)["results"]), 1)

    def test_a_limit_above_the_maximum_is_capped(self):
        rows = [passage("solid-wiggles-tips", text=str(i)) for i in range(25)]
        self.assertEqual(len(book.shape(payload(*rows), limit=99)["results"]), book._MAX_RESULTS)


class QueryTests(unittest.TestCase):
    """cmd_query with the network stubbed: the request it builds and what it prints."""

    def run_query(self, limit, rows):
        seen = {}

        def fake_call(path, token, body=None):
            seen["path"], seen["token"] = path, token
            return payload(*rows)

        import contextlib
        import io
        import json

        saved = (book.beverage._config, book.beverage._call)
        book.beverage._config = lambda: ("http://svc", "tok")
        book.beverage._call = fake_call
        out = io.StringIO()
        try:
            with contextlib.redirect_stdout(out):
                book.cmd_query(type("A", (), {"query": "why won't it set", "limit": limit})())
        finally:
            book.beverage._config, book.beverage._call = saved
        return seen, json.loads(out.getvalue())

    def test_it_asks_the_service_for_its_full_width_so_the_filter_has_something_to_keep(self):
        seen, _ = self.run_query(5, [passage("solid-wiggles-tips")])
        self.assertTrue(seen["path"].startswith("http://svc/api/hermes/knowledge?q="))
        self.assertIn("why%20won%27t%20it%20set", seen["path"])
        self.assertTrue(seen["path"].endswith("&limit=25"))
        self.assertEqual(seen["token"], "tok")

    def test_it_prints_the_shaped_result_with_the_limit_applied(self):
        rows = [passage("solid-wiggles-tips", text=str(i)) for i in range(20)]
        _, printed = self.run_query(99, rows)
        self.assertEqual(printed["count"], book._MAX_RESULTS)
        self.assertTrue(all(r["quotable"] is False for r in printed["results"]))


if __name__ == "__main__":
    unittest.main()
