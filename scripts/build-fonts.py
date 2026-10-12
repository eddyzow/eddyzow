"""One-time font prep. Pins the site's exact Fraunces/Geist settings into static
instances, subsets them to Latin, and writes fonts/*.woff + fonts/metrics.json
(advance widths, so render.mjs can wrap and align text without a browser).

  python3 scripts/build-fonts.py <dir with the google/fonts variable TTFs>
"""
import json
import sys
from pathlib import Path

from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.subset import Subsetter, Options

SRC = Path(sys.argv[1])
OUT = Path(__file__).resolve().parent.parent / "fonts"

# Same axes as docs/style.css on eddyzow.net (.home-title and its <em>).
FONTS = {
    "serif": ("Fraunces.ttf", {"opsz": 144, "wght": 330, "SOFT": 0, "WONK": 1}),
    "italic": ("Fraunces-Italic.ttf", {"opsz": 144, "wght": 400, "SOFT": 100, "WONK": 1}),
    "sans": ("Geist.ttf", {"wght": 400}),
    "mono": ("GeistMono.ttf", {"wght": 500}),
}
UNICODES = [
    *range(0x20, 0x7F), *range(0xA0, 0x100),
    0x2013, 0x2014, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2026,
    *range(0x2190, 0x2194), 0x2197, 0x2605, 0x25CF,
]

OUT.mkdir(exist_ok=True)
metrics = {}
for name, (file, axes) in FONTS.items():
    font = instantiateVariableFont(TTFont(SRC / file), axes)
    opts = Options()
    opts.layout_features = ["kern", "tnum", "lnum"]
    opts.flavor = "woff"  # woff2 needs brotli; zlib woff is fine at this size
    sub = Subsetter(opts)
    sub.populate(unicodes=UNICODES)
    sub.subset(font)
    font.flavor = "woff"
    font.save(OUT / f"{name}.woff")

    cmap, hmtx = font.getBestCmap(), font["hmtx"]
    zero = cmap[ord("0")]
    tnum = hmtx[zero][0]
    # tabular figure width, so odometer digits line up
    if "GSUB" in font:
        table = font["GSUB"].table
        for fr in table.FeatureList.FeatureRecord:
            if fr.FeatureTag != "tnum":
                continue
            for li in fr.Feature.LookupListIndex:
                for st in table.LookupList.Lookup[li].SubTable:
                    mapping = getattr(st, "mapping", None) or {}
                    if zero in mapping:
                        tnum = hmtx[mapping[zero]][0]
    metrics[name] = {
        "upm": font["head"].unitsPerEm,
        "tnum": tnum,
        "adv": {chr(cp): hmtx[g][0] for cp, g in cmap.items()},
    }

(OUT / "metrics.json").write_text(json.dumps(metrics, separators=(",", ":")))
for f in sorted(OUT.iterdir()):
    print(f.name, f.stat().st_size)
