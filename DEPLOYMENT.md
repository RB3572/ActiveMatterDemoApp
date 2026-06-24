# Deployment Notes

This project is a Streamlit app (`simviewer.py`). The local simulation TIFF
dataset is about 5.5 GB, with several individual TIFFs around 613 MB.

## Current hosting constraints

- GitHub rejects normal Git blobs over 100 MB.
- Vercel is not a good runtime for Streamlit apps because Streamlit expects a
  long-running Python server with WebSocket support.
- The large TIFF stacks should not be deployed as ordinary repository files.

## Recommended production shape

1. Push the app code, thumbnails, and lightweight configuration to GitHub.
2. Host the Streamlit app on a Streamlit-capable service.
3. Store the large simulation stacks in object storage, such as Cloudflare R2,
   or convert them to smaller web-friendly assets.
4. Point `sitename.rishib.com` in Cloudflare DNS to the production host.

If Vercel must be part of the path, use it for a small frontend/landing site or
redirect, while the Streamlit runtime lives on a service that supports it.
