"""MapLibre/WebGL plus interrupted-playback regressions; synthetic API/GPS only."""
import os
import subprocess
import sys
from pathlib import Path

folder = Path(__file__).parent
original_cases = [
    'BrowserTests.test_map_card_and_seek_while_playing',
    'BrowserTests.test_social_navigation_and_settings',
    'BrowserTests.test_stories_mute_selection_and_unread',
    'BrowserTests.test_compact_controls_at_mobile_widths',
    'BrowserTests.test_obscured_card_is_not_marked_read',
    'BrowserTests.test_self_shared_url_stays_public_only','BrowserTests.test_play_during_profile_bootstrap',
    'BrowserTests.test_a_records_pin_is_grabbable_only_while_editing_that_record',
    'BrowserTests.test_dragging_the_pin_updates_the_coordinate_fields',
    'BrowserTests.test_confirming_from_the_map_saves_without_reopening_the_panel',
]
checks = [
    ('browser-smoke.py', original_cases, '1'),
    ('browser-playback-lifecycle.py', [], '0'),
    ('browser-playback-lifecycle.py', [], '1'),
]
failed = False
for script, cases, real_map in checks:
    result = subprocess.run([sys.executable, str(folder / script), *cases],
                            env={**os.environ, 'TRAVELMAP_REAL_MAP': real_map})
    failed |= result.returncode != 0
raise SystemExit(1 if failed else 0)
