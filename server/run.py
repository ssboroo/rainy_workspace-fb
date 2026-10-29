"""Load a local .env without executing shell code, then run the server.
Production platforms can supply environment variables directly.
"""
import os, runpy
from pathlib import Path
config=Path(__file__).with_name('.env')
if config.exists():
    for line in config.read_text(encoding='utf-8').splitlines():
        line=line.strip()
        if not line or line.startswith('#') or '=' not in line:continue
        key,value=line.split('=',1);key=key.strip();value=value.strip()
        if len(value)>=2 and value[0]==value[-1] and value[0] in "\"'":value=value[1:-1]
        if key.replace('_','').isalnum():os.environ.setdefault(key,value)
runpy.run_path(str(Path(__file__).with_name('app.py')),run_name='__main__')
