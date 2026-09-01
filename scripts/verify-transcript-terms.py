#!/usr/bin/env python3
"""
Check that every glossary-biased term in the transcripts is actually in the audio.

The transcription pass runs Whisper with an --initial_prompt built from the
course's own Jargon File. That biases the decoder toward real course vocabulary,
which is allowed — but bias can also PUT a word somewhere the speaker never said
it, and a corpus quoted verbatim cannot absorb that.

So: for every occurrence of a biased term, cut the audio around that cue and
re-transcribe just that window with NO prompt. If the unprimed decoder produces
the term too, the audio supports it. If it does not, the term is recorded as
UNCONFIRMED — not silently kept, and not silently "corrected" either.

Also flags prompt echo: Whisper can emit its own initial_prompt as text during
silence, which would drop a glossary list into the corpus as though it were
narration.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
VTT_DIR = Path(sys.argv[1]) if len(sys.argv) > 1 else REPO / "data/knowledge/local_transcripts"
MEDIA = Path(sys.argv[2]) if len(sys.argv) > 2 else VTT_DIR / ".media"
WORK = VTT_DIR / ".verify"
WORK.mkdir(parents=True, exist_ok=True)

# The exact terms the prompt biased toward, as whole words.
TERMS = [
    "ABV", "ABW", "Brix", "CAS", "cloud agent", "Codex Alimentarius", "CO2",
    "EtOH", "FCC", "FEMA", "flavour house", "FIDS", "FMP", "GMP", "GRAS",
    "immiscible", "miscible", "JECFA", "MOQ", "MSDS", "WONF", "organoleptic",
    "PPM", "process authority", "RDA", "RTD", "shelf stable", "SKU", "TA",
    "TTB", "USP", "terpenes", "terpenoids", "limonene", "gentian", "wormwood",
    "percolation", "macerated", "tincture", "solvent", "emulsion", "HLB",
]
# Short all-caps tokens produce far too many false hits against ordinary words
# ("TA" inside "take"). Word-boundary matching handles that, but these are also
# case-sensitive acronyms where a lowercase match means something else.
CASE_SENSITIVE = {"TA", "CAS", "TTB", "USP", "RDA", "RTD", "SKU", "FCC", "FMP", "PPM"}

WINDOW_PAD = 4.0   # seconds of context either side; a bare 2s clip decodes badly
MAX_PER_LESSON = 45


def clock(t):
    parts = t.replace(",", ".").split(":")
    parts = [float(p) for p in parts]
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


def pattern(term):
    flags = 0 if term in CASE_SENSITIVE else re.IGNORECASE
    return re.compile(r"\b" + re.escape(term) + r"\b", flags)


PATTERNS = [(t, pattern(t)) for t in TERMS]

results = []
echoes = []

for vtt in sorted(VTT_DIR.glob("lesson_*.vtt")):
    lesson = vtt.stem.replace("lesson_", "")
    wav = MEDIA / f"{lesson}.wav"
    if not wav.exists():
        print(f"{lesson}: no media, skipped", file=sys.stderr)
        continue
    cues = parse_vtt(vtt)

    # Prompt echo: a cue that reproduces a long run of the prompt is the decoder
    # reciting its own instructions, not the speaker talking.
    for start, end, text in cues:
        low = text.lower()
        if "terms:" in low and low.count(",") >= 5:
            echoes.append({"lesson": lesson, "start": start, "text": text})

    hits = []
    for start, end, text in cues:
        for term, pat in PATTERNS:
            if pat.search(text):
                hits.append((start, end, text, term))
    # Bound the work: keep every distinct term, then fill up to the cap.
    seen, ordered = set(), []
    for h in hits:
        if h[3] not in seen:
            seen.add(h[3])
            ordered.append(h)
    for h in hits:
        if len(ordered) >= MAX_PER_LESSON:
            break
        if h not in ordered:
            ordered.append(h)

    for idx, (start, end, text, term) in enumerate(ordered):
        a = max(0.0, start - WINDOW_PAD)
        dur = (end - start) + 2 * WINDOW_PAD
        clip = WORK / f"{lesson}_{idx}.wav"
        subprocess.run(
            ["/opt/homebrew/bin/ffmpeg", "-nostdin", "-loglevel", "error", "-ss", str(a),
             "-t", str(dur), "-i", str(wav), "-ac", "1", "-ar", "16000", "-y", str(clip)],
            check=True,
        )
        subprocess.run(
            ["/opt/homebrew/bin/whisper", str(clip), "--model", "small.en", "--language", "en",
             "--output_format", "txt", "--verbose", "False", "--output_dir", str(WORK)],
            check=True, capture_output=True,
        )
        out = WORK / f"{lesson}_{idx}.txt"
        unprimed = out.read_text().strip() if out.exists() else ""
        confirmed = bool(pattern(term).search(unprimed))
        results.append({
            "lesson": lesson, "term": term, "start": round(start, 3),
            "confirmed_unprimed": confirmed,
            "primed_text": text,
            "unprimed_text": unprimed,
        })
        clip.unlink(missing_ok=True)
        out.unlink(missing_ok=True)
        print(f"{lesson} {start:8.2f} {term:22} {'OK' if confirmed else 'UNCONFIRMED'}", flush=True)

(VTT_DIR / "term_verification.json").write_text(json.dumps({"results": results, "prompt_echoes": echoes}, indent=1))
ok = sum(1 for r in results if r["confirmed_unprimed"])
print(f"\nchecked {len(results)} occurrences: {ok} confirmed in unprimed audio, "
      f"{len(results)-ok} unconfirmed; {len(echoes)} prompt echoes")
