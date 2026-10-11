// 유지보수 요청 받기 (손님 화면)
// 본문은 HTML이 아니라 글 조각과 이미지 목록으로 저장한다 → 넣은 코드가 화면에서 실행되지 않음.
// 이미지·첨부파일은 /api/upload 로 미리 올라가 있고, 여기서는 그 경로만 받아 확인한다.
const {
  SB_URL, SB_KEY, TABLE, KINDS, URGENCIES, sbHeaders, readBody, getUser, customerByToken,
  ipHash, nextPublicNo, codeOf, priorityOf, respondBy, bodyText, PENDING_RE,
} = require('./_lib');

const clip = (v, n) => String(v ?? '').trim().slice(0, n);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[0-9+\-() ]{0,20}$/;
const MAX_TEXT = 50000;

// 본문 확인: [{t:'text', v}, {t:'img', p}] — 이미지 5장, 글 50,000자까지
function cleanBody(raw) {
  if (!Array.isArray(raw)) return { error: '요청 내용을 입력하거나 이미지를 붙여넣어 주세요.' };
  const body = [];
  let chars = 0, imgs = 0;
  for (const s of raw.slice(0, 400)) {
    if (s && s.t === 'text' && typeof s.v === 'string' && s.v) {
      chars += s.v.length;
      const last = body[body.length - 1];
      if (last && last.t === 'text') last.v += s.v; else body.push({ t: 'text', v: s.v });
    } else if (s && s.t === 'img' && PENDING_RE.test(String(s.p)) && /\.(png|jpe?g)$/.test(s.p)) {
      if (++imgs > 5) return { error: '본문 이미지는 5장까지 넣을 수 있어요.' };
      body.push({ t: 'img', p: s.p });
    }
  }
  if (chars > MAX_TEXT) return { error: '요청 내용이 너무 깁니다. 나누어 접수해 주세요.' };
  if (!bodyText(body) && !imgs) return { error: '요청 내용을 입력하거나 이미지를 붙여넣어 주세요.' };
  return { body, imgs };
}
function cleanFiles(raw) {
  const list = Array.isArray(raw) ? raw : [];
  if (list.length > 5) return { error: '첨부파일은 5개까지 올릴 수 있어요.' };
  const files = [];
  for (const a of list) {
    if (!a || !PENDING_RE.test(String(a.p))) return { error: '첨부파일을 다시 올려 주세요.' };
    files.push({ p: a.p, name: clip(a.name, 120) || '첨부파일', size: Math.max(0, Math.min(Number(a.size) || 0, 10485760)) });
  }
  return { files };
}
const countSince = async (filter, ms) => {
  const since = new Date(Date.now() - ms).toISOString();
  const r = await fetch(`${SB_URL}/rest/v1/${TABLE}?${filter}&created_at=gt.${encodeURIComponent(since)}&select=id`, { headers: { ...sbHeaders(), Prefer: 'count=exact', Range: '0-0' } });
  return Number((r.headers.get('content-range') || '').split('/')[1] || 0);
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 가능해요' });
  if (!SB_URL || !SB_KEY) return res.status(500).json({ error: 'Supabase 연결 정보가 없어요. Vercel Storage 연결 후 다시 배포해 주세요.' });
  const b = readBody(req);
  if (b.website) return res.status(200).json({ ok: true }); // 스팸 함정 칸(사람에게는 안 보임)

  const row = {
    company: clip(b.company, 100),
    name: clip(b.name, 30),
    contact: clip(b.email, 100),
    phone: clip(b.phone, 20) || null,
    program: clip(b.program, 100),
    kind: clip(b.kind, 20),
    urgency: clip(b.urgency, 20) || '보통',
    consent: b.consent === true,
    channel: '웹',
  };
  if (!row.name) return res.status(400).json({ error: '이름을 입력해 주세요.' });
  if (!EMAIL_RE.test(row.contact)) return res.status(400).json({ error: '이메일 주소를 확인해 주세요.' });
  if (row.phone && !PHONE_RE.test(row.phone)) return res.status(400).json({ error: '전화번호 형식을 확인해 주세요.' });
  if (!row.company && !b.t) return res.status(400).json({ error: '회사 이름을 적어 주세요.' });
  if (!row.program) return res.status(400).json({ error: '어느 프로그램인지 적어 주세요.' });
  if (!KINDS.includes(row.kind)) return res.status(400).json({ error: '요청 종류를 골라 주세요.' });
  if (!URGENCIES.includes(row.urgency)) return res.status(400).json({ error: '급한 정도를 골라 주세요.' });
  if (!row.consent) return res.status(400).json({ error: '개인정보 수집 안내에 동의해 주세요.' });
  const bd = cleanBody(b.body);
  if (bd.error) return res.status(400).json({ error: bd.error });
  const fl = cleanFiles(b.attachments);
  if (fl.error) return res.status(400).json({ error: fl.error });
  row.body = bd.body;
  row.attachments = fl.files;
  row.message = bodyText(bd.body).slice(0, MAX_TEXT) || `[이미지 ${bd.imgs}장]`;

  // 전용 링크면 그 고객사로 묶고 회사 이름도 등록된 이름으로. 링크가 없으면 '신규 문의'
  let cust = null;
  if (b.t) {
    cust = await customerByToken(b.t);
    if (!cust) return res.status(400).json({ error: '유효하지 않은 링크입니다. 받으신 링크를 확인하거나 담당자에게 문의해 주세요.' });
    row.customer_id = cust.id;
    row.company = cust.name;
  }

  // 제출 횟수 제한: 전용 링크 1분 3건·1시간 20건 / 신규 문의는 같은 접속 위치 10분 3건
  row.ip_hash = ipHash(req);
  const busy = cust
    ? (await countSince(`customer_id=eq.${cust.id}`, 60000)) >= 3 || (await countSince(`customer_id=eq.${cust.id}`, 3600000)) >= 20
    : (await countSince(`ip_hash=eq.${row.ip_hash}&customer_id=is.null`, 600000)) >= 3;
  if (busy) return res.status(429).json({ error: '짧은 시간에 요청이 많이 들어왔어요. 잠시 뒤 다시 보내 주세요. 급하면 전화 주세요.' });

  const user = await getUser(req);
  if (user) row.user_id = user.id;

  row.priority = priorityOf(row.urgency);
  row.respond_by = respondBy(new Date(), row.priority);
  row.public_no = await nextPublicNo(codeOf(cust && { id: cust.id, code: cust.code }));

  const r = await fetch(`${SB_URL}/rest/v1/${TABLE}?select=id,public_no`, {
    method: 'POST', headers: { ...sbHeaders(), Prefer: 'return=representation' }, body: JSON.stringify(row),
  });
  if (!r.ok) return res.status(500).json({ error: '저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.' });
  const [saved] = await r.json();
  return res.status(200).json({ ok: true, id: saved && saved.id, no: saved && (saved.public_no || `#${saved.id}`) });
};
