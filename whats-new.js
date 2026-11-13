// Slim "New: …" bar under the welcome text: the latest release's headline
// (first bold bullet in its notes). Tapping it opens the "What's new" panel
// (menu.js, also opened from the version at the bottom of the menu). × hides
// it until the next release (remembered per stage, like everything stored).
(() => {
  const stage = window.STAGE || 'local';
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
      // shows its most recent change instead.
      const release = (data.releases || []).find((r) => r.from !== 'rollback');
      const latest = release || (data.recent || []).map((c) => ({ sha: c.sha, notes: c.title }))[0];
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
  document.getElementById('news-open').addEventListener('click', () => document.getElementById('version-btn').click());
})();
