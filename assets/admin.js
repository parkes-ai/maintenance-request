// 관리자 화면 (요청함 · 요청 등록 · 고객사 · 인력 · 월 요약 · 회원)
// 서버 키는 브라우저에 없다. 모든 읽기·쓰기는 /api/admin 이 비밀번호를 확인한 뒤에 한다.
(function () {
  const $ = (id) => document.getElementById(id);
  const KEY = 'mr_admin';
  const STATUSES = ['새 요청', '배정', '처리 중', '보류', '완료'];
  const KINDS = ['오류', '수정 요청', '사용 문의'];
  const URGENCIES = ['보통', '급함', '업무 중단 중'];
  const PRIORITIES = ['긴급', '보통', '낮음'];
  const CATEGORIES = ['장애', '서비스 요청', '변경 요청'];
  const CAUSES = ['우리 결함', '사용 문의·교육', '추가 요청', '고객 환경'];
  const BILLINGS = ['무상', '건당', '시간당', '월 정액', '계약 범위 안'];
  const MODES = ['원격', '방문', '개발', '전화·메일'];
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
  const opt = (list, cur, empty) => (empty !== undefined ? `<option value="">${empty}</option>` : '') + list.map((x) => `<option${x === cur ? ' selected' : ''}>${esc(x)}</option>`).join('');
  const date = (s) => new Date(s).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const stamp = (s) => (s ? new Date(s).toLocaleString('ko-KR') : '');
  const hm = (min) => { min = Math.round(min || 0); const h = Math.floor(min / 60), m = min % 60; return h ? `${h}시간${m ? ' ' + m + '분' : ''}` : `${m}분`; };
  const hours = (min) => (Math.round((min || 0) / 6) / 10).toLocaleString('ko-KR');
  const todayKst = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const delDate = (s) => { const d = new Date(s); d.setFullYear(d.getFullYear() + 1); return d.toLocaleDateString('ko-KR'); };
  const getPw = () => { try { return sessionStorage.getItem(KEY) || ''; } catch { return ''; } };
  const setPw = (v) => { try { v ? sessionStorage.setItem(KEY, v) : sessionStorage.removeItem(KEY); } catch {} };
  const no = (r) => r.public_no || `#${r.id}`;
  const companyName = (r) => (r.customers && r.customers.name) || r.company;

  let memPw = getPw();
  let rows = [], customers = [], staff = [];
  let tab = 'req';
  let shown = [];
  const filter = { status: '', urgency: '', late: false, user: '', userEmail: '', q: '', cust: '', custId: null, custName: '' };
  const staffName = (id) => (staff.find((s) => s.id === id) || {}).name || (id ? `#${id}` : '');
  const custById = (id) => customers.find((c) => c.id === Number(id));

  // ───── 공통: 서버 요청 · 잠그기 · 알림 ─────
  async function api(method, body, query = '') {
    const r = await fetch('/api/admin' + query, { method, headers: { 'x-admin-password': memPw, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const d = await r.json().catch(() => ({}));
    if (r.status === 401) { lock('비밀번호가 맞지 않아요.'); throw new Error('locked'); }
    if (!r.ok) throw new Error(d.error || '문제가 생겼어요.');
    return d;
  }
  const showErr = (id, e) => { if (e && e.message === 'locked') return; $(id).textContent = e.message || e; $(id).hidden = false; $(id).scrollIntoView({ block: 'center', behavior: 'smooth' }); };
  function toast(text) {
    document.querySelectorAll('.toast').forEach((t) => t.remove());
    const t = document.createElement('div');
    t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = text;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }
  function lock(msg) {
    memPw = ''; setPw('');
    $('box').hidden = true; $('lock').hidden = false; $('reload').hidden = true; $('out').hidden = true;
    $('pw').value = '';
    if (msg) { $('lockErr').textContent = msg; $('lockErr').hidden = false; }
    $('pw').focus();
  }
  async function load() {
    $('err').hidden = true;
    try {
      const [d, c, s] = await Promise.all([api('GET'), api('GET', null, '?view=customers'), api('GET', null, '?view=staff')]);
      rows = d.rows; customers = c.customers; staff = s.staff;
      $('lock').hidden = true; $('box').hidden = false; $('reload').hidden = false; $('out').hidden = false; $('lockErr').hidden = true;
      draw();
    } catch (e) {
      if (e.message !== 'locked') { $('lock').hidden = true; $('box').hidden = false; showErr('err', e); }
    }
  }

  // ───── 탭 ─────
  function showTab(t) {
    tab = t;
    document.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === t));
    ['req', 'add', 'cust', 'staff', 'sum', 'mem'].forEach((x) => { $('view-' + x).hidden = x !== t; });
    drawPicked();
    if (t === 'cust') drawCustomers(true);
    if (t === 'staff') drawStaff(true);
    if (t === 'mem') loadMembers();
    if (t === 'sum') loadSummary();
    if (t === 'add') addEditor();
  }
  document.querySelector('.tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) showTab(b.dataset.tab); });

  // ───── 고객사 고르기 (검색 + 목록) ─────
  // input 옆에 목록을 띄운다. 고르면 onPick(customer), 직접 적으면 onPick(null)
  function combo(input, hintEl, onPick, initialId) {
    const box = input.parentElement;
    let list = null, idx = -1, picked = initialId ? custById(initialId) : null;
    const hint = () => {
      if (!hintEl) return;
      hintEl.classList.toggle('linked', !!picked);
      hintEl.textContent = picked ? `등록 고객사 ${picked.name}${picked.code ? ' (' + picked.code + ')' : ''}에 연결돼요.` : (input.value.trim() ? '등록되지 않은 회사예요. 신규 문의로 들어가요.' : '등록된 고객사를 고르거나, 새 회사 이름을 적으면 신규 문의로 들어가요.');
    };
    const close = () => { if (list) { list.remove(); list = null; } input.setAttribute('aria-expanded', 'false'); idx = -1; };
    const choose = (c) => { picked = c; if (c) input.value = c.name; close(); hint(); onPick(c); };
    const open = () => {
      const q = input.value.trim().toLowerCase();
      const found = customers.filter((c) => !q || c.name.toLowerCase().includes(q) || (c.code || '').toLowerCase().includes(q)).slice(0, 30);
      close();
      list = document.createElement('ul');
      list.className = 'combo-list'; list.setAttribute('role', 'listbox');
      list.innerHTML = found.map((c, i) => `<li role="option" data-i="${i}" aria-selected="false">${esc(c.name)}<small>${esc(c.code || '')}${c.active ? '' : ' · 사용 중지'}</small></li>`).join('')
        + (q && !found.some((c) => c.name.toLowerCase() === q) ? `<li class="new" data-new="1">"${esc(input.value.trim())}" 신규 문의로 넣기</li>` : '')
        + (!found.length && !q ? '<li class="new" aria-disabled="true">등록된 고객사가 없어요</li>' : '');
      list._found = found;
      box.appendChild(list);
      input.setAttribute('aria-expanded', 'true');
    };
    input.addEventListener('focus', open);
    input.addEventListener('input', () => { picked = null; hint(); onPick(null); open(); });
    input.addEventListener('blur', () => setTimeout(close, 150));
    input.addEventListener('keydown', (e) => {
      if (!list) return;
      const items = [...list.querySelectorAll('li[data-i]')];
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        idx = Math.max(0, Math.min(items.length - 1, idx + (e.key === 'ArrowDown' ? 1 : -1)));
        items.forEach((li, i) => li.setAttribute('aria-selected', i === idx));
        if (items[idx]) items[idx].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter' && idx >= 0) { e.preventDefault(); choose(list._found[idx]); }
      else if (e.key === 'Escape') close();
    });
    box.addEventListener('mousedown', (e) => {
      const li = e.target.closest('.combo-list li'); if (!li) return;
      e.preventDefault();
      if (li.dataset.i !== undefined) choose(list._found[Number(li.dataset.i)]);
      else if (li.dataset.new) { picked = null; close(); hint(); onPick(null); }
    });
    hint();
    return { get: () => picked, reset: () => { picked = null; input.value = ''; hint(); } };
  }

  // ───── 요청함: 필터 · 검색 · 48시간 · 선택 ─────
  const LATE_MS = 48 * 3600 * 1000;
  const isLate = (r) => r.status === '새 요청' && Date.now() - new Date(r.created_at) > LATE_MS;
  const waited = (s) => { const h = Math.floor((Date.now() - new Date(s)) / 3600000); return h < 72 ? h + '시간째 기다리는 중' : Math.floor(h / 24) + '일째 기다리는 중'; };
  const matches = (r) => {
    const words = filter.q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return true;
    const text = [r.public_no, companyName(r), r.name, r.contact, r.phone, r.program, r.message, r.memo, r.kind, staffName(r.assigned_to)].join(' ').toLowerCase();
    return words.every((w) => (/^#\d+$/.test(w) ? String(r.id) === w.slice(1) : text.includes(w)));
  };
  const picked = new Set();
  function drawPicked() {
    for (const id of picked) if (!shown.some((r) => r.id === id)) picked.delete(id);
    $('selBar').hidden = !picked.size || tab !== 'req';
    document.body.classList.toggle('sel-on', !$('selBar').hidden);
    $('selN').textContent = picked.size;
  }
  const bindFilter = (id, key) => $(id).addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    filter[key] = b.dataset.v; filter.late = false;
    $(id).querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    draw();
  });
  bindFilter('fStatus', 'status'); bindFilter('fUrg', 'urgency'); bindFilter('fCust', 'cust');
  $('late').onclick = () => {
    filter.late = !filter.late;
    if (filter.late) { filter.status = ''; filter.urgency = ''; document.querySelectorAll('#fStatus button, #fUrg button').forEach((x) => x.classList.toggle('on', x.dataset.v === '')); }
    draw();
  };
  let qTimer;
  $('q').addEventListener('input', () => { clearTimeout(qTimer); qTimer = setTimeout(() => { filter.q = $('q').value; draw(); }, 150); });
  $('userClear').onclick = () => { filter.user = ''; filter.userEmail = ''; filter.custId = null; filter.custName = ''; draw(); };

  // ───── 최근 30일 접수 막대 ─────
  const dayKey = (d) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  const md = (d) => `${d.getMonth() + 1}월 ${d.getDate()}일`;
  function drawTrend() {
    const days = [];
    const today = new Date(); today.setHours(0, 0, 0, 0);
    for (let i = 29; i >= 0; i--) { const d = new Date(today); d.setDate(d.getDate() - i); days.push({ d, n: 0 }); }
    const idx = Object.fromEntries(days.map((x, i) => [dayKey(x.d), i]));
    rows.forEach((r) => { const i = idx[dayKey(new Date(r.created_at))]; if (i !== undefined) days[i].n++; });
    const max = Math.max(...days.map((x) => x.n));
    const total = days.reduce((s, x) => s + x.n, 0);
    const peakAt = max ? days.map((x) => x.n).lastIndexOf(max) : -1;
    $('trendSum').textContent = `모두 ${total}건`;
    $('axisFrom').textContent = md(days[0].d);
    $('chart').setAttribute('aria-label', `최근 30일 동안 ${total}건 접수, 하루 최대 ${max}건`);
    $('chart').innerHTML = days.map((x, i) => {
      const h = max ? (x.n / max) * 100 : 0;
      const peak = i === peakAt ? `<span class="peak" style="bottom:calc(${h}% + 2px)">${max}</span>` : '';
      return `<div class="col" tabindex="0" data-tip="${md(x.d)} ${x.n}건"><i style="height:${h}%"></i>${peak}</div>`;
    }).join('');
    $('trendTable').tBodies[0].innerHTML = days.slice().reverse().map((x) => `<tr><td>${md(x.d)}</td><td>${x.n}건</td></tr>`).join('');
  }
  (function () {
    const chart = $('chart');
    let tip = null;
    const hide = () => { if (tip) { tip.remove(); tip = null; } };
    const show = (col) => {
      if (!col) return hide();
      if (!tip) { tip = document.createElement('div'); tip.className = 'tip'; chart.appendChild(tip); }
      tip.textContent = col.dataset.tip;
      const half = tip.offsetWidth / 2;
      tip.style.left = Math.min(Math.max(col.offsetLeft + col.offsetWidth / 2, half), chart.clientWidth - half) + 'px';
      tip.style.top = '-6px';
    };
    chart.addEventListener('pointerover', (e) => show(e.target.closest('.col')));
    chart.addEventListener('pointerleave', hide);
    chart.addEventListener('focusin', (e) => show(e.target.closest('.col')));
    chart.addEventListener('focusout', hide);
  })();

  // ───── 요청 카드 ─────
  const editing = { id: null, v: null, combo: null };
  const procOpen = new Set();
  const wlCache = {};
  function dueText(r) {
    if (r.status === '완료' || !r.respond_by) return '';
    if (r.first_response_at) return `<span class="due ok">응답함 ${date(r.first_response_at)}</span>`;
    const left = new Date(r.respond_by) - Date.now();
    if (left < 0) return `<span class="due over">응답 목표 지남 (${date(r.respond_by)})</span>`;
    const h = Math.floor(left / 3600000), m = Math.floor((left % 3600000) / 60000);
    return `<span class="due ok">응답 목표 ${date(r.respond_by)} · ${h ? h + '시간 ' : ''}${m}분 남음</span>`;
  }
  function procSummary(r) {
    const bits = [];
    bits.push(`<b>${esc(r.priority || '우선순위 없음')}</b>`);
    if (r.category) bits.push(esc(r.category));
    bits.push(r.assigned_to ? `담당 <b>${esc(staffName(r.assigned_to))}</b>` : '담당 없음');
    bits.push(`처리 <b>${hm(r.minutes_spent)}</b>`);
    bits.push(r.cause ? `원인 ${esc(r.cause)}` : '원인 미정');
    if (r.billing_override) bits.push(`청구 ${esc(r.billing_override)}`);
    if (r.approval_status) bits.push(`유상 승인 <b>${esc(r.approval_status)}</b>`);
    return `<span class="proc-sum">${bits.join(' · ')}</span>`;
  }
  function procBody(r) {
    const active = staff.filter((s) => s.status === '재직' || s.id === r.assigned_to);
    const custBilling = r.customers && r.customers.billing;
    const effective = r.billing_override || (r.cause === '우리 결함' ? '무상' : (custBilling || '무상'));
    const logs = wlCache[r.id];
    const ap = r.approval_status;
    return `
      <div class="proc-body" data-proc="${r.id}">
        <div class="proc-grid">
          <label>우선순위<select data-p="priority">${opt(PRIORITIES, r.priority)}</select></label>
          <label>유형<select data-p="category">${opt(CATEGORIES, r.category, '미분류')}</select></label>
          <label>원인 (완료 때 필수)<select data-p="cause">${opt(CAUSES, r.cause, '고르기')}</select></label>
          <label>담당자<select data-p="assigned_to"><option value="">없음</option>${active.map((s) => `<option value="${s.id}"${s.id === r.assigned_to ? ' selected' : ''}>${esc(s.name)}${s.status === '퇴사' ? ' (퇴사)' : ''}</option>`).join('')}</select></label>
          <label>청구 예외<select data-p="billing_override">${opt(BILLINGS, r.billing_override, `고객사 기준 (${custBilling || '없음'})`)}</select></label>
          <label>적용 청구 방식<input type="text" value="${esc(effective)}${effective === '무상' || effective === '계약 범위 안' ? ' · 무상 응대' : ''}" readonly></label>
        </div>
        <div>
          <h4>작업 기록 <span>처리 시간 합계 ${hm(r.minutes_spent)}</span></h4>
          <ul class="wl">${logs ? (logs.length ? logs.map((l) => `<li><span>${esc(l.worked_on.slice(5).replace('-', '/'))}</span><span>${esc(l.mode)}</span><span>${esc(l.note || '')}${l.staff_id ? ` <small style="color:var(--muted)">· ${esc(staffName(l.staff_id))}</small>` : ''}</span><span><span class="m">${l.minutes}분</span> <button type="button" class="x" data-wldel="${l.id}" data-rid="${r.id}">지우기</button></span></li>`).join('') : '<li style="display:block;color:var(--muted)">아직 작업 기록이 없어요.</li>') : '<li style="display:block;color:var(--muted)">불러오는 중…</li>'}</ul>
          <form class="wl-add" data-wl="${r.id}">
            <label>날짜<input type="date" name="worked_on" value="${todayKst()}"></label>
            <label>방식<select name="mode">${opt(MODES, '원격')}</select></label>
            <label>분<input type="number" name="minutes" min="1" max="1440" step="1" required placeholder="30"></label>
            <label>내용<input type="text" name="note" maxlength="500" placeholder="한 줄 메모"></label>
            <label>한 사람<select name="staff_id"><option value="">-</option>${staff.filter((s) => s.status === '재직').map((s) => `<option value="${s.id}"${s.id === r.assigned_to ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
            <button type="submit">기록 추가</button>
          </form>
        </div>
        <div>
          <h4>유상 작업 승인 <span>고객이 내 요청 내역에서 동의해요</span></h4>
          ${ap ? `<div class="ap-state${ap === '동의' ? ' yes' : ap === '거절' ? ' no' : ''}">
              <b>${esc(ap === '요청함' ? '고객 답변 기다리는 중' : ap === '동의' ? '고객이 동의함' : '고객이 동의하지 않음')}</b> · 예상 ${hm(r.approval_minutes)} · ${esc(r.approval_note || '')}
              <div style="color:var(--muted);font-size:13px;margin-top:4px">요청 ${stamp(r.approval_requested_at)}${r.approval_decided_at ? ` · 답변 ${stamp(r.approval_decided_at)} (${esc(r.approval_by || '')})` : ''}</div>
              <div class="ap-actions"><button type="button" class="line" data-apcancel="${r.id}">${ap === '요청함' ? '요청 취소' : '기록 지우고 다시 요청'}</button></div>
            </div>`
          : `<form class="ap-form" data-ap="${r.id}">
              <label>예상 시간(분)<input type="number" name="minutes" min="1" step="1" required placeholder="180"></label>
              <label>무슨 작업인지 (고객에게 보여요)<input type="text" name="note" maxlength="1000" required placeholder="예: 보고서에 열 2개 추가 개발"></label>
              <button type="submit">승인 요청</button>
            </form>`}
        </div>
      </div>`;
  }
  function editForm(r) {
    const v = editing.v;
    const f = (name, label, max, type = 'text') => `<label>${label}<input type="${type}" name="${name}" maxlength="${max}" value="${esc(v[name])}"></label>`;
    const legacy = !Array.isArray(r.body);
    return `
        <form class="edit" data-id="${r.id}">
          <div class="edit-grid">
            <label>고객<div class="combo"><input type="text" name="company" maxlength="100" autocomplete="off" value="${esc(v.company)}" role="combobox" aria-expanded="false"></div><span class="combo-hint" data-hint></span></label>
            ${f('program', '프로그램', 100)}
            ${f('name', '이름', 50)}${f('contact', '이메일', 100, 'email')}
            ${f('phone', '전화', 20, 'tel')}
            <label>요청 종류<select name="kind">${opt(KINDS, v.kind)}</select></label>
            <label>급한 정도<select name="urgency">${opt(URGENCIES, v.urgency)}</select></label>
          </div>
          ${legacy ? `<label>내용<textarea name="message" maxlength="3000">${esc(v.message)}</textarea></label>` : '<p class="hint">본문(글·이미지)과 첨부파일은 손님이 보낸 그대로 보관해요.</p>'}
          <p class="hint">저장하면 "관리자 수정"으로 표시되고 변경 기록에 남아요.</p>
          <div class="edit-actions"><button type="button" data-edit-cancel>취소</button><button type="submit" class="primary">저장</button></div>
        </form>`;
  }
  function card(r, drafts) {
    const legacyImgs = (r.images || []).length ? `<div class="shots">${r.images.map((u, i) => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="캡처 ${i + 1}" loading="lazy"></a>`).join('')}</div>` : '';
    const mail = r.status === '완료' && r.mail_status ? `<span class="mail${r.mail_status === '실패' ? ' fail' : ''}">완료 메일 ${esc(r.mail_status)}${r.mail_error ? ' (' + esc(r.mail_error) + ')' : ''}</span>` : '';
    return `
      <article class="item${r.urgency === '업무 중단 중' ? ' stop' : ''}${isLate(r) ? ' late' : ''}${picked.has(r.id) ? ' picked' : ''}" data-card="${r.id}">
        <div class="meta">
          <label class="pick"><input type="checkbox" data-pick="${r.id}"${picked.has(r.id) ? ' checked' : ''} aria-label="${esc(no(r))} 선택"></label>
          <span class="no">${esc(no(r))}</span><span>${date(r.created_at)}</span>
          ${r.channel && r.channel !== '웹' ? `<span class="ch">${esc(r.channel)}</span>` : ''}
          ${isLate(r) ? `<span class="wait">${waited(r.created_at)}</span>` : ''}
          ${r.urgency !== '보통' ? `<span class="pill ${r.urgency === '업무 중단 중' ? 'stop' : 'hurry'}">${esc(r.urgency)}</span>` : ''}
          ${r.customer_id ? '<span class="pill new">고객사</span>' : '<span class="pill doing">신규 문의</span>'}
          <span class="pill">${esc(r.kind)}</span>
          ${r.user_id ? '<span class="pill">회원</span>' : ''}
          ${dueText(r)}
          ${r.status === '완료' && r.completed_at ? `<span>${delDate(r.completed_at)} 자동 삭제 예정</span>` : ''}
          ${mail}
          ${r.edited_at ? `<span class="edited" title="${esc(stamp(r.edited_at))}">관리자 수정 ${date(r.edited_at)}</span>` : ''}
        </div>
        ${editing.id === r.id ? editForm(r) : `
        <h3>${esc(companyName(r))} · ${esc(r.program)}</h3>
        <p class="who">${esc(r.name)} · <button type="button" class="copy" data-copy="${esc(r.contact)}">${esc(r.contact)}</button>${r.phone ? ` · <button type="button" class="copy" data-copy="${esc(r.phone)}">${esc(r.phone)}</button>` : ''}</p>
        <div class="body-view" data-body="${r.id}"></div>
        <ul class="files-view" data-files="${r.id}" hidden></ul>`}
        ${legacyImgs}
        ${r.status === '보류' && r.hold_reason ? `<p class="hold">보류 사유: ${esc(r.hold_reason)}</p>` : ''}
        <form class="memo" data-id="${r.id}">
          <input type="text" maxlength="2000" placeholder="메모 (관리자만 보여요)" aria-label="${esc(no(r))} 메모" value="${esc(drafts[r.id] ?? r.memo ?? '')}">
          <button type="submit"${drafts[r.id] === undefined ? ' disabled' : ''}>저장</button>
        </form>
        <details class="proc" data-procd="${r.id}"${procOpen.has(r.id) ? ' open' : ''}><summary>${procSummary(r)}</summary>${procOpen.has(r.id) ? procBody(r) : ''}</details>
        <div class="states">${STATUSES.map((s) => `<button type="button" data-id="${r.id}" data-s="${s}" class="${r.status === s ? 'on' : ''}">${s}</button>`).join('')}</div>
        ${r.last_logged_at || r.edited_at ? `<details class="hist" data-hist="${r.id}"${histOpen.has(r.id) ? ' open' : ''}><summary>변경 기록 보기</summary><div class="hist-body">${histCache[r.id] ? histHtml(histCache[r.id]) : '불러오는 중…'}</div></details>` : ''}
        <div class="del-row">${editing.id === r.id ? '' : `<button type="button" class="del edit-btn" data-edit="${r.id}">수정</button>`}${r.customer_id ? '' : `<button type="button" class="del reg-btn" data-reg="${r.id}">고객사로 등록</button>`}<button type="button" class="del" data-del="${r.id}">요청 삭제</button></div>
      </article>`;
  }

  function draw() {
    drawTrend();
    if (editing.id && !rows.some((r) => r.id === editing.id)) { editing.id = null; editing.v = null; }
    document.querySelectorAll('[data-n]').forEach((el) => { el.textContent = rows.filter((r) => r.status === el.dataset.n).length; });
    const lateN = rows.filter(isLate).length;
    if (!lateN) filter.late = false;
    $('late').hidden = !lateN; $('lateN').textContent = lateN;
    $('lateGo').textContent = filter.late ? '전체 보기' : '모아 보기';
    const drafts = {};
    document.querySelectorAll('form.memo').forEach((f) => {
      const r = rows.find((x) => String(x.id) === f.dataset.id);
      const v = f.elements[0].value;
      if (r && v !== (r.memo ?? '')) drafts[r.id] = v;
    });
    $('userBar').hidden = !filter.user && !filter.custId;
    $('userEmail').textContent = filter.custId ? filter.custName : filter.userEmail;
    $('userWhat').textContent = filter.custId ? ' 고객사의 요청만 보는 중' : ' 회원의 요청만 보는 중';
    const list = shown = rows.filter((r) => matches(r) && (!filter.user || r.user_id === filter.user)
      && (!filter.custId || r.customer_id === filter.custId)
      && (!filter.cust || (filter.cust === 'reg' ? !!r.customer_id : !r.customer_id))
      && (!filter.late || isLate(r)) && (!filter.status || r.status === filter.status) && (!filter.urgency || r.urgency === filter.urgency));
    drawPicked();
    if (!list.length) {
      $('qInfo').textContent = filter.q.trim() ? '검색 결과 0건' : '';
      $('list').innerHTML = `<div class="empty">${filter.q.trim() ? `‘${esc(filter.q.trim())}’에 맞는 요청이 없어요. 다른 단어로 찾거나 위 필터를 풀어 보세요.` : '보여 줄 요청이 없어요.'}</div>`;
      return;
    }
    $('qInfo').textContent = filter.q.trim() ? `검색 결과 ${list.length}건` : '';
    $('list').innerHTML = list.map((r) => card(r, drafts)).join('');
    // 본문(글·이미지)과 첨부는 안전하게 따로 그린다
    for (const r of list) {
      const b = document.querySelector(`[data-body="${r.id}"]`);
      if (b) Editor.render(b, r.body, r.message);
      const f = document.querySelector(`[data-files="${r.id}"]`);
      if (f) Editor.renderFiles(f, r.attachments);
    }
    if (editing.id) { const f = document.querySelector(`form.edit[data-id="${editing.id}"]`); if (f) bindEditCombo(f); }
    histOpen.forEach((id) => loadHist(id));
    procOpen.forEach((id) => loadWl(id));
  }
  const findRow = (id) => rows.find((x) => x.id === Number(id));

  // ───── 처리 패널 ─────
  async function loadWl(id, force) {
    if (wlCache[id] && !force) return;
    try {
      const { logs } = await api('GET', null, `?view=worklogs&id=${id}`);
      wlCache[id] = logs;
      redrawProc(id);
    } catch (e) { showErr('err', e); }
  }
  function redrawProc(id) {
    const d = document.querySelector(`details[data-procd="${id}"]`);
    const r = findRow(id);
    if (!d || !r) return;
    d.querySelector('summary').innerHTML = procSummary(r);
    if (d.open) { const old = d.querySelector('.proc-body'); const tmp = document.createElement('div'); tmp.innerHTML = procBody(r); if (old) old.replaceWith(tmp.firstElementChild); else d.appendChild(tmp.firstElementChild); }
  }
  $('list').addEventListener('toggle', (e) => {
    const d = e.target.closest && e.target.closest('details.proc');
    if (!d) return;
    const id = Number(d.dataset.procd);
    if (d.open) { procOpen.add(id); if (!d.querySelector('.proc-body')) { const tmp = document.createElement('div'); tmp.innerHTML = procBody(findRow(id)); d.appendChild(tmp.firstElementChild); } loadWl(id); }
    else procOpen.delete(id);
  }, true);
  // 처리 항목은 고르는 즉시 저장
  $('list').addEventListener('change', async (e) => {
    const sel = e.target.closest('[data-p]');
    if (!sel) return;
    const id = Number(sel.closest('[data-proc]').dataset.proc);
    const key = sel.dataset.p;
    sel.disabled = true;
    try {
      const d = await api('PATCH', { id, process: { [key]: sel.value || null } });
      if (!d.unchanged) {
        delete histCache[id];
        await load();
        toast(key === 'assigned_to' && sel.value ? '담당자를 정했어요' : key === 'priority' ? '우선순위를 바꾸고 응답 목표를 다시 계산했어요' : '저장했어요');
      }
    } catch (err) { showErr('err', err); await load(); }
  });
  $('list').addEventListener('submit', async (e) => {
    const wl = e.target.closest('form.wl-add');
    const ap = e.target.closest('form.ap-form');
    if (!wl && !ap) return;
    e.preventDefault();
    const btn = (wl || ap).querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      if (wl) {
        const id = Number(wl.dataset.wl);
        const fd = new FormData(wl);
        const d = await api('POST', { request_id: id, worked_on: fd.get('worked_on'), mode: fd.get('mode'), minutes: Number(fd.get('minutes')), note: fd.get('note'), staff_id: fd.get('staff_id') || null }, '?view=worklogs');
        const r = findRow(id); if (r) { r.minutes_spent = d.minutes_spent; r.last_logged_at = new Date().toISOString(); }
        delete histCache[id];
        await loadWl(id, true);
        toast(`작업 기록을 남겼어요 · 합계 ${hm(d.minutes_spent)}`);
      } else {
        const id = Number(ap.dataset.ap);
        const fd = new FormData(ap);
        await api('PATCH', { id, approval: { minutes: Number(fd.get('minutes')), note: fd.get('note') } });
        delete histCache[id];
        await load();
        toast('고객에게 유상 작업 승인을 요청했어요');
      }
    } catch (err) { btn.disabled = false; showErr('err', err); }
  });

  // ───── 카드 버튼들 ─────
  $('list').addEventListener('click', async (e) => {
    const t = e.target;
    const c = t.closest('[data-copy]');
    if (c) {
      try { await navigator.clipboard.writeText(c.dataset.copy); const v = c.textContent; c.textContent = '복사했어요'; setTimeout(() => { c.textContent = v; }, 1200); }
      catch { const sel = getSelection(); const rg = document.createRange(); rg.selectNodeContents(c); sel.removeAllRanges(); sel.addRange(rg); }
      return;
    }
    const wd = t.closest('[data-wldel]');
    if (wd) {
      if (!confirm('이 작업 기록을 지울까요? 처리 시간 합계가 줄어요.')) return;
      try {
        const d = await api('DELETE', { id: Number(wd.dataset.wldel) }, '?view=worklogs');
        const rid = Number(wd.dataset.rid); const r = findRow(rid); if (r) r.minutes_spent = d.minutes_spent;
        delete histCache[rid];
        await loadWl(rid, true);
        toast(`작업 기록을 지웠어요 · 합계 ${hm(d.minutes_spent)}`);
      } catch (err) { showErr('err', err); }
      return;
    }
    const apc = t.closest('[data-apcancel]');
    if (apc) {
      if (!confirm('유상 승인 요청 기록을 지울까요?')) return;
      try { await api('PATCH', { id: Number(apc.dataset.apcancel), approval: { cancel: true } }); delete histCache[Number(apc.dataset.apcancel)]; await load(); toast('승인 요청을 지웠어요'); }
      catch (err) { showErr('err', err); }
      return;
    }
    const ed = t.closest('[data-edit]');
    if (ed) {
      const r = findRow(ed.dataset.edit);
      if (editing.id && editing.id !== r.id && !confirm(`${no(findRow(editing.id))} 요청을 고치는 중이에요. 저장하지 않고 이 요청을 고칠까요?`)) return;
      editing.id = r.id;
      editing.v = { company: companyName(r), customer_id: r.customer_id || null, program: r.program, name: r.name, contact: r.contact, phone: r.phone || '', kind: r.kind, urgency: r.urgency, message: r.message };
      draw();
      const f = document.querySelector(`form.edit[data-id="${r.id}"]`);
      if (f) { f.scrollIntoView({ block: 'center' }); f.elements.company.focus(); }
      return;
    }
    if (t.closest('[data-edit-cancel]')) { editing.id = null; editing.v = null; draw(); return; }
    const reg = t.closest('[data-reg]');
    if (reg) {
      const r = findRow(reg.dataset.reg);
      const name = prompt('고객사로 등록할 회사 이름을 확인해 주세요. 전용 링크가 만들어지고, 같은 이름으로 들어온 신규 문의도 함께 묶여요. (코드·청구 방식은 고객사 탭에서 정해요)', r.company);
      if (name === null) return;
      if (!name.trim()) return toast('회사 이름을 적어 주세요');
      reg.disabled = true;
      try {
        const d = await api('POST', { name: name.trim(), fromRequest: r.id }, '?view=customers');
        await load();
        toast(`${d.customer.name} 고객사${d.existed ? '에 묶었어요' : '를 만들었어요'} · 요청 ${d.linked}건`);
      } catch (err) { reg.disabled = false; showErr('err', err); }
      return;
    }
    const del = t.closest('[data-del]');
    if (del) {
      const id = Number(del.dataset.del), r = findRow(id);
      const nfiles = (r.images || []).length + (Array.isArray(r.body) ? r.body.filter((s) => s.t === 'img').length : 0) + (r.attachments || []).length;
      if (!confirm(`${no(r)} 요청을 지울까요?${nfiles ? ` 이미지·첨부 ${nfiles}개와 작업 기록도 함께 지워지고,` : ''} 되돌릴 수 없어요.`)) return;
      del.disabled = true;
      try { await api('DELETE', { id }); rows = rows.filter((x) => x.id !== id); draw(); toast(`${no(r)} 요청을 지웠어요`); }
      catch (err) { del.disabled = false; showErr('err', err); }
      return;
    }
    const b = t.closest('[data-s][data-id]');
    if (!b || b.classList.contains('on')) return;
    const id = Number(b.dataset.id), s = b.dataset.s;
    let reason;
    if (s === '보류') { reason = prompt('보류 사유를 적어 주세요. (예: 고객 자료 대기)'); if (reason === null) return; if (!reason.trim()) return toast('보류 사유를 적어 주세요'); }
    b.disabled = true;
    try {
      const d = await api('PATCH', { id, status: s, reason });
      delete histCache[id];
      await load();
      toast(`${no(findRow(id) || { id })} 요청을 '${s}'(으)로 바꿨어요${d.mail ? ` · 완료 메일 ${d.mail}` : ''}`);
    } catch (err) { b.disabled = false; showErr('err', err); }
  });

  // ───── 내용 고치기 ─────
  function bindEditCombo(f) {
    const input = f.elements.company;
    editing.combo = combo(input, f.querySelector('[data-hint]'), (c) => { editing.v.customer_id = c ? c.id : null; editing.v.company = input.value; }, editing.v.customer_id);
  }
  $('list').addEventListener('input', (e) => {
    const f = e.target.closest('form.edit');
    if (f && e.target.name) { editing.v[e.target.name] = e.target.value; return; }
    const m = e.target.closest('form.memo');
    if (m) { const r = findRow(m.dataset.id); m.elements[1].disabled = m.elements[0].value === (r.memo ?? ''); }
  });
  $('list').addEventListener('submit', async (e) => {
    const f = e.target.closest('form.edit');
    if (f) {
      e.preventDefault();
      const id = Number(f.dataset.id);
      const btn = f.querySelector('[type="submit"]'); btn.disabled = true;
      const v = editing.v;
      try {
        const d = await api('PATCH', { id, edit: { company: v.company, customer_id: v.customer_id || '', program: v.program, name: v.name, contact: v.contact, phone: v.phone, kind: v.kind, urgency: v.urgency, message: v.message } });
        editing.id = null; editing.v = null;
        delete histCache[id];
        await load();
        toast(d.unchanged ? '바뀐 내용이 없어서 그대로 뒀어요' : `${no(findRow(id) || { id })} 요청을 고쳤어요`);
      } catch (err) { btn.disabled = false; showErr('err', err); }
      return;
    }
    const m = e.target.closest('form.memo');
    if (m) {
      e.preventDefault();
      const btn = m.elements[1]; if (btn.disabled) return;
      btn.disabled = true;
      try {
        const memo = m.elements[0].value.trim();
        const d = await api('PATCH', { id: Number(m.dataset.id), memo });
        const r = findRow(m.dataset.id);
        r.memo = memo || null; m.elements[0].value = memo;
        if (!d.unchanged) { r.last_logged_at = new Date().toISOString(); delete histCache[r.id]; draw(); }
        toast(d.unchanged ? '바뀐 내용이 없어서 그대로 뒀어요' : memo ? '메모를 저장했어요' : '메모를 지웠어요');
      } catch (err) { btn.disabled = false; showErr('err', err); }
    }
  });

  // ───── 선택 · 여러 개 삭제 ─────
  $('list').addEventListener('change', (e) => {
    const c = e.target.closest('[data-pick]'); if (!c) return;
    const id = Number(c.dataset.pick);
    c.checked ? picked.add(id) : picked.delete(id);
    c.closest('.item').classList.toggle('picked', c.checked);
    drawPicked();
  });
  $('selAll').onclick = () => { shown.forEach((r) => picked.add(r.id)); draw(); };
  $('selNone').onclick = () => { picked.clear(); draw(); };
  $('selDel').onclick = async () => {
    const ids = [...picked];
    if (!ids.length) return;
    if (ids.length > 100) return toast('한 번에 100건까지 지울 수 있어요');
    if (!confirm(`선택한 요청 ${ids.length}건을 지울까요? 이미지·첨부와 작업 기록도 함께 지워지고, 되돌릴 수 없어요.`)) return;
    const btn = $('selDel'); btn.disabled = true;
    try {
      const d = await api('DELETE', { ids });
      const gone = new Set(d.deleted || ids);
      rows = rows.filter((r) => !gone.has(r.id)); picked.clear(); draw();
      toast(`요청 ${gone.size}건을 지웠어요`);
    } catch (err) { showErr('err', err); } finally { btn.disabled = false; }
  };

  // ───── 변경 기록 ─────
  const FIELD = { status: '상태', memo: '메모', company: '회사', customer_id: '고객사', program: '프로그램', name: '이름', contact: '이메일', phone: '전화', kind: '요청 종류', urgency: '급한 정도', message: '내용', priority: '우선순위', category: '유형', cause: '원인', assigned_to: '담당자', billing_override: '청구 예외', hold_reason: '보류 사유', minutes: '처리 시간(분)', approval: '유상 승인', channel: '접수 경로' };
  const HIST_KINDS = { status: '상태', process: '처리', memo: '메모', content: '내용 수정' };
  const kindOf = (k) => (k === 'status' || k === 'hold_reason' ? 'status' : k === 'memo' ? 'memo' : ['priority', 'category', 'cause', 'assigned_to', 'billing_override', 'minutes', 'approval'].includes(k) ? 'process' : 'content');
  let histKind = '';
  const histCache = {};
  const histOpen = new Set();
  const shownVal = (k, v) => (k === 'assigned_to' && v ? staffName(Number(v)) : k === 'customer_id' && v ? ((custById(v) || {}).name || `#${v}`) : v);
  const val = (k, v) => { v = shownVal(k, v); return v === null || v === undefined || v === '' ? '<i class="empty-val">(비어 있음)</i>' : esc(v); };
  const pickKind = (edits) => edits
    .map((e) => ({ ...e, changes: Object.fromEntries(Object.entries(e.changes).filter(([k]) => !histKind || kindOf(k) === histKind)) }))
    .filter((e) => Object.keys(e.changes).length);
  const histHtml = (all) => {
    const edits = pickKind(all);
    if (!edits.length) return `<div>${all.length && histKind ? `${HIST_KINDS[histKind]} 기록이 없어요. 위에서 "전체"를 고르면 모두 보여요.` : '기록이 없어요.'}</div>`;
    return edits.map((e) => `
      <div class="hist-item">
        <div class="hist-when">${esc(stamp(e.edited_at))}</div>
        ${Object.entries(e.changes).map(([k, c]) => `<div class="hist-row"><b>${esc(FIELD[k] || k)}</b><span class="from">${val(k, c.from)}</span><span aria-hidden="true">→</span><span class="sr">에서</span><span class="to">${val(k, c.to)}</span></div>`).join('')}
      </div>`).join('');
  };
  $('fHist').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    histKind = b.dataset.v;
    $('fHist').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    draw();
  });
  const histLoading = new Set();
  async function loadHist(id) {
    if (histCache[id] || histLoading.has(id)) return;
    histLoading.add(id);
    const body = () => document.querySelector(`details.hist[data-hist="${id}"] .hist-body`);
    try { const { edits } = await api('GET', null, `?view=edits&id=${id}`); histCache[id] = edits; if (body()) body().innerHTML = histHtml(edits); }
    catch (err) { if (body() && err.message !== 'locked') body().textContent = err.message; }
    finally { histLoading.delete(id); }
  }
  $('list').addEventListener('toggle', (e) => {
    const d = e.target.closest && e.target.closest('details.hist'); if (!d) return;
    const id = Number(d.dataset.hist);
    if (d.open) { histOpen.add(id); loadHist(id); } else histOpen.delete(id);
  }, true);

  // ───── CSV ─────
  const cell = (v) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const saveCsv = (prefix, head, lines) => {
    const csv = '﻿' + [head, ...lines].map((l) => l.map(cell).join(',')).join('\r\n');
    const d = new Date();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `${prefix}_${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $('csv').onclick = () => {
    if (!shown.length) return toast('내려받을 요청이 없어요');
    const head = ['접수번호', '접수 일시', '접수 경로', '회사', '구분', '이름', '이메일', '전화', '프로그램', '요청 종류', '급한 정도', '우선순위', '유형', '원인', '담당자', '처리 시간(분)', '청구 예외', '내용', '첨부 수', '상태', '보류 사유', '완료 일시', '유상 승인', '메모'];
    saveCsv('requests', head, shown.map((r) => [no(r), stamp(r.created_at), r.channel || '웹', companyName(r), r.customer_id ? '고객사' : '신규 문의', r.name, r.contact, r.phone, r.program, r.kind, r.urgency, r.priority, r.category, r.cause, staffName(r.assigned_to), r.minutes_spent || 0, r.billing_override, r.message,
      (r.attachments || []).length + (r.images || []).length, r.status, r.hold_reason, stamp(r.completed_at), r.approval_status, r.memo]));
    toast(`${shown.length}건을 내려받았어요`);
  };
  $('csvLog').onclick = async () => {
    if (!shown.length) return toast('내려받을 요청이 없어요');
    const btn = $('csvLog'); btn.disabled = true;
    try {
      const { edits } = await api('POST', { ids: shown.map((r) => r.id) }, '?view=edits');
      const kept = pickKind(edits);
      if (!kept.length) return toast(histKind ? `보이는 요청에 ${HIST_KINDS[histKind]} 기록이 없어요` : '보이는 요청에 변경 기록이 없어요');
      const byId = Object.fromEntries(shown.map((r) => [r.id, r]));
      const lines = kept.flatMap((e) => Object.entries(e.changes).map(([k, c]) => [stamp(e.edited_at), no(byId[e.request_id] || { id: e.request_id }), companyName(byId[e.request_id] || {}), FIELD[k] || k, shownVal(k, c.from) ?? '', shownVal(k, c.to) ?? '']));
      saveCsv(histKind ? `change-log-${histKind}` : 'change-log', ['변경 일시', '접수번호', '회사', '항목', '이전 값', '바뀐 값'], lines);
      toast(`변경 기록 ${lines.length}줄을 내려받았어요`);
    } catch (err) { showErr('err', err); } finally { btn.disabled = false; }
  };

  // ───── 요청 등록 (전화·이메일로 받은 건) ─────
  let addEd = null, addCombo = null, addCust = null;
  function addEditor() {
    if (addEd) return;
    addEd = Editor.create($('addEditor'), { label: '요청 내용', placeholder: '받은 내용을 적고, 캡처는 Ctrl+V로 붙여 넣어요', onError: (m) => showErr('addErr', m) });
    addCombo = combo($('addCompany'), $('addComboHint'), (c) => { addCust = c; });
  }
  $('addForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('addErr').hidden = true;
    if (addEd.busy()) return showErr('addErr', '이미지나 파일을 올리는 중이에요. 끝나면 다시 눌러 주세요.');
    const ed = addEd.value();
    const kind = (document.querySelector('input[name="addKind"]:checked') || {}).value;
    const body = {
      channel: $('addChannel').value, customer_id: addCust ? addCust.id : null, company: $('addCompany').value.trim(),
      name: $('addName').value.trim(), email: $('addEmail').value.trim(), phone: $('addPhone').value.trim(), program: $('addProgram').value.trim(),
      kind, urgency: (document.querySelector('input[name="addUrg"]:checked') || {}).value || '보통', body: ed.body, attachments: ed.attachments,
    };
    if (!body.customer_id && !body.company) return showErr('addErr', '고객을 선택하거나 회사 이름을 적어 주세요.');
    if (!body.name) return showErr('addErr', '이름을 입력해 주세요.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) return showErr('addErr', '이메일 주소를 확인해 주세요.');
    if (!body.program) return showErr('addErr', '프로그램을 적어 주세요.');
    if (!kind) return showErr('addErr', '요청 종류를 골라 주세요.');
    if (!ed.text.trim() && !ed.images) return showErr('addErr', '요청 내용을 입력하거나 이미지를 붙여넣어 주세요.');
    const btn = $('addSubmit'); btn.disabled = true; btn.textContent = '저장하는 중…';
    try {
      const d = await api('POST', body, '?view=create');
      addEd.reset(); addCombo.reset(); addCust = null;
      ['addName', 'addEmail', 'addPhone', 'addProgram'].forEach((id) => { $(id).value = ''; });
      document.querySelectorAll('input[name="addKind"]').forEach((r) => { r.checked = false; });
      await load();
      showTab('req');
      toast(`${d.no} 요청을 등록했어요`);
    } catch (err) { showErr('addErr', err); }
    finally { btn.disabled = false; btn.textContent = '요청 등록'; }
  });

  // ───── 고객사 ─────
  const linkOf = (t) => `${location.origin}/r/${t}`;
  const custOpen = new Set();
  async function drawCustomers(reload) {
    $('custErr').hidden = true;
    try {
      if (reload) customers = (await api('GET', null, '?view=customers')).customers;
      $('custList').innerHTML = customers.length ? customers.map((x) => `
        <article class="item cust${x.active ? '' : ' off'}">
          <h3><button type="button" data-cust="${x.id}" data-name="${esc(x.name)}" title="이 고객사의 요청만 보기">${esc(x.name)}</button>${x.active ? '' : '<span class="pill">사용 중지</span>'}</h3>
          <p class="meta-line">코드 <b>${esc(x.code || 'C' + String(x.id).padStart(3, '0') + ' (자동)')}</b> · 청구 <b>${esc(x.billing)}</b>${x.billing === '월 정액' ? ` · 포함 ${x.monthly_hours ?? '-'}시간/월` : ''}${x.contact ? ` · 담당 ${esc(x.contact)}` : ''}</p>
          ${x.scope_note ? `<p class="meta-line">계약 메모: ${esc(x.scope_note)}</p>` : ''}
          <p class="counts">요청 ${x.requests}건${x.open ? ` (진행 중 ${x.open})` : ''} · 연결된 회원 ${x.members}명</p>
          <div class="link"><code>${esc(linkOf(x.token))}</code><button type="button" data-copy-link="${esc(linkOf(x.token))}">링크 복사</button></div>
          <div class="cust-actions">
            <button type="button" data-cinfo="${x.id}">정보 고치기</button>
            <button type="button" data-rotate="${x.id}">링크 새로 만들기</button>
            <button type="button" data-active="${x.id}" data-on="${x.active ? 0 : 1}">${x.active ? '사용 중지' : '다시 사용'}</button>
          </div>
          ${custOpen.has(x.id) ? `<form class="info-form" data-cform="${x.id}">
            <label>회사 이름<input name="name" maxlength="100" value="${esc(x.name)}"></label>
            <label>코드<input name="code" maxlength="8" value="${esc(x.code || '')}" style="text-transform:uppercase" placeholder="영문·숫자 2~8자"></label>
            <label>청구 방식<select name="billing">${opt(BILLINGS, x.billing)}</select></label>
            <label>월 정액 포함 시간<input name="monthly_hours" type="number" min="0" step="0.5" value="${x.monthly_hours ?? ''}"></label>
            <label class="full">고객 측 담당자·연락처<input name="contact" maxlength="200" value="${esc(x.contact || '')}"></label>
            <label class="full">계약 범위 메모<input name="scope_note" maxlength="1000" value="${esc(x.scope_note || '')}"></label>
            <p class="hint full" style="margin:0">코드를 바꾸면 앞으로 들어오는 요청부터 새 코드로 번호가 붙어요.</p>
            <div class="acts"><button type="button" class="row-btn line" data-cclose="${x.id}">닫기</button><button type="submit">저장</button></div>
          </form>` : ''}
        </article>`).join('') : '<div class="empty">아직 등록한 고객사가 없어요. 위에서 회사 이름을 적어 추가해 주세요.</div>';
    } catch (err) { showErr('custErr', err); }
  }
  $('custAdd').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('custName').value.trim();
    if (!name) return;
    try {
      const d = await api('POST', { name, code: $('custCode').value.trim(), billing: $('custBilling').value, monthly_hours: $('custHours').value }, '?view=customers');
      ['custName', 'custCode', 'custHours'].forEach((id) => { $(id).value = ''; });
      await drawCustomers(true);
      toast(`${d.customer.name} 고객사를 추가했어요. 링크를 복사해 보내 주세요`);
    } catch (err) { showErr('custErr', err); }
  });
  $('custList').addEventListener('click', async (e) => {
    const t = e.target;
    const copy = t.closest('[data-copy-link]');
    if (copy) {
      try { await navigator.clipboard.writeText(copy.dataset.copyLink); toast('링크를 복사했어요'); }
      catch { const code = copy.previousElementSibling; const rg = document.createRange(); rg.selectNodeContents(code); getSelection().removeAllRanges(); getSelection().addRange(rg); }
      return;
    }
    const show = t.closest('[data-cust]');
    if (show) { filter.custId = Number(show.dataset.cust); filter.custName = show.dataset.name; filter.user = ''; filter.userEmail = ''; showTab('req'); draw(); scrollTo(0, 0); return; }
    const ci = t.closest('[data-cinfo]');
    if (ci) { const id = Number(ci.dataset.cinfo); custOpen.has(id) ? custOpen.delete(id) : custOpen.add(id); drawCustomers(); return; }
    const cc = t.closest('[data-cclose]');
    if (cc) { custOpen.delete(Number(cc.dataset.cclose)); drawCustomers(); return; }
    const rot = t.closest('[data-rotate]'), act = t.closest('[data-active]');
    if (!rot && !act) return;
    let body;
    if (rot) { if (!confirm('링크를 새로 만들까요? 예전 링크는 바로 쓸 수 없게 돼요. 새 링크를 고객사에 다시 보내 주세요.')) return; body = { id: Number(rot.dataset.rotate), rotate: true }; }
    else { const on = act.dataset.on === '1'; if (!on && !confirm('이 고객사의 링크를 사용 중지할까요? 그 링크로는 요청을 남길 수 없게 돼요.')) return; body = { id: Number(act.dataset.active), active: on }; }
    try { await api('PATCH', body, '?view=customers'); await drawCustomers(true); toast(rot ? '새 링크를 만들었어요. 복사해서 보내 주세요' : body.active ? '다시 쓸 수 있게 했어요' : '사용 중지했어요'); }
    catch (err) { showErr('custErr', err); }
  });
  $('custList').addEventListener('submit', async (e) => {
    const f = e.target.closest('[data-cform]'); if (!f) return;
    e.preventDefault();
    const id = Number(f.dataset.cform);
    const fd = new FormData(f);
    try {
      await api('PATCH', { id, info: { name: fd.get('name'), code: fd.get('code'), billing: fd.get('billing'), monthly_hours: fd.get('monthly_hours'), contact: fd.get('contact'), scope_note: fd.get('scope_note') } }, '?view=customers');
      custOpen.delete(id);
      await drawCustomers(true);
      toast('고객사 정보를 저장했어요');
    } catch (err) { showErr('custErr', err); }
  });

  // ───── 인력 ─────
  const staffOpen = new Set();
  async function drawStaff(reload) {
    $('staffErr').hidden = true;
    try {
      if (reload) staff = (await api('GET', null, '?view=staff')).staff;
      const busy = {};
      rows.forEach((r) => { if (r.assigned_to && r.status !== '완료') busy[r.assigned_to] = (busy[r.assigned_to] || 0) + 1; });
      $('staffList').innerHTML = staff.length ? staff.map((s) => `
        <article class="item staff${s.status === '퇴사' ? ' off' : ''}">
          <h3>${esc(s.name)} <span class="pill${s.status === '재직' ? ' new' : ''}">${esc(s.status)}</span></h3>
          <p class="meta-line">${s.email ? esc(s.email) : '이메일 없음'}${s.phone ? ' · ' + esc(s.phone) : ''}${s.availability ? ' · 가용 ' + esc(s.availability) : ''}</p>
          <p class="counts">맡은 진행 중 요청 ${busy[s.id] || 0}건 · ${s.joined_at ? '등록 ' + esc(s.joined_at) : ''}${s.left_at ? ' · 퇴사 ' + esc(s.left_at) : ''}</p>
          <div class="cust-actions">
            <button type="button" data-sinfo="${s.id}">정보 고치기</button>
            <button type="button" data-sstat="${s.id}" data-to="${s.status === '재직' ? '퇴사' : '재직'}">${s.status === '재직' ? '퇴사 처리' : '재직으로 되돌리기'}</button>
          </div>
          ${staffOpen.has(s.id) ? `<form class="info-form" data-sform="${s.id}">
            <label>이름<input name="name" maxlength="50" value="${esc(s.name)}"></label>
            <label>이메일<input name="email" type="email" maxlength="100" value="${esc(s.email || '')}"></label>
            <label>전화<input name="phone" maxlength="20" value="${esc(s.phone || '')}"></label>
            <label>가용 시간<input name="availability" maxlength="200" value="${esc(s.availability || '')}"></label>
            <div class="acts"><button type="button" class="row-btn line" data-sclose="${s.id}">닫기</button><button type="submit">저장</button></div>
          </form>` : ''}
        </article>`).join('') : '<div class="empty">아직 등록한 인력이 없어요. 위에서 이름을 적어 추가해 주세요.</div>';
    } catch (err) { showErr('staffErr', err); }
  }
  $('staffAdd').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('POST', { name: $('staffName').value, email: $('staffEmail').value, phone: $('staffPhone').value, availability: $('staffAvail').value }, '?view=staff');
      ['staffName', 'staffEmail', 'staffPhone', 'staffAvail'].forEach((id) => { $(id).value = ''; });
      await drawStaff(true);
      toast('인력을 추가했어요');
    } catch (err) { showErr('staffErr', err); }
  });
  $('staffList').addEventListener('click', async (e) => {
    const si = e.target.closest('[data-sinfo]');
    if (si) { const id = Number(si.dataset.sinfo); staffOpen.has(id) ? staffOpen.delete(id) : staffOpen.add(id); drawStaff(); return; }
    const sc = e.target.closest('[data-sclose]');
    if (sc) { staffOpen.delete(Number(sc.dataset.sclose)); drawStaff(); return; }
    const st = e.target.closest('[data-sstat]');
    if (!st) return;
    if (st.dataset.to === '퇴사' && !confirm('퇴사 처리할까요? 지난 기록은 남고, 담당자 목록에서만 빠져요.')) return;
    try { await api('PATCH', { id: Number(st.dataset.sstat), info: { status: st.dataset.to } }, '?view=staff'); await drawStaff(true); toast(st.dataset.to === '퇴사' ? '퇴사 처리했어요' : '재직으로 되돌렸어요'); }
    catch (err) { showErr('staffErr', err); }
  });
  $('staffList').addEventListener('submit', async (e) => {
    const f = e.target.closest('[data-sform]'); if (!f) return;
    e.preventDefault();
    const id = Number(f.dataset.sform), fd = new FormData(f);
    try {
      await api('PATCH', { id, info: { name: fd.get('name'), email: fd.get('email'), phone: fd.get('phone'), availability: fd.get('availability') } }, '?view=staff');
      staffOpen.delete(id); await drawStaff(true); toast('인력 정보를 저장했어요');
    } catch (err) { showErr('staffErr', err); }
  });

  // ───── 월 요약 · 월 응대 보고서 ─────
  let summary = null;
  async function loadSummary() {
    if (!$('sumMonth').value) $('sumMonth').value = todayKst().slice(0, 7);
    $('sumErr').hidden = true; $('report').hidden = true;
    try {
      summary = await api('GET', null, `?view=summary&month=${$('sumMonth').value}`);
      const [y, m] = summary.month.split('-');
      $('sumList').innerHTML = summary.groups.length ? summary.groups.map((g, i) => {
        const ratio = g.minutes ? Math.round((g.free_minutes / g.minutes) * 100) : null;
        const quota = g.billing === '월 정액' && g.monthly_hours ? Math.round((g.minutes / 60 / g.monthly_hours) * 100) : null;
        const chips = (o) => Object.entries(o).map(([k, n]) => `${esc(k)} ${n}`).join(' · ');
        return `
          <article class="item">
            <h3>${esc(g.name)} <span class="ch">${esc(g.code || '')}</span></h3>
            <p class="meta-line">${y}년 ${Number(m)}월 · 청구 ${esc(g.billing || '없음')}${g.billing === '월 정액' ? ` · 포함 ${g.monthly_hours ?? '-'}시간` : ''}</p>
            <dl class="ms">
              <div><dt>접수</dt><dd>${g.total}<small>건 (완료 ${g.done})</small></dd></div>
              <div><dt>처리 시간</dt><dd>${hours(g.minutes)}<small>시간</small></dd></div>
              <div><dt>무상 응대</dt><dd>${hours(g.free_minutes)}<small>시간${ratio !== null ? ` · ${ratio}%` : ''}</small></dd></div>
              <div><dt>${quota !== null ? '월 정액 사용' : '응답 목표 달성'}</dt><dd${quota !== null && quota > 100 ? ' class="over-quota"' : ''}>${quota !== null ? `${quota}<small>%</small>` : g.responded ? `${Math.round((g.on_time / g.responded) * 100)}<small>% (${g.on_time}/${g.responded})</small>` : '<small>-</small>'}</dd></div>
            </dl>
            <p class="chips-line">원인: ${chips(g.by_cause)}</p>
            <p class="chips-line">유형: ${chips(g.by_category)} · 요청 종류: ${chips(g.by_kind)}</p>
            ${g.approvals.요청함 + g.approvals.동의 + g.approvals.거절 ? `<p class="chips-line">유상 승인: 동의 ${g.approvals.동의} · 거절 ${g.approvals.거절} · 대기 ${g.approvals.요청함}</p>` : ''}
            <div class="cust-actions" style="margin-top:10px"><button type="button" data-report="${i}">월 응대 보고서 보기</button></div>
          </article>`;
      }).join('') : `<div class="empty">${y}년 ${Number(m)}월에 접수된 요청이 없어요.</div>`;
    } catch (err) { showErr('sumErr', err); }
  }
  $('sumLoad').onclick = loadSummary;
  $('sumMonth').addEventListener('change', loadSummary);
  $('sumList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-report]'); if (!b) return;
    const g = summary.groups[Number(b.dataset.report)];
    const [y, m] = summary.month.split('-');
    const ratio = g.minutes ? Math.round((g.free_minutes / g.minutes) * 100) : null;
    const quota = g.billing === '월 정액' && g.monthly_hours ? `${hours(g.minutes)} / ${g.monthly_hours}시간 (${Math.round((g.minutes / 60 / g.monthly_hours) * 100)}%)` : null;
    $('report').innerHTML = `
      <p class="mono" style="color:var(--accent)">Monthly Support Report</p>
      <h2>${esc(g.name)} · ${y}년 ${Number(m)}월 유지보수 응대 보고서</h2>
      <p class="r-sub">작성 ${esc(new Date().toLocaleDateString('ko-KR'))} · 청구 방식 ${esc(g.billing || '-')}</p>
      <dl class="ms">
        <div><dt>접수</dt><dd>${g.total}<small>건 (완료 ${g.done})</small></dd></div>
        <div><dt>처리 시간 합계</dt><dd>${hours(g.minutes)}<small>시간</small></dd></div>
        <div><dt>무상 응대 시간</dt><dd>${hours(g.free_minutes)}<small>시간${ratio !== null ? ` · ${ratio}%` : ''}</small></dd></div>
        <div><dt>${quota ? '월 정액 사용' : '응답 목표 달성'}</dt><dd><small>${quota || (g.responded ? `${Math.round((g.on_time / g.responded) * 100)}% (${g.on_time}/${g.responded})` : '-')}</small></dd></div>
      </dl>
      <p class="chips-line">원인별: ${Object.entries(g.by_cause).map(([k, n]) => `${esc(k)} ${n}건`).join(' · ')}</p>
      <div class="r-table"><table>
        <thead><tr><th>접수번호</th><th>접수일</th><th>요청</th><th>종류</th><th>원인</th><th>처리 시간</th><th>구분</th><th>상태</th></tr></thead>
        <tbody>${g.rows.map((r) => `<tr><td class="n">${esc(r.no)}</td><td class="n">${esc(new Date(r.created_at).toLocaleDateString('ko-KR'))}</td><td>${esc(r.summary)}</td><td>${esc(r.kind)}</td><td>${esc(r.cause || '-')}</td><td class="n">${hm(r.minutes)}</td><td>${r.free ? '무상' : esc(r.billing)}</td><td>${esc(r.status)}</td></tr>`).join('')}</tbody>
      </table></div>
      <p class="r-note">처리 시간은 작업 기록의 합계예요. 무상 = 청구 방식이 무상·계약 범위 안이거나, 원인이 저희 프로그램 결함인 경우예요. 숫자는 ${esc(new Date().toLocaleString('ko-KR'))} 기준이에요.</p>
      <div class="report-acts"><button type="button" class="row-btn line" id="repClose">닫기</button><button type="button" class="row-btn" id="repPrint">인쇄 · PDF로 저장</button></div>`;
    $('report').hidden = false;
    $('report').scrollIntoView({ behavior: 'smooth' });
    $('repClose').onclick = () => { $('report').hidden = true; };
    $('repPrint').onclick = () => window.print();
  });

  // ───── 회원 ─────
  async function loadMembers() {
    $('memErr').hidden = true;
    try {
      const { members } = await api('GET', null, '?view=members');
      $('memN').textContent = members.length;
      const day = (s) => (s ? new Date(s).toLocaleString('ko-KR', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
      $('memList').innerHTML = members.length ? members.map((m) => `
        <article class="item member">
          <div class="mem-top"><button type="button" class="email" data-uid="${esc(m.id)}" data-email="${esc(m.email)}" title="이 회원의 요청만 보기">${esc(m.email)}</button><span class="reqs">${m.requests ? `요청 <b>${m.requests}</b>건${m.open ? ` <small>(진행 중 ${m.open})</small>` : ''}` : '요청 없음'}</span></div>
          ${m.company ? `<span class="when">회사 <b style="color:var(--ink)">${esc(m.company)}</b></span>` : '<span class="when">회사 연결 안 됨</span>'}
          <span class="when">가입 ${day(m.created_at)}${m.confirmed ? '' : ' · 메일 확인 전'}</span>
          <span class="when">마지막 로그인 ${m.last_sign_in_at ? day(m.last_sign_in_at) : '없음'}</span>
        </article>`).join('') : '<div class="empty">아직 가입한 회원이 없어요.</div>';
    } catch (err) { showErr('memErr', err); }
  }
  $('memList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-uid]'); if (!b) return;
    filter.user = b.dataset.uid; filter.userEmail = b.dataset.email; filter.custId = null; filter.custName = '';
    showTab('req'); draw(); scrollTo(0, 0);
  });

  // ───── 시작 ─────
  $('lock').addEventListener('submit', (e) => { e.preventDefault(); memPw = $('pw').value; if (!memPw) return; setPw(memPw); load(); });
  $('reload').onclick = () => (tab === 'mem' ? loadMembers() : tab === 'cust' ? drawCustomers(true) : tab === 'staff' ? drawStaff(true) : tab === 'sum' ? loadSummary() : load());
  $('out').onclick = () => lock();
  if (memPw) load(); else $('pw').focus();
})();
