"""Split the narration into sentence-aligned TTS chunks.

Each chunk is narrated separately and drives exactly one lip-sync clip, so it
must stay under the 15 s limit of the lip-sync model (~150 Arabic characters
at the cloned voice's pace). Output: narration/tts_chunks.json
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MAX_CHARS = 150


def chunks(text):
    sentences = re.split(r"(?<=[.!؟?])\s+", text.strip())
    out, cur = [], ""
    for s in sentences:
        pieces = [s]
        if len(s) > MAX_CHARS:                       # split long sentences at commas
            pieces, buf = [], ""
            for c in re.split(r"(?<=[،:])\s+", s):
                if buf and len(buf) + len(c) + 1 > MAX_CHARS:
                    pieces.append(buf)
                    buf = c
                else:
                    buf = f"{buf} {c}".strip()
            pieces.append(buf)
        for p in pieces:
            if cur and len(cur) + len(p) + 1 > MAX_CHARS:
                out.append(cur)
                cur = p
            else:
                cur = f"{cur} {p}".strip()
    if cur:
        out.append(cur)
    return out


def main():
    cfg = json.loads((ROOT / "narration" / "narration_ar.json").read_text())
    rows = []
    for s in cfg["slides"]:
        for k, c in enumerate(chunks(s["text"]), 1):
            rows.append({"slide": s["id"], "part": k, "text": c})
    (ROOT / "narration" / "tts_chunks.json").write_text(
        json.dumps(rows, ensure_ascii=False, indent=1))
    print(len(rows), "chunks; longest", max(len(r["text"]) for r in rows), "chars")


if __name__ == "__main__":
    main()
