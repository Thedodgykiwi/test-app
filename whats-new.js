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
  // "(#12)" at the end of a note marks a fixed GitHub issue: show it as a
  // small pill in that issue's label colour (reference only, not a link).
  // Label names/colours come from releases.json ("issues"), built at deploy.
  let issues = {};
  function pill(n) {
    const info = issues[n] || {};
    const color = /^[0-9a-f]{6}$/i.test(info.color || '') ? info.color : 'e9ecef';
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(color.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    // Dark or white text, whichever contrasts more with the label colour.
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const text = (lum + 0.05) / 0.0637 >= 1.05 / (lum + 0.05) ? '#1d1f23' : '#fff';
    const label = info.label ? `${escapeHtml(info.label)} ` : '';
    return `<span class="issue-pill" style="background:#${color};color:${text}" `
      + `title="Issue #${n}${info.label ? ` (${escapeHtml(info.label)})` : ''}">${label}#${n}</span>`;
  }
  const inline = (s) => escapeHtml(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Keep the pill together with the word before it so it never sits alone on a line.
    .replace(/([^\s<>]*)\s*\(#(\d+)\)/g, (m, word, n) => `<span class="keep">${word}&nbsp;${pill(n)}</span>`);

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
    issues = data.issues || {};
    const releases = data.releases || [];
    const recent = data.recent || [];
    if (releases.length) {
      return releases.map((r) => {
        const from = STAGE_NAMES[r.from] || r.from;
        const how = r.from === 'rollback' ? 'rollback'
          : r.pr ? `via pull request #${r.pr}` : `from ${from}`;
        const notes = /^##\s/.test(r.notes) ? r.notes : `## 📦 Update ${how}\n\n${r.notes}`;
        // A release that was later rolled back stays listed, faded and tagged.
        // Production releases carry their version (same name as the GitHub release).
        const version = r.version ? ` · <span class="release-version">${escapeHtml(r.version)}</span>` : '';
        const undone = r.rolled_back ? ' · <span class="rolled-back-tag">↩️ rolled back</span>' : '';
        return `<article class="release${r.rolled_back ? ' rolled-back' : ''}${r.from === 'rollback' ? ' rollback' : ''}">
          <div class="release-meta">🗓️ ${formatDate(r.date)}${version} · ${escapeHtml(how)} · <code>${escapeHtml(r.sha)}</code>${undone}</div>
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

  // Slim "New: …" bar under the welcome text: the latest release's headline
  // (first bold bullet in its notes). Clicking opens the panel; × hides it
  // until the next release (remembered per stage, like everything stored).
  const news = document.getElementById('news');
  const dismissKey = `news-dismissed-${stage}`;
  const headlineOf = (notes) => {
    const bold = notes.match(/^\s*[-*]\s+\*\*(.+?)\*\*/m);
    if (bold) return bold[1];
    const line = notes.split('\n').find((l) => l.trim() && !/^#/.test(l.trim()));
    return line ? line.replace(/\s*\(#\d+\)/g, '').trim() : '';
  };
  (async () => {
    try {
      const res = await fetch('releases.json', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      // Released stages: the latest release. Dev has no release notes, so it
      // shows its most recent change instead (as its "What's new" does).
      const release = (data.releases || []).find((r) => r.from !== 'rollback');
      const latest = release || (data.recent || []).map((c) => ({ sha: c.sha, notes: c.title }))[0];
      // Dev shows work in progress, not a release: label it honestly.
      if (!release) document.getElementById('news-label').textContent = 'Latest change:';
      if (!latest || localStorage.getItem(dismissKey) === latest.sha) return;
      const headline = headlineOf(latest.notes || '');
      if (!headline) return;
      document.getElementById('news-headline').textContent = headline;
      news.hidden = false;
      document.getElementById('news-dismiss').addEventListener('click', () => {
        localStorage.setItem(dismissKey, latest.sha);
        news.hidden = true;
      });
    } catch { /* no notes (e.g. local copy): just leave it hidden */ }
  })();
  document.getElementById('news-open').addEventListener('click', open);
  document.getElementById('whats-new-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
})();
