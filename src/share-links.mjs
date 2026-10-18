const UUID = '\\d{6}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const SHARE_CODE = new RegExp(`^(${UUID})((?:_[ab]?\\d+)*)$`, 'i');
const CN_HOSTS = new Set(['game.maj-soul.com', 'game.maj-soul.net']);

/** A share viewpoint never changes the identity of the underlying game. */
export function parseShareLink(input) {
  const candidate = String(input).trim().replace(/[。，,；;）)\]】>]+$/u, '');
  let code = candidate;
  if (/^https?:\/\//i.test(candidate)) {
    let url;
    try { url = new URL(candidate); } catch { throw new Error('分享链接格式不正确'); }
    if (!CN_HOSTS.has(url.hostname) || url.username || url.password || url.port) {
      throw new Error('目前只支持雀魂国服官方分享链接');
    }
    if (url.searchParams.getAll('paipu').length !== 1) throw new Error('链接缺少唯一的 paipu 参数');
    code = url.searchParams.get('paipu');
  }
  const match = SHARE_CODE.exec(code);
  if (!match) throw new Error('没有识别到有效的雀魂牌谱编号');
  const uuid = match[1].toLowerCase();
  const shareCode = uuid + match[2];
  return {
    uuid,
    region: 'cn',
    shareCode,
    shareUrl: `https://game.maj-soul.com/1/?paipu=${encodeURIComponent(shareCode)}`,
  };
}

/** Accept the text copied by Mahjong Soul's Share button, including its label. */
export function parseShareLinks(input) {
  const replays = new Map();
  const errors = [];
  let duplicateCount = 0;
  const lines = String(input).split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (!line) continue;
    const candidates = line.match(/https?:\/\/[^\s<>"'，。；）)\]】]+/gi) || [line];
    for (const candidate of candidates) {
      try {
        const replay = parseShareLink(candidate);
        if (replays.has(replay.uuid)) duplicateCount++;
        else replays.set(replay.uuid, replay);
      } catch (error) {
        errors.push({ line: index + 1, message: error.message });
      }
    }
  }
  return { replays: [...replays.values()], duplicateCount, errors };
}
