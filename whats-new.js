// "What's new" panel: shows this stage's release notes from releases.json,
// which the deploy workflow generates for each stage.
(() => {
  const STAGE_NAMES = { main: 'Production', staging: 'Staging', alpha: 'Alpha', dev: 'Dev', local: 'Local' };
  const stage = window.STAGE || 'local';
  const stageName = STAGE_NAMES[stage] || stage;
  const dialog = document.getElementById('whats-new');
  const body = document.getElementById('whats-new-body');

  const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const inline = (s) => escapeHtml(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Minimal Markdown: ## / ### headings, "- " bullets (with wrapped
  // continuation lines), paragraphs and **bold**. Everything is escaped first.
  function markdown(src) {
    const html = [];
    let list = null, para = null;
    const flush = () => {
      if (para) { html.push(`<p>${inline(para.join(' '))}</p>`); para = null; }
      if (list) { html.push(`<ul>${list.map((li) => `<li>${inline(li)}</li>`).join('')}</ul>`); list = null; }
    };
    for (const raw of src.split('\n')) {
      const line = raw.trimEnd();
      const h = line.match(/^(#{2,3})\s+(.*)/);
      if (h) { flush(); html.push(h[1].length === 2 ? `<h3>${inline(h[2])}</h3>` : `<h4>${inline(h[2])}</h4>`); }
      else if (/^\s*[-*]\s+/.test(line)) { if (para) flush(); (list ||= []).push(line.replace(/^\s*[-*]\s+/, '')); }
      else if (!line.trim()) flush();
      else if (list && /^\s+/.test(raw)) list[list.length - 1] += ' ' + line.trim();
      else { if (list) flush(); (para ||= []).push(line.trim()); }
    }
    flush();
    return html.join('');
  }

  const formatDate = (iso) => new Date(iso).toLocaleDateString(undefined,
    { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  function render(data) {
    const releases = data.releases || [];
    const recent = data.recent || [];
    if (releases.length) {
      return releases.map((r) => {
        const from = STAGE_NAMES[r.from] || r.from;
        const how = r.pr ? `via pull request #${r.pr}` : `from ${from}`;
        const notes = /^##\s/.test(r.notes) ? r.notes : `## 📦 Update ${how}\n\n${r.notes}`;
        return `<article class="release">
          <div class="release-meta">🗓️ ${formatDate(r.date)} · ${escapeHtml(how)} · <code>${escapeHtml(r.sha)}</code></div>
          ${markdown(notes)}
        </article>`;
      }).join('');
    }
    if (recent.length) {
      return `<p class="intro">🧪 Dev is where work in progress lives, so this is a list of the latest
        changes rather than polished release notes. They get proper notes when they move on to Alpha.</p>
        <ul class="recent">${recent.map((c) =>
          `<li><span>${escapeHtml(c.title)}</span><small>${formatDate(c.date)}</small></li>`).join('')}</ul>`;
    }
    return `<p class="intro">🌱 No releases in ${escapeHtml(stageName)} yet. Release notes will
      appear here after the first update is promoted to this stage.</p>`;
  }

  async function open() {
    document.getElementById('whats-new-title-text').textContent = `What's new in ${stageName}`;
    body.innerHTML = '<p class="intro">Loading…</p>';
    dialog.showModal();
    try {
      const res = await fetch('releases.json', { cache: 'no-store' });
      if (!res.ok) throw new Error(res.status);
      body.innerHTML = render(await res.json());
    } catch {
      body.innerHTML = `<p class="intro">ℹ️ Release notes appear here once this version is
        published to one of the stages. (You're looking at a local copy.)</p>`;
    }
  }

  document.getElementById('whats-new-btn').addEventListener('click', open);
  document.getElementById('whats-new-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
})();
