"""Split each slide's narration into <=14.5 s chunks at natural pauses.

The lip-sync model (Higgsfield `wan2_7`, start image + audio reference) renders
at most 15 s per clip, so every slide's narration is cut at the pause closest
to each limit. Output:
  work/audio_chunks/slideNN_partK.mp3
  work/audio_chunks/manifest.json   [{slide, part, file, duration}, ...]
The rendered clips are saved back as work/pip/slideNN_partK.mp4, which
build_video.py stitches into the instructor window.
"""
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
AUDIO = ROOT / "work" / "audio"
OUT = ROOT / "work" / "audio_chunks"
MAX_LEN = 14.5
MIN_LEN = 3.0


def duration(p):
    return float(subprocess.check_output(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", str(p)]))


def pauses(p):
    r = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(p), "-af",
                        "silencedetect=n=-35dB:d=0.15", "-f", "null", "-"],
                       capture_output=True, text=True)
    s = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", r.stderr)]
    e = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", r.stderr)]
    return [(a + b) / 2 for a, b in zip(s, e)]


def cut_points(total, mids):
    cuts, start = [], 0.0
    while total - start > MAX_LEN:
        window = [m for m in mids if start + MIN_LEN < m <= start + MAX_LEN]
        cut = max(window) if window else start + MAX_LEN
        cuts.append(cut)
        start = cut
    return cuts


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = []
    for src in sorted(AUDIO.glob("slide*.*")):
        n = int(re.search(r"slide(\d+)", src.stem).group(1))
        total = duration(src)
        bounds = [0.0, *cut_points(total, pauses(src)), total]
        for k, (a, b) in enumerate(zip(bounds[:-1], bounds[1:]), 1):
            dst = OUT / f"slide{n:02d}_part{k}.mp3"
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(src),
                            "-ss", f"{a:.3f}", "-to", f"{b:.3f}", "-ac", "1",
                            "-ar", "44100", "-b:a", "160k", str(dst)], check=True)
            manifest.append({"slide": n, "part": k, "file": dst.name,
                             "duration": round(b - a, 3)})
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2))
    secs = sum(m["duration"] for m in manifest)
    print(f"{len(manifest)} chunks, {secs:.1f}s of lip-sync to render")


if __name__ == "__main__":
    main()
