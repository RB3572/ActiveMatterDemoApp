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
function openDiy() { hideAllSections(); $("diy").hidden = false; window.initProDiyCanvas?.(); }
$("back").addEventListener("click", renderCategories);
$("diy-back").addEventListener("click", renderCategories);
$("search").addEventListener("input", (event) => { state.query = event.target.value.trim(); renderCategories(); });
showStatus("loading", "Loading simulations", "Fetching the latest simulation manifest.");
fetch("data/manifest.json").then((res) => { if (!res.ok) throw new Error(`Manifest request failed with status ${res.status}`); return res.json(); }).then((manifest) => { if (!Array.isArray(manifest)) throw new Error("Manifest JSON is not an array."); state.manifest = manifest.filter((item) => item && item.category && item.title && item.video && item.poster); renderCategories(); }).catch((error) => { showStatus("error", "Could not load simulations", error.message || "The simulation manifest could not be loaded."); });
