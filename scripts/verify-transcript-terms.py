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

Neither stage edits a transcript. Nothing here rewrites audio to match the
glossary; the output is evidence, and an UNCONFIRMED row stays UNCONFIRMED.

Writes term_verification.json beside the transcripts.
"""
import json
import re
import subprocess
import sys
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
# these case-insensitively turns "ta" in "take" into a TA hit. Word boundaries
# alone are not enough: "TA" IS a standalone word in "a ta value".
CASE_SENSITIVE = {"TA", "CAS", "TTB", "USP", "RDA", "RTD", "SKU", "FCC", "FMP",
                  "PPM", "ABV", "ABW", "GRAS", "GMP", "FEMA", "MOQ", "MSDS",
                  "WONF", "HLB", "EtOH", "FIDS", "JECFA"}

WINDOW_PAD = 4.0   # seconds either side; a bare 2s clip decodes badly out of context


def pattern(term):
    flags = 0 if term in CASE_SENSITIVE else re.IGNORECASE
    return re.compile(r"\b" + re.escape(term) + r"\b", flags)


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


def course_text():
    blobs = {}
    for page in sorted(PAGES.glob("lesson_*.html")):
        raw = page.read_text(encoding="utf-8", errors="replace")
        text = INLINE_TAGS.sub("", raw)
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


ordered, seen = [], set()
for occ in sorted(occurrences, key=risk_key):
    key = (occ["lesson"], occ["term"])
    if key not in seen:
        seen.add(key)
        ordered.append(occ)
for occ in sorted(occurrences, key=risk_key):
    if occ not in ordered:
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
    occ["audio_check"] = "confirmed" if pattern(occ["term"]).search(unprimed) else "unconfirmed"
    clip.unlink(missing_ok=True)
    out.unlink(missing_ok=True)
    checked += 1
    print(f"  audio {occ['lesson']} {occ['start']:8.2f} {occ['term']:20} "
          f"{occ['audio_check']}", flush=True)

# ---------------------------------------------------------------- report
by_term = {}
for occ in occurrences:
    row = by_term.setdefault(occ["term"], {
        "occurrences": 0, "attested_in_course": occ["attested_in_course"],
        "audio_confirmed": 0, "audio_unconfirmed": 0, "audio_not_sampled": 0})
    row["occurrences"] += 1
    key = {"confirmed": "audio_confirmed", "unconfirmed": "audio_unconfirmed"}.get(
        occ.get("audio_check"), "audio_not_sampled")
    row[key] += 1

unattested = sorted(t for t, r in by_term.items() if not r["attested_in_course"])
unconfirmed = [o for o in occurrences if o.get("audio_check") == "unconfirmed"]

print()
print(f"biased-term occurrences across {len(list(VTT_DIR.glob('lesson_*.vtt')))} transcripts: "
      f"{len(occurrences)}")
print(f"distinct terms used: {len(by_term)}")
print(f"terms attested in the course's own written material: "
      f"{len(by_term) - len(unattested)}/{len(by_term)}")
print(f"terms NOT attested in writing: {unattested or 'none'}")
print(f"audio re-checked (unprimed): {checked} of {len(occurrences)}")
print(f"  confirmed by unprimed audio: {sum(1 for o in occurrences if o.get('audio_check') == 'confirmed')}")
print(f"  UNCONFIRMED: {len(unconfirmed)}")
for o in unconfirmed:
    print(f"    lesson {o['lesson']} @ {o['start']}s  term={o['term']}")
    print(f"      primed:   {o['primed_text'][:110]}")
    print(f"      unprimed: {o.get('unprimed_text','')[:110]}")
print(f"prompt echoes: {len(echoes)}")

(VTT_DIR / "term_verification.json").write_text(json.dumps({
    "audio_budget": AUDIO_BUDGET,
    "audio_checked": checked,
    "by_term": by_term,
    "occurrences": occurrences,
    "prompt_echoes": echoes,
}, indent=1))
print(f"\nwrote {VTT_DIR / 'term_verification.json'}")
