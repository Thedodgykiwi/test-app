// Starter to-dos for a brand-new visitor (Issue #93): shown once, signed out, on a device
// with nothing saved for this stage yet. Award-night examples, three setup ones starred
// (they sort first, in this order), each marked `sample: true` so "Clear examples" can
// remove them and the first sign-in leaves them behind (sync.js). Renaming one, or
// rewriting its note, makes it the visitor's own (store.js `update`).
// Keep titles short (they share a phone row with the priority bars) and on brand.

const pad = (n) => String(n).padStart(2, '0');
const day = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`; };

const WELCOME = `Your to-dos are the nominees. Tick one off and it wins.

These are examples from a very busy awards season. Tick, swipe and edit them as much as you like, then tap "Clear examples" at the top to start your own list.

The next two get you the full red-carpet treatment.`;

const HOME = `A front-row seat: from your Home Screen, The Shortlist opens full screen, works offline and can send you reminders.

iPhone: in Safari, tap Share (the square with an arrow), then "Add to Home Screen".
Android or computer: Menu (top right) → Settings → Account and app → Add to Home Screen.

Then open it from your Home Screen and do the next one from there. (On iPhone, the Home Screen app keeps its own sign-in, separate from Safari.)`;

const GUEST = `Sign in with your Google account from the menu (top right). Your list then follows you to every phone and computer, safely backed up.

Once you're in: Menu → Settings → Reminders → Phone notifications → Turn on. You'll get a nudge before any to-do with a time, and a morning summary if you'd like one.

These examples stay on this device when you sign in, apart from any you've renamed or rewritten.`;

const SWIPES = `Swipe right: star it (starred ones walk the red carpet at the top).
Swipe left: send it to tomorrow (or bring a "due tomorrow" one back to today).
Choose what each swipe does in Menu → Settings → Swipe actions.
Not doing one after all? Press and hold its tick box: it's withdrawn, not won.

Tap a to-do to change its date, time, priority, checklist, note or list. Tap a date label like "Due today" for quick dates.

Shortcuts when typing a new one, at the start or end:
• "tom", "tonight" or "nw" (next week) sets the date
• "4pm" sets the time
• H, M or L sets the priority
• S stars it, #name puts it in a list
For example: "Call the venue tom 4pm H".`;

const BILLING = `Every to-do gets billing:
• High: the headline act
• Medium: a strong supporting role
• Low: "also starring"
• None: an extra, somewhere in the background

To-dos without a date sit in these High, Medium and Low panels, headliners first. Ones with a date show their billing as little bars on the right (three red bars = High).

Set it with the bars button in the add box, by typing H, M or L at the start or end of a new to-do, or tap a to-do and pick under Priority.`;

export function starterTodos() {
  // Already opened from the Home Screen? Those steps are done.
  const home = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  return [
    { text: '👋 Welcome to The Shortlist', p: 'none', starred: true, note: WELCOME },
    { text: '📲 Get me on your Home Screen', p: 'none', starred: true, note: HOME,
      items: [{ text: 'Add to Home Screen', done: home }, { text: 'Open it from there', done: home }] },
    { text: '🎟️ Get on the guest list (sign in)', p: 'none', starred: true, note: GUEST,
      items: [{ text: 'Sign in with Google', done: false }, { text: 'Turn on reminders', done: false }] },
    { text: '↔️ Swipe me left or right', p: 'med', due: day(0), note: SWIPES },
    { text: '🎬 Give me top billing (priority)', p: 'high', note: BILLING },
    { text: '👔 Collect the tux', p: 'high', due: day(0), time: '16:00' },
    { text: '😌 Practise the gracious-loser face', p: 'none', due: day(0), evening: true },
    { text: '🧾 RSVP to the after-party', p: 'med', due: day(-2) },
    { text: '🎤 Write a speech (just in case)', p: 'med', note: 'Thank: Mum, my agent, the catering team.\nDo NOT mention the ex.\nUnder 45 seconds, or the music starts.' },
    { text: '🏆 Clear a shelf. Just in case.', p: 'low' },
    { text: '✅ Get nominated', p: 'high', done: true, doneAt: Date.now() - 36e5 },
  ].map((t) => ({ done: false, ...t, sample: true }));
}
