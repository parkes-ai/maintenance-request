// 유지보수 요청 받기: 글은 표에, 화면 캡처는 비공개 저장소에 저장한다.
const crypto = require('node:crypto');
const { SB_URL, SB_KEY, TABLE, BUCKET, KINDS, URGENCIES, sbHeaders, readBody, getUser, customerByToken } = require('./_lib');

const clip = (v, n) => String(v ?? '').trim().slice(0, n);
const MAX_IMAGES = 3;
const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;

// 파일 앞부분을 보고 진짜 이미지인지 확인한다
const imageType = (buf) => {
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { type: 'image/jpeg', ext: 'jpg' };
  if (buf.slice(0, 4).toString('hex') === '89504e47') return { type: 'image/png', ext: 'png' };
  return null;
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 가능해요' });
  if (!SB_URL || !SB_KEY) return res.status(500).json({ error: 'Supabase 연결 정보가 없어요. Vercel Storage 연결 후 다시 배포해 주세요.' });
  const b = readBody(req);
  if (b.website) return res.status(200).json({ ok: true }); // 스팸 함정 칸(사람에게는 안 보임)

  const row = {
    company: clip(b.company, 100),
    name: clip(b.name, 50),
    contact: clip(b.contact, 100),
    program: clip(b.program, 100),
    kind: clip(b.kind, 20),
    urgency: clip(b.urgency, 20),
    message: clip(b.message, 3000),
    consent: b.consent === true,
  };
  if ((!row.company && !b.t) || !row.name || !row.contact) return res.status(400).json({ error: '회사 이름, 이름, 연락처를 적어 주세요' });
  if (!row.program) return res.status(400).json({ error: '어느 프로그램인지 골라 주세요' });
  if (!KINDS.includes(row.kind)) return res.status(400).json({ error: '요청 종류를 골라 주세요' });
  if (!URGENCIES.includes(row.urgency)) return res.status(400).json({ error: '급한 정도를 골라 주세요' });
  if (!row.message) return res.status(400).json({ error: '요청 내용을 적어 주세요' });
  if (!row.consent) return res.status(400).json({ error: '개인정보 수집·이용에 동의해 주세요' });

  const images = Array.isArray(b.images) ? b.images.slice(0, MAX_IMAGES) : [];
  const files = [];
  for (const data of images) {
    const buf = Buffer.from(String(data || ''), 'base64');
    const t = imageType(buf);
    if (!t) return res.status(400).json({ error: '화면 캡처는 이미지 파일만 올릴 수 있어요' });
    if (buf.length > MAX_IMAGE_BYTES) return res.status(400).json({ error: '캡처 파일이 너무 커요. 다시 올려 주세요' });
    files.push({ buf, ...t });
  }

  const user = await getUser(req);
  if (user) row.user_id = user.id;

  // 전용 링크로 왔으면 그 고객사로 묶고 회사 이름도 등록된 이름으로 맞춘다. 링크가 없으면 '신규 문의'
  if (b.t) {
    const c = await customerByToken(b.t);
    if (!c) return res.status(400).json({ error: '링크가 맞지 않거나 더 이상 쓰지 않는 링크예요. 받으신 링크를 확인하거나 전화 주세요.' });
    row.customer_id = c.id;
    row.company = c.name;
  }

  // 캡처 먼저 저장
  const month = new Date().toISOString().slice(0, 7);
  row.images = [];
  for (const f of files) {
    const path = `${month}/${crypto.randomUUID()}.${f.ext}`;
    const h = sbHeaders();
    const r = await fetch(`${SB_URL}/storage/v1/object/${BUCKET}/${path}`, {
      method: 'POST', headers: { ...h, 'Content-Type': f.type }, body: f.buf,
    });
    if (!r.ok) return res.status(500).json({ error: '캡처를 저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.' });
    row.images.push(path);
  }

  const r = await fetch(`${SB_URL}/rest/v1/${TABLE}?select=id`, {
    method: 'POST', headers: { ...sbHeaders(), Prefer: 'return=representation' }, body: JSON.stringify(row),
  });
  if (!r.ok) return res.status(500).json({ error: '저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.' });
  const [saved] = await r.json();
  return res.status(200).json({ ok: true, id: saved && saved.id });
};
