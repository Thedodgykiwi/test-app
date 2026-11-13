// test-app: the to-do screen is app/main.js (Preact components) and its data
// and saving are app/store.js (Issue #13). This file only does the stage banner.

// Stage banner on every stage except Production, with a link to the pipeline
// page (built by the shared deploy at the site root; not on local copies).
const stage = window.STAGE || 'local';
if (stage !== 'main') {
  const banner = document.getElementById('stage-banner');
  document.getElementById('stage-name').textContent = `${stage.toUpperCase()} environment`;
  banner.className = `stage-${stage}`;
  banner.hidden = false;
  document.body.classList.add('has-banner');
  if (stage !== 'local') document.getElementById('pipeline-link').hidden = false;
}
