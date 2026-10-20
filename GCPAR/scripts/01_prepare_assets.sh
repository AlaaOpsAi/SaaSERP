#!/usr/bin/env bash
# Extract slide images from the deck, clean up the voice sample and crop the
# instructor photo for the picture-in-picture window.
#
# Usage: scripts/01_prepare_assets.sh <deck.pptx> <voice.m4a> <instructor.jpg>
set -euo pipefail

DECK=${1:?deck.pptx}
VOICE=${2:?voice.m4a}
PHOTO=${3:?instructor.jpg}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
WORK="$ROOT/work"
mkdir -p "$WORK/slides" "$WORK/src"
cp "$PHOTO" "$WORK/src/instructor.jpg"

# 1) Slides: every slide in this deck is a single full-bleed picture, so pull
#    the image each slide references, in presentation order.
python3 "$ROOT/scripts/extract_slides.py" "$DECK" "$WORK/slides"

# 2) Voice sample: high-pass rumble, normalize loudness, drop trailing silence.
ffmpeg -y -hide_banner -loglevel error -i "$VOICE" \
  -af "highpass=f=70,loudnorm=I=-18:TP=-1.5:LRA=11,silenceremove=stop_periods=-1:stop_duration=1.2:stop_threshold=-45dB" \
  -ar 44100 -ac 1 "$WORK/src/voice_sample_clean.wav"

# 3) Instructor photo: 3:4 crop (almost the whole portrait, Paris backdrop
#    included) -- the start frame for the lip-synced instructor window.
python3 - "$PHOTO" "$WORK/src/instructor_3x4.jpg" <<'PY'
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert("RGB")
w, h = im.size
ch = int(w * 4 / 3)
top = max(0, min(h - ch, int(h * 0.10)))
im.crop((0, top, w, top + ch)).resize((960, 1280), Image.LANCZOS).save(sys.argv[2], quality=95)
print("instructor crop", (0, top, w, top + ch))
PY

# 4) Fonts with both Arabic and Latin glyphs (SIL Open Font License).
mkdir -p "$WORK/fonts"
GF=https://raw.githubusercontent.com/google/fonts/main/ofl
for f in ibmplexsansarabic/IBMPlexSansArabic-Regular.ttf \
         ibmplexsansarabic/IBMPlexSansArabic-SemiBold.ttf \
         ibmplexsansarabic/IBMPlexSansArabic-Bold.ttf \
         "cairo/Cairo%5Bslnt,wght%5D.ttf"; do
  name=$(basename "$f" | sed 's/%5B/[/; s/%5D/]/')
  [ -s "$WORK/fonts/$name" ] || curl -sSfL -o "$WORK/fonts/$name" "$GF/$f"
done

echo "assets ready in $WORK"
