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
TEMPLATE_DIR = ROOT / "tools" / "static_templates"

CATEGORY_ORDER = ["Turbo", "Whirlpool", "Centipede", "2Layer", "Zigzag", "Activation Example"]
TIFF_EXTS = {".tif", ".tiff"}
STATIC_TEMPLATE_FILES = ["index.html", "styles.css", "app.js", "app-main.js", "sim.js"]


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


def copy_static_templates() -> None:
    missing = [name for name in STATIC_TEMPLATE_FILES if not (TEMPLATE_DIR / name).exists()]
    if missing:
        raise FileNotFoundError(f"Missing static template files: {', '.join(missing)}")
    for name in STATIC_TEMPLATE_FILES:
        shutil.copy2(TEMPLATE_DIR / name, DOCS_DIR / name)


def write_site(manifest: list[dict]) -> None:
    (DOCS_DIR / "assets").mkdir(parents=True, exist_ok=True)
    (DOCS_DIR / "data").mkdir(parents=True, exist_ok=True)
    (DOCS_DIR / "data" / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    (DOCS_DIR / "CNAME").write_text("activematter.rishib.com\n", encoding="utf-8")
    (DOCS_DIR / ".nojekyll").write_text("", encoding="utf-8")
    copy_static_templates()


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
