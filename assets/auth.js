// 손님 로그인 도우미. 브라우저에는 공개 키만 쓰고, 그것도 /api/auth-config에서 받아 온다.
(function () {
  const KEY = 'mr_session';
  let cfg = null;

  const Auth = {
    async config() {
      if (cfg) return cfg;
      const r = await fetch('/api/auth-config');
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || '로그인 준비가 안 됐어요.');
      return (cfg = d);
    },
    session() {
      try {
        const s = JSON.parse(sessionStorage.getItem(KEY) || 'null');
        if (s && s.access_token && s.expires_at > Date.now() / 1000 + 30) return s;
      } catch {}
      Auth.clear();
      return null;
    },
    save(d) {
      const expires_at = d.expires_at || Math.floor(Date.now() / 1000) + Number(d.expires_in || 3600);
      const email = (d.user && d.user.email) || d.email || '';
      try { sessionStorage.setItem(KEY, JSON.stringify({ access_token: d.access_token, email, expires_at })); } catch {}
    },
    clear() { try { sessionStorage.removeItem(KEY); } catch {} },
    // Supabase Auth 창구에 요청
    async call(path, { method = 'POST', body, token } = {}) {
      const c = await Auth.config();
      const headers = { apikey: c.key, 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      const r = await fetch(`${c.url}/auth/v1/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
      const d = await r.json().catch(() => ({}));
      return { ok: r.ok, status: r.status, data: d };
    },
    async logout() {
      const s = Auth.session();
      if (s) await Auth.call('logout', { token: s.access_token }).catch(() => {});
      Auth.clear();
      location.href = '/';
    },
    // 머리말 메뉴: 로그인 상태에 따라 바뀐다
    nav() {
      const el = document.getElementById('nav');
      if (!el) return;
      const s = Auth.session();
      el.innerHTML = s
        ? '<a href="/my">내 요청 내역</a><button type="button" id="logoutBtn">로그아웃</button>'
        : '<a href="/login">로그인</a><a href="/signup">회원가입</a>';
      const b = document.getElementById('logoutBtn');
      if (b) b.onclick = Auth.logout;
    },
  };

  // 메일 링크(가입 확인·비밀번호 다시 설정)로 돌아왔을 때
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get('access_token')) {
    if (h.get('type') === 'recovery') {
      if (!location.pathname.startsWith('/login')) location.replace('/login' + location.hash);
    } else {
      Auth.save({ access_token: h.get('access_token'), expires_in: h.get('expires_in'), expires_at: Number(h.get('expires_at')) || undefined });
      history.replaceState(null, '', location.pathname);
      location.replace('/my');
    }
  }

  window.Auth = Auth;
  document.addEventListener('DOMContentLoaded', () => {
    Auth.nav();
    const S = window.SITE || {};
    document.querySelectorAll('[data-site-name]').forEach((e) => { e.textContent = S.name; });
    document.querySelectorAll('[data-phone]').forEach((e) => {
      e.textContent = S.phone ? S.phone + (S.phoneHours ? ` (${S.phoneHours})` : '') : '전화번호 준비 중';
      // data-phone="split": 번호와 받는 시간을 따로 꾸밀 수 있게 나눈다
      if (S.phone && e.dataset.phone === 'split') {
        e.textContent = S.phone;
        if (S.phoneHours) { const h = document.createElement('small'); h.className = 'hours'; h.textContent = S.phoneHours; e.append(' ', h); }
      }
      if (S.phone && e.tagName === 'A') e.href = 'tel:' + S.phone.replace(/[^0-9+]/g, '');
    });
    // 글자 대신 묶음 전체가 전화 링크인 곳 (예: 첫 화면의 Tel)
    if (S.phone) document.querySelectorAll('[data-phone-link]').forEach((e) => { e.href = 'tel:' + S.phone.replace(/[^0-9+]/g, ''); });
  });
})();
