// Toasts: short messages that slide up near the bottom and fade after a few
// seconds, optionally with an action button (e.g. Undo). One at a time: a new
// one replaces the old. While one shows, the install tip and "new version"
// bar step aside so nothing overlaps. Screen readers hear it (role="status");
// with Reduce Motion it appears without sliding.
//
//   AppToast.show('Signed out.');
//   AppToast.show('“Buy milk” moved to Done', {
//     icon: 'check-circle',                       // optional, from icons.js
//     action: { label: 'Undo', icon: 'arrow-counter-clockwise', onClick() { … } },
//     duration: 4500,                             // ms; default 4000, or 6000 with an action
//   });
//
// Apps with a bar fixed at the bottom set --toast-bottom in their CSS so
// toasts sit above it (test-app: above its add bar).
(() => {
  let current = null, timer;
  const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  function close(el = current) {
    if (!el?.isConnected) return;
    clearTimeout(timer);
    const done = () => { el.remove(); if (current === el) { current = null; document.body.classList.remove('has-toast'); } };
    if (reduceMotion()) return done();
    el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200 }).finished.then(done);
  }

  function show(message, { icon: iconName, action, duration } = {}) {
    if (current) { current.remove(); current = null; }
    clearTimeout(timer);
    const el = document.createElement('div');
    el.className = 'app-toast';
    el.setAttribute('role', 'status');
    if (iconName && window.icon) el.append(icon(iconName, 'app-toast-icon'));
    const text = document.createElement('span');
    text.className = 'app-toast-text';
    text.textContent = message;
    el.append(text);
    if (action) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'app-toast-action';
      if (action.icon && window.icon) btn.append(icon(action.icon));
      btn.append(action.label);
      btn.addEventListener('click', () => { close(el); action.onClick?.(); });
      el.append(btn);
    }
    document.body.append(el);
    document.body.classList.add('has-toast');
    current = el;
    if (!reduceMotion()) {
      el.animate([{ transform: 'translate(-50%, 16px)', opacity: 0 }, { transform: 'translate(-50%, 0)', opacity: 1 }],
        { duration: 220, easing: 'cubic-bezier(.2,.8,.3,1)' });
    }
    timer = setTimeout(() => close(el), duration ?? (action ? 6000 : 4000));
    return { close: () => close(el) };
  }

  window.AppToast = { show, close: () => close() };
})();
