# Deployment Notes

This project is a Streamlit app (`simviewer.py`). The local simulation TIFF
dataset is about 5.5 GB, with several individual TIFFs around 613 MB.

## Hosting constraints

- GitHub rejects normal Git blobs over 100 MB.
- Vercel is not a good runtime for Streamlit apps because Streamlit expects a
  long-running Python server with WebSocket support.
- The large TIFF stacks should not be deployed as ordinary repository files.

## Current production shape

The browser-facing production site is generated into `docs/`:

```bash
python3 tools/build_static_site.py
```

That script converts the local TIFF stacks into compressed MP4 movies and writes
a static site with a JSON manifest. The live domain is:

```text
https://activematter.rishib.com/
```

Cloudflare is configured with:

- Worker script: `active-matter-demo-app`
- Worker source in this repo: `cloudflare/active-matter-demo-app.worker.js`
- Route: `activematter.rishib.com/*`
- DNS: proxied CNAME `activematter.rishib.com` to `rb3572.github.io`

The Worker serves files from the public GitHub repo under `docs/`, while the
original Streamlit app remains available locally for development.
