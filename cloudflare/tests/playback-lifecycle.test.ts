import {test} from 'node:test';
import assert from 'node:assert/strict';
import {makeViewerState} from '../public/viewer-state.js';
import {makePlaybackController} from '../public/playback-controller.js';

function setup({slow = false} = {}) {
  const doc = Object.assign(new EventTarget(), {hidden: false});
  Object.defineProperty(globalThis, 'document', {value: doc, configurable: true});
  const state = makeViewerState({self: 'me'});
  state.replaceFeed({self: 'me', muted: [], entries: [
    {id: 'a1', author: 'a', date: '2026-09-20', publication_seq: 1, unread: true},
    {id: 'b1', author: 'b', date: '2026-09-20', publication_seq: 2, unread: true}
  ]});
  const loads: any[] = [], releases: (() => void)[] = [], reads: any[] = [];
  let pauses = 0;
  const controller = makePlaybackController({state,
    player: {finish() {}, pause() {pauses++;}, load(data: any, options: any) {loads.push({data, options});}},
    refresh: async () => true,
    loadGroup: (group: any) => slow ? new Promise(resolve => releases.push(() => resolve(group))) : Promise.resolve(group),
    markRead: async (step: any) => {reads.push(step);}, notify() {}, choose: async () => null
  });
  return {controller, doc, state, loads, reads, releases, pauses: () => pauses};
}

test('hidden during a pending group load invalidates even an abort-ignoring loader', async () => {
  const h = setup({slow: true});
  try {
    const pending = h.controller.play(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.releases.length, 2);
    h.doc.hidden = true; h.doc.dispatchEvent(new Event('visibilitychange'));
    h.doc.hidden = false; h.doc.dispatchEvent(new Event('visibilitychange'));
    h.releases.forEach(release => release()); await pending;
    assert.equal(h.loads.length, 0);
  } finally {h.controller.destroy();}
});

test('suspending an active queue pauses without losing the next author', async () => {
  const h = setup();
  try {
    await h.controller.play();
    h.doc.hidden = true; h.doc.dispatchEvent(new Event('visibilitychange'));
    assert.equal(h.pauses(), 1); assert.equal(h.controller.state().total, 2);
    h.doc.hidden = false; h.doc.dispatchEvent(new Event('visibilitychange'));
    assert.equal(h.loads.length, 1, 'returning must not auto-resume');
    h.loads[0].options.onComplete(); assert.equal(h.loads[1].data.user.handle, 'b');
  } finally {h.controller.destroy();}
});

test('suspend cancels a pending replay requested before settings opened', async () => {
  const h = setup({slow: true});
  try {
    const pending = h.controller.play(); await new Promise(resolve => setImmediate(resolve));
    h.controller.suspend(); h.releases.forEach(release => release()); await pending;
    assert.equal(h.loads.length, 0); assert.equal(h.controller.state().total, 0);
  } finally {h.controller.destroy();}
});

test('read callback from an invalidated playback cannot acknowledge a later view', async () => {
  const h = setup();
  try {
    await h.controller.play(); const old = h.loads[0].options.onSeen;
    h.controller.stop(); await old({publicEntryId: 'a1'});
    assert.equal(h.reads.length, 0);
  } finally {h.controller.destroy();}
});

test('play requested while hidden performs no load and keeps no queue', async () => {
  const h = setup();
  try {
    h.doc.hidden = true; await h.controller.play();
    assert.equal(h.loads.length, 0); assert.equal(h.controller.state().total, 0);
  } finally {h.controller.destroy();}
});
