import { readFile } from 'node:fs/promises';

export class OfficialSession {
  constructor(BrowserWindow) {
    this.BrowserWindow = BrowserWindow;
    this.window = null;
    this.current = { ready: false, phase: 'signed-out', nickname: '', sockets: 0 };
    this.opening = null;
    this.quitting = false;
    this.contexts = new Map();
    this.activeContext = null;
    this.networkSockets = new Set();
    this.hideAfterLogin = true;
    this.pageGeneration = 0;
  }
  status() {
    let pageHost = '';
    let replayId = '';
    try { const url = new URL(this.window?.webContents.getURL()); pageHost = url.hostname; replayId = url.searchParams.get('paipu') || ''; } catch (_) {}
    return { ...this.current, audioMuted: Boolean(this.window && !this.window.isDestroyed() && this.window.webContents.isAudioMuted()), diagnostics: {
      contextCount: this.contexts.size, networkSocketCount: this.networkSockets.size,
      pageHost, title: this.window && !this.window.isDestroyed() ? this.window.getTitle() : '',
      loading: this.window && !this.window.isDestroyed() ? this.window.webContents.isLoading() : false,
      visible: Boolean(this.window && !this.window.isDestroyed() && this.window.isVisible()),
      minimized: Boolean(this.window && !this.window.isDestroyed() && this.window.isMinimized()),
      replayId,
      loadError: this.loadError || null, bridgeError: this.bridgeError || null,
    } };
  }
  async open({ show = true } = {}) {
    if (this.opening) await this.opening;
    if (this.window && !this.window.isDestroyed()) {
      if (show) { this.hideAfterLogin = true; this.show(); }
      return;
    }
    this.opening = this.create(show).finally(() => { this.opening = null; });
    return this.opening;
  }
  show() {
    if (this.window.isMinimized()) this.window.restore();
    this.window.setOpacity(1); this.window.setIgnoreMouseEvents(false); this.window.setSkipTaskbar(false);
    this.window.show(); this.window.focus();
  }
  async openReplay(value) {
    const url = new URL(value);
    if (url.origin !== 'https://game.maj-soul.com' || url.pathname !== '/1/' ||
        !/^\d{6}-[a-f0-9-]{36}$/.test(url.searchParams.get('paipu') || '')) throw new Error('牌谱链接不正确');
    await this.open({ show: false });
    this.hideAfterLogin = false;
    this.show();
    if (this.window.webContents.getURL() === url.href) return;
    this.contexts.clear(); this.networkSockets.clear(); this.activeContext = null;
    this.pageGeneration++;
    this.loadError = null; this.bridgeError = null;
    this.current = { ready: false, phase: 'loading-replay', nickname: '', sockets: 0 };
    await this.window.loadURL(url.href);
  }
  async create(show) {
    this.pageGeneration++;
    this.hideAfterLogin = true;
    this.current = { ready: false, phase: 'loading', nickname: '', sockets: 0 };
    const window = new this.BrowserWindow({
      title: '雀魂国服登录', width: 1200, height: 800, show, paintWhenInitiallyHidden: true, autoHideMenuBar: true,
      webPreferences: { partition: 'persist:majsoul-cn', nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false, focusOnNavigation: false },
    });
    this.window = window;
    window.webContents.setAudioMuted(true);
    window.webContents.on('did-create-window', (child) => child.webContents.setAudioMuted(true));
    this.contexts.clear();
    this.networkSockets.clear();
    this.activeContext = null;
    this.loadError = null;
    this.bridgeError = null;
    window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    window.webContents.setWindowOpenHandler(({ url }) => {
      try { if (new URL(url).protocol === 'https:') return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, webPreferences: { partition: 'persist:majsoul-cn', nodeIntegration: false, contextIsolation: true, sandbox: true } } }; } catch (_) {}
      return { action: 'deny' };
    });
    window.webContents.on('will-navigate', (event, url) => { if (url !== 'about:blank' && !url.startsWith('https://')) event.preventDefault(); });
    window.webContents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => { if (isMainFrame) this.loadError = { code, description }; });
    window.on('close', (event) => { if (!this.quitting) { event.preventDefault(); window.hide(); } });
    window.on('closed', () => { this.window = null; this.current = { ready: false, phase: 'signed-out', nickname: '', sockets: 0 }; });
    window.webContents.debugger.attach('1.3');
    const source = (await readFile(new URL('../app/session-bridge.js', import.meta.url), 'utf8')) + '\n//# sourceURL=maj-stats-session-bridge.js';
    const debug = window.webContents.debugger;
    debug.on('message', (_event, method, params, sessionId = '') => {
      if (method === 'Runtime.executionContextCreated') {
        const context = params.context;
        if (context.auxData?.isDefault !== false) this.contexts.set(`${sessionId}:${context.id}`, { contextId: context.id, sessionId });
      } else if (method === 'Runtime.executionContextDestroyed') {
        this.contexts.delete(`${sessionId}:${params.executionContextId}`);
      } else if (method === 'Runtime.executionContextsCleared') {
        for (const [key, context] of this.contexts) if (context.sessionId === sessionId) this.contexts.delete(key);
      } else if (method === 'Network.webSocketCreated') {
        try { this.networkSockets.add(new URL(params.url).hostname); } catch (_) {}
      } else if (method === 'Runtime.exceptionThrown' && params.exceptionDetails?.url === 'maj-stats-session-bridge.js') {
        this.bridgeError = { text: params.exceptionDetails.text, line: params.exceptionDetails.lineNumber };
      } else if (method === 'Target.attachedToTarget') {
        const child = params.sessionId;
        // Only page/Unity worker contexts need the socket bridge. In particular,
        // a service worker can wait for Runtime initialization until it resumes;
        // waiting to inject first deadlocks the official client's boot cache.
        if (!['worker', 'iframe'].includes(params.targetInfo.type)) {
          debug.sendCommand('Runtime.runIfWaitingForDebugger', {}, child).catch(() => {});
          return;
        }
        // Unity may create its networking WebSocket in an Emscripten worker.
        // Install the same read-only bridge before that worker starts.
        (async () => {
          try {
            await debug.sendCommand('Runtime.enable', {}, child);
            await debug.sendCommand('Runtime.evaluate', { expression: source }, child);
            if (params.targetInfo.type === 'iframe') await debug.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source }, child);
            await debug.sendCommand('Network.enable', {}, child).catch(() => {});
          } finally { await debug.sendCommand('Runtime.runIfWaitingForDebugger', {}, child).catch(() => {}); }
        })().catch(() => {});
      } else if (method === 'Target.detachedFromTarget') {
        for (const [key, context] of this.contexts) if (context.sessionId === params.sessionId) this.contexts.delete(key);
      }
    });
    // Create the target first, then finish registration before the official
    // page can construct any socket. Starting navigation concurrently races it.
    await window.loadURL('about:blank');
    await debug.sendCommand('Page.enable');
    await window.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
      source,
    });
    await Promise.all([
      debug.sendCommand('Runtime.enable'),
      debug.sendCommand('Network.enable'),
      debug.sendCommand('Target.setAutoAttach', {
        autoAttach: true, waitForDebuggerOnStart: true, flatten: true,
        filter: [{ type: 'worker' }, { type: 'iframe' }, { exclude: true }],
      }),
    ]);
    // Unity needs an unminimized native surface to initialize its worker.
    // Keep it invisible and noninteractive while it restores the saved login.
    if (!show) {
      window.setOpacity(0); window.setIgnoreMouseEvents(true); window.setSkipTaskbar(true);
      window.showInactive();
    }
    const loading = window.loadURL('https://game.maj-soul.com/1/');
    loading.catch(() => { this.current = { ...this.current, phase: 'load-failed' }; });
    this.current.phase = 'waiting-login';
  }
  async evaluate(expression, awaitPromise = false, context = this.activeContext) {
    if (!this.window || this.window.isDestroyed()) throw new Error('请先登录雀魂');
    const parameters = { expression, returnByValue: true, awaitPromise };
    if (context) parameters.contextId = context.contextId;
    const reply = await this.window.webContents.debugger.sendCommand('Runtime.evaluate', parameters, context?.sessionId || undefined);
    if (reply.exceptionDetails) throw new Error(reply.exceptionDetails.exception?.description?.split('\n')[0] || '雀魂登录页面未就绪');
    return reply.result.value;
  }
  async poll() {
    if (!this.window || this.window.isDestroyed() || this.polling) return this.status();
    this.polling = true;
    const generation = this.pageGeneration;
    try {
      const contexts = [...this.contexts.values()];
      if (!contexts.length) contexts.push(null);
      const observed = await Promise.allSettled(contexts.map(async (context) => ({ context, status: await this.evaluate('globalThis.__majStatsSession?.status() || null', false, context) })));
      if (generation !== this.pageGeneration) return this.status();
      const entries = observed.filter((entry) => entry.status === 'fulfilled' && entry.value.status).map((entry) => entry.value);
      const selected = entries.find((entry) => entry.status.ready) || entries.sort((a, b) => b.status.sockets - a.status.sockets)[0];
      const result = selected?.status;
      if (result) {
        const becameReady = result.ready && !this.current.ready;
        this.activeContext = selected.context;
        this.current = { ...result, phase: result.ready ? 'ready' : 'waiting-login', contexts: contexts.length, networkSockets: this.networkSockets.size };
        if (becameReady && this.hideAfterLogin) this.window.hide();
      }
    } catch (_) { /* A navigation temporarily replaces the JavaScript context. */ }
    finally { this.polling = false; }
    return this.status();
  }
  async fetchRecord(wrapper) {
    const state = await this.poll();
    if (!state.ready) throw new Error('请先在雀魂官方页面完成登录');
    const encoded = await this.evaluate(`globalThis.__majStatsSession.request(${JSON.stringify(wrapper.toString('base64'))})`, true);
    return Buffer.from(encoded, 'base64');
  }
  async logout() {
    if (this.window && !this.window.isDestroyed()) {
      const officialSession = this.window.webContents.session;
      this.quitting = true;
      this.window.destroy();
      await officialSession.clearStorageData();
      this.quitting = false;
    }
    this.current = { ready: false, phase: 'signed-out', nickname: '', sockets: 0 };
  }
  close() { this.quitting = true; if (this.window && !this.window.isDestroyed()) this.window.destroy(); }
}
