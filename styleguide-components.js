// Style guide: live Preact examples (React-style components, no build step).
// Each demo below is drawn into its <div data-demo="…"> and its code is shown
// underneath. Copy the patterns into app/ when building screens.
import { html, render } from 'htm/preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import { signal, computed } from '@preact/signals';

const Icon = ({ name }) => html`<span ref=${(el) => el && !el.firstChild && el.append(icon(name))} />`;

// 1. A component with its own state (useState)
function Counter() {
  const [count, setCount] = useState(0);
  return html`
    <div class="row">
      <button class="btn outline icon" aria-label="Less" onClick=${() => setCount(count - 1)}>−</button>
      <strong aria-live="polite">${count}</strong>
      <button class="btn outline icon" aria-label="More" onClick=${() => setCount(count + 1)}>+</button>
    </div>`;
}

// 2. Shared data between components (signals): both re-draw when it changes
const cart = signal(0);
const cartLabel = computed(() => (cart.value === 1 ? '1 item' : `${cart.value} items`));
function AddToCart() {
  return html`<button class="btn primary" onClick=${() => cart.value++}><${Icon} name="plus" />Add to cart</button>`;
}
function CartBadge() {
  return html`<span class="badge accent">${cartLabel}</span>`;
}
function SharedData() {
  return html`<div class="row"><${AddToCart} /><${CartBadge} /><button class="btn ghost sm" onClick=${() => { cart.value = 0; }}>Reset</button></div>`;
}

// 3. A reusable component with props: one place for label, hint and error
function Field({ id, label, hint, error, ...input }) {
  return html`
    <div class="field">
      <label for=${id}>${label}</label>
      <input id=${id} class="input" aria-invalid=${error ? 'true' : 'false'}
        aria-describedby=${`${id}-msg`} ...${input} />
      ${(error || hint) && html`<span id=${`${id}-msg`} class=${error ? 'error-text' : 'hint'}>${error || hint}</span>`}
    </div>`;
}
function FieldDemo() {
  const [name, setName] = useState('');
  return html`<${Field} id="sg-name" label="Your name" hint="As it should appear on the card."
    error=${name.length > 20 ? 'Keep it under 20 characters.' : ''}
    value=${name} onInput=${(e) => setName(e.target.value)} />`;
}

// 4. Lists, conditions and "Loading…" (data arriving later)
function LoadingList() {
  const [rows, setRows] = useState(null);   // null = still loading
  const load = () => { setRows(null); setTimeout(() => setRows(['Apples', 'Bread', 'Coffee']), 900); };
  useEffect(load, []);                       // runs once, when it first appears
  if (rows === null) return html`<p class="row muted"><${Icon} name="spinner-gap" />Loading…</p>`;
  return html`
    <div style="display:grid;gap:.6rem">
      <ul class="list">${rows.map((r) => html`<li key=${r}><span class="grow">${r}</span></li>`)}</ul>
      <div><button class="btn outline sm" onClick=${load}>Reload</button></div>
    </div>`;
}

// 5. A dialog (uses the kit's .sheet panel and <dialog>)
function ConfirmDelete() {
  const ref = useRef();
  const [deleted, setDeleted] = useState(false);
  return html`
    <div class="row">
      <button class="btn danger" onClick=${() => ref.current.showModal()}><${Icon} name="trash" />Delete list…</button>
      ${deleted && html`<span class="badge warn">Deleted (demo)</span>`}
      <dialog ref=${ref} class="sheet" aria-labelledby="sg-del-title"
        onClick=${(e) => e.target === ref.current && ref.current.close()}>
        <header><h2 id="sg-del-title">Delete this list?</h2></header>
        <p class="muted">This can't be undone.</p>
        <div class="row" style="justify-content:flex-end">
          <button class="btn ghost" onClick=${() => ref.current.close()}>Cancel</button>
          <button class="btn danger" onClick=${() => { setDeleted(true); ref.current.close(); }}>Delete</button>
        </div>
      </dialog>
    </div>`;
}

const DEMOS = {
  counter: [Counter],
  shared: [SharedData, AddToCart, CartBadge, 'const cart = signal(0);\nconst cartLabel = computed(() => (cart.value === 1 ? \'1 item\' : `${cart.value} items`));'],
  field: [FieldDemo, Field],
  loading: [LoadingList],
  dialog: [ConfirmDelete],
};
document.querySelectorAll('[data-demo]').forEach((el) => {
  const [Main, ...more] = DEMOS[el.dataset.demo];
  render(html`<${Main} />`, el);
  const code = [...more.reverse().map((m) => (typeof m === 'string' ? m : m.toString())), Main.toString()].join('\n\n');
  const d = document.createElement('details'); d.className = 'code';
  d.innerHTML = '<summary>Code</summary><pre><code></code></pre>';
  d.querySelector('code').textContent = code;
  el.closest('.example').after(d);
});
