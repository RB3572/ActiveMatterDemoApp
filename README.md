# Active Matter Demo App

Streamlit viewer for active matter pump simulations.

## Run Locally

```bash
pip install -r requirements.txt
streamlit run simviewer.py
```

The app expects the local `Simulation/` TIFF stacks and optional `DIYSim/`
generated assets to exist next to `simviewer.py`.

## Deployment Status

The code and lightweight assets are published to GitHub. Large local simulation
TIFFs are intentionally ignored because the dataset is about 5.5 GB and several
individual files are too large for normal GitHub/Vercel deployment.

See `DEPLOYMENT.md` for the recommended production path.
