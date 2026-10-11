// 여러 /api 함수가 같이 쓰는 도구. 키 값은 적지 않고 환경변수 이름으로만 읽는다.
// 파일 이름이 _ 로 시작해서 주소(/api/_lib)로는 열리지 않는다.
const SB_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
const SB_ANON = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  || process.env.SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const TABLE = 'maintenance_requests';
const BUCKET = 'request-images'; // 예전 방식(요청 화면 캡처)
const FILE_BUCKET = 'request-files'; // 본문 이미지와 첨부파일
const STATUSES = ['새 요청', '배정', '처리 중', '완료', '보류'];
const KINDS = ['오류', '수정 요청', '사용 문의'];
const URGENCIES = ['보통', '급함', '업무 중단 중'];
const PRIORITIES = ['긴급', '보통', '낮음'];
const CATEGORIES = ['고장', '일반 요청', '기능 변경'];
const CAUSES = ['우리 프로그램 오류', '사용법 안내', '추가 작업', '고객 PC·환경'];
const BILLINGS = ['무료', '건별', '시간당', '월 정액', '계약에 포함'];
const MODES = ['원격', '방문', '개발', '전화·메일'];
const CHANNELS = ['웹', '전화', '이메일', '기타'];

// 고객에게 보여 주는 상태 이름 (내부 5가지 → 고객 4가지)
const custStatus = (s) => ({ '새 요청': '접수됨', '배정': '접수됨', '처리 중': '처리 중', '보류': '확인 필요', '완료': '완료' }[s] || s);
// 급한 정도에서 우선순위 기본값
const priorityOf = (urgency) => (urgency === '보통' ? '보통' : '긴급');

// 답변 기한 시각: 평일 09–18시(한국 시간)만 센다. 긴급 2시간 · 보통 9시간 · 낮음 27시간
function respondBy(from, priority) {
  const H = { 긴급: 2, 보통: 9, 낮음: 27 }[priority] || 9;
  const KST = 9 * 3600000;
  let t = new Date(new Date(from).getTime() + KST); // 한국 시간을 UTC 칸에 담아 계산
  let left = H * 60;
  const at = (d, h) => { const x = new Date(d); x.setUTCHours(h, 0, 0, 0); return x; };
  const nextDay9 = (d) => { const x = at(d, 9); x.setUTCDate(x.getUTCDate() + 1); return x; };
  for (let guard = 0; guard < 400 && left > 0; guard++) {
    const wd = t.getUTCDay();
    if (wd === 0 || wd === 6) { t = nextDay9(t); continue; }
    if (t < at(t, 9)) t = at(t, 9);
    const end = at(t, 18);
    if (t >= end) { t = nextDay9(t); continue; }
    const avail = (end - t) / 60000;
    if (left <= avail) { t = new Date(t.getTime() + left * 60000); left = 0; }
    else { left -= avail; t = nextDay9(t); }
  }
  return new Date(t.getTime() - KST).toISOString();
}

// 접속 위치를 그대로 저장하지 않고 한 방향 암호로 바꿔 둔다 (제출 제한용)
function ipHash(req) {
  const ip = String(req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || '').split(',')[0].trim() || 'unknown';
  return require('node:crypto').createHash('sha256').update(ip + '|' + String(SB_KEY).slice(-16)).digest('hex').slice(0, 32);
}

// 접수번호: 고객사코드-년도-일련번호 (신규 문의는 NEW)
async function nextPublicNo(prefix) {
  const year = new Date(Date.now() + 9 * 3600000).getUTCFullYear();
  const r = await fetch(`${SB_URL}/rest/v1/rpc/next_request_no`, { method: 'POST', headers: sbHeaders(), body: JSON.stringify({ p_prefix: prefix, p_year: year }) });
  if (!r.ok) return null;
  const n = await r.json();
  return `${prefix}-${year}-${String(n).padStart(4, '0')}`;
}
const codeOf = (c) => (c && c.code) || (c ? 'C' + String(c.id).padStart(3, '0') : 'NEW');

// 본문(글 조각 + 이미지)에서 글만 뽑기
const bodyText = (segments) => (Array.isArray(segments) ? segments.filter((s) => s.t === 'text').map((s) => s.v).join('').trim() : '');

// 올릴 수 있는 파일: 확장자 → 형식
const FILE_TYPES = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', pdf: 'application/pdf', txt: 'text/plain', log: 'text/plain', csv: 'text/csv',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  hwp: 'application/x-hwp', hwpx: 'application/vnd.hancom.hwpx', zip: 'application/zip',
};
const PENDING_RE = /^pending\/\d{4}-\d{2}\/[0-9a-f-]{36}\.(png|jpe?g|pdf|txt|log|csv|xlsx?|docx?|pptx?|hwpx?|zip)$/;

const clipText = (v, n) => String(v ?? '').trim().slice(0, n);
// 본문 확인: [{t:'text', v}, {t:'img', p}] — 이미지 5장, 글은 maxText자까지(관리자 직접 등록은 제한 없음)
function cleanBody(raw, maxText = 50000) {
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
  if (maxText && chars > maxText) return { error: '요청 내용이 너무 깁니다. 나누어 접수해 주세요.' };
  if (!bodyText(body) && !imgs) return { error: '요청 내용을 입력하거나 이미지를 붙여넣어 주세요.' };
  return { body, imgs };
}
function cleanFiles(raw) {
  const list = Array.isArray(raw) ? raw : [];
  if (list.length > 5) return { error: '첨부파일은 5개까지 올릴 수 있어요.' };
  const files = [];
  for (const a of list) {
    if (!a || !PENDING_RE.test(String(a.p))) return { error: '첨부파일을 다시 올려 주세요.' };
    files.push({ p: a.p, name: clipText(a.name, 120) || '첨부파일', size: Math.max(0, Math.min(Number(a.size) || 0, 10485760)) });
  }
  return { files };
}

// 본문 이미지·첨부파일을 1시간짜리 임시 주소로 바꿔 준다
async function signFiles(rows) {
  const paths = [...new Set(rows.flatMap((r) => [
    ...(Array.isArray(r.body) ? r.body.filter((s) => s.t === 'img').map((s) => s.p) : []),
    ...((r.attachments || []).map((a) => a.p)),
  ]))].filter(Boolean);
  if (!paths.length) return rows;
  const s = await fetch(`${SB_URL}/storage/v1/object/sign/${FILE_BUCKET}`, { method: 'POST', headers: sbHeaders(), body: JSON.stringify({ expiresIn: 3600, paths }) });
  const map = {};
  if (s.ok) for (const x of await s.json()) if (x.signedURL) map[x.path] = `${SB_URL}/storage/v1${x.signedURL}`;
  return rows.map((r) => ({
    ...r,
    body: Array.isArray(r.body) ? r.body.map((x) => (x.t === 'img' ? { t: 'img', url: map[x.p] || null } : x)) : r.body,
    attachments: (r.attachments || []).map((a) => ({ name: a.name, size: a.size, url: map[a.p] || null })),
  }));
}

const sbHeaders = () => ({
  apikey: SB_KEY,
  ...(String(SB_KEY).startsWith('eyJ') ? { Authorization: `Bearer ${SB_KEY}` } : {}),
  'Content-Type': 'application/json',
});

const readBody = (req) => {
  let b = req.body || {};
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
  return b;
};

// 로그인한 손님이면 그 사람 정보, 아니면 null
async function getUser(req) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token || !SB_URL || !SB_ANON) return null;
  const r = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_ANON, Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const u = await r.json();
  return u && u.id ? u : null;
}

// 비공개 저장소의 캡처를 1시간짜리 임시 주소로 바꿔 준다
async function signImages(rows) {
  const paths = [...new Set(rows.flatMap((r) => r.images || []))];
  if (!paths.length) return rows;
  const r = await fetch(`${SB_URL}/storage/v1/object/sign/${BUCKET}`, {
    method: 'POST', headers: sbHeaders(), body: JSON.stringify({ expiresIn: 3600, paths }),
  });
  const map = {};
  if (r.ok) {
    for (const s of await r.json()) {
      if (s.signedURL) map[s.path] = `${SB_URL}/storage/v1${s.signedURL}`;
    }
  }
  return rows.map((row) => ({ ...row, images: (row.images || []).map((p) => map[p]).filter(Boolean) }));
}

// 고객사 전용 링크 토큰 (영문·숫자 12자, 짐작할 수 없게 무작위)
const TOKEN_RE = /^[A-Za-z0-9]{8,32}$/;
function newToken() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  return [...require('node:crypto').randomBytes(12)].map((b) => chars[b % chars.length]).join('');
}
// 쓰고 있는 고객사만 돌려준다 (사용 중지했거나 없으면 null)
async function customerByToken(token) {
  if (!TOKEN_RE.test(String(token || ''))) return null;
  const r = await fetch(`${SB_URL}/rest/v1/customers?token=eq.${token}&active=is.true&select=id,name,code`, { headers: sbHeaders() });
  if (!r.ok) return null;
  const [c] = await r.json();
  return c || null;
}
// 회원이 연결된 고객사 (없으면 null)
async function membershipOf(userId) {
  const r = await fetch(`${SB_URL}/rest/v1/customer_members?user_id=eq.${encodeURIComponent(userId)}&select=customer_id,customers(name)`, { headers: sbHeaders() });
  if (!r.ok) return null;
  const [m] = await r.json();
  return m ? { id: m.customer_id, name: m.customers && m.customers.name } : null;
}

module.exports = { cleanBody, cleanFiles, FILE_BUCKET, PRIORITIES, CATEGORIES, CAUSES, BILLINGS, MODES, CHANNELS, custStatus, priorityOf, respondBy, ipHash, nextPublicNo, codeOf, bodyText, FILE_TYPES, PENDING_RE, signFiles, newToken, customerByToken, membershipOf, SB_URL, SB_KEY, SB_ANON, TABLE, BUCKET, STATUSES, KINDS, URGENCIES, sbHeaders, readBody, getUser, signImages };
