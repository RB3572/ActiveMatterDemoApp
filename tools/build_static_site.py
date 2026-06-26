from __future__ import annotations

import json
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

import numpy as np
import tifffile
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SIM_DIR = ROOT / "Simulation"
THUMBS_DIR = ROOT / "Thumbnails"
DOCS_DIR = ROOT / "docs"
VIDEO_DIR = DOCS_DIR / "assets" / "videos"
POSTER_DIR = DOCS_DIR / "assets" / "posters"
THUMB_DIR = DOCS_DIR / "assets" / "thumbnails"

CATEGORY_ORDER = ["Turbo", "Whirlpool", "Centipede", "2Layer", "Zigzag", "Activation Example"]
TIFF_EXTS = {".tif", ".tiff"}


def slugify(value: str) -> str:
    value = value.lower().replace("µ", "u")
    value = re.sub(r"[^a-z0-9]+", "-", value)
    return value.strip("-")


def normalize_to_uint8(img: np.ndarray) -> np.ndarray:
    arr = np.asarray(img)
    if arr.dtype == np.uint8:
        return arr
    if np.issubdtype(arr.dtype, np.floating):
        arr = np.clip(arr, 0.0, 1.0)
        return (arr * 255).astype(np.uint8)
    mx = float(arr.max()) if arr.size else 1.0
    if mx <= 0:
        mx = 1.0
    return (arr.astype(np.float32) / mx * 255.0).astype(np.uint8)


def frame_to_rgb(frame: np.ndarray) -> Image.Image:
    arr = normalize_to_uint8(frame)
    if arr.ndim == 2:
        arr = np.stack([arr] * 3, axis=-1)
    elif arr.ndim == 3 and arr.shape[0] in (3, 4):
        arr = np.moveaxis(arr, 0, -1)
    if arr.shape[-1] == 4:
        arr = arr[..., :3]
    return Image.fromarray(arr)


def resize_for_video(img: Image.Image, max_side: int = 960) -> Image.Image:
    w, h = img.size
    scale = min(1.0, max_side / max(w, h))
    if scale < 1.0:
        w = max(2, int(w * scale) // 2 * 2)
        h = max(2, int(h * scale) // 2 * 2)
        return img.resize((w, h), Image.Resampling.LANCZOS)
    return img


def index_simulations() -> dict[str, list[Path]]:
    cats: dict[str, list[Path]] = {}
    if not SIM_DIR.exists():
        return cats
    for path in sorted(SIM_DIR.iterdir(), key=lambda p: p.name.lower()):
        if path.is_dir():
            files = [p for p in sorted(path.iterdir()) if p.suffix.lower() in TIFF_EXTS]
            if files:
                cats[path.name] = files
    example = SIM_DIR / "ActivationExample.tiff"
    if example.exists():
        cats["Activation Example"] = [example]
    return dict(sorted(cats.items(), key=lambda kv: (
        CATEGORY_ORDER.index(kv[0]) if kv[0] in CATEGORY_ORDER else 999,
        kv[0].lower(),
    )))


def copy_thumbnail(category: str) -> str | None:
    candidates = [
        f"{category}_TN.png",
        f"{category.replace(' ', '')}_TN.png",
        f"{category}.png",
        f"{category.replace(' ', '')}.png",
        f"{category.lower()}_tn.png",
    ]
    for name in candidates:
        src = THUMBS_DIR / name
        if src.exists():
            dest = THUMB_DIR / f"{slugify(category)}.png"
            shutil.copy2(src, dest)
            return str(dest.relative_to(DOCS_DIR))
    return None


def convert_tiff_to_mp4(src: Path, out: Path, poster: Path, fps: int = 12) -> tuple[int, list[int]]:
    with tifffile.TiffFile(src) as tf, tempfile.TemporaryDirectory() as tmp:
        frame_dir = Path(tmp)
        frame_count = len(tf.pages)
        first_size: list[int] = [0, 0]
        for index, page in enumerate(tf.pages):
            img = resize_for_video(frame_to_rgb(page.asarray()))
            if index == 0:
                first_size = [img.size[0], img.size[1]]
                img.save(poster, quality=82, optimize=True)
            img.save(frame_dir / f"frame_{index:05d}.jpg", quality=80, optimize=True)

        cmd = [
            "ffmpeg",
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-framerate",
            str(fps),
            "-i",
            str(frame_dir / "frame_%05d.jpg"),
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            "-crf",
            "28",
            str(out),
        ]
        subprocess.run(cmd, check=True)
        return frame_count, first_size


def write_site(manifest: list[dict]) -> None:
    (DOCS_DIR / "assets").mkdir(parents=True, exist_ok=True)
    (DOCS_DIR / "data").mkdir(parents=True, exist_ok=True)
    (DOCS_DIR / "data" / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    (DOCS_DIR / "CNAME").write_text("activematter.rishib.com\n", encoding="utf-8")
    (DOCS_DIR / ".nojekyll").write_text("", encoding="utf-8")

    (DOCS_DIR / "index.html").write_text(
        """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Active Matter Pump Simulations</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <header class="topbar">
    <div>
      <p class="eyebrow">Active Matter Demo</p>
      <h1>Active Matter Pump Simulations</h1>
      <p>Browse active-matter pump designs and play simulation movies in your browser.</p>
    </div>
    <input id="search" type="search" placeholder="Search simulations" aria-label="Search simulations" />
  </header>
  <main>
    <section id="categories" class="category-grid" aria-live="polite"></section>
    <section id="viewer" class="viewer" hidden>
      <button id="back" class="back-button">Back</button>
      <div class="viewer-layout">
        <aside>
          <h2 id="viewer-title"></h2>
          <p id="viewer-meta"></p>
          <div id="video-list" class="video-list"></div>
        </aside>
        <div class="stage">
          <video id="video" controls playsinline preload="metadata"></video>
        </div>
      </div>
    </section>
  </main>
  <script src="app.js"></script>
</body>
</html>
""",
        encoding="utf-8",
    )

    (DOCS_DIR / "styles.css").write_text(
        """:root {
  --bg: #f5f8fc;
  --card: #ffffff;
  --text: #17202a;
  --muted: #617084;
  --border: #d9e2ee;
  --accent: #1d6eea;
  --accent-soft: #eaf2ff;
  --shadow: 0 14px 34px rgba(20, 36, 58, .10);
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: var(--text);
  background: radial-gradient(circle at top left, #ffffff 0, var(--bg) 42%, #eef4fb 100%);
}
.topbar {
  display: flex;
  gap: 24px;
  align-items: end;
  justify-content: space-between;
  padding: 30px clamp(18px, 5vw, 64px);
  background: rgba(255, 255, 255, .86);
  border-bottom: 1px solid var(--border);
  backdrop-filter: blur(10px);
}
.eyebrow {
  margin: 0 0 8px;
  color: var(--accent);
  font-weight: 700;
  letter-spacing: .08em;
  text-transform: uppercase;
  font-size: 12px;
}
h1 { margin: 0; font-size: clamp(30px, 4vw, 52px); letter-spacing: -.03em; }
p { color: var(--muted); line-height: 1.5; }
#search {
  width: min(380px, 100%);
  border: 1px solid #c7d4e5;
  border-radius: 999px;
  padding: 13px 16px;
  font: inherit;
  background: #fff;
  box-shadow: 0 5px 18px rgba(20, 36, 58, .06);
}
#search:focus-visible, button:focus-visible, video:focus-visible {
  outline: 3px solid rgba(29, 110, 234, .28);
  outline-offset: 3px;
}
main { padding: 30px clamp(18px, 5vw, 64px) 60px; }
.category-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 20px; }
.category-card, .video-item, .status-card {
  border: 1px solid var(--border);
  border-radius: 16px;
  background: var(--card);
  overflow: hidden;
  text-align: left;
}
.category-card, .video-item { cursor: pointer; }
.category-card {
  padding: 0;
  transition: transform .16s ease, box-shadow .16s ease, border-color .16s ease;
}
.category-card:hover, .video-item:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow);
  border-color: #b9c9dc;
}
.category-card img { width: 100%; aspect-ratio: 16 / 9; object-fit: cover; display: block; background: #dce4ee; }
.card-body { padding: 15px 16px 17px; }
.card-body h2 { margin: 0 0 5px; font-size: 21px; letter-spacing: -.01em; }
.card-body p { margin: 0; }
.card-meta { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
.pill { display: inline-flex; align-items: center; border-radius: 999px; padding: 4px 9px; background: var(--accent-soft); color: var(--accent); font-size: 12px; font-weight: 650; }
.status-card { grid-column: 1 / -1; padding: 26px; max-width: 780px; }
.status-card h2 { margin: 0 0 8px; font-size: 24px; }
.status-card p { margin: 0; }
.status-card.error { border-color: #f0b8b8; background: #fff8f8; }
.viewer { display: block; }
.back-button {
  border: 1px solid var(--accent);
  background: #fff;
  color: var(--accent);
  border-radius: 999px;
  padding: 10px 15px;
  font: inherit;
  cursor: pointer;
  margin-bottom: 18px;
}
.back-button:hover { background: var(--accent-soft); }
.viewer-layout { display: grid; grid-template-columns: minmax(260px, 360px) minmax(0, 1fr); gap: 22px; align-items: start; }
aside { min-width: 0; }
#viewer-title { margin: 0 0 4px; font-size: clamp(24px, 3vw, 34px); letter-spacing: -.02em; }
#viewer-meta { margin-top: 0; }
.video-list { display: grid; gap: 10px; margin-top: 18px; max-height: 72vh; overflow: auto; padding: 2px 6px 2px 2px; }
.video-item { display: grid; grid-template-columns: 92px 1fr; gap: 12px; padding: 9px; align-items: center; transition: transform .16s ease, box-shadow .16s ease, border-color .16s ease; }
.video-item.active { border-color: var(--accent); box-shadow: inset 4px 0 0 var(--accent), 0 10px 22px rgba(29, 110, 234, .10); }
.video-item img { width: 92px; height: 58px; object-fit: cover; border-radius: 10px; background: #dce4ee; }
.video-item strong { display: block; font-size: 14px; overflow-wrap: anywhere; color: var(--text); }
.video-item span { color: #657282; font-size: 13px; }
.stage { background: #0e1621; border-radius: 16px; padding: 14px; min-height: 300px; box-shadow: var(--shadow); }
video { width: 100%; max-height: 78vh; display: block; border-radius: 10px; background: #000; }
@media (max-width: 860px) {
  .topbar { display: grid; align-items: start; }
  .viewer-layout { grid-template-columns: 1fr; }
  .video-list { max-height: none; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); }
}
@media (max-width: 520px) {
  main { padding-inline: 14px; }
  .topbar { padding-inline: 14px; }
  .category-grid { grid-template-columns: 1fr; }
  .video-item { grid-template-columns: 78px 1fr; }
  .video-item img { width: 78px; height: 50px; }
}
""",
        encoding="utf-8",
    )

    (DOCS_DIR / "app.js").write_text(
        """const state = { manifest: [], category: null, active: null, query: "" };
const $ = (id) => document.getElementById(id);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showStatus(kind, title, message) {
  $("viewer").hidden = true;
  $("categories").hidden = false;
  $("categories").innerHTML = `<article class="status-card ${kind}">
    <h2>${escapeHtml(title)}</h2>
    <p>${escapeHtml(message)}</p>
  </article>`;
}

function simulationCountLabel(count) {
  return `${count} simulation${count === 1 ? "" : "s"}`;
}

function matchesQuery(item) {
  if (!state.query) return true;
  const q = state.query.toLowerCase();
  return [item.category, item.title, `${item.frames} frames`, `${item.width}x${item.height}`]
    .some((value) => String(value ?? "").toLowerCase().includes(q));
}

function renderCategories() {
  $("viewer").hidden = true;
  $("categories").hidden = false;
  if (!state.manifest.length) {
    showStatus("empty", "No simulations available", "The manifest loaded, but it does not list any simulation movies yet.");
    return;
  }

  const matchingItems = state.manifest.filter(matchesQuery);
  if (!matchingItems.length) {
    showStatus("empty", "No matching simulations", "Try a broader search, such as Turbo, Zigzag, or frames.");
    return;
  }

  const byCategory = new Map();
  for (const item of matchingItems) {
    if (!byCategory.has(item.category)) byCategory.set(item.category, []);
    byCategory.get(item.category).push(item);
  }

  $("categories").innerHTML = [...byCategory.entries()].map(([category, items]) => {
    const first = items[0];
    const thumb = first.categoryThumbnail || first.poster;
    const frameTotal = items.reduce((sum, item) => sum + Number(item.frames || 0), 0);
    return `<button class="category-card" data-category="${escapeHtml(category)}">
      <img src="${escapeHtml(thumb)}" alt="${escapeHtml(category)} preview">
      <div class="card-body">
        <h2>${escapeHtml(category)}</h2>
        <p>${simulationCountLabel(items.length)}</p>
        <div class="card-meta"><span class="pill">${frameTotal.toLocaleString()} total frames</span></div>
      </div>
    </button>`;
  }).join("");

  document.querySelectorAll(".category-card").forEach((card) => {
    card.addEventListener("click", () => openCategory(card.dataset.category));
  });
}

function openCategory(category) {
  state.category = category;
  const items = state.manifest.filter((item) => item.category === category && matchesQuery(item));
  if (!items.length) {
    state.category = null;
    renderCategories();
    return;
  }
  $("categories").hidden = true;
  $("viewer").hidden = false;
  $("viewer-title").textContent = category;
  $("viewer-meta").textContent = `${items.length} browser-ready simulation movie${items.length === 1 ? "" : "s"}`;
  $("video-list").innerHTML = items.map((item, index) => `<button class="video-item" data-video="${escapeHtml(item.video)}" data-index="${index}">
    <img src="${escapeHtml(item.poster)}" alt="${escapeHtml(item.title)} poster">
    <span><strong>${escapeHtml(item.title)}</strong><span>${Number(item.frames || 0).toLocaleString()} frames · ${escapeHtml(item.width)}x${escapeHtml(item.height)}</span></span>
  </button>`).join("");
  document.querySelectorAll(".video-item").forEach((button) => {
    button.addEventListener("click", () => setVideo(items[Number(button.dataset.index)]));
  });
  setVideo(items[0]);
}

function setVideo(item) {
  state.active = item;
  const video = $("video");
  video.poster = item.poster;
  video.src = item.video;
  video.load();
  document.querySelectorAll(".video-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.video === item.video);
  });
}

$("back").addEventListener("click", renderCategories);
$("search").addEventListener("input", (event) => {
  state.query = event.target.value.trim();
  renderCategories();
});

showStatus("loading", "Loading simulations", "Fetching the latest simulation manifest.");
fetch("data/manifest.json")
  .then((res) => {
    if (!res.ok) throw new Error(`Manifest request failed with status ${res.status}`);
    return res.json();
  })
  .then((manifest) => {
    if (!Array.isArray(manifest)) throw new Error("Manifest JSON is not an array.");
    state.manifest = manifest.filter((item) => item && item.category && item.title && item.video && item.poster);
    renderCategories();
  })
  .catch((error) => {
    showStatus("error", "Could not load simulations", error.message || "The simulation manifest could not be loaded.");
  });
""",
        encoding="utf-8",
    )


def main() -> None:
    VIDEO_DIR.mkdir(parents=True, exist_ok=True)
    POSTER_DIR.mkdir(parents=True, exist_ok=True)
    THUMB_DIR.mkdir(parents=True, exist_ok=True)

    manifest: list[dict] = []
    categories = index_simulations()
    category_thumbs = {category: copy_thumbnail(category) for category in categories}

    for category, files in categories.items():
        for src in files:
            slug = f"{slugify(category)}-{slugify(src.stem)}"
            video = VIDEO_DIR / f"{slug}.mp4"
            poster = POSTER_DIR / f"{slug}.jpg"
            print(f"Converting {src.relative_to(ROOT)}")
            frames, size = convert_tiff_to_mp4(src, video, poster)
            manifest.append({
                "category": category,
                "title": src.name,
                "frames": frames,
                "width": size[0],
                "height": size[1],
                "video": str(video.relative_to(DOCS_DIR)),
                "poster": str(poster.relative_to(DOCS_DIR)),
                "categoryThumbnail": category_thumbs.get(category),
            })

    write_site(manifest)
    total_mb = sum(p.stat().st_size for p in DOCS_DIR.rglob("*") if p.is_file()) / 1024 / 1024
    print(f"Built {len(manifest)} videos in {DOCS_DIR} ({total_mb:.1f} MB)")


if __name__ == "__main__":
    main()
