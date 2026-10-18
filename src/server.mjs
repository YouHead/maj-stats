import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createExcelExport } from './excel-export.mjs';
import { DEFAULT_SORT } from './metrics.mjs';

export async function createServer({ session, store, onQuit, onOpenData, onOpenReplay, application }) {
  let origin;
  const assets = new Map([['/', ['index.html', 'text/html; charset=utf-8']], ['/teams.js', ['teams.js', 'text/javascript; charset=utf-8']], ['/app.js', ['app.js', 'text/javascript; charset=utf-8']], ['/record-controls.js', ['record-controls.js', 'text/javascript; charset=utf-8']], ['/table.js', ['table.js', 'text/javascript; charset=utf-8']], ['/metrics.js', ['../../src/metrics.mjs', 'text/javascript; charset=utf-8']], ['/style.css', ['style.css', 'text/css; charset=utf-8']]]);
  assets.set('/records', ['records.html', 'text/html; charset=utf-8']);
  assets.set('/records.js', ['records.js', 'text/javascript; charset=utf-8']);
  assets.set('/record-list.js', ['../../src/record-list.mjs', 'text/javascript; charset=utf-8']);
  assets.set('/contest-controls.js', ['contest-controls.js', 'text/javascript; charset=utf-8']);
  assets.set('/replay-details.js', ['replay-details.js', 'text/javascript; charset=utf-8']);
  assets.set('/score-chart.js', ['../../src/score-chart.mjs', 'text/javascript; charset=utf-8']);
  const server = http.createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const send = (status, value) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(value)); };
    try {
      if (request.headers.host !== new URL(origin).host) return send(403, { error: '无效的访问地址' });
      const url = new URL(request.url, origin);
      if (request.method === 'GET' && url.pathname === '/api/state') return send(200, { session: session.status(), application, ...store.state() });
      if (request.method === 'GET' && url.pathname === '/api/records/detail') return send(200, await store.replayDetails(url.searchParams.get('contestId'), url.searchParams.get('uuid')));
      if (request.method === 'GET' && url.pathname === '/api/export.xlsx') {
        const state = store.state();
        const bytes = await createExcelExport(state, { sortKey: url.searchParams.get('sort') || DEFAULT_SORT.key, direction: url.searchParams.get('direction') || DEFAULT_SORT.direction });
        const fileName = `比赛${state.contest?.contest_id || ''}选手统计.xlsx`;
        response.writeHead(200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Length': bytes.length, 'Content-Disposition': `attachment; filename="maj-stats.xlsx"; filename*=UTF-8''${encodeURIComponent(fileName)}` });
        response.end(bytes);
        return;
      }
      if (request.method === 'GET' && assets.has(url.pathname)) {
        const [file, contentType] = assets.get(url.pathname);
        response.writeHead(200, { 'Content-Type': contentType });
        response.end(await readFile(new URL(`../app/ui/${file}`, import.meta.url)));
        return;
      }
      if (request.method !== 'POST' || request.headers.origin !== origin || !request.headers['content-type']?.startsWith('application/json')) {
        return send(403, { error: '请从软件界面发起此操作' });
      }
      let size = 0;
      const chunks = [];
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 1024 * 1024) return send(413, { error: '一次粘贴的内容过多，请分批导入' });
        chunks.push(chunk);
      }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch { return send(400, { error: '请求格式不正确' }); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return send(400, { error: '请求格式不正确' });
      if (url.pathname === '/api/login') {
        session.open().catch(() => { session.current.phase = 'load-failed'; });
        return send(200, { ok: true });
      }
      if (url.pathname === '/api/logout') {
        if (store.busy) return send(409, { error: '请等待本次导入完成后退出登录' });
        await session.logout();
        return send(200, { ok: true });
      }
      if (url.pathname === '/api/import') {
        if (typeof body.text !== 'string') return send(400, { error: '请粘贴分享链接' });
        return send(200, store.start(body.text));
      }
      if (url.pathname === '/api/contest/import') return send(200, store.startContest());
      if (url.pathname === '/api/contest/select') return send(200, await store.selectContest(body.contestId));
      if (url.pathname === '/api/teams/sync') return send(200, await store.syncTeams(body.contestId));
      if (['/api/records/delete', '/api/records/clear'].includes(url.pathname) && body.confirmed !== true) return send(400, { error: '请先确认要删除的本地记录' });
      if (url.pathname === '/api/records/delete') return send(200, await store.removeReplay(body.contestId, body.uuid));
      if (url.pathname === '/api/records/clear') return send(200, await store.clearRecords(body.contestId));
      if (url.pathname === '/api/records/restore') return send(200, await store.restoreRecords(body.contestId, body.batchId));
      if (url.pathname === '/api/records/open' && onOpenReplay) {
        if (store.busy) return send(409, { error: '正在导入或管理记录，请等待完成后打开牌谱' });
        const replayUrl = store.replayUrl(body.contestId, body.uuid);
        await onOpenReplay(replayUrl);
        return send(200, { ok: true });
      }
      if (url.pathname === '/api/import/stop') return send(200, store.stop());
      if (url.pathname === '/api/data/open' && onOpenData) { await onOpenData(); return send(200, { ok: true }); }
      if (url.pathname === '/api/quit' && onQuit) { send(200, { ok: true }); onQuit(); return; }
      send(404, { error: '未找到此操作' });
    } catch (error) { send(400, { error: error.message }); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  return { server, origin };
}
