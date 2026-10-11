// 비슷한 요청 안내: 전용 링크의 고객사 요청 중 최근 90일 안에 비슷한 것을 최대 3건 (접수는 막지 않음)
// 링크가 없으면(신규 문의) 아무것도 돌려주지 않는다 → 다른 회사 요청은 어떤 경우에도 보이지 않음
const { SB_URL, SB_KEY, TABLE, sbHeaders, customerByToken, custStatus } = require('./_lib');

const words = (s) => [...new Set(String(s).toLowerCase().split(/[^0-9a-z가-힣]+/).filter((w) => w.length >= 2))];

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET만 가능해요' });
  if (!SB_URL || !SB_KEY) return res.status(200).json({ items: [] });
  const q = words(String((req.query && req.query.q) || '').slice(0, 500));
  const c = q.length ? await customerByToken(req.query && req.query.t) : null;
  if (!c) return res.status(200).json({ items: [] });
  const since = new Date(Date.now() - 90 * 86400000).toISOString();
  const r = await fetch(`${SB_URL}/rest/v1/${TABLE}?customer_id=eq.${c.id}&created_at=gt.${encodeURIComponent(since)}&select=id,public_no,message,program,status&order=created_at.desc&limit=300`, { headers: sbHeaders() });
  if (!r.ok) return res.status(200).json({ items: [] });
  const need = q.length >= 3 ? 2 : 1;
  const items = (await r.json())
    .map((x) => { const w = new Set(words(x.message + ' ' + x.program)); return { x, score: q.filter((k) => w.has(k)).length }; })
    .filter((s) => s.score >= need)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(({ x }) => ({ no: x.public_no || `#${x.id}`, summary: String(x.message).replace(/\s+/g, ' ').slice(0, 60), status: custStatus(x.status) }));
  return res.status(200).json({ items });
};
