"""从本地客户端源码恢复调试棒的属性和值顺序，复用已有目录，不重新生成图片。"""


import json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
source=(ROOT/'tools/generate-board-catalog.py').read_text(encoding='utf-8').split('catalog = []',1)[0]
source=source.replace("if name == 'Direction': return ['north','east','south','west','up','down']", "if name == 'Direction': return ['down','up','north','south','west','east']")
context={'__file__':str(ROOT/'tools/generate-board-catalog.py')}
exec(source,context)
text=(ROOT/'webapp/renderer/board-catalog.js').read_text(encoding='utf-8')
catalog=json.loads(text.split('window.BoardCatalog = ',1)[1].strip().removesuffix(';'))
orders={}
for block in catalog:
    declared=context['declared_properties'](context['source_for'](block['id']))
    orders[block['id']]={k:(['true','false'] if set(values)=={'false','true'} else declared.get(k,values)) for k,values in sorted(block['properties'].items())}
(ROOT/'webapp/renderer/debug-stick-properties.js').write_text('/* 按原版 StateDefinition 顺序生成，工具为 generate-debug-stick-properties.py。 */\nwindow.DebugStickProperties='+json.dumps(orders,ensure_ascii=False,separators=(',',':'))+';\n',encoding='utf-8')
