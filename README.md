# Active Matter Demo App

Streamlit viewer for active matter pump simulations.

Public site: https://activematter.rishib.com/

## Run Locally

```bash
pip install -r requirements.txt
streamlit run simviewer.py
```

The app expects the local `Simulation/` TIFF stacks and optional `DIYSim/`
generated assets to exist next to `simviewer.py`.

## Deployment Status

The public site is a static browser version in `docs/`, served at
`activematter.rishib.com` by a Cloudflare Worker. The Worker proxies the
published static files from this public GitHub repository and supports MP4 range
requests for normal browser video playback.

Large local simulation TIFFs are intentionally ignored because the dataset is
about 5.5 GB and several individual files are too large for normal GitHub/Vercel
deployment.

See `DEPLOYMENT.md` for the recommended production path.
