// 메일처럼 쓰는 본문 편집기: 글 중간에 이미지(붙여넣기·끌어 놓기·고르기) + 첨부파일
// 저장할 때는 HTML이 아니라 [{t:'text', v}, {t:'img', p}] 목록으로 바꾼다 → 넣은 코드가 실행되지 않음
(function () {
  const IMG_MAX = 5, FILE_MAX = 5, FILE_BYTES = 10 * 1024 * 1024;
  const FILE_ACCEPT = '.pdf,.xls,.xlsx,.doc,.docx,.ppt,.pptx,.hwp,.hwpx,.zip,.txt,.log,.csv,.png,.jpg,.jpeg';
  const size = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + 'MB' : Math.max(1, Math.round(n / 1024)) + 'KB');

  // 서버에서 한 번 쓰는 업로드 주소를 받아 저장소로 바로 올린다
  async function upload(file, kind) {
    const r = await fetch('/api/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: file.name, size: file.size, kind }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || '파일을 올리지 못했어요.');
    const p = await fetch(d.uploadUrl, { method: 'PUT', headers: { 'Content-Type': d.type, 'x-upsert': 'false' }, body: file });
    if (!p.ok) throw new Error('파일을 올리지 못했어요. 다시 시도해 주세요.');
    return d.path;
  }

  // 캡처를 가볍게 (긴 쪽 1600px, JPEG)
  async function shrink(file) {
    const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = URL.createObjectURL(file); });
    const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(img.src);
    let q = 0.85, blob;
    do { blob = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', q)); q -= 0.15; } while (blob.size > 1500000 && q > 0.35);
    return new File([blob], 'capture.jpg', { type: 'image/jpeg' });
  }

  function create(root, opts = {}) {
    const onError = opts.onError || ((m) => alert(m));
    root.classList.add('ed');
    root.innerHTML = `
      <div class="ed-area" contenteditable="true" role="textbox" aria-multiline="true" aria-label="${opts.label || '요청 내용'}" data-placeholder="${opts.placeholder || ''}"></div>
      <div class="ed-bar">
        <button type="button" class="ed-btn" data-act="img">이미지 넣기</button>
        <button type="button" class="ed-btn" data-act="file">파일 첨부</button>
        <span class="ed-hint">캡처한 뒤 본문에서 Ctrl+V로 붙여 넣어도 돼요 · 이미지 5장 · 첨부 5개(파일당 10MB)</span>
        <input type="file" accept="image/png,image/jpeg" multiple hidden data-in="img">
        <input type="file" accept="${FILE_ACCEPT}" multiple hidden data-in="file">
      </div>
      <ul class="ed-files" aria-label="첨부파일"></ul>`;
    const area = root.querySelector('.ed-area');
    const list = root.querySelector('.ed-files');
    let files = []; // {name, size, path, state: 'up'|'ok'|'err', li}
    let saved = null; // 마지막 커서 위치 (버튼을 누르면 포커스가 빠지므로 기억)

    const remember = () => { const s = getSelection(); if (s.rangeCount && area.contains(s.anchorNode)) saved = s.getRangeAt(0).cloneRange(); };
    area.addEventListener('keyup', remember); area.addEventListener('mouseup', remember); area.addEventListener('input', () => { remember(); opts.onInput && opts.onInput(); });

    const imgCount = () => area.querySelectorAll('.ed-img').length;
    function placeAtCaret(node) {
      area.focus();
      const s = getSelection();
      let r = saved && area.contains(saved.startContainer) ? saved : null;
      if (!r) { r = document.createRange(); r.selectNodeContents(area); r.collapse(false); }
      r.deleteContents(); r.insertNode(node);
      const after = document.createRange(); after.setStartAfter(node); after.collapse(true);
      s.removeAllRanges(); s.addRange(after); saved = after.cloneRange();
    }
    async function addImages(list) {
      for (const f of list) {
        if (!/^image\/(png|jpeg)$/.test(f.type)) { onError('본문에는 PNG·JPG 이미지만 넣을 수 있어요.'); continue; }
        if (imgCount() >= IMG_MAX) { onError('본문 이미지는 5장까지 넣을 수 있어요.'); break; }
        const fig = document.createElement('span');
        fig.className = 'ed-img up'; fig.contentEditable = 'false';
        const preview = URL.createObjectURL(f);
        fig.innerHTML = `<img alt="첨부 이미지" src="${preview}"><span class="ed-state">올리는 중…</span><button type="button" class="ed-x" aria-label="이미지 빼기">×</button>`;
        placeAtCaret(fig);
        try {
          const small = await shrink(f);
          fig.dataset.path = await upload(small, 'image');
          fig.classList.remove('up');
          fig.querySelector('.ed-state').remove();
        } catch (e) { fig.remove(); onError(e.message || '이미지를 넣지 못했어요.'); }
        opts.onInput && opts.onInput();
      }
    }
    function drawFiles() {
      list.innerHTML = '';
      files.forEach((f, i) => {
        const li = document.createElement('li');
        li.className = 'ed-file ' + f.state;
        li.innerHTML = `<span class="ed-fname"></span><span class="ed-fsize">${size(f.size)}${f.state === 'up' ? ' · 올리는 중…' : f.state === 'err' ? ' · 실패' : ''}</span><button type="button" class="ed-x" aria-label="첨부 빼기">×</button>`;
        li.querySelector('.ed-fname').textContent = f.name;
        li.querySelector('.ed-x').onclick = () => { files.splice(i, 1); drawFiles(); };
        list.appendChild(li);
      });
    }
    async function addFiles(chosen) {
      for (const f of chosen) {
        if (files.length >= FILE_MAX) { onError('첨부파일은 5개까지 올릴 수 있어요.'); break; }
        if (f.size > FILE_BYTES) { onError(`"${f.name}"은 10MB가 넘어서 올릴 수 없어요.`); continue; }
        const item = { name: f.name, size: f.size, state: 'up' };
        files.push(item); drawFiles();
        try { item.path = await upload(f, 'file'); item.state = 'ok'; }
        catch (e) { files = files.filter((x) => x !== item); onError(e.message); }
        drawFiles();
      }
    }

    // 붙여넣기: 이미지는 커서 위치에, 글은 꾸밈 없이 글자만
    area.addEventListener('paste', (e) => {
      const imgs = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
      e.preventDefault();
      if (imgs.length) { remember(); addImages(imgs); return; }
      const text = e.clipboardData.getData('text/plain');
      if (text) document.execCommand('insertText', false, text);
    });
    area.addEventListener('drop', (e) => {
      const dropped = [...(e.dataTransfer?.files || [])];
      if (!dropped.length) return;
      e.preventDefault();
      const imgs = dropped.filter((f) => /^image\/(png|jpeg)$/.test(f.type));
      const others = dropped.filter((f) => !imgs.includes(f));
      if (document.caretRangeFromPoint) { const r = document.caretRangeFromPoint(e.clientX, e.clientY); if (r && area.contains(r.startContainer)) saved = r; }
      if (imgs.length) addImages(imgs);
      if (others.length) addFiles(others);
    });
    area.addEventListener('click', (e) => { const x = e.target.closest('.ed-img .ed-x'); if (x) { x.closest('.ed-img').remove(); opts.onInput && opts.onInput(); } });
    root.querySelector('[data-act="img"]').onclick = () => { remember(); root.querySelector('[data-in="img"]').click(); };
    root.querySelector('[data-act="file"]').onclick = () => root.querySelector('[data-in="file"]').click();
    root.querySelector('[data-in="img"]').onchange = (e) => { addImages([...e.target.files]); e.target.value = ''; };
    root.querySelector('[data-in="file"]').onchange = (e) => { addFiles([...e.target.files]); e.target.value = ''; };

    // 편집기 내용 → 글 조각과 이미지 목록
    function segments() {
      const out = [];
      const push = (v) => { if (!v) return; const l = out[out.length - 1]; if (l && l.t === 'text') l.v += v; else out.push({ t: 'text', v }); };
      const walk = (node) => {
        for (const n of node.childNodes) {
          if (n.nodeType === 3) push(n.nodeValue.replace(/ /g, ' '));
          else if (n.nodeType === 1) {
            if (n.classList.contains('ed-img')) { if (n.dataset.path) out.push({ t: 'img', p: n.dataset.path }); continue; }
            if (n.tagName === 'BR') { push('\n'); continue; }
            const block = /^(DIV|P|LI)$/.test(n.tagName);
            if (block && out.length && !/\n$/.test((out[out.length - 1] || {}).v || '')) push('\n');
            walk(n);
            if (block) push('\n');
          }
        }
      };
      walk(area);
      // 앞뒤 빈 줄 정리
      if (out[0] && out[0].t === 'text') out[0].v = out[0].v.replace(/^\s+/, '');
      const l = out[out.length - 1]; if (l && l.t === 'text') l.v = l.v.replace(/\s+$/, '');
      return out.filter((s) => s.t !== 'text' || s.v);
    }

    return {
      value() {
        const body = segments();
        return {
          body,
          text: body.filter((s) => s.t === 'text').map((s) => s.v).join(''),
          images: body.filter((s) => s.t === 'img').length,
          attachments: files.filter((f) => f.state === 'ok').map((f) => ({ p: f.path, name: f.name, size: f.size })),
        };
      },
      busy() { return !!area.querySelector('.ed-img.up') || files.some((f) => f.state === 'up'); },
      reset() { area.innerHTML = ''; files = []; drawFiles(); saved = null; },
      focus() { area.focus(); },
      text() { return area.innerText; },
    };
  }

  // 저장된 본문을 안전하게 그리기 (글은 글자로만, 이미지는 임시 주소로)
  function render(container, body, fallbackText) {
    container.innerHTML = '';
    container.classList.add('ed-view');
    if (!Array.isArray(body) || !body.length) { container.textContent = fallbackText || ''; return; }
    for (const s of body) {
      if (s.t === 'text') container.appendChild(document.createTextNode(s.v));
      else if (s.t === 'img') {
        if (!s.url) { const m = document.createElement('span'); m.className = 'ed-missing'; m.textContent = '[이미지]'; container.appendChild(m); continue; }
        const a = document.createElement('a'); a.href = s.url; a.target = '_blank'; a.rel = 'noopener'; a.className = 'ed-shot';
        const img = document.createElement('img'); img.src = s.url; img.alt = '본문 이미지'; img.loading = 'lazy';
        a.appendChild(img); container.appendChild(a);
      }
    }
  }
  function renderFiles(container, files) {
    container.innerHTML = '';
    if (!files || !files.length) { container.hidden = true; return; }
    container.hidden = false;
    for (const f of files) {
      const li = document.createElement('li');
      const a = document.createElement(f.url ? 'a' : 'span');
      if (f.url) { a.href = f.url; a.target = '_blank'; a.rel = 'noopener'; a.download = f.name; }
      a.textContent = f.name;
      const s = document.createElement('span'); s.className = 'ed-fsize'; s.textContent = ' ' + size(f.size || 0);
      li.append(a, s); container.appendChild(li);
    }
  }

  window.Editor = { create, render, renderFiles };
})();
