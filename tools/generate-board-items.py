"""Copy original item layers used by the offline 2D inventory palette."""
import json
import subprocess
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT.parents[1] / '26.3-client-src/assets/minecraft'
OUT = ROOT / 'webapp/renderer/board-items'
items = json.loads(subprocess.check_output(['node', '-e', "console.log(JSON.stringify(require('./webapp/renderer/board-world-features.js').extraItems))"], cwd=ROOT, encoding='utf-8'))
OUT.mkdir(parents=True, exist_ok=True)

def model(name, seen=()):
    name = name.removeprefix('minecraft:')
    if name in seen or name in ['item/generated', 'builtin/generated', 'item/handheld']:
        return {}
    path = ASSETS / ('models/' + name + '.json')
    if not path.is_file():
        return {}
    data = json.loads(path.read_text())
    return {**model(data.get('parent', 'builtin/generated'), (*seen, name)), **data.get('textures', {})}

for item in items:
    data = json.loads((ASSETS / ('items/' + item['id'] + '.json')).read_text())['model']
    while 'model' not in data:
        data = data.get('fallback') or data.get('on_false') or data.get('cases', [{}])[0].get('model', {})
        if not data:
            raise RuntimeError('No original item model: ' + item['id'])
    textures = model(data['model'])
    canvas = Image.new('RGBA', (32, 32))
    for layer, texture in sorted(textures.items()):
        if not layer.startswith('layer'):
            continue
        while texture.startswith('#'):
            texture = textures[texture[1:]]
        source = Image.open(ASSETS / ('textures/' + texture.removeprefix('minecraft:') + '.png')).convert('RGBA')
        source = source.crop((0, 0, source.width, source.width))
        index = int(layer[5:])
        tints = data.get('tints', [])
        if index < len(tints) and 'default' in tints[index]:
            color = tints[index]['default'] & 0xffffff
            rgb = [(color >> shift) & 255 for shift in [16, 8, 0]]
            channels = list(source.split())
            for i in range(3):
                channels[i] = channels[i].point(lambda v, c=rgb[i]: v*c//255)
            source = Image.merge('RGBA', channels)
        canvas.alpha_composite(source.resize((32, 32), Image.Resampling.NEAREST))
    if not canvas.getbbox():
        raise RuntimeError('Empty original item icon: ' + item['id'])
    canvas.save(OUT / (item['id'] + '.png'))
print(f'{len(items)} original inventory item icons exported')
