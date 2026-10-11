// 본문 이미지·첨부파일 올리기: 한 번만 쓸 수 있는 업로드 주소를 내준다.
// 파일은 브라우저가 저장소로 바로 올린다 (서버 함수는 큰 파일을 받지 않음). 올린 파일은 pending/ 에 있다가
// 요청과 함께 저장되면 쓰이고, 하루가 지나도 쓰이지 않으면 매일 청소 때 지워진다.
const crypto = require('node:crypto');
const { SB_URL, SB_KEY, FILE_BUCKET, FILE_TYPES, sbHeaders, readBody, ipHash } = require('./_lib');

const MAX_BYTES = 10 * 1024 * 1024;
const LIMIT = 40; // 같은 접속 위치에서 10분에 40개까지

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 가능해요' });
  if (!SB_URL || !SB_KEY) return res.status(500).json({ error: 'Supabase 연결 정보가 없어요.' });
  const b = readBody(req);
  const ext = String(b.name || '').toLowerCase().split('.').pop();
  const type = FILE_TYPES[ext];
  const size = Number(b.size);
  if (!type) return res.status(400).json({ error: '이 형식의 파일은 올릴 수 없어요. PDF·엑셀·워드·한글·PPT·ZIP·TXT·이미지만 돼요.' });
  if (b.kind === 'image' && !/^image\//.test(type)) return res.status(400).json({ error: '본문에는 PNG·JPG 이미지만 넣을 수 있어요.' });
  if (!Number.isFinite(size) || size <= 0 || size > MAX_BYTES) return res.status(400).json({ error: '파일은 10MB까지 올릴 수 있어요.' });

  const ip = ipHash(req);
  const since = new Date(Date.now() - 10 * 60000).toISOString();
  const c = await fetch(`${SB_URL}/rest/v1/upload_log?ip_hash=eq.${ip}&created_at=gt.${encodeURIComponent(since)}&select=id`, { headers: { ...sbHeaders(), Prefer: 'count=exact', Range: '0-0' } });
  const total = Number((c.headers.get('content-range') || '').split('/')[1] || 0);
  if (total >= LIMIT) return res.status(429).json({ error: '파일을 너무 많이 올렸어요. 잠시 뒤 다시 시도해 주세요.' });

  const month = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 7);
  const path = `pending/${month}/${crypto.randomUUID()}.${ext}`;
  const s = await fetch(`${SB_URL}/storage/v1/object/upload/sign/${FILE_BUCKET}/${path}`, { method: 'POST', headers: sbHeaders(), body: '{}' });
  if (!s.ok) return res.status(500).json({ error: '올릴 준비를 하지 못했어요. 잠시 뒤 다시 시도해 주세요.' });
  const d = await s.json();
  await fetch(`${SB_URL}/rest/v1/upload_log`, { method: 'POST', headers: { ...sbHeaders(), Prefer: 'return=minimal' }, body: JSON.stringify({ ip_hash: ip }) });
  return res.status(200).json({ path, type, uploadUrl: `${SB_URL}/storage/v1${d.url}` });
};
