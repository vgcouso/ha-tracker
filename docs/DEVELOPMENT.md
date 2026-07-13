# Development & manual deployment

How to build the frontend bundle and deploy this fork straight into a Home
Assistant `config/` folder — **without** going through HACS.

## Repository layout

The integration is a single folder:

```
custom_components/ha_tracker/
├── __init__.py, config_flow.py, manifest.json   # integration + backend
├── api/                                         # REST endpoints (Python)
└── www/
    ├── js/                 # frontend SOURCE (ES modules)  <-- edit these
    ├── dist/ha-tracker.js  # BUNDLE built from js/main.js  <-- generated, don't hand-edit
    ├── index.html          # loads dist/ in prod, js/main.js when ?debug=1
    └── vendor/, css/, ...
```

The browser loads the **bundle** (`dist/ha-tracker.js`) in normal use, and the raw
source modules only when the panel URL has `?debug=1`. So after changing anything under
`www/js/`, you must **rebuild the bundle**.

## Prerequisites

- Node.js (v18+; developed on v24). Check: `node --version`.
- A way to reach the HA `config/` folder from this PC — e.g. the **Samba share**
  add-on (`\\<HA-IP>\config`), a mapped drive, or a local path.

## One-time setup

```bash
npm install
```

This installs esbuild (the only dev dependency) into `node_modules/` (gitignored).

## Build (compile)

```bash
npm run build      # one-off: www/js/main.js -> www/dist/ha-tracker.js (minified ESM)
npm run watch      # rebuild automatically on every save
```

The bundle is produced with:

```
esbuild custom_components/ha_tracker/www/js/main.js \
  --bundle --minify --format=esm \
  --outfile=custom_components/ha_tracker/www/dist/ha-tracker.js
```

Vendor libraries (Leaflet, MapLibre, flatpickr, …) are **not** bundled — they are loaded
at runtime by `www/js/utils/loader.js` — so the bundle stays app-only (~170 KB).

## Deploy (folder → Home Assistant)

Set the destination once (the HA **config** directory, the one with
`configuration.yaml`) and deploy:

```bash
# PowerShell
$env:HA_CONFIG = '\\192.168.1.111\config'
npm run deploy
```

`npm run deploy` runs `npm run build` first, then `scripts/deploy.ps1`, which mirrors
`custom_components/ha_tracker/` into `<HA_CONFIG>/custom_components/ha_tracker/` with
`robocopy /MIR` (excluding `__pycache__` and `*.pyc`).

You can also pass the path explicitly:

```bash
powershell -File scripts/deploy.ps1 -HaConfig '\\192.168.1.111\config'
```

### After every deploy

1. **Restart Home Assistant** (Developer Tools → Restart), or reload the integration
   (Settings → Devices & Services → HA Tracker → ⋮ → Reload). A backend (`api/`) change
   needs a restart; a pure `www/` change needs at least an integration reload.
2. **Hard-refresh** the browser (Ctrl+F5). The `manifest.json` `version` is used as the
   panel/bundle cache-buster (`?v=`), so bumping it forces fresh JS — see the note below.

> **Cache-buster:** the panel appends `?v=<manifest version>` to the bundle URL. If you
> change frontend code but keep the same version, a hard-refresh is usually enough, but
> bumping `manifest.json` `version` guarantees every client reloads the new bundle.

## VS Code tasks & launch (`.vscode/`, local-only, gitignored)

- **Tasks** (`Ctrl+Shift+B`, or *Terminal → Run Task…*):
  - `ha-tracker: build` — build the bundle (default build task).
  - `ha-tracker: watch` — continuous rebuild.
  - `ha-tracker: deploy` — build + copy to HA; prompts for the HA config path
    (defaults to `\\192.168.1.111\config`).
- **Launch** (Run & Debug panel): *Open HA Tracker panel* in Edge or Chrome, pointed at
  `http://192.168.1.111:8123/ha-tracker/index.html?debug=1` (loads source modules for
  breakpoint debugging).

> `.vscode/` is in `.gitignore`. If you want these committed to your fork, remove that
> line or force-add: `git add -f .vscode/`.

## What this fork changes vs. upstream

- **Show all `device_tracker.*` with a location**, even ones not assigned to a `person`
  (e.g. a car). `www/js/screens/persons.js` adds unclaimed trackers as their own rows;
  `api/filtered_positions.py` accepts a `device_tracker.*` id directly so the
  history/filter tab works for them. This is gated by a new **General** option,
  **"Include device trackers without a person"** (`include_non_persons`), which
  **defaults to off** — enable it in Settings → Devices & Services → HA Tracker →
  Configure. The flag is read by the backend and exposed to the frontend via
  `/api/ha_tracker/config`.
- Fixed case-sensitive dynamic imports in `www/js/utils/map.js`
  (`map2d.js`/`map3d.js` → `map2D.js`/`map3D.js`), which would 404 in `?debug=1` mode on
  a case-sensitive host.
- Bumps `manifest.json` version on each release so the `?v=` cache-buster changes and
  clients reload fresh JS (currently `0.0.38`). **Always bump this when you change
  frontend code** — reusing the same version serves stale cached JavaScript.

> Known limitation (unchanged from upstream): a `person` is still matched to only its
> **first** `device_trackers[]` entry. If that first tracker has no GPS fix, the person
> isn't shown by name — but any of its other trackers that do have a location still
> appear as their own rows.
