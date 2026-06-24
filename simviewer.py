# simviewer.py — Active Matter Simulation Viewer (Desktop/Web)
# -----------------------------------------------------------
# A single‑file Streamlit app to browse categories (Turbo, Whirlpool,
# Centipede, 2Layer, Zigzag), list stacked‑TIFF simulations, and view
# frames interactively with a slider.
#
# ▶ Install deps (once):
#     pip install streamlit pillow tifffile imageio
#
# ▶ Run from the DemoApp folder that contains Simulation/ and Thumbnails/:
#     streamlit run simviewer.py
#
# Folder layout expected (example):
# DemoApp/
#   Simulation/
#     2Layer/*.tiff
#     Centipede/*.tiff
#     Turbo/*.tiff
#     Whirlpool/*.tiff
#     Zigzag/*.tiff
#     ActivationExample.tiff        # special standalone example
#   Thumbnails/
#     2Layer_TN.png, Centipede_TN.png, Whirlpool_TN.png, Zigzag_TN.png, (Turbo_TN.png optional)
#   simviewer.py

from __future__ import annotations
import io
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Tuple
import streamlit as st
from streamlit_drawable_canvas import st_canvas

import numpy as np
from PIL import Image, ImageDraw
from contextlib import contextmanager
import os as _os

from pathlib import Path
# Define ROOT early so it can be used below
ROOT = Path(__file__).resolve().parent
import sys, importlib.util
import importlib

# Try to import run_sim from DIYSim/SoloSim.py robustly
_diy_err = None
solo_path = ROOT / "DIYSim" / "SoloSim.py"
diy_run_sim = None
try:
    from DIYSim.SoloSim import run_sim as diy_run_sim  # standard import
except Exception as e:
    _diy_err = e
    # Fallback: load directly from file if it exists
    if solo_path.exists():
        try:
            spec = importlib.util.spec_from_file_location("DIYSim.SoloSim", str(solo_path))
            _mod = importlib.util.module_from_spec(spec)
            sys.modules["DIYSim.SoloSim"] = _mod
            assert spec and spec.loader
            spec.loader.exec_module(_mod)  # type: ignore[attr-defined]
            diy_run_sim = getattr(_mod, "run_sim", None)
        except Exception as e2:
            _diy_err = e2
    else:
        _diy_err = FileNotFoundError(f"Missing {solo_path}")

@contextmanager
def _chdir(path):
    prev = _os.getcwd()
    _os.chdir(str(path))
    try:
        yield
    finally:
        _os.chdir(prev)

# Patch SoloSim's tqdm to drive Streamlit progress bar
@contextmanager
def _patch_solarsim_tqdm(progress, total_hint: int | None = None):
    """Temporarily replace DIYSim.SoloSim.tqdm so we can report true progress.
    Works when SoloSim did `from tqdm import tqdm`.
    """
    mod = sys.modules.get("DIYSim.SoloSim")
    if mod is None:
        try:
            mod = importlib.import_module("DIYSim.SoloSim")
        except Exception:
            # If we can't import, yield without patching
            yield
            return
    original = getattr(mod, "tqdm", None)

    def _tqdm_wrapper(iterable=None, *args, **kwargs):
        # Determine total
        total = kwargs.get("total", None)
        if total is None:
            try:
                total = len(iterable)  # type: ignore[arg-type]
            except Exception:
                total = total_hint
        done = 0
        # Initialize bar
        try:
            progress.progress(0)
        except Exception:
            pass
        for item in iterable:
            yield item
            done += 1
            if total:
                pct = max(0, min(100, int(done * 100 / total)))
                try:
                    progress.progress(pct)
                except Exception:
                    pass

    try:
        if original is not None:
            setattr(mod, "tqdm", _tqdm_wrapper)
        yield
    finally:
        if original is not None:
            setattr(mod, "tqdm", original)

# tifffile is much faster/robust than PIL for stacks
try:
    import tifffile as tiff
except Exception:  # pragma: no cover
    tiff = None

APP_TITLE = "Active Matter Pump Simulations"
ACCENT = "#1f6feb"  # blue-gray accent

# ROOT already defined above
DIY_DIR = ROOT / "DIYSim"
SIM_DIR = ROOT / "Simulation"
THUMBS_DIR = ROOT / "Thumbnails"

CATEGORY_ORDER = ["Turbo", "Whirlpool", "Centipede", "2Layer", "Zigzag", "Activation Example"]
TIFF_EXTS = {".tif", ".tiff"}

# --------------------------- Utility helpers --------------------------- #

def chunked(seq, n):
    for i in range(0, len(seq), n):
        yield seq[i : i + n]


def normalize_to_uint8(img: np.ndarray) -> np.ndarray:
    arr = np.asarray(img)
    if arr.dtype == np.uint8:
        return arr
    if np.issubdtype(arr.dtype, np.floating):
        arr = np.clip(arr, 0.0, 1.0)
        arr = (arr * 255).astype(np.uint8)
    else:
        mx = float(arr.max()) if arr.size else 1.0
        if mx <= 0:
            mx = 1.0
        arr = (arr.astype(np.float32) / mx * 255.0).astype(np.uint8)
    return arr


@st.cache_data(show_spinner=False)
def index_simulations(sim_root: Path) -> Dict[str, List[Path]]:
    """Scan Simulation/ for category folders and TIFF files.
    Also pulls in ActivationExample.tiff as a pseudo-category.
    """
    cats: Dict[str, List[Path]] = {}
    if not sim_root.exists():
        return cats

    for p in sorted(sim_root.iterdir(), key=lambda p: p.name.lower()):
        if p.name.startswith("."):
            continue
        if p.is_dir():
            files = [f for f in sorted(p.iterdir()) if f.suffix.lower() in TIFF_EXTS]
            if files:
                cats[p.name] = files

    # Special standalone example
    example = sim_root / "ActivationExample.tiff"
    if example.exists():
        cats["Activation Example"] = [example]

    # Sort by desired order, then alpha
    cats = dict(
        sorted(
            cats.items(),
            key=lambda kv: (
                CATEGORY_ORDER.index(kv[0]) if kv[0] in CATEGORY_ORDER else 999,
                kv[0].lower(),
            ),
        )
    )
    return cats


@st.cache_data(show_spinner=False)
def category_count(index: Dict[str, List[Path]]) -> Dict[str, int]:
    return {k: len(v) for k, v in index.items()}


def _thumb_candidates(cat: str) -> List[str]:
    # Try a few common naming patterns for thumbnails
    base = cat.replace(" ", "")
    return [
        f"{cat}_TN.png",
        f"{base}_TN.png",
        f"{cat}.png",
        f"{base}.png",
        f"{cat.lower()}_tn.png",
    ]


@st.cache_data(show_spinner=False)
def load_category_thumbnail(cat: str) -> Image.Image:
    for name in _thumb_candidates(cat):
        fp = THUMBS_DIR / name
        if fp.exists():
            try:
                return Image.open(fp).convert("RGB")
            except Exception:
                pass
    # Fallback: draw a simple abstract icon
    return draw_placeholder_icon(cat)


def draw_placeholder_icon(cat: str, size: Tuple[int, int] = (1200, 700)) -> Image.Image:
    w, h = size
    img = Image.new("RGB", size, color=(20, 36, 58))  # deep blue background
    d = ImageDraw.Draw(img)
    stroke = 8
    fg = (230, 238, 255)

    if "Whirlpool" in cat:
        # Spiral arcs
        for r in range(40, min(w, h) // 2, 40):
            d.arc([w // 2 - r, h // 2 - r, w // 2 + r, h // 2 + r], 30, 300, fill=fg, width=stroke)
    elif "Turbo" in cat:
        # Swirl arms
        for i in range(4):
            d.arc([150 + i * 60, 100 + i * 60, w - 150 - i * 60, h - 100 - i * 60], 10 + i * 15, 340 - i * 10, fill=fg, width=stroke)
    elif "Centipede" in cat:
        # Repeating U waves
        step = 120
        y = h // 2
        for x in range(100, w - 100, step):
            d.arc([x, y - 80, x + step // 2, y + 80], 90, 270, fill=fg, width=stroke)
            d.arc([x + step // 2, y - 80, x + step, y + 80], 270, 90, fill=fg, width=stroke)
    elif "2Layer" in cat or "2 Layer" in cat:
        d.line((120, h // 3, w - 120, h // 3), fill=fg, width=stroke)
        d.line((120, 2 * h // 3, w - 120, 2 * h // 3), fill=fg, width=stroke)
    elif "Zigzag" in cat:
        pts = []
        n = 9
        for i in range(n):
            x = 100 + int((w - 200) * i / (n - 1))
            y = 200 if i % 2 == 0 else h - 200
            pts.append((x, y))
        d.line(pts, fill=fg, width=stroke)
    else:  # Activation example or unknown
        r = min(w, h) // 3
        d.ellipse((w // 2 - r, h // 2 - r, w // 2 + r, h // 2 + r), outline=fg, width=stroke)
    return img


# --------------- TIFF loading (cached) & metadata helpers --------------- #

@st.cache_data(show_spinner=False)
def tiff_info(path: Path) -> Tuple[int, Tuple[int, ...]]:
    """Return (num_frames, frame_shape)."""
    if tiff is None:
        # Fallback via PIL (slower, limited)
        with Image.open(path) as im:
            n = getattr(im, "n_frames", 1)
            im.seek(0)
            shp = im.size[::-1]  # (H, W)
        return n, (shp[0], shp[1])

    with tiff.TiffFile(str(path)) as tf:
        n = len(tf.pages)
        shp = tf.pages[0].shape
        if isinstance(shp, tuple) and len(shp) == 2:
            pass
        elif isinstance(shp, tuple) and len(shp) == 3:
            # Could be (H,W,C) or (C,H,W)
            if shp[-1] in (3, 4):
                shp = (shp[0], shp[1])
            elif shp[0] in (3, 4):
                shp = (shp[1], shp[2])
        return n, tuple(map(int, shp))


@st.cache_resource(show_spinner=False)
def load_stack(path: Path) -> np.ndarray:
    """Load entire TIFF stack to memory (cached). Returns array [T,H,W,(C)]."""
    if tiff is None:
        frames = []
        with Image.open(path) as im:
            for i in range(getattr(im, "n_frames", 1)):
                im.seek(i)
                frames.append(np.array(im.convert("L")))
        arr = np.stack(frames, axis=0)
        return arr
    arr = tiff.imread(str(path))  # tifffile handles stacks efficiently
    # Ensure arr shape consistency: [T,H,W] or [T,H,W,C]
    if arr.ndim == 2:
        arr = arr[None, ...]
    elif arr.ndim == 3:
        pass
    elif arr.ndim == 4:
        # Could be [T,C,H,W] or [T,H,W,C]
        if arr.shape[1] in (3, 4):
            arr = np.moveaxis(arr, 1, -1)
        elif arr.shape[-1] in (3, 4):
            pass
        else:
            # Collapse channels if unknown
            arr = arr[..., 0]
    return arr


@st.cache_data(show_spinner=False)
def first_frame(path: Path) -> Image.Image:
    stack = load_stack(path)
    frame0 = stack[0]
    if frame0.ndim == 2:
        frame0 = np.stack([frame0] * 3, axis=-1)
    frame0 = normalize_to_uint8(frame0)
    return Image.fromarray(frame0)


def get_frame(path: Path, idx: int) -> Image.Image:
    stack = load_stack(path)
    idx = int(np.clip(idx, 0, len(stack) - 1))
    fr = stack[idx]
    if fr.ndim == 2:
        fr = np.stack([fr] * 3, axis=-1)
    fr = normalize_to_uint8(fr)
    return Image.fromarray(fr)


# --- Helper to render current TIFF stack as an animated GIF (for smooth autoplay) --- #
@st.cache_resource(show_spinner=False)
def stack_as_gif(path: Path, fps: int, max_side: int = 1024) -> bytes:
    """Return an animated GIF (bytes) for the given TIFF stack at the requested fps.
    Uses cached bytes so autoplay is smooth without rerun loops.
    """
    arr = load_stack(path)  # [T,H,W,(C)]
    frames = []
    for i in range(len(arr)):
        fr = arr[i]
        if fr.ndim == 2:
            fr = np.stack([fr] * 3, axis=-1)
        fr = normalize_to_uint8(fr)
        img = Image.fromarray(fr)
        # Downscale if huge, to keep GIF small/smooth
        w, h = img.size
        scale = 1.0
        if max(w, h) > max_side:
            scale = max_side / float(max(w, h))
        if scale < 1.0:
            img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
        frames.append(img.convert("P", palette=Image.ADAPTIVE))
    if not frames:
        return b""
    buf = io.BytesIO()
    duration_ms = max(1, int(1000 / max(fps, 1)))
    frames[0].save(
        buf,
        format="GIF",
        save_all=True,
        append_images=frames[1:],
        duration=duration_ms,
        loop=0,
        disposal=2,
    )
    return buf.getvalue()


# ------------------------------ UI Styles ------------------------------ #

st.set_page_config(page_title=APP_TITLE, layout="wide")

st.markdown(
    f"""
    <style>
    :root {{ --accent: {ACCENT}; }}
    .app-title {{
        font-weight: 700; font-size: 2.0rem; margin: 0.25rem 0 1.0rem 0;
    }}
    .subtle {{ color: #6b7280; }}
    .card {{
        border-radius: 16px; padding: 0; background: #fff; box-shadow: 0 2px 12px rgba(0,0,0,0.06);
        transition: transform .15s ease, box-shadow .15s ease; overflow: hidden; border: 1px solid #e5e7eb;
    }}
    .card:hover {{ transform: translateY(-2px); box-shadow: 0 10px 22px rgba(0,0,0,0.10); }}
    .card-body {{ padding: 0.75rem 1rem 1rem 1rem; }}
    .btn {{ display:inline-block; padding: .5rem .9rem; border-radius: 10px; border: 1px solid var(--accent); color: var(--accent); text-decoration:none; }}
    .btn:hover {{ background: rgba(31,111,235,0.08); }}
    .pill {{ display:inline-block; padding:.2rem .6rem; border-radius: 999px; background: rgba(31,111,235,0.1); color: var(--accent); font-size:.85rem; }}
    .hdr {{ background: linear-gradient(180deg, #f8fafc 0%, #ffffff 100%); border-radius: 18px; padding: 1rem; border: 1px solid #e5e7eb; }}
    </style>
    """,
    unsafe_allow_html=True,
)

# ------------------------------ App State ------------------------------ #

if "page" not in st.session_state:
    st.session_state.page = "home"
if "category" not in st.session_state:
    st.session_state.category = None
if "video" not in st.session_state:
    st.session_state.video = None


def nav_home():
    st.session_state.page = "home"
    st.session_state.category = None
    st.session_state.video = None


def nav_category(cat: str):
    st.session_state.page = "category"
    st.session_state.category = cat
    st.session_state.video = None


def nav_video(path: Path):
    st.session_state.page = "video"
    st.session_state.video = str(path)
def nav_diy():
    st.session_state.page = "diy"
    st.session_state.video = None


# ------------------------------ Screens ------------------------------ #

# ------------------------------ Cache Utils ------------------------------ #

def clear_all_caches():
    """Clear all Streamlit caches used by this app."""
    try:
        index_simulations.clear()
    except Exception:
        pass
    try:
        category_count.clear()
    except Exception:
        pass
    try:
        first_frame.clear()
    except Exception:
        pass
    try:
        load_stack.clear()
    except Exception:
        pass
    try:
        tiff_info.clear()
    except Exception:
        pass


index = index_simulations(SIM_DIR)
counts = category_count(index)


def screen_home():
    st.markdown(f"<div class='hdr'><div class='app-title'>{APP_TITLE}</div><div class='subtle'>Browse by design category</div></div>", unsafe_allow_html=True)
    st.write("")

    # Search across category names
    q = st.text_input("Search categories or filenames", placeholder="e.g. Turbo, Zigzag, 200µm")

    cats = list(index.keys())
    if q:
        ql = q.lower()
        cats = [c for c in cats if ql in c.lower() or any(ql in f.stem.lower() for f in index[c])]

    if not cats:
        st.info("No matches. Try a different query.")
        return

    for row in chunked(cats, 3):
        cols = st.columns(3, gap="large")
        for col, cat in zip(cols, row):
            with col:
                thumb = load_category_thumbnail(cat)
                st.markdown("<div class='card'>", unsafe_allow_html=True)
                st.image(thumb, width='stretch')
                st.markdown("<div class='card-body'>", unsafe_allow_html=True)
                st.markdown(f"### {cat}")
                st.caption(f"{counts.get(cat, 0)} simulations")
                st.button("Open", key=f"open_{cat}", on_click=nav_category, kwargs={"cat": cat})
                st.markdown("</div></div>", unsafe_allow_html=True)

    with st.sidebar:
        st.markdown("### Options")
        if st.button("↻ Rescan / clear cache"):
            clear_all_caches()
            st.rerun()


def screen_category(cat: str):
    st.button("← Back", on_click=nav_home)
    st.markdown(f"<div class='app-title'>{cat} Simulations</div>", unsafe_allow_html=True)

    # Filter within this category
    search = st.text_input("Filter simulations", key=f"filter_{cat}", placeholder="type to filter…")

    files = index.get(cat, [])
    if search:
        ql = search.lower()
        files = [f for f in files if ql in f.name.lower()]

    sort_choice = st.selectbox("Sort", ["Name (A→Z)", "Name (Z→A)", "Frames (desc)", "Frames (asc)"])

    # Pre-compute metadata for sorting
    meta = {p: tiff_info(p) for p in files}

    if sort_choice == "Name (A→Z)":
        files.sort(key=lambda p: p.name.lower())
    elif sort_choice == "Name (Z→A)":
        files.sort(key=lambda p: p.name.lower(), reverse=True)
    elif sort_choice == "Frames (desc)":
        files.sort(key=lambda p: meta[p][0], reverse=True)
    else:
        files.sort(key=lambda p: meta[p][0])

    if not files:
        st.info("No simulations in this category.")
        return

    for row in chunked(files, 3):
        cols = st.columns(3, gap="large")
        for col, fpath in zip(cols, row):
            with col:
                try:
                    preview = first_frame(fpath)
                except Exception:
                    preview = draw_placeholder_icon(cat)
                st.markdown("<div class='card'>", unsafe_allow_html=True)
                st.image(preview, width='stretch')
                nframes, shape = meta[fpath]
                st.markdown("<div class='card-body'>", unsafe_allow_html=True)
                st.markdown(f"**{fpath.name}**")
                st.caption(f"{nframes} frames • {shape[0]}×{shape[1]}")
                st.button("View", key=f"view_{fpath}", on_click=nav_video, kwargs={"path": fpath})
                st.markdown("</div></div>", unsafe_allow_html=True)


def screen_video(path_str: str):
    path = Path(path_str)
    st.button("← Back to category", on_click=nav_category, kwargs={"cat": st.session_state.category})

    st.markdown(f"<div class='app-title'>{path.name}</div>", unsafe_allow_html=True)

    try:
        nframes, shape = tiff_info(path)
    except Exception as e:
        st.error(f"Failed to read TIFF: {e}")
        return

    left, right = st.columns([3, 1])
    with right:
        st.metric("Frames", nframes)
        st.metric("Resolution", f"{shape[1]}×{shape[0]}")
        fps = st.select_slider("Preview FPS", options=[2, 5, 10, 15, 20, 30], value=20)
        show_hist = st.checkbox("Show intensity histogram", value=False)

    with left:
        frame_idx = st.slider("Frame", min_value=0, max_value=max(nframes - 1, 0), value=0, step=1, key="frame_slider")
        img = get_frame(path, frame_idx)
        st.image(img, width='stretch', clamp=True)
    if show_hist:
        arr = np.array(img.convert("L"))
        hist = np.histogram(arr.flatten(), bins=32, range=(0, 255))[0]
        st.bar_chart(hist)

    st.divider()

    autoplay = st.toggle("Autoplay", value=True, help="Loops through frames at the selected FPS", key="viewer_autoplay")
    placeholder = st.empty()
    fps_int = int(fps)
    if autoplay:
        # Smooth, non-blocking autoplay using a cached animated GIF
        gif_bytes = stack_as_gif(path, fps_int)
        if gif_bytes:
            placeholder.image(gif_bytes, width='stretch')
        else:
            # Fallback to first frame if something went wrong
            placeholder.image(get_frame(path, 0), width='stretch', clamp=True)
    else:
        i = st.session_state.get("viewer_last_frame", 0)
        frame_idx_manual = st.slider("Frame", 0, max(nframes-1, 0), int(i), key="viewer_frame")
        st.session_state["viewer_last_frame"] = frame_idx_manual
        placeholder.image(get_frame(path, frame_idx_manual), width='stretch', clamp=True)
# ------------------------------ Sidebar (global) ------------------------------ #
with st.sidebar:
    st.markdown("### Tools")
    st.button("🧪 DIY Simulator", on_click=nav_diy)
    if st.button("↻ Rescan / clear cache"):
        clear_all_caches()
        st.rerun()
# ------------------------------ DIY Simulator Screen ------------------------------ #

def screen_diy():
    st.button("← Back", on_click=nav_home)
    st.markdown("<div class='app-title'>DIY Active Matter Pattern Builder</div>", unsafe_allow_html=True)
    st.caption("Draw your light (blue) and PDMS wall mask (red) on a 1280×800 black canvas. Export to PNG and TIFF for simulation.")

    col1, col2 = st.columns([3, 1])
    with col2:
        mode = st.radio("Drawing mode", ["Draw Light (blue)", "Draw Mask (red)"])
        tool = st.radio("Tool", ["Free draw", "Rectangle/Square", "Circle"], index=0)
        filled = st.checkbox("Fill shape", value=False, help="If checked, shapes are filled. Unchecked = hollow outline.")
        brush = st.slider("Brush/Stroke size", 2, 60, 16)
        st.caption("Canvas is fixed at 1280×800 (black background). Use Rectangle for squares.")
        export = st.button("💾 Export PNGs & TIFFs")
        run_sim = st.button("▶ Run simulation")
        visualize = st.button("👁️ Visualize result")

    stroke_color = "#13AEEC" if "Light" in mode else "#FF3B30"

    # Choose drawing mode
    if tool == "Free draw":
        drawing_mode = "freedraw"
    elif tool == "Rectangle/Square":
        drawing_mode = "rect"
    else:
        drawing_mode = "circle"

    # Fill color: transparent for hollow, opaque for filled
    if filled:
        fill_color = stroke_color  # fully opaque fill
    else:
        fill_color = "rgba(0,0,0,0)"

    with col1:
        # Centered overlay guide drawn as a locked Fabric object (won't intercept events)
        guide = {
            "version": "5.2.4",
            "objects": [
                {
                    "type": "rect",
                    "left": 274.5,   # (1280-400)/2
                    "top": 34.5,    # (800-400)/2
                    "width": 731,
                    "height": 731,
                    "fill": "rgba(128,128,128,0.25)",
                    "stroke": "#9ca3af",
                    "strokeWidth": 2,
                    "rx": 8,
                    "ry": 8,
                    "strokeDashArray": [6, 6],
                    "selectable": False,
                    "evented": False,
                    "hasControls": False,
                    "hasBorders": False,
                    "lockMovementX": True,
                    "lockMovementY": True,
                    "excludeFromExport": True
                }
            ]
        }

        canvas_result = st_canvas(
            fill_color=fill_color,
            stroke_width=brush,
            stroke_color=stroke_color,
            background_color="#000000",
            height=800,
            width=1280,
            drawing_mode=drawing_mode,
            update_streamlit=True,
            key="diy_canvas",
            display_toolbar=True,
            initial_drawing=guide,
        )

    if export:
        # Ensure output directory exists
        DIY_DIR.mkdir(parents=True, exist_ok=True)

        if canvas_result.image_data is None:
            st.warning("Nothing drawn yet — draw some blue/red first.")
            return

        from PIL import Image
        from pathlib import Path as _Path

        rgba = np.array(canvas_result.image_data).astype(np.uint8)  # (H,W,4)
        rgb = rgba[..., :3]

        # Target colors (approx)
        blue = np.array([19, 174, 236], dtype=np.int16)   # #13AEEC
        red  = np.array([255, 59, 48], dtype=np.int16)    # #FF3B30

        # Distances to target colors
        diff_blue = np.linalg.norm(rgb.astype(np.int16) - blue, axis=-1)
        diff_red  = np.linalg.norm(rgb.astype(np.int16) - red, axis=-1)

        # Tolerances to catch anti-aliased strokes
        tol_blue = 60
        tol_red = 60

        light_mask = (diff_blue <= tol_blue)
        gel_mask = (diff_red <= tol_red)

        # Binary 8-bit images
        light_img = (light_mask * 255).astype(np.uint8)
        gel_img = ((~gel_mask).astype(np.uint8) * 255)

        # Save PNGs
        light_png = DIY_DIR / "lightmask.png"
        gel_png = DIY_DIR / "gelmask.png"
        Image.fromarray(light_img, mode="L").save(light_png)
        Image.fromarray(gel_img, mode="L").save(gel_png)

        # Convert to TIFFs (your routine inline)
        target_size = (1280, 800)
        target_mode = "L"
        files_to_convert = ["gelmask.png", "lightmask.png"]
        for filename in files_to_convert:
            input_path = DIY_DIR / filename
            output_path = DIY_DIR / (_Path(filename).stem + ".tiff")
            img = Image.open(input_path).convert("RGB").resize(target_size).convert(target_mode)
            img.save(output_path, compression="tiff_adobe_deflate")

        st.success(f"Exported PNGs and TIFFs to {DIY_DIR}")
        st.write({
            "light_png": str(light_png),
            "gel_png": str(gel_png),
            "light_tiff": str(DIY_DIR / "lightmask.tiff"),
            "gel_tiff": str(DIY_DIR / "gelmask.tiff"),
        })

    if run_sim:
        DIY_DIR.mkdir(parents=True, exist_ok=True)

        # Ensure PNG inputs exist or create from canvas (keeps your current logic)
        light_png = DIY_DIR / "lightmask.png"
        gel_png = DIY_DIR / "gelmask.png"
        if (not light_png.exists()) or (not gel_png.exists()):
            if canvas_result.image_data is None:
                st.error("No input masks found and nothing drawn on canvas. Please draw and click 'Save inputs (PNGs)'.")
                st.stop()
            rgba = np.array(canvas_result.image_data).astype(np.uint8)
            rgb = rgba[..., :3]
            blue = np.array([19, 174, 236], dtype=np.int16)
            red  = np.array([255, 59, 48], dtype=np.int16)
            diff_blue = np.linalg.norm(rgb.astype(np.int16) - blue, axis=-1)
            diff_red  = np.linalg.norm(rgb.astype(np.int16) - red, axis=-1)
            tol_blue = 60; tol_red = 60
            light_mask = (diff_blue <= tol_blue)
            gel_mask = (diff_red <= tol_red)
            light_img = (light_mask * 255).astype(np.uint8)
            gel_img = ((~gel_mask).astype(np.uint8) * 255)  # black where red is drawn
            Image.fromarray(light_img, mode="L").save(light_png)
            Image.fromarray(gel_img, mode="L").save(gel_png)

        # Require DIYSimParm.txt
        param_name = "DIYSimParm"
        param_txt = DIY_DIR / f"{param_name}.txt"
        if not param_txt.exists():
            st.error(f"Missing parameter file: {param_txt}")
            st.stop()

        if diy_run_sim is None:
            st.error("Could not import DIYSim.SoloSim.run_sim. Check that DIYSim/SoloSim.py exists and imports cleanly.")
            if '_diy_err' in globals() and _diy_err is not None:
                st.exception(_diy_err)
            else:
                st.info("Tip: ensure `DemoApp/DIYSim/SoloSim.py` exists and contains a `def run_sim(parm): ...` function.")
            st.stop()

        # If your SoloSim expects a TIFF light pattern, convert PNG -> TIFF once:
        # (Only if DIYSimParm.txt uses 'lightmask.tiff' as light_pattern)
        light_tif = DIY_DIR / "lightmask.tiff"
        if light_tif.exists() is False:
            from PIL import Image
            Image.open(light_png).convert("L").save(light_tif, compression="tiff_adobe_deflate")

        # Run simulation with DIYSim as CWD so relative paths in SoloSim work
        progress = st.progress(0)
        status = st.empty()
        status.markdown("Running simulation…")
        try:
            with _chdir(DIY_DIR), _patch_solarsim_tqdm(progress):
                diy_run_sim(param_name)
        except Exception as err:
            status.markdown("Simulation failed.")
            st.exception(err)
            st.stop()
        progress.progress(100)
        status.markdown("Simulation complete.")

        # Preview the result using the standard video viewer
        sim_path = DIY_DIR / f"{param_name}.tiff"
        if not sim_path.exists():
            st.error(f"Simulation did not produce expected file: {sim_path}")
            st.stop()
        # Clear caches so freshly written TIFF is reloaded
        try:
            load_stack.clear()
        except Exception:
            pass
        try:
            tiff_info.clear()
        except Exception:
            pass
        try:
            first_frame.clear()
        except Exception:
            pass
        try:
            stack_as_gif.clear()
        except Exception:
            pass
        nav_video(sim_path)
        st.rerun()

    # --- Visualize an existing DIYSimParm.tiff via the standard viewer ---
    if 'visualize' in locals() and visualize:
        sim_path = DIY_DIR / "DIYSimParm.tiff"
        if not sim_path.exists():
            st.error(f"Could not find {sim_path}. Run the simulation first, or ensure the file exists.")
        else:
            # Clear caches to force fresh read of the latest file
            try:
                load_stack.clear()
            except Exception:
                pass
            try:
                tiff_info.clear()
            except Exception:
                pass
            try:
                first_frame.clear()
            except Exception:
                pass
            try:
                stack_as_gif.clear()
            except Exception:
                pass
            nav_video(sim_path)
            st.rerun()
# ------------------------------ Router ------------------------------ #

if st.session_state.page == "home":
    screen_home()
elif st.session_state.page == "category":
    screen_category(st.session_state.category)
elif st.session_state.page == "video":
    screen_video(st.session_state.video)
elif st.session_state.page == "diy":
    screen_diy()
else:
    nav_home()
    screen_home()
