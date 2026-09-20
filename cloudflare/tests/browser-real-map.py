"""Same regression against real MapLibre/WebGL with blank style and synthetic API/GPS."""
import os,subprocess,sys
from pathlib import Path
script=Path(__file__).with_name('browser-smoke.py')
raise SystemExit(subprocess.run([sys.executable,str(script),'BrowserTests.test_map_card_and_seek_while_playing'],env={**os.environ,'TRAVELMAP_REAL_MAP':'1'}).returncode)
