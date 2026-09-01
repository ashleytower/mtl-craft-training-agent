#!/usr/bin/env python3
"""
Check that the glossary bias did not put words into the transcripts.

    scripts/verify-transcript-terms.py [--audio-budget N] [vtt_dir] [media_dir]

WHY

Transcription runs Whisper with an --initial_prompt built from the course's own
Jargon File (lesson 5136) plus terms grepped out of the saved lesson pages. That
biases the decoder toward real course spelling — unprimed `small.en` rendered
"gentian" as "genshin", and gentian appears twice in lesson 6066's own page.

Bias cuts both ways. It can also place a term where the speaker never said one,
and a corpus quoted verbatim with citations cannot absorb that. The glossary is
allowed to influence spelling; it is never allowed to silently "correct" the
audio. So every biased term that appears in a transcript is checked, and
anything unproven is recorded as such rather than quietly kept.

TWO STAGES, DELIBERATELY DIFFERENT IN COST AND COVERAGE

  1. GLOSSARY / DOCUMENTARY — complete, no audio, runs in seconds.
     Every occurrence of every biased term is checked against the course's own
     written material: the Jargon File and the 24 saved lesson pages. A term the
     course itself uses in writing is attested vocabulary, and its appearance in
     that course's narration is expected rather than suspicious.

  2. AUDIO RE-CHECK — bounded sample, expensive.
     Cuts the audio around a cue and re-transcribes that window with NO prompt.
     A term the unprimed decoder also produces is confirmed by the recording
     itself. This is the strongest evidence available, and it costs a Whisper
     run per occurrence, so it is budgeted and spent worst-first: terms with NO
     documentary attestation go first, because those are the ones the glossary
     could have invented outright.

The audio stage returns three verdicts, not two: `confirmed` (the unprimed
decoder produced the term), `variant` (it produced the same word spelt
differently, so the speaker said it and the prime only fixed the spelling), and
`absent` (nothing resembling it, so a human must look). Only `absent` is
evidence of a possible insertion. A plain pass/fail split would file the prime's
most valuable correction — gentian, which unprimed Whisper renders "genshin" —
as a failure, indistinguishable from a genuine fabrication.

Neither stage edits a transcript. Nothing here rewrites audio to match the
glossary; the output is evidence, and an `absent` row stays `absent`.

Writes term_verification.json beside the transcripts.
"""
import json
import re
import subprocess
import sys
from difflib import SequenceMatcher
from pathlib import Path

args = [a for a in sys.argv[1:]]
AUDIO_BUDGET = 40
if "--audio-budget" in args:
    i = args.index("--audio-budget")
    AUDIO_BUDGET = int(args[i + 1])
    del args[i:i + 2]

REPO = Path(__file__).resolve().parent.parent
VTT_DIR = Path(args[0]) if len(args) > 0 else REPO / "data/knowledge/local_transcripts"
MEDIA = Path(args[1]) if len(args) > 1 else VTT_DIR / ".media"
PAGES = REPO / "data/knowledge/batch1/authorized_lesson_pages"
WORK = VTT_DIR / ".verify"
WORK.mkdir(parents=True, exist_ok=True)

# The exact terms the prompt biased toward. Kept in step with the PRIME string
# in scripts/collect-lesson-transcripts.sh — a term biased there but absent here
# would never be checked at all.
TERMS = [
    "ABV", "ABW", "Brix", "CAS", "cloud agent", "Codex Alimentarius", "CO2",
    "EtOH", "FCC", "FEMA", "flavour house", "FIDS", "FMP", "GMP", "GRAS",
    "immiscible", "miscible", "JECFA", "MOQ", "MSDS", "WONF", "organoleptic",
    "PPM", "process authority", "RDA", "RTD", "shelf stable", "SKU", "TA",
    "TTB", "USP", "terpenes", "terpenoids", "limonene", "gentian", "wormwood",
    "percolation", "macerated", "tincture", "solvent", "emulsion", "HLB",
]
# Acronyms whose lowercase form is an ordinary word or word-fragment. Matching
# these case-insensitively turns "ta" in "take" into a TA hit, or French "gras"
# into a GRAS hit. Word boundaries alone are not enough: "TA" IS a standalone
# word in "a ta value".
#
# EtOH is deliberately NOT here, unlike every other acronym in the list. It is
# the one term with internal lowercase, and a speech decoder will not reproduce
# that casing reliably — "ETOH" or "Etoh" is at least as likely. Matched
# case-sensitively it would simply never appear in `occurrences` at all: not
# unconfirmed, invisible, with the report silently claiming full coverage of a
# term it never once looked at. "etoh" collides with no English word, so
# matching it case-insensitively costs nothing.
CASE_SENSITIVE = {"TA", "CAS", "TTB", "USP", "RDA", "RTD", "SKU", "FCC", "FMP",
                  "PPM", "ABV", "ABW", "GRAS", "GMP", "FEMA", "MOQ", "MSDS",
                  "WONF", "HLB", "FIDS", "JECFA"}

WINDOW_PAD = 4.0   # seconds either side; a bare 2s clip decodes badly out of context


def pattern(term):
    flags = 0 if term in CASE_SENSITIVE else re.IGNORECASE
    return re.compile(r"\b" + re.escape(term) + r"\b", flags)


# How close a word has to be to the term to count as the same word misspelt.
#
# Measured, not assumed — an earlier 0.72 was set from a guessed ratio and threw
# away the exact case this classifier exists for:
#
#   gentian / genshin    0.71   real, the miss the prime corrects
#   terpenes / terpines  0.88   real, a plausible spelling slip
#   gentian / stand      0.17   unrelated
#   tincture / store     0.29   unrelated
#
# Genuine ASR variants of a word cluster around 0.7-0.9 because they share most
# of their characters; unrelated vocabulary sits below 0.4. 0.65 falls in the
# empty gap between the two, so it is not balanced on either group's edge.
VARIANT_RATIO = 0.65


def audio_verdict(term, unprimed):
    """
    Three outcomes, because two are not enough.

    A plain confirmed/unconfirmed split conflates the two things this check
    exists to tell apart. Unprimed Whisper renders "gentian" as "genshin" — that
    is the whole reason the glossary prime exists — so an exact-match test
    reports the prime's most valuable correction as a failure, right beside a
    genuine fabrication, and a reader cannot tell which is which.

      confirmed  the unprimed decoder produced the term itself
      variant    it produced something close enough to be the same word spelt
                 differently, so the speaker did say it and the prime only
                 fixed the spelling — the intended use of the bias
      absent     it produced nothing resembling the term, so the audio does not
                 support it and a human must look

    Only `absent` is evidence of a possible insertion.
    """
    if pattern(term).search(unprimed):
        return "confirmed", None
    head = term.split()[0].lower()
    best, best_word = 0.0, None
    for word in re.findall(r"[A-Za-z][A-Za-z'-]*", unprimed):
        ratio = SequenceMatcher(None, head, word.lower()).ratio()
        if ratio > best:
            best, best_word = ratio, word
    if best >= VARIANT_RATIO:
        return "variant", best_word
    return "absent", best_word


PATTERNS = [(t, pattern(t)) for t in TERMS]


def clock(t):
    parts = [float(p) for p in t.replace(",", ".").split(":")]
    return parts[0] * 60 + parts[1] if len(parts) == 2 else parts[0] * 3600 + parts[1] * 60 + parts[2]


def parse_vtt(path):
    lines = path.read_text(encoding="utf-8-sig").splitlines()
    cues, i = [], 0
    while i < len(lines):
        if "-->" not in lines[i]:
            i += 1
            continue
        a, b = lines[i].split("-->", 1)
        start, end = clock(a.strip().split()[0]), clock(b.strip().split()[0])
        i += 1
        body = []
        while i < len(lines) and lines[i].strip():
            body.append(re.sub(r"<[^>]+>", "", lines[i]).strip())
            i += 1
        text = " ".join(x for x in body if x)
        if text:
            cues.append((start, end, text))
        i += 1
    return cues


# ---------------------------------------------------------------- stage 1
# The course's own written words, as one searchable corpus.
#
# Inline tags are removed WITHOUT leaving a space, matching the rule in
# server/knowledgeLessonPages.ts. Stripping every tag to a space turns
# `CO<sub>2</sub>` into "CO 2", so a search for CO2 finds nothing and a term the
# Jargon File defines on its own line looks unattested. That is the same
# corruption the TypeScript extractor exists to avoid, and getting it wrong here
# silently downgrades a well-attested term into the high-risk bucket.
INLINE_TAGS = re.compile(
    r"</?(?:a|sub|sup|strong|b|em|i|span|u|code|small|mark)\b[^>]*>", re.I)

# KEEP IN SYNC WITH `BODY_START` / `BODY_END` in server/knowledgeLessonPages.ts.
#
# Scoping to the lesson body is not tidiness, it is the whole validity of this
# stage. A saved lesson page is ~344,000 characters of which ~4,100 are the
# lesson; the rest is WordPress chrome plus a MasterStudy curriculum sidebar
# that lists EVERY lesson title in the course, repeated on every page. Searching
# the raw file therefore finds "Tincture", "HLB" and "Terpenes" on all 24 pages
# — as navigation labels, not content.
#
# That made attestation almost unfalsifiable: any fabricated word that happened
# to match a lesson title anywhere in the 39-item syllabus counted as attested
# and was demoted to the low-risk bucket that rarely gets an audio check. Since
# the biased vocabulary is drawn largely from this course's own titles, that was
# not a remote edge case.
BODY_START = '<div class="masterstudy-course-player-lesson-video">'
BODY_END = "masterstudy-nav-button"


def course_text():
    blobs = {}
    for page in sorted(PAGES.glob("lesson_*.html")):
        raw = page.read_text(encoding="utf-8", errors="replace")
        start = raw.find(BODY_START)
        if start == -1:
            # Not a lesson page shape. Contributing nothing is right: an
            # unparseable page must not silently widen what counts as attested.
            continue
        end = raw.find(BODY_END, start)
        body = raw[start:] if end == -1 else raw[start:end]
        text = INLINE_TAGS.sub("", body)
        text = re.sub(r"<[^>]+>", " ", text)
        text = re.sub(r"\s+", " ", text)
        blobs[page.stem.replace("lesson_", "")] = text
    return blobs


COURSE = course_text()
JARGON = COURSE.get("5136", "")


def attested(term):
    """Where the course itself writes this term, in its own material."""
    where = []
    if pattern(term).search(JARGON):
        where.append("jargon-file")
    lessons = sorted(lid for lid, text in COURSE.items()
                     if lid != "5136" and pattern(term).search(text))
    if lessons:
        where.append("pages:" + ",".join(lessons))
    return where


# ---------------------------------------------------------------- collect
occurrences = []          # every biased-term hit in every transcript
echoes = []               # decoder reciting its own prompt

for vtt in sorted(VTT_DIR.glob("lesson_*.vtt")):
    lesson = vtt.stem.replace("lesson_", "")
    cues = parse_vtt(vtt)
    for start, end, text in cues:
        low = text.lower()
        # A cue reproducing a long comma-run after "terms:" is the decoder
        # reciting its initial_prompt during silence, not the speaker talking.
        if "terms:" in low and low.count(",") >= 5:
            echoes.append({"lesson": lesson, "start": round(start, 3), "text": text})
            # And it must NOT be mined for term occurrences. Every word in a
            # recited prompt is by construction a term this script treats as
            # attested vocabulary, so a single echoed cue manufactures ~15
            # occurrences that pass the documentary stage with certainty and
            # could then be "confirmed" by re-transcribing the same silence.
            # That is the one outcome this script exists to prevent: reporting
            # a fabricated word as verified.
            continue
        for term, pat in PATTERNS:
            if pat.search(text):
                occurrences.append({
                    "lesson": lesson, "term": term,
                    "start": round(start, 3), "end": round(end, 3),
                    "primed_text": text,
                })

for occ in occurrences:
    occ["attested_in_course"] = attested(occ["term"])

# ---------------------------------------------------------------- stage 2
# Spend the audio budget worst-first: an unattested term could have been
# invented outright by the bias, so it is checked before a term the course
# itself writes down. Within each group, one occurrence per (lesson, term)
# before any second occurrence, so breadth beats depth.
def risk_key(o):
    return (0 if not o["attested_in_course"] else 1, o["lesson"], o["term"], o["start"])


# Membership is tracked by identity, not by value. `occ in ordered` compares
# dict CONTENTS, so two genuinely separate occurrences that happen to carry the
# same lesson, term, clock and text — exactly what a repeated Whisper cue
# produces — collapse into one. The duplicate then never enters the queue, never
# gets an `audio_check` key, and the rollup buckets it as "not_sampled",
# indistinguishable from an honest budget cutoff. A scheduling bug that reports
# itself as a budget limit is the kind that survives for months.
# (It was also O(n^2): a linear scan of a growing list, per occurrence.)
ordered, seen_pairs, queued = [], set(), set()
for occ in sorted(occurrences, key=risk_key):
    pair = (occ["lesson"], occ["term"])
    if pair not in seen_pairs:
        seen_pairs.add(pair)
        queued.add(id(occ))
        ordered.append(occ)
for occ in sorted(occurrences, key=risk_key):
    if id(occ) not in queued:
        queued.add(id(occ))
        ordered.append(occ)

checked = 0
for occ in ordered:
    if checked >= AUDIO_BUDGET:
        occ["audio_check"] = "not_sampled"
        continue
    wav = MEDIA / f"{occ['lesson']}.wav"
    if not wav.exists():
        occ["audio_check"] = "no_media"
        continue
    a = max(0.0, occ["start"] - WINDOW_PAD)
    dur = (occ["end"] - occ["start"]) + 2 * WINDOW_PAD
    clip = WORK / f"{occ['lesson']}_{checked}.wav"
    subprocess.run(
        ["ffmpeg", "-nostdin", "-loglevel", "error", "-ss", str(a), "-t", str(dur),
         "-i", str(wav), "-ac", "1", "-ar", "16000", "-y", str(clip)], check=True)
    subprocess.run(
        ["whisper", str(clip), "--model", "small.en", "--language", "en",
         "--output_format", "txt", "--verbose", "False", "--output_dir", str(WORK)],
        check=True, capture_output=True)
    out = WORK / f"{clip.stem}.txt"
    unprimed = out.read_text().strip() if out.exists() else ""
    occ["unprimed_text"] = unprimed
    verdict, nearest = audio_verdict(occ["term"], unprimed)
    occ["audio_check"] = verdict
    occ["nearest_unprimed_word"] = nearest
    clip.unlink(missing_ok=True)
    out.unlink(missing_ok=True)
    checked += 1
    near = (f" (heard ~{occ['nearest_unprimed_word']})"
            if occ.get("nearest_unprimed_word") and occ["audio_check"] != "confirmed" else "")
    print(f"  audio {occ['lesson']} {occ['start']:8.2f} {occ['term']:20} "
          f"{occ['audio_check']}{near}", flush=True)

# ---------------------------------------------------------------- report
VERDICT_KEY = {"confirmed": "audio_confirmed", "variant": "audio_variant",
               "absent": "audio_absent"}

by_term = {}
for occ in occurrences:
    row = by_term.setdefault(occ["term"], {
        "occurrences": 0, "attested_in_course": occ["attested_in_course"],
        "audio_confirmed": 0, "audio_variant": 0, "audio_absent": 0,
        "audio_not_sampled": 0})
    row["occurrences"] += 1
    row[VERDICT_KEY.get(occ.get("audio_check"), "audio_not_sampled")] += 1

unattested = sorted(t for t, r in by_term.items() if not r["attested_in_course"])
absent = [o for o in occurrences if o.get("audio_check") == "absent"]
variants = [o for o in occurrences if o.get("audio_check") == "variant"]

print()
print(f"biased-term occurrences across {len(list(VTT_DIR.glob('lesson_*.vtt')))} transcripts: "
      f"{len(occurrences)}")
print(f"distinct terms used: {len(by_term)}")
print(f"terms attested in the course's own written material: "
      f"{len(by_term) - len(unattested)}/{len(by_term)}")
print(f"terms NOT attested in writing: {unattested or 'none'}")
print(f"audio re-checked (unprimed): {checked} of {len(occurrences)}")
print(f"  confirmed  — unprimed decoder produced the term: "
      f"{sum(1 for o in occurrences if o.get('audio_check') == 'confirmed')}")
print(f"  variant    — same word, different spelling (the bias doing its job): {len(variants)}")
for o in variants:
    print(f"      lesson {o['lesson']} @ {o['start']}s  {o['term']} ~ "
          f"{o.get('nearest_unprimed_word')}")
print(f"  ABSENT     — audio does not support the term, needs a human: {len(absent)}")
for o in absent:
    print(f"      lesson {o['lesson']} @ {o['start']}s  term={o['term']} "
          f"(nearest: {o.get('nearest_unprimed_word')})")
    print(f"        primed:   {o['primed_text'][:104]}")
    print(f"        unprimed: {o.get('unprimed_text','')[:104]}")
if echoes:
    print(f"\nPROMPT ECHOES: {len(echoes)} — the decoder recited its own glossary.")
    print("  These cues are NOT narration and are excluded from term counts above.")
    print("  scripts/ingest-knowledge.ts refuses a transcript containing one, so the")
    print("  corpus cannot hold them. Inspect the audio at these timestamps:")
    for e in echoes:
        print(f"    lesson {e['lesson']} @ {e['start']}s: {e['text'][:100]}")
else:
    print("prompt echoes: 0")

(VTT_DIR / "term_verification.json").write_text(json.dumps({
    "audio_budget": AUDIO_BUDGET,
    "audio_checked": checked,
    "by_term": by_term,
    "occurrences": occurrences,
    "prompt_echoes": echoes,
}, indent=1))
print(f"\nwrote {VTT_DIR / 'term_verification.json'}")
