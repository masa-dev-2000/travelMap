"""Playback interruption and locationless cards against the real application.
Uses the existing controlled API/GPS harness. Not an iPhone/live GPS test.
"""
import importlib.util
import sys
import unittest
from pathlib import Path
from playwright.sync_api import expect

spec = importlib.util.spec_from_file_location('playback_browser_base', Path(__file__).with_name('browser-smoke.py'))
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)

class PlaybackLifecycleTests(base.BrowserTests):
    def start_pending_playback(self):
        p = self.page
        p.goto(self.origin + '/')
        expect(p.locator('.auto-location')).to_be_visible()
        # Hold loadGroup after the real feed reload; deliberately ignore abort to
        # prove generation invalidation, rather than relying on fetch cancellation.
        p.evaluate('''() => {
          const original = __tm.everyone.groupData;
          window.__pendingGroups = [];
          __tm.everyone.groupData = group => new Promise(resolve => {
            __pendingGroups.push(() => resolve(original(group)));
          });
          window.__pendingPlay = __tm.playback.play();
        }''')
        p.wait_for_function('window.__pendingGroups.length > 0')

    def release_pending_playback(self):
        self.page.evaluate('''async () => {
          for (const release of __pendingGroups) release();
          await __pendingPlay;
        }''')
        self.assertFalse(self.page.evaluate('__tm.player.active()'))
        self.assertEqual(self.read_posts, [])

    def test_pending_playback_cannot_replace_profile(self):
        self.start_pending_playback()
        self.page.get_by_role('button', name='プロフィール', exact=True).click()
        self.release_pending_playback()
        expect(self.page.locator('#view-profile')).to_be_visible()

    def test_pending_playback_cannot_start_under_settings(self):
        self.start_pending_playback()
        self.page.get_by_role('button', name='設定', exact=True).click()
        self.release_pending_playback()
        expect(self.page.locator('#settings-dialog')).to_be_visible()
        self.page.get_by_role('button', name='設定を閉じる', exact=True).click()
        self.assertFalse(self.page.evaluate('__tm.player.active()'))

    def test_pending_playback_does_not_start_after_tab_return(self):
        self.start_pending_playback()
        p = self.page
        p.evaluate("Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'))")
        self.release_pending_playback()
        p.evaluate("Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});document.dispatchEvent(new Event('visibilitychange'))")
        p.wait_for_timeout(600)
        self.assertFalse(p.evaluate('__tm.player.active()'))
        self.assertEqual(self.read_posts, [])

    def test_locationless_card_never_uses_another_records_pin(self):
        # A later located record must not put its pin on an earlier unlocated one.
        self.public_entries[1]['latitude'] = None
        self.public_entries[1]['longitude'] = None
        p = self.page
        p.goto(self.origin + '/')
        expect(p.locator('.auto-location')).to_be_visible()
        p.locator('.story-person[data-handle="friend"]').click()
        p.locator('.replay-play').click()
        p.wait_for_function('__tm.player.active()')
        p.locator('.replay-play').click()
        expect(p.locator('.tm-locationless-card')).to_be_visible()
        expect(p.locator('.story-pin')).to_have_count(0)
        # A real location gets its own pin, then scrubbing back removes it again.
        p.locator('.replay-progress').evaluate("e=>{e.value=e.max;e.dispatchEvent(new Event('input',{bubbles:true}));}")
        expect(p.locator('.story-pin')).to_have_count(1)
        expect(p.locator('.tm-record-card h2')).to_have_text('public-two')
        p.locator('.replay-progress').evaluate("e=>{e.value=0;e.dispatchEvent(new Event('input',{bubbles:true}));}")
        expect(p.locator('.story-pin')).to_have_count(0)
        expect(p.locator('.tm-locationless-card')).to_be_visible()

if __name__ == '__main__':
    names = [name for name in PlaybackLifecycleTests.__dict__ if name.startswith('test_')]
    suite = unittest.TestSuite(PlaybackLifecycleTests(name) for name in names)
    sys.exit(not unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful())
