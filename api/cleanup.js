// 매일 한 번(vercel.json의 crons) 청소한다.
//  1) 완료 후 1년이 지난 요청과 그 이미지·첨부파일 (변경 기록·작업 기록은 요청과 함께 지워짐)
//  2) 올려 두고 요청에 쓰지 않은 파일(pending/)은 하루가 지나면 지움
// Vercel이 부를 때 Authorization: Bearer CRON_SECRET 을 붙여 준다. 그 값이 없으면 아무것도 하지 않는다.
const crypto = require('node:crypto');
const { SB_URL, SB_KEY, TABLE, BUCKET, FILE_BUCKET, sbHeaders } = require('./_lib');

const same = (a, b) => {
  const h = (s) => crypto.createHash('sha256').update(String(s)).digest();
  return crypto.timingSafeEqual(h(a), h(b));
};
const del = (bucket, paths) => (paths.length
  ? fetch(`${SB_URL}/storage/v1/object/${bucket}`, { method: 'DELETE', headers: sbHeaders(), body: JSON.stringify({ prefixes: paths }) })
  : Promise.resolve({ ok: true }));
const filesOf = (x) => [
  ...(Array.isArray(x.body) ? x.body.filter((s) => s.t === 'img').map((s) => s.p) : []),
  ...((x.attachments || []).map((a) => a.p)),
].filter(Boolean);

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(500).json({ error: 'CRON_SECRET이 없어요.' });
  if (!same(req.headers.authorization || '', `Bearer ${secret}`)) return res.status(401).json({ error: '권한이 없어요.' });
  if (!SB_URL || !SB_KEY) return res.status(500).json({ error: 'Supabase 연결 정보가 없어요.' });

  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 1);
  const where = `status=eq.${encodeURIComponent('완료')}&completed_at=lt.${encodeURIComponent(cutoff.toISOString())}`;

  // 1) 완료 후 1년 지난 요청: 파일을 먼저 지우고, 성공하면 요청을 지운다 (파일만 남는 일을 막기 위해)
  const r = await fetch(`${SB_URL}/rest/v1/${TABLE}?select=id,images,body,attachments&${where}&limit=500`, { headers: sbHeaders() });
  if (!r.ok) return res.status(500).json({ error: '불러오지 못했어요.' });
  const rows = await r.json();
  let deleted = 0, files = 0;
  if (rows.length) {
    const old = rows.flatMap((x) => x.images || []);
    const fp = rows.flatMap(filesOf);
    const [s1, s2] = await Promise.all([del(BUCKET, old), del(FILE_BUCKET, fp)]);
    if (!s1.ok || !s2.ok) return res.status(500).json({ error: '첨부 이미지·파일을 지우지 못했어요.' });
    const ids = rows.map((x) => x.id).join(',');
    const d = await fetch(`${SB_URL}/rest/v1/${TABLE}?id=in.(${ids})&${where}`, { method: 'DELETE', headers: { ...sbHeaders(), Prefer: 'return=minimal' } });
    if (!d.ok) return res.status(500).json({ error: '요청을 지우지 못했어요.' });
    deleted = rows.length; files = old.length + fp.length;
  }

  // 2) 쓰이지 않은 업로드 파일 정리
  let orphans = 0;
  const all = await fetch(`${SB_URL}/rest/v1/${TABLE}?select=body,attachments&limit=10000`, { headers: sbHeaders() });
  if (all.ok) {
    const used = new Set((await all.json()).flatMap(filesOf));
    const list = async (prefix) => {
      const l = await fetch(`${SB_URL}/storage/v1/object/list/${FILE_BUCKET}`, { method: 'POST', headers: sbHeaders(), body: JSON.stringify({ prefix, limit: 1000 }) });
      return l.ok ? l.json() : [];
    };
    const dayAgo = Date.now() - 86400000;
    const stale = [];
    for (const folder of await list('pending')) {
      if (!folder.name || folder.id) continue; // 달별 폴더만 (pending/2026-10)
      for (const f of await list(`pending/${folder.name}`)) {
        const p = `pending/${folder.name}/${f.name}`;
        if (f.id && !used.has(p) && new Date(f.created_at).getTime() < dayAgo) stale.push(p);
      }
    }
    if (stale.length && (await del(FILE_BUCKET, stale)).ok) orphans = stale.length;
  }
  // 하루 지난 업로드 횟수 기록도 지운다
  await fetch(`${SB_URL}/rest/v1/upload_log?created_at=lt.${encodeURIComponent(new Date(Date.now() - 86400000).toISOString())}`, { method: 'DELETE', headers: sbHeaders() });
  return res.status(200).json({ ok: true, deleted, files, orphans });
};
