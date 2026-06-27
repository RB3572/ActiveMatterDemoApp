const state = { manifest: [], category: null, active: null, query: "", diyReady: false };
const $ = (id) => document.getElementById(id);
const DIY_WIDTH = 1280;
const DIY_HEIGHT = 800;
function escapeHtml(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function hideAllSections() { $("categories").hidden = true; $("viewer").hidden = true; $("diy").hidden = true; }
function showStatus(kind, title, message) { hideAllSections(); $("categories").hidden = false; $("categories").innerHTML = `${diyLaunchCard()}<article class="status-card ${kind}"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(message)}</p></article>`; bindDiyLaunchers(); }
function simulationCountLabel(count) { return `${count} simulation${count === 1 ? "" : "s"}`; }
function diyLaunchCard() { return `<button class="diy-launch-card" type="button" data-action="open-diy"><span><span class="eyebrow">Run a custom simulation</span><h2>DIY Pattern Builder</h2><p>Draw light activation and PDMS wall masks, then run a browser simulation directly on the site.</p></span><span class="primary-button">Open simulator</span></button>`; }
function bindDiyLaunchers() { document.querySelectorAll("[data-action='open-diy']").forEach((button) => { button.addEventListener("click", openDiy); }); }
function matchesQuery(item) { if (!state.query) return true; const q = state.query.toLowerCase(); return [item.category, item.title, `${item.frames} frames`, `${item.width}x${item.height}`].some((value) => String(value ?? "").toLowerCase().includes(q)); }
function renderCategories() {
  hideAllSections();
  $("categories").hidden = false;
  if (!state.manifest.length) { showStatus("empty", "No simulations available", "The manifest loaded, but it does not list any simulation movies yet."); return; }
  const matchingItems = state.manifest.filter(matchesQuery);
  if (!matchingItems.length) { showStatus("empty", "No matching simulations", "Try a broader search, such as Turbo, Zigzag, or frames."); return; }
  const byCategory = new Map();
  for (const item of matchingItems) { if (!byCategory.has(item.category)) byCategory.set(item.category, []); byCategory.get(item.category).push(item); }
  $("categories").innerHTML = `${diyLaunchCard()}${[...byCategory.entries()].map(([category, items]) => {
    const first = items[0]; const thumb = first.categoryThumbnail || first.poster; const frameTotal = items.reduce((sum, item) => sum + Number(item.frames || 0), 0);
    return `<button class="category-card" data-category="${escapeHtml(category)}"><img src="${escapeHtml(thumb)}" alt="${escapeHtml(category)} preview"><div class="card-body"><h2>${escapeHtml(category)}</h2><p>${simulationCountLabel(items.length)}</p><div class="card-meta"><span class="pill">${frameTotal.toLocaleString()} total frames</span></div></div></button>`;
  }).join("")}`;
  bindDiyLaunchers();
  document.querySelectorAll(".category-card").forEach((card) => { card.addEventListener("click", () => openCategory(card.dataset.category)); });
}
function openCategory(category) {
  state.category = category;
  const items = state.manifest.filter((item) => item.category === category && matchesQuery(item));
  if (!items.length) { state.category = null; renderCategories(); return; }
  hideAllSections();
  $("viewer").hidden = false;
  $("viewer-title").textContent = category;
  $("viewer-meta").textContent = `${items.length} browser-ready simulation movie${items.length === 1 ? "" : "s"}`;
  $("video-list").innerHTML = items.map((item, index) => `<button class="video-item" data-video="${escapeHtml(item.video)}" data-index="${index}"><img src="${escapeHtml(item.poster)}" alt="${escapeHtml(item.title)} poster"><span><strong>${escapeHtml(item.title)}</strong><span>${Number(item.frames || 0).toLocaleString()} frames · ${escapeHtml(item.width)}x${escapeHtml(item.height)}</span></span></button>`).join("");
  document.querySelectorAll(".video-item").forEach((button) => { button.addEventListener("click", () => setVideo(items[Number(button.dataset.index)])); });
  setVideo(items[0]);
}
function setVideo(item) { state.active = item; const video = $("video"); video.poster = item.poster; video.src = item.video; video.load(); document.querySelectorAll(".video-item").forEach((button) => { button.classList.toggle("active", button.dataset.video === item.video); }); }
function openDiy() { hideAllSections(); $("diy").hidden = false; initDiyCanvas(); }
function createLayerCanvas() { const canvas = document.createElement("canvas"); canvas.width = DIY_WIDTH; canvas.height = DIY_HEIGHT; return canvas; }
const diy = { light: createLayerCanvas(), mask: createLayerCanvas(), drawing: false, start: null, last: null };
function getDiyPoint(event) { const canvas = $("diy-canvas"); const rect = canvas.getBoundingClientRect(); return { x: (event.clientX - rect.left) * (DIY_WIDTH / rect.width), y: (event.clientY - rect.top) * (DIY_HEIGHT / rect.height) }; }
function activeLayerContext() { const layer = $("diy-mode").value === "light" ? diy.light : diy.mask; return layer.getContext("2d"); }
function activeColor() { return $("diy-mode").value === "light" ? "#13AEEC" : "#FF3B30"; }
function drawGuide(ctx) { ctx.fillStyle = "#000000"; ctx.fillRect(0, 0, DIY_WIDTH, DIY_HEIGHT); ctx.fillStyle = "rgba(128,128,128,0.25)"; ctx.strokeStyle = "#9ca3af"; ctx.lineWidth = 2; ctx.setLineDash([6, 6]); ctx.fillRect(274.5, 34.5, 731, 731); ctx.strokeRect(274.5, 34.5, 731, 731); ctx.setLineDash([]); }
function renderDiyCanvas(previewShape = null) { const canvas = $("diy-canvas"); const ctx = canvas.getContext("2d"); drawGuide(ctx); ctx.drawImage(diy.light, 0, 0); ctx.drawImage(diy.mask, 0, 0); if (previewShape) drawShape(ctx, previewShape, true); }
function drawLine(from, to) { const ctx = activeLayerContext(); ctx.strokeStyle = activeColor(); ctx.lineWidth = Number($("diy-brush").value); ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke(); }
function drawShape(ctx, shape, isPreview = false) { const { start, end, tool, filled, color, brush } = shape; ctx.save(); if (isPreview) ctx.globalAlpha = 0.75; ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = brush; const x = Math.min(start.x, end.x); const y = Math.min(start.y, end.y); const w = Math.abs(end.x - start.x); const h = Math.abs(end.y - start.y); if (tool === "rect") { if (filled) ctx.fillRect(x, y, w, h); else ctx.strokeRect(x, y, w, h); } else if (tool === "circle") { const r = Math.sqrt(w * w + h * h) / 2; ctx.beginPath(); ctx.arc((start.x + end.x) / 2, (start.y + end.y) / 2, r, 0, Math.PI * 2); if (filled) ctx.fill(); else ctx.stroke(); } ctx.restore(); }
function commitShape(end) { const tool = $("diy-tool").value; if (tool === "draw" || !diy.start) return; drawShape(activeLayerContext(), { start: diy.start, end, tool, filled: $("diy-filled").checked, color: activeColor(), brush: Number($("diy-brush").value) }); renderDiyCanvas(); }
function pointerDown(event) { event.preventDefault(); diy.drawing = true; diy.start = getDiyPoint(event); diy.last = diy.start; }
function pointerMove(event) { if (!diy.drawing) return; event.preventDefault(); const point = getDiyPoint(event); if ($("diy-tool").value === "draw") { drawLine(diy.last, point); diy.last = point; renderDiyCanvas(); } else renderDiyCanvas({ start: diy.start, end: point, tool: $("diy-tool").value, filled: $("diy-filled").checked, color: activeColor(), brush: Number($("diy-brush").value) }); }
function pointerUp(event) { if (!diy.drawing) return; event.preventDefault(); commitShape(getDiyPoint(event)); diy.drawing = false; diy.start = null; diy.last = null; }
function clearDiyCanvas() { [diy.light, diy.mask].forEach((layer) => layer.getContext("2d").clearRect(0, 0, DIY_WIDTH, DIY_HEIGHT)); renderDiyCanvas(); }
function buildMaskDownload(kind) { const output = createLayerCanvas(); const out = output.getContext("2d"); const source = kind === "light" ? diy.light : diy.mask; const data = source.getContext("2d").getImageData(0, 0, DIY_WIDTH, DIY_HEIGHT); const result = out.createImageData(DIY_WIDTH, DIY_HEIGHT); for (let i = 0; i < data.data.length; i += 4) { const value = kind === "light" ? (data.data[i + 3] > 0 ? 255 : 0) : (data.data[i + 3] > 0 ? 0 : 255); result.data[i] = value; result.data[i + 1] = value; result.data[i + 2] = value; result.data[i + 3] = 255; } out.putImageData(result, 0, 0); const link = document.createElement("a"); link.href = output.toDataURL("image/png"); link.download = kind === "light" ? "lightmask.png" : "gelmask.png"; link.click(); }
function initDiyCanvas() { if (state.diyReady) { renderDiyCanvas(); return; } const canvas = $("diy-canvas"); canvas.addEventListener("pointerdown", pointerDown); canvas.addEventListener("pointermove", pointerMove); canvas.addEventListener("pointerup", pointerUp); canvas.addEventListener("pointerleave", (event) => { if (diy.drawing) pointerUp(event); }); $("diy-clear").addEventListener("click", clearDiyCanvas); $("diy-export-light").addEventListener("click", () => buildMaskDownload("light")); $("diy-export-gel").addEventListener("click", () => buildMaskDownload("gel")); $("diy-brush").addEventListener("input", (event) => { $("diy-brush-value").textContent = `${event.target.value} px`; }); renderDiyCanvas(); state.diyReady = true; }
$("back").addEventListener("click", renderCategories);
$("diy-back").addEventListener("click", renderCategories);
$("search").addEventListener("input", (event) => { state.query = event.target.value.trim(); renderCategories(); });
showStatus("loading", "Loading simulations", "Fetching the latest simulation manifest.");
fetch("data/manifest.json").then((res) => { if (!res.ok) throw new Error(`Manifest request failed with status ${res.status}`); return res.json(); }).then((manifest) => { if (!Array.isArray(manifest)) throw new Error("Manifest JSON is not an array."); state.manifest = manifest.filter((item) => item && item.category && item.title && item.video && item.poster); renderCategories(); }).catch((error) => { showStatus("error", "Could not load simulations", error.message || "The simulation manifest could not be loaded."); });
