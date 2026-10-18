// Runs inside the app's official login page, before the game's scripts.
// It reuses the authenticated socket. Passwords and tokens are never retained.
(() => {
  'use strict';
  if (globalThis.__majStatsSession) return;
  const NativeSocket = globalThis.WebSocket;
  const decoder = new TextDecoder();
  const forwarded = new WeakSet();
  const connections = new Set();
  let authenticated = null;
  const LOGIN = new Map([['.lq.Lobby.login', 11], ['.lq.Lobby.oauth2Login', 10]]);
  const ALLOWED = new Set(['.lq.Lobby.fetchGameRecord', '.lq.Lobby.fetchCustomizedContestByContestId', '.lq.Lobby.fetchCustomizedContestGameRecords', '.lq.Lobby.fetchContestTeamRank', '.lq.Lobby.fetchContestTeamMember']);
  const asBytes = (data) => data instanceof ArrayBuffer ? new Uint8Array(data)
    : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null;
  function fields(bytes) {
    const result = new Map();
    let offset = 0;
    const uint = () => {
      let value = 0n;
      for (let shift = 0n; shift < 70n; shift += 7n) {
        if (offset >= bytes.length) throw new Error('Truncated protocol message');
        const byte = bytes[offset++];
        value |= BigInt(byte & 127) << shift;
        if (!(byte & 128)) return Number(value);
      }
      throw new Error('Invalid protocol message');
    };
    while (offset < bytes.length) {
      const tag = uint();
      const wire = tag & 7;
      let value;
      if (wire === 0) value = uint();
      else if (wire === 2) {
        const end = uint() + offset;
        if (end > bytes.length) throw new Error('Truncated protocol message');
        value = bytes.subarray(offset, end);
        offset = end;
      } else if (wire === 1 || wire === 5) {
        offset += wire === 1 ? 8 : 4;
        if (offset > bytes.length) throw new Error('Truncated protocol message');
        continue;
      } else throw new Error('Unsupported protocol message');
      result.set(Math.floor(tag / 8), value);
    }
    return result;
  }
  const text = (value) => value instanceof Uint8Array ? decoder.decode(value) : '';
  function toBase64(bytes) {
    let result = '';
    for (let offset = 0; offset < bytes.length; offset += 8192) result += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    return btoa(result);
  }
  const fromBase64 = (value) => Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  const withId = (bytes, id) => {
    const output = bytes.slice();
    output[1] = id & 255;
    output[2] = id >>> 8;
    return output;
  };
  function install(socket) {
    const nativeSend = socket.send;
    const connection = { socket, game: new Map(), own: new Map(), next: 65535, accountId: null, nickname: '', clientVersion: '', viewedReplay: null };
    connections.add(connection);
    const freeId = () => {
      for (let attempt = 0; attempt < 65535; attempt++) {
        const id = connection.next;
        connection.next = id <= 1 ? 65535 : id - 1;
        if (!connection.game.has(id) && !connection.own.has(id)) return id;
      }
      throw new Error('Too many pending requests');
    };
    connection.request = (wrapper) => new Promise((resolve, reject) => {
      const id = freeId();
      const packet = new Uint8Array(wrapper.length + 3);
      packet[0] = 2;
      packet[1] = id & 255;
      packet[2] = id >>> 8;
      packet.set(wrapper, 3);
      const timeout = setTimeout(() => {
        connection.own.delete(id);
        reject(new Error('牌谱下载超时，请重试'));
      }, 30000);
      connection.own.set(id, { resolve, reject, timeout });
      try { nativeSend.call(socket, packet); }
      catch (error) { clearTimeout(timeout); connection.own.delete(id); reject(error); }
    });
    socket.send = function (data) {
      const bytes = asBytes(data);
      if (!bytes || bytes.length < 3 || bytes[0] !== 2) return nativeSend.call(this, data);
      const originalId = bytes[1] | bytes[2] << 8;
      // Remap only collisions, so application requests cannot collide with game RPCs.
      const id = connection.game.has(originalId) || connection.own.has(originalId) ? freeId() : originalId;
      let method = '';
      let clientVersion = '';
      let replayId = '';
      try {
        const wrapper = fields(bytes.subarray(3));
        method = text(wrapper.get(1));
        if (LOGIN.has(method)) clientVersion = text(fields(wrapper.get(2)).get(LOGIN.get(method)));
        if (method === '.lq.Lobby.fetchGameRecord') {
          const uuid = text(fields(wrapper.get(2)).get(1));
          if (/^\d{6}-[a-f0-9-]{36}$/.test(uuid)) {
            replayId = uuid; connection.viewedReplay = { uuid, state: 'loading', errorCode: 0 };
          }
        }
      } catch (_) { /* Forward the game's own bytes even if its schema changes. */ }
      connection.game.set(id, { originalId, method, clientVersion, replayId });
      try { return nativeSend.call(this, id === originalId ? data : withId(bytes, id)); }
      catch (error) { connection.game.delete(id); throw error; }
    };
    function processMessage(bytes) {
      if (bytes.length < 3) return null;
      if (bytes[0] === 1) {
        try {
          if (text(fields(bytes.subarray(1)).get(1)) === '.lq.NotifyAccountLogout' && authenticated === connection) authenticated = null;
        } catch (_) {}
        return null;
      }
      if (bytes[0] !== 3) return null;
      const id = bytes[1] | bytes[2] << 8;
      const own = connection.own.get(id);
      if (own) {
        connection.own.delete(id);
        clearTimeout(own.timeout);
        try {
          // A successful response whose fields are all defaults may omit data.
          const envelope = fields(bytes.subarray(3));
          const payload = envelope.has(2) ? envelope.get(2) : new Uint8Array(0);
          if (!(payload instanceof Uint8Array)) throw new Error('牌谱响应不完整');
          own.resolve(toBase64(payload));
        } catch (error) { own.reject(error); }
        return false;
      }
      const game = connection.game.get(id);
      if (!game) return null;
      connection.game.delete(id);
      if (game.replayId) {
        try {
          const payload = fields(fields(bytes.subarray(3)).get(2));
          const errorCode = payload.get(1) ? fields(payload.get(1)).get(1) || 0 : 0;
          connection.viewedReplay = { uuid: game.replayId, state: !errorCode && payload.get(3) ? 'loaded' : 'failed', errorCode };
        } catch (_) { connection.viewedReplay = { uuid: game.replayId, state: 'failed', errorCode: 0 }; }
      }
      if (LOGIN.has(game.method)) {
        try {
          const payload = fields(fields(bytes.subarray(3)).get(2));
          const error = payload.get(1);
          if ((!error || !fields(error).get(1)) && payload.get(2)) {
            connection.accountId = payload.get(2);
            connection.nickname = payload.get(3) ? text(fields(payload.get(3)).get(2)) : '';
            connection.clientVersion = game.clientVersion;
            authenticated = connection;
          }
        } catch (_) {}
      }
      if (game.method === '.lq.Lobby.logout' && authenticated === connection) authenticated = null;
      return id === game.originalId ? null : withId(bytes, game.originalId);
    }
    const forward = (event, data) => {
      const replacement = new MessageEvent('message', { data, origin: event.origin, lastEventId: event.lastEventId });
      forwarded.add(replacement);
      socket.dispatchEvent(replacement);
    };
    let blobQueue = Promise.resolve();
    socket.addEventListener('message', (event) => {
      if (forwarded.has(event)) return;
      const bytes = asBytes(event.data);
      if (bytes) {
        let replacement;
        try { replacement = processMessage(bytes); } catch (_) { return; }
        if (replacement === null) return;
        event.stopImmediatePropagation();
        if (replacement !== false) forward(event, replacement.buffer);
      } else if (event.data instanceof Blob) {
        event.stopImmediatePropagation();
        blobQueue = blobQueue.then(async () => {
          let replacement = null;
          try { replacement = processMessage(new Uint8Array(await event.data.arrayBuffer())); } catch (_) {}
          if (replacement !== false) forward(event, replacement === null ? event.data : new Blob([replacement], { type: event.data.type }));
        });
      }
    }, { capture: true });
    socket.addEventListener('close', () => {
      if (authenticated === connection) authenticated = null;
      for (const pending of connection.own.values()) { clearTimeout(pending.timeout); pending.reject(new Error('登录连接已断开，请重新登录')); }
      connection.own.clear();
      connection.game.clear();
      connections.delete(connection);
    });
  }
  globalThis.WebSocket = new Proxy(NativeSocket, {
    construct(target, args, newTarget) {
      const socket = Reflect.construct(target, args, newTarget);
      try {
        const host = new URL(socket.url).hostname;
        if (host === 'maj-soul.com' || host.endsWith('.maj-soul.com')) install(socket);
      } catch (_) {}
      return socket;
    },
  });
  Object.defineProperty(globalThis, '__majStatsSession', {
    value: Object.freeze({
      status() {
        const ready = authenticated?.socket.readyState === NativeSocket.OPEN;
        return { ready, sockets: connections.size, nickname: ready ? authenticated.nickname : '', clientVersion: ready ? authenticated.clientVersion : '', viewedReplay: ready ? authenticated.viewedReplay : null };
      },
      async request(wrapperBase64) {
        if (!authenticated || authenticated.socket.readyState !== NativeSocket.OPEN) throw new Error('请先登录雀魂');
        const wrapper = fromBase64(wrapperBase64);
        if (!ALLOWED.has(text(fields(wrapper).get(1)))) throw new Error('此工具仅允许读取牌谱');
        return authenticated.request(wrapper);
      },
    }),
    configurable: false,
  });
})();
