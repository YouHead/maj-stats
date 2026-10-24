import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { OfficialSession } from '../src/electron-session.mjs';

const replayUrl = 'https://game.maj-soul.com/1/?paipu=261018-11111111-2222-3333-4444-555555555555';
function fixture() {
  const windows = [];
  class Window extends EventEmitter {
    constructor(options) {
      super(); windows.push(this); this.options = options; this.visible = options.show; this.minimized = false;
      this.calls = []; this.loads = []; this.url = ''; this.statusResult = null;
      const debug = new EventEmitter(); debug.attach = () => {}; debug.commands = [];
      debug.sendCommand = async (method, parameters, sessionId) => {
        debug.commands.push({ method, parameters, sessionId });
        return method === 'Runtime.evaluate' && parameters.returnByValue ? { result: { value: this.statusResult } } : {};
      };
      this.webContents = Object.assign(new EventEmitter(), {
        debugger: debug, setAudioMuted: (value) => { this.muted = value; }, isAudioMuted: () => this.muted,
        getURL: () => this.url, isLoading: () => false, setWindowOpenHandler: () => {},
        session: { setPermissionRequestHandler: () => {}, clearStorageData: async () => { this.cleared = true; } },
      });
    }
    async loadURL(url) { this.url = url; this.loads.push(url); }
    isDestroyed() { return Boolean(this.destroyed); }
    isVisible() { return this.visible; }
    isMinimized() { return this.minimized; }
    getTitle() { return 'Official fixture'; }
    showInactive() { this.calls.push('showInactive'); this.visible = true; }
    minimize() { this.calls.push('minimize'); this.minimized = true; }
    restore() { this.calls.push('restore'); this.minimized = false; }
    setOpacity(value) { this.opacity = value; }
    setIgnoreMouseEvents(value) { this.ignoresMouse = value; }
    setSkipTaskbar(value) { this.skipTaskbar = value; }
    show() { this.calls.push('show'); this.visible = true; }
    focus() { this.calls.push('focus'); }
    hide() { this.calls.push('hide'); this.visible = false; }
    destroy() { this.destroyed = true; this.emit('closed'); }
  }
  return { session: new OfficialSession(Window), windows };
}

test('background startup never focuses the official client and hides after login restoration', async () => {
  const { session, windows } = fixture();
  await session.open({ show: false });
  const window = windows[0];
  assert.equal(window.options.show, false); assert.equal(window.options.webPreferences.focusOnNavigation, false);
  assert.equal(window.options.webPreferences.backgroundThrottling, false);
  assert.deepEqual(window.calls, ['showInactive']);
  assert.equal(window.opacity, 0); assert.equal(window.ignoresMouse, true); assert.equal(window.skipTaskbar, true);
  assert.equal(session.status().audioMuted, true);
  window.statusResult = { ready: true, sockets: 1, nickname: 'Fixture' };
  await session.poll();
  assert.equal(session.status().ready, true); assert.equal(session.status().diagnostics.visible, false);
  assert.ok(!window.calls.includes('focus'));
});

test('replays reuse the same official window and session and remain visible after reconnecting', async () => {
  const { session, windows } = fixture();
  await session.open({ show: false });
  const window = windows[0], partition = window.options.webPreferences.partition;
  session.current.ready = true; session.activeContext = { contextId: 123 }; window.minimized = true;
  await session.openReplay(replayUrl);
  assert.equal(windows.length, 1); assert.equal(window.options.webPreferences.partition, partition);
  assert.equal(window.loads.at(-1), replayUrl); assert.equal(session.current.ready, false); assert.equal(session.activeContext, null);
  assert.equal(window.minimized, false); assert.ok(window.calls.includes('restore')); assert.ok(window.calls.includes('focus'));
  assert.equal(window.opacity, 1); assert.equal(window.ignoresMouse, false); assert.equal(window.skipTaskbar, false);
  window.statusResult = { ready: true, sockets: 1, nickname: 'Fixture' };
  await session.poll();
  assert.equal(session.status().ready, true); assert.equal(session.status().diagnostics.visible, true);
  assert.equal(session.status().diagnostics.replayId, new URL(replayUrl).searchParams.get('paipu'));
  const loads = window.loads.length; await session.openReplay(replayUrl); assert.equal(window.loads.length, loads);
  const close = { preventDefault() { this.prevented = true; } }; window.emit('close', close);
  assert.equal(close.prevented, true); assert.equal(window.visible, false); assert.equal(window.destroyed, undefined);
});

test('invalid replay destinations do not open a window, and a stale poll cannot restore old page state', async () => {
  const { session, windows } = fixture();
  await assert.rejects(session.openReplay('https://example.com/1/?paipu=261018-11111111-2222-3333-4444-555555555555'), /牌谱链接/);
  await assert.rejects(session.openReplay('https://game.maj-soul.com/1/?paipu=../../settings'), /牌谱链接/);
  assert.equal(windows.length, 0);
  await session.open({ show: false });
  let finish;
  session.evaluate = () => new Promise((resolve) => { finish = resolve; });
  const pending = session.poll();
  await session.openReplay(replayUrl);
  finish({ ready: true, sockets: 1, nickname: 'Old context' }); await pending;
  assert.equal(session.current.ready, false); assert.equal(session.current.phase, 'loading-replay');
});

test('explicit login opens the background window and replay load failures reach the caller', async () => {
  const { session, windows } = fixture();
  await session.open({ show: false }); await session.open();
  assert.equal(windows.length, 1); assert.equal(windows[0].visible, true);
  assert.equal(windows[0].minimized, false); assert.equal(session.hideAfterLogin, true);
  windows[0].loadURL = async () => { throw new Error('Fixture navigation failed'); };
  await assert.rejects(session.openReplay(replayUrl), /navigation failed/);
  assert.equal(session.current.ready, false);
  await session.logout(); assert.equal(windows[0].cleared, true); assert.equal(session.window, null);
});

test('service workers are excluded from startup suspension and an unexpected cache worker resumes without injection', async () => {
  const { session, windows } = fixture();
  await session.open({ show: false });
  const debug = windows[0].webContents.debugger;
  const filter = debug.commands.find(({ method }) => method === 'Target.setAutoAttach').parameters.filter;
  const isIncluded = (type) => !filter.find((entry) => !entry.type || entry.type === type)?.exclude;
  assert.equal(isIncluded('service_worker'), false);
  assert.equal(isIncluded('shared_worker'), false);
  assert.equal(isIncluded('worker'), true);
  assert.equal(isIncluded('iframe'), true);
  const originalSend = debug.sendCommand;
  debug.sendCommand = (method, parameters, sessionId) => {
    if (sessionId === 'cache-worker' && method === 'Runtime.enable') return new Promise(() => {});
    return originalSend(method, parameters, sessionId);
  };
  debug.emit('message', {}, 'Target.attachedToTarget', { sessionId: 'cache-worker', targetInfo: { type: 'service_worker' } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(debug.commands.filter(({ sessionId }) => sessionId === 'cache-worker').map(({ method }) => method), ['Runtime.runIfWaitingForDebugger']);
});

test('Unity workers and frames still receive the bridge before resuming, including injection failures', async () => {
  for (const type of ['worker', 'iframe']) {
    const { session, windows } = fixture();
    await session.open({ show: false });
    const debug = windows[0].webContents.debugger;
    debug.emit('message', {}, 'Target.attachedToTarget', { sessionId: 'game-context', targetInfo: { type } });
    await new Promise((resolve) => setImmediate(resolve));
    const commands = debug.commands.filter(({ sessionId }) => sessionId === 'game-context');
    assert.equal(commands[0].method, 'Runtime.enable');
    assert.equal(commands[1].method, 'Runtime.evaluate');
    assert.match(commands[1].parameters.expression, /__majStatsSession/);
    assert.equal(commands.at(-1).method, 'Runtime.runIfWaitingForDebugger');
    assert.equal(commands.some(({ method }) => method === 'Page.addScriptToEvaluateOnNewDocument'), type === 'iframe');
    const originalSend = debug.sendCommand;
    debug.sendCommand = (method, parameters, sessionId) => sessionId === 'failed-worker' && method === 'Runtime.evaluate'
      ? Promise.reject(new Error('Context replaced')) : originalSend(method, parameters, sessionId);
    debug.emit('message', {}, 'Target.attachedToTarget', { sessionId: 'failed-worker', targetInfo: { type } });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(debug.commands.filter(({ sessionId }) => sessionId === 'failed-worker').at(-1).method, 'Runtime.runIfWaitingForDebugger');
  }
});
