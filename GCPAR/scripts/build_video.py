"""Compose the Arabic lecture video from slides, narration and instructor PiP.

Layout (1920x1080):
  * slide framed on the right, Arabic subtitles in a band beneath it
  * left column: course title, slide counter, section title, progress dots,
    a live waveform of the narration, and the instructor window bottom-left
  * branded intro/outro cards, crossfades between every segment

Inputs (all under GCPAR/work unless overridden):
  slides/slideNN.png         slide images (scripts/extract_slides.py)
  audio/slideNN.(wav|mp3)    narration per slide in the cloned voice
  pip/slideNN_partK.mp4      lip-synced instructor clips per slide (optional;
                             falls back to an animated still of the photo)
  src/instructor.jpg         instructor photo

Usage:
  python3 scripts/build_video.py              # full render
  python3 scripts/build_video.py --preview    # placeholder audio where missing
  python3 scripts/build_video.py --only 2,3   # render a subset (no final mux)
"""
import argparse
import json
import math
import re
import shutil
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
WORK = ROOT / "work"
BUILD = WORK / "build"
OUT = ROOT / "output"

W, H, FPS = 1920, 1080, 30
LEAD, TAIL, XFADE = 0.5, 0.7, 0.5          # seconds of silence around speech

# Geometry
SLIDE_BOX = (396, 26, 1500, 837)            # x, y, w, h
SUB_BOX = (396, 884, 1500, 170)
COL_X, COL_W = 24, 348
PIP_BOX = (24, 590, 348, 464)               # 3:4 instructor window
WAVE_BOX = (24, 528, 348, 40)

# Palette (matches the deck's dark-navy / electric-blue look)
BG_TOP, BG_BOTTOM = (8, 13, 26), (14, 24, 46)
ACCENT = (92, 176, 255)
ACCENT_2 = (124, 243, 196)
TEXT = (238, 243, 252)
MUTED = (150, 166, 196)

# Fonts with both Arabic and Latin glyphs (product names stay in English)
FONT_DIR = WORK / "fonts"                    # fetched by 01_prepare_assets.sh
F_TITLE = (str(FONT_DIR / "Cairo[slnt,wght].ttf"), "Bold")
F_BODY_B = (str(FONT_DIR / "IBMPlexSansArabic-Bold.ttf"), None)
F_BODY_SB = (str(FONT_DIR / "IBMPlexSansArabic-SemiBold.ttf"), None)
F_BODY = (str(FONT_DIR / "IBMPlexSansArabic-Regular.ttf"), None)


def font(spec, size):
    path, variation = spec
    f = ImageFont.truetype(path, size, layout_engine=ImageFont.Layout.RAQM)
    if variation:
        f.set_variation_by_name(variation)
    return f


def run(cmd):
    subprocess.run(cmd, check=True)


def probe_duration(path):
    out = subprocess.check_output(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", str(path)])
    return float(out)


# --------------------------------------------------------------------------
# Text helpers (Arabic is shaped/bidi-ordered by libraqm; we only wrap words)
# --------------------------------------------------------------------------
def text_w(draw, s, f):
    return draw.textlength(s, font=f, direction="rtl", language="ar")


# A run of Latin words (product names) wraps as one unit so it never splits
# across lines in the middle of an Arabic sentence.
LATIN_RUN = re.compile(r"[A-Za-z0-9][\w.\-]*(?:\s+[A-Za-z0-9][\w.\-]*)*[،.:]?|\S+")


def wrap(draw, s, f, max_w):
    lines, cur = [], ""
    for word in LATIN_RUN.findall(s):
        trial = f"{cur} {word}".strip()
        if cur and text_w(draw, trial, f) > max_w:
            lines.append(cur)
            cur = word
        else:
            cur = trial
    if cur:
        lines.append(cur)
    return lines


def draw_rtl(draw, xy_right, s, f, fill, anchor="ra"):
    draw.text(xy_right, s, font=f, fill=fill, direction="rtl",
              language="ar", anchor=anchor)


def rounded_mask(size, radius):
    m = Image.new("L", size, 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, size[0] - 1, size[1] - 1),
                                        radius=radius, fill=255)
    return m


def glow(canvas, box, radius, color, blur, alpha):
    x, y, w, h = box
    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    ImageDraw.Draw(layer).rounded_rectangle(
        (x, y, x + w, y + h), radius=radius, fill=color + (alpha,))
    canvas.alpha_composite(layer.filter(ImageFilter.GaussianBlur(blur)))


# --------------------------------------------------------------------------
# Static layers
# --------------------------------------------------------------------------
def background():
    bg = Image.new("RGBA", (W, H))
    px = ImageDraw.Draw(bg)
    for yy in range(H):
        t = yy / (H - 1)
        c = tuple(int(BG_TOP[i] + (BG_BOTTOM[i] - BG_TOP[i]) * t) for i in range(3))
        px.line([(0, yy), (W, yy)], fill=c + (255,))
    grid = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    g = ImageDraw.Draw(grid)
    for xx in range(0, W, 48):
        g.line([(xx, 0), (xx, H)], fill=(120, 160, 255, 10))
    for yy in range(0, H, 48):
        g.line([(0, yy), (W, yy)], fill=(120, 160, 255, 10))
    bg.alpha_composite(grid)
    sx, sy, sw, sh = SLIDE_BOX
    glow(bg, (sx + 80, sy + 60, sw - 160, sh - 120), 60, (40, 110, 255), 90, 70)
    return bg


def render_slide_canvas(idx, total, slide_png, meta, course, base, next_section):
    im = base.copy()
    d = ImageDraw.Draw(im)

    # Slide with shadow + hairline border
    sx, sy, sw, sh = SLIDE_BOX
    glow(im, (sx + 6, sy + 14, sw, sh), 18, (0, 0, 0), 18, 200)
    slide = Image.open(slide_png).convert("RGBA").resize((sw, sh), Image.LANCZOS)
    im.paste(slide, (sx, sy), rounded_mask((sw, sh), 16))
    d.rounded_rectangle((sx, sy, sx + sw - 1, sy + sh - 1), radius=16,
                        outline=ACCENT + (90,), width=2)

    # Subtitle band (text is overlaid per caption at render time)
    bx, by, bw, bh = SUB_BOX
    d.rounded_rectangle((bx, by, bx + bw, by + bh), radius=18,
                        fill=(12, 20, 38, 235), outline=ACCENT + (55,), width=2)

    right = COL_X + COL_W
    # Course title
    f_title = font(F_TITLE, 30)
    y = 30
    for line in wrap(d, course, f_title, COL_W):
        draw_rtl(d, (right, y), line, f_title, TEXT)
        y += 50
    y += 18

    # Slide counter
    f_lbl = font(F_BODY, 22)
    draw_rtl(d, (right, y), "الشريحة", f_lbl, MUTED)
    f_cnt = font(F_BODY_B, 64)
    cnt = f"{idx:02d}"
    d.text((COL_X, y - 8), cnt, font=f_cnt, fill=ACCENT + (255,), anchor="la")
    cw = d.textlength(cnt, font=f_cnt)
    d.text((COL_X + cw + 10, y + 26), f"/ {total:02d}", font=font(F_BODY_B, 26),
           fill=MUTED + (255,), anchor="la")
    y += 92

    # Section title
    f_sec = font(F_TITLE, 28)
    for line in wrap(d, meta["section"], f_sec, COL_W)[:3]:
        draw_rtl(d, (right, y), line, f_sec, ACCENT_2)
        y += 48
    y += 16

    # Progress dots, filling right-to-left (Arabic reading order)
    gap = 4
    seg = (COL_W - gap * (total - 1)) / total
    for k in range(total):
        x1 = right - (k + 1) * seg - k * gap
        n = k + 1
        col = (ACCENT + (255,) if n < idx else
               ACCENT_2 + (255,) if n == idx else (255, 255, 255, 38))
        d.rounded_rectangle((x1, y, x1 + seg, y + 7), radius=3, fill=col)
    y += 30

    # "Up next" card
    f_next = font(F_BODY_SB, 22)
    next_lines = wrap(d, next_section, f_next, COL_W - 32)[:2]
    card = (COL_X, y, right, y + 52 + 32 * len(next_lines))
    d.rounded_rectangle(card, radius=14, fill=(18, 30, 56, 210),
                        outline=ACCENT + (60,), width=2)
    draw_rtl(d, (right - 16, y + 10), "التالي", font(F_BODY, 19), MUTED)
    for k, line in enumerate(next_lines):
        draw_rtl(d, (right - 16, y + 38 + k * 32), line, f_next, TEXT)

    # "Speaking now" label above the waveform
    wx, wy, ww, wh = WAVE_BOX
    d.ellipse((right - 12, wy - 30, right, wy - 18), fill=(255, 82, 82, 255))
    draw_rtl(d, (right - 20, wy - 38), "يتحدث الآن", font(F_BODY, 20), MUTED)

    # Instructor window frame glow
    px, py, pw, ph = PIP_BOX
    glow(im, (px - 4, py - 4, pw + 8, ph + 8), 26, ACCENT, 16, 150)
    d.rounded_rectangle((px - 3, py - 3, px + pw + 2, py + ph + 2), radius=26,
                        outline=ACCENT + (230,), width=3)
    return im.convert("RGB")


def render_nametag(name, role):
    """Full-canvas transparent overlay with the name pill over the PiP."""
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    px, py, pw, ph = PIP_BOX
    box = (px + 12, py + ph - 64, px + pw - 12, py + ph - 12)
    d.rounded_rectangle(box, radius=26, fill=(8, 14, 30, 215),
                        outline=ACCENT + (120,), width=2)
    label = f"{name}  ·  {role}"
    draw_rtl(d, ((box[0] + box[2]) // 2, (box[1] + box[3]) // 2), label,
             font(F_BODY_B, 22), TEXT, anchor="mm")
    return im


def render_pip_mask():
    _, _, pw, ph = PIP_BOX
    return rounded_mask((pw, ph), 24).convert("RGB")


def render_caption(text):
    bx, by, bw, bh = SUB_BOX
    im = Image.new("RGBA", (bw, bh), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    f = font(F_BODY_B, 40)
    lines = wrap(d, text, f, bw - 90)[:2]
    lh = 66
    y0 = bh / 2 - lh * len(lines) / 2 + lh / 2
    for i, line in enumerate(lines):
        draw_rtl(d, (bw / 2 + 2, y0 + i * lh + 3), line, f, (0, 0, 0, 160), anchor="mm")
        draw_rtl(d, (bw / 2, y0 + i * lh), line, f, TEXT, anchor="mm")
    return im


def render_card(course, subtitle, name, role, photo, kind):
    im = background()
    d = ImageDraw.Draw(im)
    # Instructor portrait in a glowing circle
    size = 360
    cx, cy = W // 2, 380
    glow(im, (cx - size // 2 - 10, cy - size // 2 - 10, size + 20, size + 20),
         size // 2, ACCENT, 26, 170)
    ph = Image.open(photo).convert("RGB")
    s = min(ph.size)
    face = ph.crop((int(ph.width * 0.10), int(ph.height * 0.14),
                    int(ph.width * 0.10) + int(s * 0.80),
                    int(ph.height * 0.14) + int(s * 0.80))).resize((size, size), Image.LANCZOS)
    m = Image.new("L", (size, size), 0)
    ImageDraw.Draw(m).ellipse((0, 0, size - 1, size - 1), fill=255)
    im.paste(face, (cx - size // 2, cy - size // 2), m)
    d.ellipse((cx - size // 2 - 3, cy - size // 2 - 3, cx + size // 2 + 2,
               cy + size // 2 + 2), outline=ACCENT + (255,), width=4)

    # intro: course title + tagline; outro: subtitle is a (title, tagline) pair
    title, sub = (course, subtitle) if kind == "intro" else subtitle
    draw_rtl(d, (W // 2, 650), title, font(F_TITLE, 64), TEXT, anchor="mm")
    draw_rtl(d, (W // 2, 740), sub, font(F_BODY, 34), ACCENT_2, anchor="mm")
    draw_rtl(d, (W // 2, 850), f"{name}  ·  {role}", font(F_BODY_B, 30),
             MUTED, anchor="mm")
    return im.convert("RGB")


# --------------------------------------------------------------------------
# Captions & timing
# --------------------------------------------------------------------------
def split_captions(text, max_chars=78):
    """Sentence/clause chunks short enough for two subtitle lines."""
    parts = re.split(r"(?<=[.!؟?:])\s+", text.strip())
    out = []
    for p in parts:
        if len(p) <= max_chars:
            out.append(p)
            continue
        cur = ""
        for clause in re.split(r"(?<=،)\s+", p):
            if cur and len(cur) + len(clause) + 1 > max_chars:
                out.append(cur)
                cur = clause
            else:
                cur = f"{cur} {clause}".strip()
        if cur:
            out.append(cur)
    return out


def silences(audio, noise="-35dB", min_d=0.18):
    r = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(audio), "-af",
                        f"silencedetect=n={noise}:d={min_d}", "-f", "null", "-"],
                       capture_output=True, text=True)
    starts = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", r.stderr)]
    ends = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", r.stderr)]
    return [((a + b) / 2) for a, b in zip(starts, ends)]


def caption_times(chunks, audio, dur):
    """Proportional-by-length boundaries, snapped to nearby pauses."""
    weights = [len(c.replace(" ", "")) + 6 for c in chunks]
    tot = sum(weights)
    mids = silences(audio)
    bounds, acc = [0.0], 0.0
    for wgt in weights[:-1]:
        acc += wgt / tot * dur
        near = [m for m in mids if abs(m - acc) < 0.9]
        b = min(near, key=lambda m: abs(m - acc)) if near else acc
        bounds.append(max(b, bounds[-1] + 0.6))
    bounds.append(dur)
    return list(zip(bounds[:-1], bounds[1:]))


# --------------------------------------------------------------------------
# Audio / PiP sources
# --------------------------------------------------------------------------
def find_audio(n):
    for ext in ("wav", "mp3", "m4a"):
        p = WORK / "audio" / f"slide{n:02d}.{ext}"
        if p.exists():
            return p
    return None


def placeholder_audio(n, text):
    """Rough timing stand-in (espeak-ng) used only by --preview."""
    dst = BUILD / "preview_audio" / f"slide{n:02d}.wav"
    dst.parent.mkdir(parents=True, exist_ok=True)
    if not dst.exists():
        if shutil.which("espeak-ng"):
            run(["espeak-ng", "-v", "ar", "-s", "150", "-w", str(dst), text])
        else:
            secs = max(4.0, len(text) / 14.5)
            run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i",
                 "anullsrc=r=48000:cl=mono", "-t", f"{secs:.2f}", str(dst)])
    return dst


def pip_source(n, dur):
    """Concatenate lip-sync clips for slide n, or animate the still photo."""
    clips = sorted((WORK / "pip").glob(f"slide{n:02d}_part*.mp4"))
    dst = BUILD / "pip" / f"slide{n:02d}.mp4"
    dst.parent.mkdir(parents=True, exist_ok=True)
    _, _, pw, ph = PIP_BOX
    if clips:
        lst = BUILD / "pip" / f"slide{n:02d}.txt"
        lst.write_text("".join(f"file '{c}'\n" for c in clips))
        run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0",
             "-i", str(lst), "-an", "-vf",
             f"fps={FPS},scale={pw}:{ph}:force_original_aspect_ratio=increase,"
             f"crop={pw}:{ph},tpad=start_duration={LEAD}:start_mode=clone:"
             f"stop_duration=30:stop_mode=clone",
             "-t", f"{dur:.3f}", "-c:v", "libx264", "-crf", "16", "-preset",
             "veryfast", "-pix_fmt", "yuv420p", str(dst)])
    else:
        still = BUILD / "pip_still.jpg"
        if not still.exists():
            ph_im = Image.open(WORK / "src" / "instructor.jpg").convert("RGB")
            iw, ih = ph_im.size
            ch = int(iw * 4 / 3)
            top = max(0, int(ih * 0.10))
            ph_im.crop((0, top, iw, top + ch)).resize((pw * 3, ph * 3),
                                                      Image.LANCZOS).save(still, quality=95)
        frames = int(dur * FPS) + 1
        # slow breathing zoom; oversampled input avoids zoompan jitter
        run(["ffmpeg", "-y", "-loglevel", "error", "-loop", "1", "-i", str(still),
             "-vf", f"zoompan=z='1.04+0.025*sin(2*PI*on/{FPS * 6})':"
                    f"x='iw/2-(iw/zoom/2)':y='ih*0.42-(ih/zoom/2)':"
                    f"d={frames}:s={pw}x{ph}:fps={FPS}",
             "-frames:v", str(frames), "-c:v", "libx264", "-crf", "16",
             "-preset", "veryfast", "-pix_fmt", "yuv420p", str(dst)])
    return dst


# --------------------------------------------------------------------------
# Segment rendering
# --------------------------------------------------------------------------
ENC = ["-c:v", "libx264", "-preset", "medium", "-crf", "17", "-pix_fmt",
       "yuv420p", "-r", str(FPS), "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
       "-ac", "2"]


def render_slide_segment(n, total, meta, course, base, nametag, mask, preview,
                         next_section):
    seg_dir = BUILD / f"seg{n:02d}"
    seg_dir.mkdir(parents=True, exist_ok=True)
    audio = find_audio(n) or (placeholder_audio(n, meta["text"]) if preview else None)
    if audio is None:
        raise SystemExit(f"missing narration for slide {n} (use --preview)")
    speech = probe_duration(audio)
    dur = LEAD + speech + TAIL

    canvas = seg_dir / "canvas.png"
    render_slide_canvas(n, total, WORK / "slides" / f"slide{n:02d}.png", meta,
                        course, base, next_section).save(canvas)
    pip = pip_source(n, dur)

    chunks = split_captions(meta["text"])
    times = caption_times(chunks, audio, speech)
    cap_files = []
    for k, (c, (a, b)) in enumerate(zip(chunks, times)):
        p = seg_dir / f"cap{k:02d}.png"
        render_caption(c).save(p)
        cap_files.append((p, LEAD + a, LEAD + b))

    inputs = ["-loop", "1", "-t", f"{dur:.3f}", "-i", str(canvas),
              "-i", str(pip),
              "-loop", "1", "-t", f"{dur:.3f}", "-i", str(mask),
              "-loop", "1", "-t", f"{dur:.3f}", "-i", str(nametag),
              "-i", str(audio)]
    px, py, pw, ph = PIP_BOX
    wx, wy, ww, wh = WAVE_BOX
    sx, sy = SUB_BOX[:2]
    fg = [
        f"[1:v]format=rgb24[pv];[2:v]format=gray,scale={pw}:{ph}[pm];"
        f"[pv][pm]alphamerge[pip]",
        f"[4:a]adelay={int(LEAD * 1000)}:all=1,apad=whole_dur={dur:.3f},"
        f"aformat=sample_rates=48000:channel_layouts=stereo,asplit=2[aout][aw]",
        f"[aw]showwaves=s={ww}x{wh}:mode=cline:rate={FPS}:scale=sqrt:"
        f"colors=0x5CB0FF|0x7CF3C4,format=rgba,colorkey=black:0.1:0.0[wave]",
        f"[0:v][pip]overlay={px}:{py}:shortest=1[v0]",
        f"[v0][3:v]overlay=0:0[v1]",
        f"[v1][wave]overlay={wx}:{wy}:shortest=1[v2]",
    ]
    last = "v2"
    for k, (p, a, b) in enumerate(cap_files):
        idx = 5 + k
        inputs += ["-loop", "1", "-t", f"{dur:.3f}", "-i", str(p)]
        fade_d = 0.18
        fg.append(f"[{idx}:v]format=rgba,fade=t=in:st={a:.3f}:d={fade_d}:alpha=1,"
                  f"fade=t=out:st={max(a, b - fade_d):.3f}:d={fade_d}:alpha=1[c{k}]")
        fg.append(f"[{last}][c{k}]overlay={sx}:{sy}:"
                  f"enable='between(t,{a:.3f},{b:.3f})'[v{k + 3}]")
        last = f"v{k + 3}"
    out = seg_dir / "segment.mp4"
    run(["ffmpeg", "-y", "-loglevel", "error", *inputs, "-filter_complex",
         ";".join(fg), "-map", f"[{last}]", "-map", "[aout]", "-t", f"{dur:.3f}",
         *ENC, str(out)])
    return out, dur


def render_card_segment(name, img, dur):
    seg_dir = BUILD / name
    seg_dir.mkdir(parents=True, exist_ok=True)
    png = seg_dir / "card.png"
    img.save(png)
    out = seg_dir / "segment.mp4"
    frames = int(dur * FPS)
    run(["ffmpeg", "-y", "-loglevel", "error", "-loop", "1", "-i", str(png),
         "-f", "lavfi", "-t", f"{dur:.3f}", "-i", "anullsrc=r=48000:cl=stereo",
         "-filter_complex",
         f"[0:v]scale=3840:-1,zoompan=z='1+0.04*on/{frames}':x='iw/2-(iw/zoom/2)':"
         f"y='ih/2-(ih/zoom/2)':d={frames}:s={W}x{H}:fps={FPS}[v]",
         "-map", "[v]", "-map", "1:a", "-t", f"{dur:.3f}", *ENC, str(out)])
    return out, dur


def concat_with_xfades(segments, out):
    inputs, fg = [], []
    for p, _ in segments:
        inputs += ["-i", str(p)]
    offset = 0.0
    vlast, alast = "0:v", "0:a"
    for i in range(1, len(segments)):
        offset += segments[i - 1][1] - XFADE
        fg.append(f"[{vlast}][{i}:v]xfade=transition=fade:duration={XFADE}:"
                  f"offset={offset:.3f}[xv{i}]")
        fg.append(f"[{alast}][{i}:a]acrossfade=d={XFADE}:c1=tri:c2=tri[xa{i}]")
        vlast, alast = f"xv{i}", f"xa{i}"
    fg.append(f"[{vlast}]fade=t=in:st=0:d=0.6,"
              f"fade=t=out:st={offset + segments[-1][1] - 0.8:.3f}:d=0.8[vf]")
    run(["ffmpeg", "-y", "-loglevel", "error", "-stats", *inputs,
         "-filter_complex", ";".join(fg), "-map", "[vf]", "-map", f"[{alast}]",
         "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt",
         "yuv420p", "-movflags", "+faststart", "-c:a", "aac", "-b:a", "192k",
         str(out)])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--preview", action="store_true",
                    help="use placeholder narration where the real one is missing")
    ap.add_argument("--only", help="comma-separated slide numbers (skips final mux)")
    ap.add_argument("--out", default=str(OUT / "GCP_Compute_Engine_AR.mp4"))
    args = ap.parse_args()

    cfg = json.loads((ROOT / "narration" / "narration_ar.json").read_text())
    slides = cfg["slides"]
    total = len(slides)
    BUILD.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)

    base = background()
    nametag = BUILD / "nametag.png"
    render_nametag(cfg["instructor_name"], cfg["instructor_role"]).save(nametag)
    mask = BUILD / "pip_mask.png"
    render_pip_mask().save(mask)

    only = {int(x) for x in args.only.split(",")} if args.only else None
    segments = []
    if not only:
        intro = render_card(cfg["course_title"], cfg["course_subtitle"],
                            cfg["instructor_name"], cfg["instructor_role"],
                            WORK / "src" / "instructor.jpg", "intro")
        segments.append(render_card_segment("intro", intro, 4.0))
    for i, meta in enumerate(slides):
        n = meta["id"]
        if only and n not in only:
            continue
        nxt = slides[i + 1]["section"] if i + 1 < total else cfg["outro_title"]
        seg = render_slide_segment(n, total, meta, cfg["course_title"], base,
                                   nametag, mask, args.preview, nxt)
        print(f"slide {n:02d}: {seg[1]:.1f}s")
        segments.append(seg)
    if only:
        return
    outro = render_card(cfg["course_title"],
                        (cfg["outro_title"], cfg["outro_subtitle"]),
                        cfg["instructor_name"], cfg["instructor_role"],
                        WORK / "src" / "instructor.jpg", "outro")
    segments.append(render_card_segment("outro", outro, 5.0))
    concat_with_xfades(segments, Path(args.out))
    total_s = sum(d for _, d in segments) - XFADE * (len(segments) - 1)
    print(f"wrote {args.out} ({total_s / 60:.1f} min)")


if __name__ == "__main__":
    main()
