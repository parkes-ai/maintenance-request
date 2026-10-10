// 매일 한 번(vercel.json의 crons) 완료 후 1년이 지난 요청과 그 화면 캡처를 지운다.
// Vercel이 부를 때 Authorization: Bearer CRON_SECRET 을 붙여 준다. 그 값이 없으면 아무것도 하지 않는다.
const crypto = require('node:crypto');
const { SB_URL, SB_KEY, TABLE, BUCKET, sbHeaders } = require('./_lib');

const same = (a, b) => {
  const h = (s) => crypto.createHash('sha256').update(String(s)).digest();
  return crypto.timingSafeEqual(h(a), h(b));
};

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(500).json({ error: 'CRON_SECRET이 없어요.' });
  if (!same(req.headers.authorization || '', `Bearer ${secret}`)) return res.status(401).json({ error: '권한이 없어요.' });
  if (!SB_URL || !SB_KEY) return res.status(500).json({ error: 'Supabase 연결 정보가 없어요.' });

  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 1);
  const where = `status=eq.${encodeURIComponent('완료')}&completed_at=lt.${encodeURIComponent(cutoff.toISOString())}`;

  const r = await fetch(`${SB_URL}/rest/v1/${TABLE}?select=id,images&${where}&limit=500`, { headers: sbHeaders() });
  if (!r.ok) return res.status(500).json({ error: '불러오지 못했어요.' });
  const rows = await r.json();
  if (!rows.length) return res.status(200).json({ ok: true, deleted: 0 });

  // 캡처 먼저 지우고, 성공하면 요청을 지운다 (캡처만 남는 일을 막기 위해)
  const paths = rows.flatMap((x) => x.images || []);
  if (paths.length) {
    const s = await fetch(`${SB_URL}/storage/v1/object/${BUCKET}`, { method: 'DELETE', headers: sbHeaders(), body: JSON.stringify({ prefixes: paths }) });
    if (!s.ok) return res.status(500).json({ error: '캡처를 지우지 못했어요.' });
  }
  const ids = rows.map((x) => x.id).join(',');
  const d = await fetch(`${SB_URL}/rest/v1/${TABLE}?id=in.(${ids})&${where}`, { method: 'DELETE', headers: { ...sbHeaders(), Prefer: 'return=minimal' } });
  if (!d.ok) return res.status(500).json({ error: '요청을 지우지 못했어요.' });
  return res.status(200).json({ ok: true, deleted: rows.length, images: paths.length });
};
