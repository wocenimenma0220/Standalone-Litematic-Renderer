"""Observer arrows must point toward the output, opposite vanilla FACING.

Tests actual generated sprite pixels; logical state-only tests cannot catch
UV mirroring that makes a correctly simulated clock look back-to-front.
"""
import json
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[2] / 'webapp/renderer'
catalog = json.loads((root / 'board-catalog.js').read_text(encoding='utf8').split('window.BoardCatalog = ', 1)[1].strip().rstrip(';'))
observer = next(b for b in catalog if b['id'] == 'observer')
atlas = Image.open(root / 'board-atlas.png').convert('RGBA')

def arrow_centroid(facing, view):
    v = next(v for v in observer['visuals'] if v['when'] == {'facing': facing, 'powered': 'false'})
    index = v[view]
    image = atlas.crop((index % 64 * 32, index // 64 * 32, index % 64 * 32 + 32, index // 64 * 32 + 32))
    ink = [(x, y) for y in range(7, 25) for x in range(7, 25)
           if image.getpixel((x, y))[3] >= 128 and sum(image.getpixel((x, y))[:3]) < 150]
    assert len(ink) >= 20, (facing, view, 'arrow must be visible')
    return tuple(sum(p[k] for p in ink) / len(ink) for k in (0, 1))

# An arrow's wide tail carries more ink than its tip: a left-pointing arrow
# has its centroid right of center, and vice versa (similarly for up/down).
for view, directions in [('sprite', {'east': (0, 1), 'west': (0, -1), 'up': (1, -1), 'down': (1, 1)}),
                         ('top', {'east': (0, 1), 'west': (0, -1), 'north': (1, -1), 'south': (1, 1)})]:
    for facing, (axis, sign) in directions.items():
        centroid = arrow_centroid(facing, view)
        assert (centroid[axis] - 15.5) * sign > 0.1, (view, facing, centroid, 'arrow must point opposite detection face')
print('PASS: actual side/top observer arrows point opposite detection faces in all planar directions')
