const SIM_W = 1280;
const SIM_H = 800;
const DENSITY_W = 180;
const DENSITY_H = 112;

let simRunning = false;
let simAnimation = null;
let simFrame = 0;
let lightMask = null;
let wallMask = null;
let network = null;

function simEl(id) { return document.getElementById(id); }
function setStatus(message) { const el = simEl("sim-status"); if (el) el.textContent = message; }
function clearOutput(message = "Simulation output will appear here.") {
  const canvas = simEl("sim-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#020817";
  ctx.fillRect(0, 0, SIM_W, SIM_H);
  ctx.fillStyle = "#8aa0b8";
  ctx.font = "32px system-ui, sans-serif";
  ctx.fillText(message, 48, 80);
  setStatus(message);
}

function readMasksFromInputCanvas() {
  const ctx = simEl("diy-canvas").getContext("2d");
  const data = ctx.getImageData(0, 0, SIM_W, SIM_H).data;
  lightMask = new Uint8Array(SIM_W * SIM_H);
  wallMask = new Uint8Array(SIM_W * SIM_H);
  let lightCount = 0;
  let wallCount = 0;
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const isLight = b > 150 && g > 100 && r < 90;
    const isWall = r > 180 && g < 125 && b < 125;
    if (isLight) { lightMask[p] = 1; lightCount += 1; }
    if (isWall) { wallMask[p] = 1; wallCount += 1; }
  }
  return { lightCount, wallCount };
}

function maskIndex(x, y) {
  const xx = Math.max(0, Math.min(SIM_W - 1, Math.floor(x)));
  const yy = Math.max(0, Math.min(SIM_H - 1, Math.floor(y)));
  return yy * SIM_W + xx;
}
function wallAt(x, y) { if (x < 0 || x >= SIM_W || y < 0 || y >= SIM_H) return true; return wallMask && wallMask[maskIndex(x, y)] === 1; }
function lightAt(x, y) { if (!lightMask || x < 0 || x >= SIM_W || y < 0 || y >= SIM_H) return 0; return lightMask[maskIndex(x, y)]; }
function targetGridFromSlider() {
  const requested = Number(simEl("sim-particles")?.value || 2500);
  const nx = Math.max(28, Math.min(110, Math.round(Math.sqrt(requested * SIM_W / SIM_H))));
  const ny = Math.max(18, Math.min(70, Math.round(nx * SIM_H / SIM_W)));
  return { nx, ny };
}
function nodeId(x, y, nx) { return y * nx + x; }
function addSpring(springs, a, b, rawX, rawY, nodeMap) {
  const ia = nodeMap[a], ib = nodeMap[b];
  if (ia < 0 || ib < 0) return;
  const dx = rawX[b] - rawX[a], dy = rawY[b] - rawY[a];
  springs.push({ a: ia, b: ib, rest: Math.hypot(dx, dy) || 1 });
}

function buildMassSpringNetwork() {
  const { nx, ny } = targetGridFromSlider();
  const spacingX = SIM_W / (nx - 1);
  const spacingY = SIM_H / (ny - 1);
  const rawCount = nx * ny;
  const rawX = new Float32Array(rawCount);
  const rawY = new Float32Array(rawCount);
  const rawBlocked = new Uint8Array(rawCount);
  for (let gy = 0; gy < ny; gy += 1) {
    for (let gx = 0; gx < nx; gx += 1) {
      const id = nodeId(gx, gy, nx);
      rawX[id] = gx * spacingX;
      rawY[id] = gy * spacingY;
      rawBlocked[id] = wallAt(rawX[id], rawY[id]) ? 1 : 0;
    }
  }
  const nodeMap = new Int32Array(rawCount);
  nodeMap.fill(-1);
  let alive = 0;
  for (let i = 0; i < rawCount; i += 1) if (!rawBlocked[i]) nodeMap[i] = alive++;
  const x = new Float32Array(alive), y = new Float32Array(alive), x0 = new Float32Array(alive), y0 = new Float32Array(alive);
  const vx = new Float32Array(alive), vy = new Float32Array(alive), fx = new Float32Array(alive), fy = new Float32Array(alive);
  for (let i = 0; i < rawCount; i += 1) {
    const j = nodeMap[i];
    if (j >= 0) { x[j] = rawX[i]; y[j] = rawY[i]; x0[j] = rawX[i]; y0[j] = rawY[i]; }
  }
  const springs = [];
  for (let gy = 0; gy < ny; gy += 1) {
    for (let gx = 0; gx < nx; gx += 1) {
      const id = nodeId(gx, gy, nx);
      if (gx + 1 < nx) addSpring(springs, id, nodeId(gx + 1, gy, nx), rawX, rawY, nodeMap);
      if (gy + 1 < ny) addSpring(springs, id, nodeId(gx, gy + 1, nx), rawX, rawY, nodeMap);
      if (gx + 1 < nx && gy + 1 < ny) addSpring(springs, id, nodeId(gx + 1, gy + 1, nx), rawX, rawY, nodeMap);
      if (gx > 0 && gy + 1 < ny) addSpring(springs, id, nodeId(gx - 1, gy + 1, nx), rawX, rawY, nodeMap);
    }
  }
  return { nx, ny, x, y, x0, y0, vx, vy, fx, fy, springs, alive };
}

function stepMassSpring() {
  if (!network) return;
  const strength = Number(simEl("sim-strength")?.value || 65) / 100;
  const dt = 0.22, damping = 0.88, baseK = 0.030, anchorK = 0.0025, noise = 0.045;
  network.fx.fill(0); network.fy.fill(0);
  for (const s of network.springs) {
    const ax = network.x[s.a], ay = network.y[s.a], bx = network.x[s.b], by = network.y[s.b];
    const dx = bx - ax, dy = by - ay, dist = Math.hypot(dx, dy) + 1e-6;
    const activated = lightAt(ax, ay) || lightAt(bx, by);
    const targetRest = activated ? s.rest * Math.max(0.05, 1 - 0.96 * strength) : s.rest;
    const k = activated ? baseK * (3.5 + 7.5 * strength) : baseK;
    const f = k * (dist - targetRest), ux = dx / dist, uy = dy / dist, fx = f * ux, fy = f * uy;
    network.fx[s.a] += fx; network.fy[s.a] += fy; network.fx[s.b] -= fx; network.fy[s.b] -= fy;
  }
  for (let i = 0; i < network.alive; i += 1) {
    network.fx[i] += (network.x0[i] - network.x[i]) * anchorK;
    network.fy[i] += (network.y0[i] - network.y[i]) * anchorK;
    network.vx[i] = (network.vx[i] + network.fx[i] * dt + (Math.random() - 0.5) * noise) * damping;
    network.vy[i] = (network.vy[i] + network.fy[i] * dt + (Math.random() - 0.5) * noise) * damping;
    let nx = network.x[i] + network.vx[i] * dt, ny = network.y[i] + network.vy[i] * dt;
    if (wallAt(nx, ny)) { network.vx[i] *= -0.15; network.vy[i] *= -0.15; nx = network.x[i]; ny = network.y[i]; }
    network.x[i] = Math.max(0, Math.min(SIM_W - 1, nx));
    network.y[i] = Math.max(0, Math.min(SIM_H - 1, ny));
  }
  simFrame += 1;
}

function heatColor(ratio) {
  const v = Math.max(-1, Math.min(1, Math.log2(Math.max(0.08, ratio)) / 2.2));
  if (v >= 0) { const t = v; return [255, Math.round(255 * (1 - t)), Math.round(255 * (1 - t))]; }
  const t = -v; return [Math.round(255 * (1 - t)), Math.round(255 * (1 - t)), 255];
}
function drawMassSpringFrame() {
  const canvas = simEl("sim-canvas"), ctx = canvas.getContext("2d"), density = new Float32Array(DENSITY_W * DENSITY_H);
  for (let i = 0; i < network.alive; i += 1) {
    const gx = Math.max(0, Math.min(DENSITY_W - 1, Math.floor(network.x[i] / SIM_W * DENSITY_W)));
    const gy = Math.max(0, Math.min(DENSITY_H - 1, Math.floor(network.y[i] / SIM_H * DENSITY_H)));
    density[gy * DENSITY_W + gx] += 1;
  }
  const expected = Math.max(0.001, network.alive / (DENSITY_W * DENSITY_H));
  const image = ctx.createImageData(DENSITY_W, DENSITY_H);
  for (let gy = 0; gy < DENSITY_H; gy += 1) {
    for (let gx = 0; gx < DENSITY_W; gx += 1) {
      const p = gy * DENSITY_W + gx, px = Math.floor((gx + 0.5) * SIM_W / DENSITY_W), py = Math.floor((gy + 0.5) * SIM_H / DENSITY_H);
      let [r, g, b] = heatColor(density[p] / expected);
      if (lightAt(px, py)) { r = Math.round(r * 0.72); g = Math.min(255, Math.round(g * 0.92 + 60)); b = Math.round(b * 0.72); }
      if (wallAt(px, py)) { r = 42; g = 46; b = 52; }
      const o = p * 4; image.data[o] = r; image.data[o + 1] = g; image.data[o + 2] = b; image.data[o + 3] = 255;
    }
  }
  const heatCanvas = document.createElement("canvas");
  heatCanvas.width = DENSITY_W; heatCanvas.height = DENSITY_H; heatCanvas.getContext("2d").putImageData(image, 0, 0);
  ctx.imageSmoothingEnabled = true; ctx.fillStyle = "#020817"; ctx.fillRect(0, 0, SIM_W, SIM_H); ctx.drawImage(heatCanvas, 0, 0, SIM_W, SIM_H);
  ctx.save(); ctx.globalAlpha = 0.18; ctx.drawImage(simEl("diy-canvas"), 0, 0); ctx.restore();
  ctx.fillStyle = "rgba(255,255,255,0.82)"; ctx.font = "24px system-ui, sans-serif";
  ctx.fillText(`Frame ${simFrame.toLocaleString()}  |  Masses ${network.alive.toLocaleString()}  |  Springs ${network.springs.length.toLocaleString()}`, 32, 42);
}

function loop() {
  if (!simRunning) return;
  const steps = Number(simEl("sim-speed")?.value || 4);
  for (let i = 0; i < steps; i += 1) stepMassSpring();
  drawMassSpringFrame();
  if (simFrame % 20 === 0) setStatus(`Running mass-spring simulation. Frame ${simFrame.toLocaleString()} with ${network.alive.toLocaleString()} masses and ${network.springs.length.toLocaleString()} springs.`);
  simAnimation = requestAnimationFrame(loop);
}
function runSim() {
  stopSim();
  const masks = readMasksFromInputCanvas();
  network = buildMassSpringNetwork();
  simFrame = 0;
  if (network.alive < 25 || network.springs.length < 25) { clearOutput("Mask leaves too little free gel to simulate. Clear or reduce red walls."); return; }
  const lightPct = (100 * masks.lightCount / (SIM_W * SIM_H)).toFixed(1), wallPct = (100 * masks.wallCount / (SIM_W * SIM_H)).toFixed(1);
  drawMassSpringFrame();
  setStatus(`Running mass-spring simulation. Light area: ${lightPct}%. Wall area: ${wallPct}%. ${network.alive.toLocaleString()} masses, ${network.springs.length.toLocaleString()} springs.`);
  simRunning = true; simAnimation = requestAnimationFrame(loop);
}
function stopSim() { simRunning = false; if (simAnimation) cancelAnimationFrame(simAnimation); simAnimation = null; }
function pauseSim() { stopSim(); setStatus(`Paused at frame ${simFrame.toLocaleString()}.`); }
function resetSim() { stopSim(); network = null; simFrame = 0; clearOutput("Simulation reset. Click Run simulation to start."); }
function exportFrame() { const link = document.createElement("a"); link.href = simEl("sim-canvas").toDataURL("image/png"); link.download = "active-matter-simulation-frame.png"; link.click(); }
function bindSlider(id, labelId, suffix) { const slider = simEl(id), label = simEl(labelId); if (!slider || !label) return; slider.addEventListener("input", () => { label.textContent = `${slider.value}${suffix}`; }); }
function installSimulationControls() {
  simEl("sim-run")?.addEventListener("click", runSim);
  simEl("sim-pause")?.addEventListener("click", pauseSim);
  simEl("sim-reset")?.addEventListener("click", resetSim);
  simEl("sim-export-frame")?.addEventListener("click", exportFrame);
  simEl("diy-clear")?.addEventListener("click", resetSim);
  bindSlider("sim-particles", "sim-particles-value", " masses");
  bindSlider("sim-strength", "sim-strength-value", "%");
  bindSlider("sim-speed", "sim-speed-value", " steps/frame");
  clearOutput();
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", installSimulationControls); else installSimulationControls();
