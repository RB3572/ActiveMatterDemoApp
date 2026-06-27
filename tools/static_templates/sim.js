const SIM_W = 1280;
const SIM_H = 800;
const FIELD_X = 240;
const FIELD_Y = 0;
const FIELD_SIZE = 800;
const PROJECTOR_X = 274.5;
const PROJECTOR_Y = 34.5;
const PROJECTOR_SIZE = 731;
const PLOT_SIZE = 700;
const PLOT_X = 210;
const PLOT_Y = 64;
const BAR_X = 945;
const BAR_Y = 64;
const BAR_W = 32;
const BAR_H = 700;
const DENSITY_W = 300;
const DENSITY_H = 300;

let simRunning = false;
let simAnimation = null;
let simFrame = 0;
let lightMask = null;
let wallMask = null;
let network = null;

function simEl(id) { return document.getElementById(id); }
function setStatus(message) { const el = simEl("sim-status"); if (el) el.textContent = message; }
function inField(x, y) { return x >= FIELD_X && x <= FIELD_X + FIELD_SIZE && y >= FIELD_Y && y <= FIELD_Y + FIELD_SIZE; }
function inProjector(x, y) { return x >= PROJECTOR_X && x <= PROJECTOR_X + PROJECTOR_SIZE && y >= PROJECTOR_Y && y <= PROJECTOR_Y + PROJECTOR_SIZE; }
function fieldToDensityX(x) { return (x - FIELD_X) / FIELD_SIZE * DENSITY_W - 0.5; }
function fieldToDensityY(y) { return (y - FIELD_Y) / FIELD_SIZE * DENSITY_H - 0.5; }
function densityToFieldX(x) { return FIELD_X + (x + 0.5) * FIELD_SIZE / DENSITY_W; }
function densityToFieldY(y) { return FIELD_Y + (y + 0.5) * FIELD_SIZE / DENSITY_H; }

function clearOutput(message = "Simulation output will appear here.") {
  const canvas = simEl("sim-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, SIM_W, SIM_H);
  ctx.fillStyle = "#53657a";
  ctx.font = "30px system-ui, sans-serif";
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
  for (let y = 0; y < SIM_H; y += 1) {
    for (let x = 0; x < SIM_W; x += 1) {
      const p = y * SIM_W + x;
      const i = p * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const isLight = b > 150 && g > 100 && r < 95 && inProjector(x, y);
      const isWall = r > 175 && g < 130 && b < 130 && inField(x, y);
      if (isLight) { lightMask[p] = 1; lightCount += 1; }
      if (isWall) { wallMask[p] = 1; wallCount += 1; }
    }
  }
  return { lightCount, wallCount };
}
function maskIndex(x, y) {
  const xx = Math.max(0, Math.min(SIM_W - 1, Math.floor(x)));
  const yy = Math.max(0, Math.min(SIM_H - 1, Math.floor(y)));
  return yy * SIM_W + xx;
}
function wallAt(x, y) { if (!inField(x, y)) return true; return wallMask && wallMask[maskIndex(x, y)] === 1; }
function lightAt(x, y) { if (!lightMask || !inProjector(x, y)) return 0; return lightMask[maskIndex(x, y)]; }
function nodeId(x, y, nx) { return y * nx + x; }
function sliderMassTarget() { return Number(simEl("sim-particles")?.value || 20000); }
function targetGridFromSlider() {
  const requested = Math.max(6000, sliderMassTarget());
  const nx = Math.max(90, Math.min(230, Math.round(Math.sqrt(requested))));
  const ny = nx;
  return { nx, ny };
}
function addSpring(springs, a, b, rawX, rawY, nodeMap, kind = 1) {
  const ia = nodeMap[a], ib = nodeMap[b];
  if (ia < 0 || ib < 0) return;
  const dx = rawX[b] - rawX[a], dy = rawY[b] - rawY[a];
  springs.push({ a: ia, b: ib, rest: Math.hypot(dx, dy) || 1, kind });
}
function depositDensity(density, x, y) {
  const gx = fieldToDensityX(x), gy = fieldToDensityY(y);
  const ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy;
  for (let dy = 0; dy <= 1; dy += 1) for (let dx = 0; dx <= 1; dx += 1) {
    const px = ix + dx, py = iy + dy;
    if (px >= 0 && px < DENSITY_W && py >= 0 && py < DENSITY_H) density[py * DENSITY_W + px] += (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy);
  }
}
function blurDensity(field, passes = 2) {
  const temp = new Float32Array(field.length);
  for (let pass = 0; pass < passes; pass += 1) {
    for (let y = 0; y < DENSITY_H; y += 1) for (let x = 0; x < DENSITY_W; x += 1) {
      let sum = 0, wsum = 0;
      for (let k = -3; k <= 3; k += 1) {
        const xx = x + k;
        if (xx < 0 || xx >= DENSITY_W) continue;
        const w = k === 0 ? 10 : (Math.abs(k) === 1 ? 7 : (Math.abs(k) === 2 ? 4 : 1));
        sum += field[y * DENSITY_W + xx] * w; wsum += w;
      }
      temp[y * DENSITY_W + x] = sum / wsum;
    }
    for (let y = 0; y < DENSITY_H; y += 1) for (let x = 0; x < DENSITY_W; x += 1) {
      let sum = 0, wsum = 0;
      for (let k = -3; k <= 3; k += 1) {
        const yy = y + k;
        if (yy < 0 || yy >= DENSITY_H) continue;
        const w = k === 0 ? 10 : (Math.abs(k) === 1 ? 7 : (Math.abs(k) === 2 ? 4 : 1));
        sum += temp[yy * DENSITY_W + x] * w; wsum += w;
      }
      field[y * DENSITY_W + x] = sum / wsum;
    }
  }
}

function buildMassSpringNetwork() {
  const { nx, ny } = targetGridFromSlider();
  const spacing = FIELD_SIZE / (nx - 1);
  const rawCount = nx * ny;
  const rawX = new Float32Array(rawCount), rawY = new Float32Array(rawCount), blocked = new Uint8Array(rawCount);
  for (let gy = 0; gy < ny; gy += 1) {
    for (let gx = 0; gx < nx; gx += 1) {
      const id = nodeId(gx, gy, nx);
      rawX[id] = FIELD_X + gx * spacing;
      rawY[id] = FIELD_Y + gy * spacing;
      blocked[id] = wallAt(rawX[id], rawY[id]) ? 1 : 0;
    }
  }
  const nodeMap = new Int32Array(rawCount);
  nodeMap.fill(-1);
  let alive = 0;
  for (let i = 0; i < rawCount; i += 1) if (!blocked[i]) nodeMap[i] = alive++;
  const x = new Float32Array(alive), y = new Float32Array(alive), x0 = new Float32Array(alive), y0 = new Float32Array(alive);
  const vx = new Float32Array(alive), vy = new Float32Array(alive), fx = new Float32Array(alive), fy = new Float32Array(alive);
  for (let i = 0; i < rawCount; i += 1) {
    const j = nodeMap[i];
    if (j >= 0) {
      const jitterX = (Math.random() - 0.5) * spacing * 0.08;
      const jitterY = (Math.random() - 0.5) * spacing * 0.08;
      x[j] = rawX[i] + jitterX;
      y[j] = rawY[i] + jitterY;
      x0[j] = x[j];
      y0[j] = y[j];
    }
  }
  const springs = [];
  for (let gy = 0; gy < ny; gy += 1) {
    for (let gx = 0; gx < nx; gx += 1) {
      const id = nodeId(gx, gy, nx);
      if (gx + 1 < nx) addSpring(springs, id, nodeId(gx + 1, gy, nx), rawX, rawY, nodeMap, 1);
      if (gy + 1 < ny) addSpring(springs, id, nodeId(gx, gy + 1, nx), rawX, rawY, nodeMap, 1);
      if (gx + 1 < nx && gy + 1 < ny) addSpring(springs, id, nodeId(gx + 1, gy + 1, nx), rawX, rawY, nodeMap, 0.72);
      if (gx > 0 && gy + 1 < ny) addSpring(springs, id, nodeId(gx - 1, gy + 1, nx), rawX, rawY, nodeMap, 0.72);
      if (gx + 2 < nx) addSpring(springs, id, nodeId(gx + 2, gy, nx), rawX, rawY, nodeMap, 0.38);
      if (gy + 2 < ny) addSpring(springs, id, nodeId(gx, gy + 2, nx), rawX, rawY, nodeMap, 0.38);
    }
  }
  const refDensity = new Float32Array(DENSITY_W * DENSITY_H);
  for (let i = 0; i < alive; i += 1) depositDensity(refDensity, x0[i], y0[i]);
  blurDensity(refDensity, 3);
  return { nx, ny, x, y, x0, y0, vx, vy, fx, fy, springs, alive, refDensity };
}
function stepMassSpring() {
  if (!network) return;
  const strength = Number(simEl("sim-strength")?.value || 75) / 100;
  const dt = 0.18, damping = 0.935, baseK = 0.020, anchorK = 0.0009, noise = 0.026;
  network.fx.fill(0); network.fy.fill(0);
  const tRamp = Math.min(1, simFrame / 90);
  for (const s of network.springs) {
    const ax = network.x[s.a], ay = network.y[s.a], bx = network.x[s.b], by = network.y[s.b];
    const dx = bx - ax, dy = by - ay, dist = Math.hypot(dx, dy) + 1e-6;
    const activated = lightAt(ax, ay) || lightAt(bx, by);
    const targetRest = activated ? s.rest * (1 - 0.985 * strength * tRamp) : s.rest;
    const k = activated ? baseK * s.kind * (8.5 + 13.0 * strength) : baseK * s.kind;
    const f = k * (dist - Math.max(0.02, targetRest));
    const ux = dx / dist, uy = dy / dist, fx = f * ux, fy = f * uy;
    network.fx[s.a] += fx; network.fy[s.a] += fy; network.fx[s.b] -= fx; network.fy[s.b] -= fy;
  }
  for (let i = 0; i < network.alive; i += 1) {
    network.fx[i] += (network.x0[i] - network.x[i]) * anchorK;
    network.fy[i] += (network.y0[i] - network.y[i]) * anchorK;
    network.vx[i] = (network.vx[i] + network.fx[i] * dt + (Math.random() - 0.5) * noise) * damping;
    network.vy[i] = (network.vy[i] + network.fy[i] * dt + (Math.random() - 0.5) * noise) * damping;
    let nx = network.x[i] + network.vx[i] * dt, ny = network.y[i] + network.vy[i] * dt;
    if (wallAt(nx, ny)) { network.vx[i] = 0; network.vy[i] = 0; nx = network.x[i]; ny = network.y[i]; }
    network.x[i] = Math.max(FIELD_X, Math.min(FIELD_X + FIELD_SIZE, nx));
    network.y[i] = Math.max(FIELD_Y, Math.min(FIELD_Y + FIELD_SIZE, ny));
  }
  simFrame += 1;
}

function bwrColor(value) {
  const v = Math.max(-1, Math.min(1, value));
  if (v >= 0) {
    const t = v;
    return [255, Math.round(255 * (1 - t)), Math.round(255 * (1 - t))];
  }
  const t = -v;
  return [Math.round(255 * (1 - t)), Math.round(255 * (1 - t)), 255];
}
function ratioToColor(ratio) { return bwrColor(Math.log2(Math.max(0.2, Math.min(10.0, ratio))) / Math.log2(10)); }
function drawColorbar(ctx) {
  const grad = ctx.createLinearGradient(0, BAR_Y + BAR_H, 0, BAR_Y);
  grad.addColorStop(0, "rgb(38,38,255)"); grad.addColorStop(0.5, "rgb(255,255,255)"); grad.addColorStop(1, "rgb(255,38,38)");
  ctx.fillStyle = grad; ctx.fillRect(BAR_X, BAR_Y, BAR_W, BAR_H);
  ctx.strokeStyle = "#333"; ctx.lineWidth = 1.2; ctx.strokeRect(BAR_X, BAR_Y, BAR_W, BAR_H);
  ctx.fillStyle = "#222"; ctx.font = "20px system-ui, sans-serif";
  const labels = [["10.00", 0.00], ["8.60", 0.143], ["7.20", 0.286], ["5.80", 0.429], ["4.40", 0.571], ["3.00", 0.714], ["1.60", 0.857], ["0.20", 1.00]];
  for (const [label, frac] of labels) {
    const y = BAR_Y + BAR_H * frac;
    ctx.beginPath(); ctx.moveTo(BAR_X + BAR_W, y); ctx.lineTo(BAR_X + BAR_W + 8, y); ctx.stroke();
    ctx.fillText(label, BAR_X + BAR_W + 15, y + 7);
  }
  ctx.save(); ctx.translate(BAR_X + 128, BAR_Y + BAR_H / 2); ctx.rotate(-Math.PI / 2); ctx.font = "24px system-ui, sans-serif"; ctx.fillText("MT concentration ratio", -118, 0); ctx.restore();
}
function drawMassSpringFrame() {
  const canvas = simEl("sim-canvas"), ctx = canvas.getContext("2d"), density = new Float32Array(DENSITY_W * DENSITY_H);
  for (let i = 0; i < network.alive; i += 1) depositDensity(density, network.x[i], network.y[i]);
  blurDensity(density, 3);
  const image = ctx.createImageData(DENSITY_W, DENSITY_H);
  for (let y = 0; y < DENSITY_H; y += 1) {
    for (let x = 0; x < DENSITY_W; x += 1) {
      const p = y * DENSITY_W + x, px = densityToFieldX(x), py = densityToFieldY(y);
      const baseline = Math.max(0.02, network.refDensity[p]);
      let [r, g, b] = ratioToColor(density[p] / baseline);
      if (wallAt(px, py)) { r = 54; g = 67; b = 72; }
      if (lightAt(px, py)) { r = Math.min(255, Math.round(r * 0.74 + 62)); g = Math.min(255, Math.round(g * 0.78 + 62)); b = Math.round(b * 0.74); }
      const o = p * 4; image.data[o] = r; image.data[o + 1] = g; image.data[o + 2] = b; image.data[o + 3] = 255;
    }
  }
  const heatCanvas = document.createElement("canvas");
  heatCanvas.width = DENSITY_W; heatCanvas.height = DENSITY_H; heatCanvas.getContext("2d").putImageData(image, 0, 0);
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, SIM_W, SIM_H);
  ctx.fillStyle = "#111"; ctx.font = "26px system-ui, sans-serif"; ctx.textAlign = "center";
  ctx.fillText(`Mass-Spring System with Density Heatmap: Frame ${simFrame.toLocaleString()}`, PLOT_X + PLOT_SIZE / 2, 38);
  ctx.textAlign = "start";
  ctx.imageSmoothingEnabled = true; ctx.drawImage(heatCanvas, PLOT_X, PLOT_Y, PLOT_SIZE, PLOT_SIZE);
  ctx.strokeStyle = "#333"; ctx.lineWidth = 1.2; ctx.strokeRect(PLOT_X, PLOT_Y, PLOT_SIZE, PLOT_SIZE);
  drawColorbar(ctx);
}
function loop() {
  if (!simRunning) return;
  const steps = Number(simEl("sim-speed")?.value || 4);
  for (let i = 0; i < steps; i += 1) stepMassSpring();
  drawMassSpringFrame();
  if (simFrame % 20 === 0) setStatus(`Running calibrated projector-scale simulation. Frame ${simFrame.toLocaleString()} with ${network.alive.toLocaleString()} masses and ${network.springs.length.toLocaleString()} springs.`);
  simAnimation = requestAnimationFrame(loop);
}
function runSim() {
  stopSim();
  const masks = readMasksFromInputCanvas();
  network = buildMassSpringNetwork();
  simFrame = 0;
  if (network.alive < 250 || network.springs.length < 250) { clearOutput("Mask leaves too little free gel to simulate. Clear or reduce red walls."); return; }
  const lightPct = (100 * masks.lightCount / (PROJECTOR_SIZE * PROJECTOR_SIZE)).toFixed(1), wallPct = (100 * masks.wallCount / (FIELD_SIZE * FIELD_SIZE)).toFixed(1);
  drawMassSpringFrame();
  setStatus(`Running calibrated projector-scale simulation. Projector light area: ${lightPct}%. Field wall area: ${wallPct}%. ${network.alive.toLocaleString()} masses, ${network.springs.length.toLocaleString()} springs.`);
  simRunning = true; simAnimation = requestAnimationFrame(loop);
}
function stopSim() { simRunning = false; if (simAnimation) cancelAnimationFrame(simAnimation); simAnimation = null; }
function pauseSim() { stopSim(); setStatus(`Paused at frame ${simFrame.toLocaleString()}.`); }
function resetSim() { stopSim(); network = null; simFrame = 0; clearOutput("Simulation reset. Click Run simulation to start."); }
function exportFrame() { const link = document.createElement("a"); link.href = simEl("sim-canvas").toDataURL("image/png"); link.download = "active-matter-simulation-frame.png"; link.click(); }
function bindSlider(id, labelId, suffix) { const slider = simEl(id), label = simEl(labelId); if (!slider || !label) return; slider.addEventListener("input", () => { label.textContent = `${Number(slider.value).toLocaleString()}${suffix}`; }); }
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
