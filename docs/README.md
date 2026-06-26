# Static viewer assets

This folder contains the generated public site served by the Cloudflare worker.

The DIY simulator is split across:

- `index.html` for the visible simulator controls and canvases.
- `app.js` for navigation, simulation browsing, and drawing masks.
- `sim.js` for the browser-native active-particle simulation runner.
- `styles.css` for the responsive layout.

The source templates live in `tools/static_templates/`. Run `python3 tools/build_static_site.py` to regenerate these files from templates and local simulation assets.
