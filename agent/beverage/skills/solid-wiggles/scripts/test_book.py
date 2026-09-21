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

    def test_coverage_note_names_what_the_book_sources_do_not_hold(self):
        out = book.shape(payload(passage("solid-wiggles-tips")), limit=5)
        self.assertIn("Techniques and Design Language", out["coverage_note"])
        self.assertNotIn("empty", out)

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


if __name__ == "__main__":
    unittest.main()
