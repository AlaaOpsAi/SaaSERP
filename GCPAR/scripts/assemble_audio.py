"""Join the per-chunk TTS files into one narration track per slide.

Reads work/tts_manifest.json (written when the chunks were downloaded) and
writes work/audio/slideNN.wav. Chunks are separated by a short natural pause.
A chunk that has a lip-sync clip (work/pip/slideNN_partK.mp4) is padded to the
clip's exact length so the instructor's mouth stays in step with the voice.
"""
import json
import subprocess
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORK = ROOT / "work"
GAP = 0.35


def duration(p):
    return float(subprocess.check_output(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", str(p)]))


def main():
    manifest = json.loads((WORK / "tts_manifest.json").read_text())
    by_slide = defaultdict(list)
    for row in manifest:
        by_slide[row["slide"]].append(row)
    out_dir = WORK / "audio"
    out_dir.mkdir(exist_ok=True)
    for slide, rows in sorted(by_slide.items()):
        rows.sort(key=lambda r: r["part"])
        inputs, filters = [], []
        for i, r in enumerate(rows):
            src = ROOT / r["file"]
            clip = WORK / "pip" / f"slide{slide:02d}_part{r['part']}.mp4"
            # pad to the clip length when lip-synced, else add a short pause
            target = duration(clip) if clip.exists() else duration(src) + GAP
            inputs += ["-i", str(src)]
            filters.append(f"[{i}:a]aformat=sample_rates=48000:channel_layouts=mono,"
                           f"apad=whole_dur={target:.3f}[a{i}]")
        cat = "".join(f"[a{i}]" for i in range(len(rows)))
        filters.append(f"{cat}concat=n={len(rows)}:v=0:a=1[out]")
        dst = out_dir / f"slide{slide:02d}.wav"
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *inputs,
                        "-filter_complex", ";".join(filters), "-map", "[out]",
                        str(dst)], check=True)
        print(f"{dst.name}: {duration(dst):.1f}s from {len(rows)} chunks")


if __name__ == "__main__":
    main()
