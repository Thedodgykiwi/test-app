# vendor/

Small libraries stored in the app itself (no CDN: works offline, fixed versions).
Loaded through the import map in `index.html`, so app code imports them by name:

    import { html, render } from 'htm/preact';
    import { useState } from 'preact/hooks';
    import { signal, computed } from '@preact/signals';

| File | Package | Version | Licence |
|---|---|---|---|
| preact.js | preact (dist/preact.mjs) | 11.2.0 | MIT |
| preact-hooks.js | preact/hooks (hooks/dist/hooks.mjs) | 11.2.0 | MIT |
| htm.js | htm (dist/htm.module.js) | 3.1.1 | Apache-2.0 |
| htm-preact.js | htm/preact (preact/index.module.js) | 3.1.1 | Apache-2.0 |
| signals.js | @preact/signals (dist/signals.module.js) | 2.11.4 | MIT |
| signals-core.js | @preact/signals-core (dist/signals-core.module.js) | 1.14.5 | MIT |

Update deliberately (playbook `guides/preact.md`): `npm pack <name>@<version>`,
copy the same files, remove the trailing `sourceMappingURL` comment (not the whole line: minified files are one line), update this table and the
licences in `LICENSES/`.
