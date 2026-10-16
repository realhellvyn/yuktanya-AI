from pathlib import Path
import json, hashlib, sys
root=Path(__file__).resolve().parents[1]
manifest=json.loads((root/'PACKAGE_MANIFEST.json').read_text(encoding='utf-8'))
errors=[]
for item in manifest['files']:
    p=root/item['path']
    if not p.is_file() or hashlib.sha256(p.read_bytes()).hexdigest()!=item['sha256']:
        errors.append(item['path'])
if errors:
    print('FAIL: missing/changed files: '+', '.join(errors)); sys.exit(1)
print('PASS: '+str(len(manifest['files']))+' packaged files match SHA-256 manifest.')
print('Scope: blueprint integrity only; no app, legal, integration or E2E tests executed.')
