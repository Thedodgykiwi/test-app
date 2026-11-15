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

  let draft = { title: '', body: '', type: '' };   // kept if the box is closed by mistake

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
        await window.AppCloud.submitReport({ title: title.value.trim(), body: body.value.trim(), type: draft.type || null });
        draft = { title: '', body: '', type: '' };
        box.innerHTML = `${head}<div class="report-done">
          <div class="report-tick">${ic('check-circle', '✓')}</div>
          <p><b>Thanks! Your report is in.</b></p>
          <p class="report-note">It becomes a GitHub issue within about 15 minutes, and we'll email you a copy with its number.</p>
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
