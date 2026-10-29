"""Rebuild the SIDEWAYS emitter extension. The original SDK remains in sdk-originale/."""
from pathlib import Path
import hashlib
import json
from build_audio import build

ROOT = Path(__file__).resolve().parent
build()
header = '/* MotorLab game SDK 1.6.3 + SIDEWAYS spatial-emitter extension; physics unchanged. */\n'
source = '\n\n'.join((ROOT/'src'/name).read_text(encoding='utf-8') for name in ('core.js','vehicle.js','audio.js','game-api.js'))
variants = {
    'motor-engine.mjs': header + source + '\n\nexport {MotorLab, EngineCore, VehicleCore, SimulationDriver};\nexport default MotorLab;\n',
    'motor-engine.js': header + "(function () {\n'use strict';\n" + source + "\n\nif (Object.prototype.hasOwnProperty.call(globalThis, 'MotorLab')) throw new Error('MotorLab ist bereits geladen.');\nglobalThis.MotorLab = MotorLab;\n})();\n",
    'motor-engine.cjs': header + "module.exports = (function () {\n'use strict';\n" + source + '\n\nreturn MotorLab;\n})();\n'
}
for name,content in variants.items():
    (ROOT/name).write_text(content,encoding='utf-8')
(ROOT.parent/'dist/vendor/motor-engine.js').write_text(variants['motor-engine.js'],encoding='utf-8')
manifest=json.loads((ROOT/'SOURCES.json').read_text(encoding='utf-8'))
manifest['integrationExtension']='SIDEWAYS V12 explicit emitter scene; base physics and SDK version unchanged'
manifest['testReportStatus']='Original qa report is historical. See ../qa/audio-v12-results.json for extension validation.'
for group in ['sourceSHA256','audioModuleSHA256','generatedSHA256']:
    for name in manifest.get(group,{}):
        path=ROOT/('src/'+name if group=='sourceSHA256' else name)
        manifest[group][name]=hashlib.sha256(path.read_bytes()).hexdigest()
(ROOT/'SOURCES.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'extension':'SIDEWAYS V12 emitter scene','bundles':list(variants)}))
