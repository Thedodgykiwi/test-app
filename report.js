// "Report issue" on the stage banner (Issue #28): a drop-down under the banner
// with Title, Description and an optional type. Shown on Dev, Alpha, Staging
// (and local copies), never on Production.
//
// It saves the report to Firestore (issueReports/{id}); only signed-in people on
// the testers list (access/testers, field `emails`) may do that (firestore.rules).
// A GitHub Action (.github/workflows/issue-reports.yml) checks every few
// minutes, turns new reports into GitHub issues and emails the reporter a copy.
// sync.js provides window.AppCloud (who's signed in, and saving the report).
(() => {
  const stage = window.STAGE || 'local';
  if (stage === 'main') return;
  const TYPES = [['bug', 'Bug'], ['feature', 'Feature'], ['tweak', 'Tweak'], ['performance', 'Performance']];
  const STAGE_NAMES = { local: 'Local', dev: 'Dev', alpha: 'Alpha', staging: 'Staging' };

  const btn = document.getElementById('report-link');
  btn.hidden = false;
  const ic = (name, fallback) => (window.icon ? window.icon(name).outerHTML : fallback);
  btn.insertAdjacentHTML('afterbegin', ic('flag', ''));

  const box = document.createElement('div');
  box.id = 'report-box';
  box.className = 'report-box';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'false');
  box.setAttribute('aria-labelledby', 'report-heading');
  box.hidden = true;
  document.body.appendChild(box);
  btn.setAttribute('aria-controls', 'report-box');
  btn.setAttribute('aria-expanded', 'false');

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const head = `<div class="report-head"><h2 id="report-heading">Report an issue</h2>
    <button type="button" class="close-btn" data-close aria-label="Close">${ic('x', '✕')}</button></div>`;

  let draft = { title: '', body: '', type: '', shot: '' };   // kept if the box is closed by mistake

  // Screenshots are shrunk on the device to a JPEG of at most ~500 KB (the
  // database stores at most 1 MB per report), keeping text readable.
  async function shrink(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      let max = 1600, q = 0.82;
      for (let n = 0; n < 7; n++) {
        const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
        const g = c.getContext('2d');
        g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
        const out = c.toDataURL('image/jpeg', q);
        if (out.length <= 700000) return out;
        max = Math.round(max * 0.8); q = Math.max(0.5, q - 0.08);
      }
      throw new Error('too big');
    } finally { URL.revokeObjectURL(url); }
  }

  function showForm() {
    const user = window.AppCloud?.user();
    if (!user) {
      box.innerHTML = `${head}<p class="report-note">Sign in with Google to report an issue. Reports are open to testers only.</p>
        <button type="button" class="btn primary" data-signin>Sign in</button>`;
      box.querySelector('[data-signin]').onclick = () => { close(); window.AppCloud?.signIn(); };
      if (!window.AppCloud) box.querySelector('[data-signin]').hidden = true;
      return;
    }
    box.innerHTML = `${head}
      <form novalidate>
        <label for="report-title">Title</label>
        <input id="report-title" maxlength="120" autocomplete="off" placeholder="e.g. Done list doesn't scroll on iPhone" aria-describedby="report-title-msg">
        <p class="report-msg" id="report-title-msg" aria-live="polite"></p>
        <label for="report-body">What happened, or what you'd like</label>
        <textarea id="report-body" maxlength="5000" rows="4" placeholder="What you did, what you saw, what you expected" aria-describedby="report-body-msg"></textarea>
        <p class="report-msg" id="report-body-msg" aria-live="polite"></p>
        <p class="report-label" id="report-shot-label">Screenshot <span>(optional)</span></p>
        <div class="report-shot" data-shot></div>
        <p class="report-warn">Screenshots are public. Crop out names, clients and private details first.</p>
        <p class="report-label" id="report-type-label">Type <span>(optional)</span></p>
        <div class="report-types" role="group" aria-labelledby="report-type-label">
          ${TYPES.map(([v, l]) => `<button type="button" class="report-pill" data-type="${v}" aria-pressed="false">${l}</button>`).join('')}
        </div>
        <p class="report-note">Logged from <b>${STAGE_NAMES[stage] || esc(stage)}</b>. We'll email a copy to ${esc(user.email)}.</p>
        <p class="report-msg" data-error aria-live="polite"></p>
        <button class="btn primary" data-send>Submit</button>
      </form>`;
    const f = box.querySelector('form');
    const title = f.querySelector('#report-title');
    const body = f.querySelector('#report-body');
    title.value = draft.title; body.value = draft.body;
    const pills = [...f.querySelectorAll('.report-pill')];
    const setType = (v) => { draft.type = v; pills.forEach((p) => p.setAttribute('aria-pressed', String(p.dataset.type === v))); };
    setType(draft.type);
    pills.forEach((p) => { p.onclick = () => setType(draft.type === p.dataset.type ? '' : p.dataset.type); });
    const shotBox = f.querySelector('[data-shot]');
    const renderShot = () => {
      if (draft.shot) {
        shotBox.innerHTML = `<div class="report-shot-prev"><img src="${draft.shot}" alt="Your screenshot">
          <button type="button" class="report-shot-rm" aria-label="Remove screenshot">✕ Remove</button></div>`;
        shotBox.querySelector('button').onclick = () => { draft.shot = ''; renderShot(); shotBox.querySelector('input').focus(); };
        return;
      }
      shotBox.innerHTML = `<label class="report-shot-add">${ic('camera', '')}<b>Add a screenshot</b>
          <span>Tap to choose a photo or screenshot</span>
          <input type="file" accept="image/*" aria-labelledby="report-shot-label"></label>
        <p class="report-msg" data-shot-msg aria-live="polite"></p>`;
      shotBox.querySelector('input').onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try { draft.shot = await shrink(file); renderShot(); shotBox.querySelector('.report-shot-rm').focus(); }
        catch { shotBox.querySelector('[data-shot-msg]').textContent = "Couldn't use that image. Try another one."; }
      };
    };
    renderShot();
    title.oninput = () => { draft.title = title.value; check(title, false); };
    body.oninput = () => { draft.body = body.value; check(body, false); };
    function check(el, show) {
      const empty = !el.value.trim();
      const msg = document.getElementById(`${el.id}-msg`);
      if (!empty || show) {
        el.classList.toggle('bad', empty);
        el.setAttribute('aria-invalid', String(empty));
        msg.textContent = empty ? (el === title ? 'Add a short title' : 'Tell us a bit more') : '';
      }
      return !empty;
    }
    f.onsubmit = async (e) => {
      e.preventDefault();
      const ok = [check(title, true), check(body, true)];
      if (!ok[0]) { title.focus(); return; }
      if (!ok[1]) { body.focus(); return; }
      const err = f.querySelector('[data-error]');
      if (!navigator.onLine) { err.textContent = "You're offline. Try again when you're back online."; return; }
      const send = f.querySelector('[data-send]');
      send.disabled = true; send.textContent = 'Sending…'; err.textContent = '';
      try {
        await window.AppCloud.submitReport({ title: title.value.trim(), body: body.value.trim(), type: draft.type || null, screenshot: draft.shot || null });
        draft = { title: '', body: '', type: '', shot: '' };
        box.innerHTML = `${head}<div class="report-done">
          <div class="report-tick">${ic('check-circle', '✓')}</div>
          <p><b>Thanks! Your report is in.</b></p>
          <p class="report-note">We'll email you a copy shortly.</p>
          <button type="button" class="btn outline" data-close>Done</button></div>`;
        box.querySelector('.report-done [data-close]').focus();
      } catch (e2) {
        send.disabled = false; send.textContent = 'Submit';
        err.textContent = e2?.code === 'permission-denied'
          ? "Only people on the testers list can report issues. Ask the app's owner to add you."
          : "Couldn't send it. Check your connection and try again.";
        console.warn('Report failed:', e2);
      }
    };
  }

  function open() {
    showForm();
    box.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    (box.querySelector('input, [data-signin]') || box.querySelector('[data-close]')).focus();
  }
  function close() {
    box.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
  }
  btn.addEventListener('click', () => (box.hidden ? open() : close()));
  box.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) { close(); btn.focus(); } });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !box.hidden) { close(); btn.focus(); } });
  document.addEventListener('pointerdown', (e) => {
    if (!box.hidden && !box.contains(e.target) && !btn.contains(e.target)) close();
  });
})();
