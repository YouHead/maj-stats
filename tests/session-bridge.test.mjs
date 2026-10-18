import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';
import { loadProtocol } from '../src/protocol.mjs';

const source = await readFile(new URL('../app/session-bridge.js', import.meta.url), 'utf8');
const protocol = await loadProtocol(new URL('../.cache/', import.meta.url));
const packet = (direction, id, wrapper) => Buffer.concat([Buffer.from([direction, id & 255, id >>> 8]), wrapper]);
const wrap = (name, data) => protocol.encode('lq.Wrapper', { name, data });
const response = (id, type, data) => packet(3, id, wrap('', protocol.encode(type, data)));

function setup() {
  class Socket extends EventTarget {
    static OPEN = 1;
    constructor(url) { super(); this.url = url; this.readyState = 1; this.sent = []; }
    send(bytes) { this.sent.push(Buffer.from(bytes)); }
    receive(bytes) { const copy = Uint8Array.from(bytes); this.dispatchEvent(new MessageEvent('message', { data: copy.buffer })); }
  }
  const context = vm.createContext({
    WebSocket: Socket, TextDecoder, Uint8Array, ArrayBuffer, Blob, MessageEvent, URL, setTimeout, clearTimeout,
    btoa: (value) => Buffer.from(value, 'binary').toString('base64'), atob: (value) => Buffer.from(value, 'base64').toString('binary'),
  });
  vm.runInContext(source, context);
  const socket = new context.WebSocket('wss://route-2.maj-soul.com/gateway');
  const delivered = [];
  socket.addEventListener('message', (event) => delivered.push(Buffer.from(event.data)));
  const login = (error = null) => {
    socket.send(packet(2, 1, wrap('.lq.Lobby.login', protocol.encode('lq.ReqLogin', { account: 'private@example.invalid', password: 'PRIVATE_HASH', client_version_string: 'web-test-version' }))));
    socket.receive(response(1, 'lq.ResLogin', error ? { error } : { account_id: 123, account: { nickname: 'Logged In' }, access_token: 'PRIVATE_TOKEN' }));
  };
  return { socket, bridge: context.__majStatsSession, delivered, login };
}

test('recognizes a successful official login without exposing credential fields', () => {
  const { bridge, login } = setup();
  assert.equal(bridge.status().ready, false);
  login();
  assert.equal(bridge.status().ready, true);
  assert.equal(bridge.status().nickname, 'Logged In');
  assert.equal(bridge.status().clientVersion, 'web-test-version');
  assert.doesNotMatch(JSON.stringify(bridge.status()), /PRIVATE_|private@example/);
});

test('keeps application read responses away from the game, remapping a concurrent game ID collision', async () => {
  const { bridge, socket, delivered, login } = setup();
  login();
  const own = bridge.request(protocol.replayRequest('260101-00000001-0000-4000-8000-000000000007').toString('base64'));
  const ownId = socket.sent.at(-1).readUInt16LE(1);
  assert.equal(ownId, 65535);
  const gameRequest = packet(2, ownId, wrap('.lq.Lobby.heatbeat', protocol.encode('lq.ReqHeatBeat', {})));
  socket.send(gameRequest);
  const remappedId = socket.sent.at(-1).readUInt16LE(1);
  assert.notEqual(remappedId, ownId);
  socket.receive(response(remappedId, 'lq.ResCommon', {}));
  assert.equal(delivered.at(-1).readUInt16LE(1), ownId);
  const before = delivered.length;
  socket.receive(response(ownId, 'lq.ResGameRecord', { error: { code: 1004 } }));
  const actual = protocol.decode('lq.ResGameRecord', Buffer.from(await own, 'base64'));
  assert.equal(actual.error.code, 1004);
  assert.equal(delivered.length, before);
});

test('rejects account-changing methods and invalidates the session when disconnected', async () => {
  const { bridge, socket, login } = setup();
  login({ code: 1004 });
  assert.equal(bridge.status().ready, false);
  login();
  await assert.rejects(bridge.request(wrap('.lq.Lobby.startRoom', Buffer.alloc(0)).toString('base64')), /仅允许读取牌谱/);
  socket.readyState = 3;
  socket.dispatchEvent(new Event('close'));
  assert.equal(bridge.status().ready, false);
});

test('allows the tournament listing read method on the same authenticated connection', async () => {
  const { bridge, socket, login } = setup();
  login();
  const listing = bridge.request(protocol.contestRecordsRequest(80196077, 50).toString('base64'));
  const ownId = socket.sent.at(-1).readUInt16LE(1);
  socket.receive(response(ownId, 'lq.ResFetchCustomizedContestGameRecords', { next_index: 40 }));
  assert.equal(protocol.decode('lq.ResFetchCustomizedContestGameRecords', Buffer.from(await listing, 'base64')).next_index, 40);
});

test('allows only the two additional read methods for official teams and members', async () => {
  const { bridge, socket, login } = setup(); login();
  for (const [request, type] of [[protocol.contestTeamsRequest(123), 'lq.ResFetchContestTeamRank'], [protocol.contestTeamMembersRequest(123, 1), 'lq.ResFetchContestTeamMember']]) {
    const result = bridge.request(request.toString('base64'));
    const id = socket.sent.at(-1).readUInt16LE(1);
    socket.receive(response(id, type, { total: 0, rank: [] }));
    assert.equal(protocol.decode(type, Buffer.from(await result, 'base64')).total, 0);
  }
  await assert.rejects(bridge.request(wrap('.lq.Lobby.signupCustomizedContest', Buffer.alloc(0)).toString('base64')), /仅允许读取/);
});

test('observes only the game viewer replay result without mixing in application downloads', async () => {
  const { bridge, socket, login, delivered } = setup(); login();
  const uuid = '261018-11111111-2222-3333-4444-555555555555';
  socket.send(packet(2, 9, protocol.replayRequest(uuid)));
  assert.equal(bridge.status().viewedReplay.state, 'loading');
  socket.receive(response(9, 'lq.ResGameRecord', { head: { uuid } }));
  assert.equal(bridge.status().viewedReplay.uuid, uuid); assert.equal(bridge.status().viewedReplay.state, 'loaded');
  assert.equal(delivered.at(-1).readUInt16LE(1), 9);
  const own = bridge.request(protocol.replayRequest(uuid).toString('base64'));
  socket.receive(response(socket.sent.at(-1).readUInt16LE(1), 'lq.ResGameRecord', { error: { code: 1004 } })); await own;
  assert.equal(bridge.status().viewedReplay.state, 'loaded');
  socket.send(packet(2, 10, protocol.replayRequest(uuid)));
  socket.receive(response(10, 'lq.ResGameRecord', { error: { code: 1004 } }));
  assert.equal(bridge.status().viewedReplay.state, 'failed'); assert.equal(bridge.status().viewedReplay.errorCode, 1004);
  assert.doesNotMatch(JSON.stringify(bridge.status()), /PRIVATE_|private@example/);
});
