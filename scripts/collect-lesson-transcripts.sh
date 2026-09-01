#!/bin/bash
#
# Collect and locally transcribe the Art of Drink lessons that have video but no
# caption track.
#
#   scripts/collect-lesson-transcripts.sh [outdir]
#
# Writes, for each lesson, into data/knowledge/local_transcripts/ (gitignored):
#   lesson_<id>.vtt        Whisper output — the cues ingest-knowledge.ts reads
#   lesson_<id>.duration   media length from ffprobe — the check that the
#                          transcript belongs to the recording it claims
#
# Then: PATH=/usr/local/bin:$PATH npx tsx scripts/ingest-knowledge.ts
#
# WHY THIS EXISTS
#
# Bunny library 177015 serves these lessons' embeds with no `.vtt` reference of
# any kind, so there is no caption track to collect — unlike library 4056, whose
# embeds expose `captions/en-auto.vtt`. Transcribing locally is the only way to
# give these lessons a citable clock.
#
# RIGHTS: this is `authorized_private` course material under Ashley's
# enrolment. It is transcribed ON THIS MACHINE and must never be sent to a
# cloud transcription service. An offline machine is the fix for a slow run, not
# a faster API.
#
# ACCESS: the Bunny embed is referrer-locked — fetching it without a lesson-page
# referer returns 403. This sends the same referer the enrolled browser sends,
# and takes the audio stream only. The signed CDN token is read fresh from the
# embed on every run and never stored.
#
# RESOURCES: Whisper needs real idle CPU. On a loaded machine (load average 40+,
# under 1% idle) even `tiny.en` cannot transcribe 170 seconds of audio in 300
# seconds, while the same clip takes under three minutes on a quiet one. Check
# first:  top -l 1 -n 0 | grep -E "CPU usage|PhysMem"
#
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-$REPO/data/knowledge/local_transcripts}"
WORK="$OUT/.media"
mkdir -p "$OUT" "$WORK"

UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
BASE=https://edu.artofdrink.com/courses-archive-elementor/flavor-beverage-development
LIBRARY=177015

# lesson_id:bunny_guid — the seven lessons with video and no caption track.
# Lessons 7966, 7736, 5726, 5136 and 7561 are deliberately absent: they have no
# video at all. See docs/BRIX_KNOWLEDGE.md for the per-lesson evidence.
LESSONS="
4906:4dd19975-aff7-44bf-99c3-2c9d7264de55
5446:ba0221f8-35a1-400c-97b3-0717ec7810e1
6066:7d24df54-78ad-43db-8ddf-5978bfcf58d0
6381:794509be-ce5d-4600-9893-eaf1efdaa9c3
5551:684635ca-2ae5-4885-9cf1-71c90f8e00d6
4776:c817a5d3-404d-451d-b281-d2a57ee79f51
5256:149c1e60-916a-47a9-8044-f69db1a7568a
"

# Vocabulary bias for the decoder. EVERY term is attested in real course
# material — the Jargon File (lesson 5136) plus terms grepped out of the saved
# lesson pages. Nothing here is invented. It biases toward course spelling; it
# does not authorise "correcting" the audio, which is what
# scripts/verify-transcript-terms.py exists to police.
PRIME="Flavour and beverage development course. Terms: ABV, ABW, Brix, CAS, cloud agent, Codex Alimentarius, CO2, EtOH, FCC, FEMA, flavour house, FIDS, FMP, GMP, GRAS, immiscible, miscible, JECFA, MOQ, MSDS, WONF, organoleptic, PPM, process authority, RDA, RTD, shelf stable, SKU, TA, TTB, USP, terpenes, terpenoids, limonene, gentian, wormwood, percolation, macerated, tincture, solvent, emulsion, HLB."

# One torch process at a time, with bounded threads. Two concurrent runs each
# grabbing all cores drove the machine to load 27 and made a 2:47 file take
# over twenty minutes.
export OMP_NUM_THREADS=6 MKL_NUM_THREADS=6

for entry in $LESSONS; do
  LID="${entry%%:*}"; GUID="${entry##*:}"

  # ---- audio ----------------------------------------------------------------
  # `embed_<id>.html` is an in-flight marker, deleted only after ffmpeg exits
  # clean. Its presence means the previous run died mid-write and the .wav is
  # truncated — an interrupted run once left a 5-minute lesson at 188 seconds.
  if [ ! -s "$WORK/$LID.wav" ] || [ -f "$WORK/embed_$LID.html" ]; then
    curl -s -H "Referer: $BASE/$LID/" -H "User-Agent: $UA" \
      "https://iframe.mediadelivery.net/embed/$LIBRARY/$GUID" -o "$WORK/embed_$LID.html"

    # Quoted heredoc: bash does no interpolation, so the pattern reaches Python
    # verbatim. The filename comes through argv rather than being spliced into
    # the source. An earlier version inlined this with `python3 -c "..."` and a
    # character class full of quotes and backslashes; bash mangled it into a
    # SyntaxError, and because the failure path is "no playlist found", every
    # lesson would have been skipped with a plausible-looking message.
    #
    # The pattern deliberately contains no quote characters: a lazy \S+? ending
    # at .m3u8 cannot run past the closing quote of an HTML attribute.
    PLAYLIST=$(python3 - "$WORK/embed_$LID.html" <<'PY'
import re, sys
html = open(sys.argv[1], encoding="utf-8", errors="replace").read()
found = re.findall(r"https://vz-[a-z0-9-]+\.b-cdn\.net/\S+?\.m3u8", html)
print(found[0] if found else "")
PY
)
    if [ -z "$PLAYLIST" ]; then
      echo "$LID: NO PLAYLIST in embed — access may have changed, skipping" >&2
      continue
    fi

    # Lowest rendition: the audio is identical across renditions and this moves
    # the least video over the wire for a stream we discard anyway.
    ffmpeg -nostdin -loglevel error \
      -headers $'Referer: https://iframe.mediadelivery.net/\r\n' \
      -i "${PLAYLIST%/playlist.m3u8}/352x240/video.m3u8" \
      -vn -ac 1 -ar 16000 -c:a pcm_s16le -y "$WORK/$LID.wav" </dev/null || {
        echo "$LID: ffmpeg failed" >&2; continue; }
    rm -f "$WORK/embed_$LID.html"
  fi

  ffprobe -v error -show_entries format=duration -of csv=p=0 "$WORK/$LID.wav" \
    > "$OUT/lesson_$LID.duration"

  # ---- transcript -----------------------------------------------------------
  if [ -s "$OUT/lesson_$LID.vtt" ]; then
    echo "$LID: transcript already present"
    continue
  fi
  START=$(date +%s)
  whisper "$WORK/$LID.wav" --model small.en --language en \
    --output_format vtt --verbose False --output_dir "$OUT" \
    --initial_prompt "$PRIME" >/dev/null 2>&1
  # Whisper names output after the input file; rename to the lesson_ convention
  # ingest-knowledge.ts looks for.
  [ -f "$OUT/$LID.vtt" ] && mv "$OUT/$LID.vtt" "$OUT/lesson_$LID.vtt"
  echo "$LID: $(grep -c '\-\->' "$OUT/lesson_$LID.vtt" 2>/dev/null || echo 0) cues, \
$(cat "$OUT/lesson_$LID.duration")s media, $(( $(date +%s) - START ))s to transcribe"
done

echo
echo "Next: scripts/verify-transcript-terms.py \"$OUT\" \"$WORK\""
echo "Then: PATH=/usr/local/bin:\$PATH npx tsx scripts/ingest-knowledge.ts"
