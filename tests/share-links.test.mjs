import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseShareLink, parseShareLinks } from '../src/share-links.mjs';

const uuid = '260101-00000001-0000-4000-8000-000000000007';
const userShare = `雀魂牌谱:https://game.maj-soul.com/1/?paipu=${uuid}_a123456789`;

test('accepts the share text format with a synthetic replay identifier', () => {
  const result = parseShareLinks(userShare);
  assert.equal(result.errors.length, 0);
  assert.equal(result.replays.length, 1);
  assert.equal(result.replays[0].uuid, uuid);
  assert.equal(result.replays[0].shareCode, `${uuid}_a123456789`);
});

test('counts one game once across viewpoints, domains, and repeated pasted links', () => {
  const result = parseShareLinks(`${userShare}\n${userShare}\nhttps://game.maj-soul.net/1/?paipu=${uuid}_a999_2。`);
  assert.equal(result.replays.length, 1);
  assert.equal(result.duplicateCount, 2);
  assert.equal(result.errors.length, 0);
});

test('reports malformed and unrelated links without accepting external hosts', () => {
  const result = parseShareLinks(`${userShare}\nhttps://example.com/?paipu=${uuid}\nhttps://game.maj-soul.com/1/?paipu=bad`);
  assert.equal(result.replays.length, 1);
  assert.equal(result.errors.length, 2);
  assert.equal(result.errors[0].line, 2);
  assert.throws(() => parseShareLink(`https://game.maj-soul.com.evil.example/?paipu=${uuid}`));
  assert.throws(() => parseShareLink(`https://game.maj-soul.com/1/?paipu=${uuid}&paipu=${uuid}`));
});

test('accepts encoded query values and more than one link in a pasted line', () => {
  const second = uuid.replace('00000001', '00000002');
  const result = parseShareLinks(`https://game.maj-soul.com/1/?paipu=${uuid}%5Fa123456789 https://game.maj-soul.com/1/?paipu=${second}`);
  assert.equal(result.replays.length, 2);
  assert.equal(result.replays[0].shareCode, `${uuid}_a123456789`);
  assert.equal(result.errors.length, 0);
});
