"""
Cuts the short logo (icon) out of the customer's Illustrator logo sheets, as small SVG files.

    pdftocairo -svg Wed-x-all-logos.pdf Wed.svg        # vector copy of each sheet first
    python3 -I make-logo-icons.py list Wed.svg         # every shape: number, colour, box
    python3 -I make-logo-icons.py build <sheets dir> <out dir>

`build` writes, per company, <code>-light.svg (dark ink + accent, for the light theme) and
<code>-dark.svg (white + accent, for the dark theme). The white version is made from the
coloured one (dark ink becomes white, the accent colour stays), as in the customer's colour
identity: "black + magenta / white + magenta".
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

PATH = re.compile(r'<path style="([^"]*)" d="([^"]*)"/>')
NUM = re.compile(r'-?\d+(?:\.\d+)?')


def shapes(svg: str):
    """(number, fill, style, d, box) for every filled shape of a pdftocairo SVG."""
    out = []
    for i, m in enumerate(PATH.finditer(svg)):
        style, d = m.group(1), m.group(2)
        fill = re.search(r'fill:([^;]+);', style)
        if not fill or fill.group(1).strip() == 'none' or 'stroke:none' not in style:
            continue  # outlines (the white versions drawn on paper) are skipped
        nums = [float(n) for n in NUM.findall(d)]
        xs, ys = nums[0::2], nums[1::2]
        out.append((i, fill.group(1).strip(), style, d, (min(xs), min(ys), max(xs), max(ys))))
    return out


def rgb(fill: str) -> tuple[float, float, float]:
    p = [float(v) for v in re.findall(r'([\d.]+)%', fill)]
    return (p[0], p[1], p[2]) if len(p) == 3 else (0.0, 0.0, 0.0)


def is_ink(fill: str) -> bool:
    """Black / dark brown, as opposed to the accent colour (magenta, neon green)."""
    r, g, b = rgb(fill)
    return max(r, g, b) < 35 and max(r, g, b) - min(r, g, b) < 15


def hexcolour(fill: str) -> str:
    return '#' + ''.join(f'{round(v * 2.55):02x}' for v in rgb(fill))


# Which shapes make each icon: a box on the sheet (points), minus shapes to leave out.
ICONS = {
    # The TwinFlame: the calligraphy mark and its magenta letter, without the WED·X lettering.
    'WEDX': {'sheet': 'Wed.svg', 'box': (90, 90, 300, 440), 'drop': 'lettering'},
    # The magenta triangle tucked into the X (first icon of the bottom row).
    'CONFX': {'sheet': 'Conf.svg', 'box': (70, 700, 182, 800)},
    # The neon-green triangle tucked into the dark-brown X (first icon of the bottom row).
    'DEALX': {'sheet': 'Deal.svg', 'box': (70, 660, 184, 765)},
}


def inside(box, area):
    return box[0] >= area[0] and box[1] >= area[1] and box[2] <= area[2] and box[3] <= area[3]


def pick(sheet: str, spec: dict):
    chosen = [s for s in shapes(sheet) if inside(s[4], spec['box'])]
    if spec.get('drop') == 'lettering':
        # The lettering is the row of small shapes under the flame; the flame's long strokes cross it.
        top = min(s[4][1] for s in chosen)
        bottom = max(s[4][3] for s in chosen)
        row = top + (bottom - top) * 0.82
        chosen = [s for s in chosen if not (s[4][1] >= row - 2 and (s[4][3] - s[4][1]) < (bottom - top) * 0.2)]
    return chosen


def write(chosen, out: Path, white: bool, pad: float = 2.0):
    x0 = min(s[4][0] for s in chosen) - pad
    y0 = min(s[4][1] for s in chosen) - pad
    x1 = max(s[4][2] for s in chosen) + pad
    y1 = max(s[4][3] for s in chosen) + pad
    body = []
    for _, fill, _, d, _ in chosen:
        colour = '#ffffff' if white and is_ink(fill) else hexcolour(fill)
        body.append(f'<path fill="{colour}" d="{d}"/>')
    w, h = x1 - x0, y1 - y0
    out.write_text(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{x0:.2f} {y0:.2f} {w:.2f} {h:.2f}" '
        f'width="{w:.1f}" height="{h:.1f}">' + ''.join(body) + '</svg>\n')


if __name__ == '__main__':
    if sys.argv[1] == 'list':
        for i, fill, _, _, box in shapes(Path(sys.argv[2]).read_text()):
            print(i, hexcolour(fill), 'ink' if is_ink(fill) else 'accent', [round(v) for v in box])
    else:
        sheets, out = Path(sys.argv[2]), Path(sys.argv[3])
        out.mkdir(parents=True, exist_ok=True)
        for code, spec in ICONS.items():
            chosen = pick((sheets / spec['sheet']).read_text(), spec)
            write(chosen, out / f'{code}-light.svg', white=False)
            write(chosen, out / f'{code}-dark.svg', white=True)
            print(code, len(chosen), 'shapes')
