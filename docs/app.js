const state = { manifest: [], category: null, active: null, query: "" };
const $ = (id) => document.getElementById(id);

function matchesQuery(item) {
  if (!state.query) return true;
  const q = state.query.toLowerCase();
  return item.category.toLowerCase().includes(q) || item.title.toLowerCase().includes(q);
}

function renderCategories() {
  $("viewer").hidden = true;
  $("categories").hidden = false;
  const byCategory = new Map();
  for (const item of state.manifest.filter(matchesQuery)) {
    if (!byCategory.has(item.category)) byCategory.set(item.category, []);
    byCategory.get(item.category).push(item);
  }
  $("categories").innerHTML = [...byCategory.entries()].map(([category, items]) => {
    const first = items[0];
    const thumb = first.categoryThumbnail || first.poster;
    return `<button class="category-card" data-category="${category}">
      <img src="${thumb}" alt="">
      <div class="card-body"><h2>${category}</h2><p>${items.length} simulation${items.length === 1 ? "" : "s"}</p></div>
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
  state.active = items[0];
  $("categories").hidden = true;
  $("viewer").hidden = false;
  $("viewer-title").textContent = category;
  $("viewer-meta").textContent = `${items.length} browser-ready simulation movie${items.length === 1 ? "" : "s"}`;
  $("video-list").innerHTML = items.map((item, index) => `<button class="video-item ${index === 0 ? "active" : ""}" data-index="${index}">
    <img src="${item.poster}" alt="">
    <span><strong>${item.title}</strong><span>${item.frames} frames · ${item.width}x${item.height}</span></span>
  </button>`).join("");
  document.querySelectorAll(".video-item").forEach((button) => {
    button.addEventListener("click", () => setVideo(items[Number(button.dataset.index)]));
  });
  setVideo(state.active);
}

function setVideo(item) {
  state.active = item;
  const video = $("video");
  video.poster = item.poster;
  video.src = item.video;
  video.load();
  document.querySelectorAll(".video-item").forEach((button) => {
    button.classList.toggle("active", button.textContent.includes(item.title));
  });
}

$("back").addEventListener("click", renderCategories);
$("search").addEventListener("input", (event) => {
  state.query = event.target.value.trim();
  renderCategories();
});

fetch("data/manifest.json")
  .then((res) => res.json())
  .then((manifest) => {
    state.manifest = manifest;
    renderCategories();
  });
