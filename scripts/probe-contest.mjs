// Read-only, anonymous protocol probe. Never logs in or changes a contest.
import { readFile, writeFile } from 'node:fs/promises';

const replayId = process.argv[2] === '--replay' ? process.argv[3] : null;
if (replayId && !/^\d{6}-[a-f0-9-]{36}$/i.test(replayId)) throw new Error('Invalid replay UUID');
const contestId = replayId ? 196077 : Number(process.argv[2] || 196077);
if (!Number.isSafeInteger(contestId) || contestId <= 0) throw new Error('Invalid contest ID');
const readJson = async (path) => JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
const definitions = (await readJson('.cache/liqi.json')).nested.lq.nested;
const config = await readJson('.cache/client-config.json');
const { version } = await readJson('.cache/version.json');

function varint(value) {
  let remaining = BigInt(value);
  const bytes = [];
  do {
    bytes.push(Number(remaining & 127n) | (remaining > 127n ? 128 : 0));
    remaining >>= 7n;
  } while (remaining);
  return Buffer.from(bytes);
}

function encode(type, value) {
  const chunks = [];
  for (const [name, field] of Object.entries(definitions[type].fields)) {
    if (value[name] === undefined) continue;
    const item = value[name];
    if (field.type === 'string' || field.type === 'bytes') {
      const data = Buffer.from(item);
      chunks.push(varint(field.id * 8 + 2), varint(data.length), data);
    } else {
      chunks.push(varint(field.id * 8), varint(item));
    }
  }
  return Buffer.concat(chunks);
}

// Decodes only the messages needed for the anonymous metadata probe.
function decode(type, buffer) {
  const schema = definitions[type];
  const fields = new Map(Object.entries(schema.fields).map(([name, field]) => [field.id, { name, ...field }]));
  const result = {};
  let offset = 0;
  const readVarint = () => {
    let value = 0n;
    for (let shift = 0n; shift < 70n; shift += 7n) {
      if (offset >= buffer.length) throw new Error('Truncated protobuf varint');
      const byte = buffer[offset++];
      value |= BigInt(byte & 127) << shift;
      if (!(byte & 128)) return Number(value);
    }
    throw new Error('Invalid protobuf varint');
  };
  while (offset < buffer.length) {
    const tag = readVarint();
    const field = fields.get(tag >>> 3);
    const wire = tag & 7;
    let value;
    if (wire === 0) value = readVarint();
    else if (wire === 2) {
      const length = readVarint();
      const end = offset + length;
      if (end > buffer.length) throw new Error('Truncated protobuf data');
      const data = buffer.subarray(offset, end);
      offset = end;
      if (!field || field.type === 'bytes') value = data;
      else if (field.type === 'string') value = data.toString('utf8');
      else if (definitions[field.type]?.fields) value = decode(field.type, data);
      else value = { unparsedBytes: length };
    } else if (wire === 1 || wire === 5) {
      offset += wire === 1 ? 8 : 4;
      continue;
    } else throw new Error(`Unsupported wire type: ${wire}`);
    if (!field) continue;
    if (field.type === 'bool') value = Boolean(value);
    if (field.rule === 'repeated') (result[field.name] ||= []).push(value);
    else result[field.name] = value;
  }
  return result;
}

const gateways = config.ip.find((item) => item.name === 'player').gateways;
const gateway = gateways[0];
const server = new URL(gateway.url);
server.protocol = 'wss:';
server.pathname = '/gateway';
const socket = new WebSocket(server);
socket.binaryType = 'arraybuffer';
const pending = new Map();
let index = 0;
socket.addEventListener('message', ({ data }) => {
  try {
    const bytes = Buffer.from(data);
    if (bytes[0] !== 3) return;
    const id = bytes.readUInt16LE(1);
    const request = pending.get(id);
    if (!request) return;
    pending.delete(id);
    clearTimeout(request.timeout);
    const wrapper = decode('Wrapper', bytes.subarray(3));
    request.resolve(decode(request.responseType, wrapper.data));
  } catch (error) {
    for (const request of pending.values()) request.reject(error);
  }
});

async function rpc(service, method, payload) {
  const definition = definitions[service].methods[method];
  const id = ++index;
  const header = Buffer.alloc(3);
  header[0] = 2;
  header.writeUInt16LE(id, 1);
  const message = encode('Wrapper', {
    name: `.lq.${service}.${method}`,
    data: encode(definition.requestType, payload),
  });
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${service}.${method}: response timeout`));
    }, 10000);
    pending.set(id, { resolve, reject, timeout, responseType: definition.responseType });
    socket.send(Buffer.concat([header, message]));
  });
}

const report = { contestId, region: 'cn', authenticated: false, version, gateway: gateway.id, checkedAt: new Date().toISOString(), responses: {} };
try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('WebSocket connection timeout')), 15000);
    socket.addEventListener('open', () => { clearTimeout(timeout); resolve(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('WebSocket connection failed')); }, { once: true });
  });
  report.responses.route = await rpc('Route', 'requestConnection', { type: 1, route_id: gateway.id, timestamp: Math.floor(Date.now() / 1000) });
  if (replayId) {
    report.replayId = replayId;
    report.responses.replay = await rpc('Lobby', 'fetchGameRecord', { game_uuid: replayId, client_version_string: 'web-' + version.replace(/\.[a-z]+$/i, '') });
  } else {
    report.responses.contest = await rpc('Lobby', 'fetchCustomizedContestByContestId', { contest_id: contestId });
  }
} catch (error) {
  report.failure = error.message;
} finally {
  for (const request of pending.values()) clearTimeout(request.timeout);
  socket.close();
}
await writeFile(`.cache/probe-${replayId || contestId}.json`, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (report.failure || report.responses.contest?.error || report.responses.replay?.error) process.exitCode = 1;
