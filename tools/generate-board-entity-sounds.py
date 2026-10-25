"""从本机原版资源缓存生成二维实体音效，不进行网络下载。"""
import argparse
import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--cache', type=Path, default=Path.home()/'.gradle/caches/fabric-loom/assets')
parser.add_argument('--index', default='26.3-34')
args = parser.parse_args()
objects = json.loads((args.cache/'indexes'/f'{args.index}.json').read_text())['objects']

def asset(name):
    entry = objects['minecraft/'+name]
    source = args.cache/'objects'/entry['hash'][:2]/entry['hash']
    data = source.read_bytes()
    if hashlib.sha1(data).hexdigest() != entry['hash']:
        raise ValueError('资源校验失败：'+name)
    return data

events = json.loads(asset('sounds.json'))
output = root/'webapp/renderer'
manifest = {}
for key, event in [('tnt_primed', 'entity.tnt.primed'), ('explosion', 'entity.generic.explode')]:
    samples = []
    for value in events[event]['sounds']:
        entry = {'name':value} if isinstance(value,str) else value
        relative = 'sounds/'+entry['name'].removeprefix('minecraft:')+'.ogg'
        target = output/'board-audio'/relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(asset(relative))
        samples.append({'file':'board-audio/'+relative,'volume':entry.get('volume',1),'pitch':entry.get('pitch',1),'weight':entry.get('weight',1)})
    manifest[key] = {'event':event,'volume':.8,'pitch':1,'samples':samples}
(output/'board-entity-sounds.js').write_text("'use strict';\n// 从原版 26.3 资源缓存导出的实体音效。\n(function(root){const data="+json.dumps(manifest,separators=(',',':'))+";if(typeof module!=='undefined')module.exports=data;else root.BoardEntitySounds=data;})(typeof window!=='undefined'?window:globalThis);\n",encoding='utf-8')
print('已导出 TNT 点燃和爆炸音效')
