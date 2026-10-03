"""Export the picture behind every slide of a .pptx, in presentation order.

The source deck stores each slide as one full-bleed PNG, so the media file a
slide references *is* the slide. Output: slide01.png, slide02.png, ...
"""
import re
import sys
import zipfile
from pathlib import Path


def main(deck: str, out_dir: str) -> None:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(deck) as z:
        pres = z.read("ppt/presentation.xml").decode()
        rels = z.read("ppt/_rels/presentation.xml.rels").decode()
        rid_to_slide = {}
        for rel in re.findall(r"<Relationship [^>]*/>", rels):
            rid = re.search(r'Id="([^"]+)"', rel).group(1)
            target = re.search(r'Target="([^"]+)"', rel).group(1)
            if target.startswith("slides/"):
                rid_to_slide[rid] = target
        order = re.findall(r'<p:sldId [^>]*r:id="([^"]+)"', pres)
        for n, rid in enumerate(order, 1):
            slide = rid_to_slide[rid]
            srels = z.read(f"ppt/slides/_rels/{Path(slide).name}.rels").decode()
            media = re.search(r'Target="\.\./(media/[^"]+)"', srels).group(1)
            dest = out / f"slide{n:02d}{Path(media).suffix}"
            dest.write_bytes(z.read(f"ppt/{media}"))
            print(f"{dest.name} <- {media}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
