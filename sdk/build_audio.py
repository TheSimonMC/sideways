"""Assemble the standalone audio entry point from its editable modules."""
from pathlib import Path
import argparse
import hashlib
import json

ROOT = Path(__file__).resolve().parent
MODULES = ('header.js', 'runtime.js', 'pre.js', 'layer.js', 'listener.js', 'sources.js', 'processor.js', 'driver.js')

def assembled():
    return ''.join((ROOT / 'src/audio' / name).read_text(encoding='utf-8') for name in MODULES)

def build():
    content = assembled()
    target = ROOT / 'src/audio.js'
    # SDK packaging also calls this builder. Leave an already current runtime
    # untouched so concurrent read-only validation cannot observe a partial
    # rewrite of identical source bytes.
    if not target.exists() or target.read_text(encoding='utf-8') != content:
        target.write_text(content, encoding='utf-8')
    return content

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    content = assembled()
    target = ROOT / 'src/audio.js'
    if args.check:
        if target.read_text(encoding='utf-8') != content:
            raise SystemExit('src/audio.js is stale; run python3 build_audio.py')
    else:
        build()
    print(json.dumps({'audioModules': len(MODULES), 'bytes': len(content.encode()), 'sha256': hashlib.sha256(content.encode()).hexdigest(), 'checked': args.check}))

if __name__ == '__main__':
    main()
