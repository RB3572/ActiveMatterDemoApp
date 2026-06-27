const SIM_W = 1280;
const SIM_H = 800;
const SPACE_SIZE = 3000;
const HALF_SPACE = SPACE_SIZE / 2;
const FACTOR_X = 2.825;
const FACTOR_Y = 2.825;
const RESIZED_W = Math.round(SIM_W * FACTOR_X);
const RESIZED_H = Math.round(SIM_H * FACTOR_Y);
const PROJECTOR_SIZE = 2048;
const PROJECTOR_PAD = Math.floor((SPACE_SIZE - PROJECTOR_SIZE) / 2);
const CROP_ROW0 = Math.floor((RESIZED_H - PROJECTOR_SIZE) / 2);
const CROP_COL0 = Math.floor((RESIZED_W - PROJECTOR_SIZE) / 2);
const DENSITY_W = 600;
const DENSITY_H = 600;
const PLOT_SIZE = 700;
const PLOT_X = 210;
const PLOT_Y = 64;
const BAR_X = 945;
const BAR_Y = 64;
const BAR_W = 32;
const BAR_H = 700;

const DT = 0.03;
const DEFAULT_K = 1.0;
const ACTIVATED_K_MULTIPLIER = 25.0;
const ACTIVATED_REST_LENGTH = 0.3;
const DAMPING = 0.99;
const RESISTANCE = 10.0;
const NOISE = 0.1;
const MAX_LENGTH_MULTIPLIER = 2.5;

let simRunning = false;
let simAnimation = null;
let simFrame = 0;
let lightMask = null;
let wallMask = null;
let network = null;

function simEl(id) { return document.getElementById(id); }
function setStatus(message) { const el = simEl("sim-status"); if (el) el.textContent = message; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function maskOffset(row, col) { return row * SPACE_SIZE + col; }
function coordToMaskIndex(x, y) {
  const col = clamp(Math.floor(x + HALF_SPACE), 0, SPACE_SIZE - 1);
  const row = clamp(Math.floor(y + HALF_SPACE), 0, SPACE_SIZE - 1);
  return { row, col };
}
function maskIndexToCanvas(col, row) {
  const cropCol = col - PROJECTOR_PAD;
  const cropRow = row - PROJECTOR_PAD;
  if (cropCol < 0 || cropCol >= PROJECTOR_SIZE || cropRow < 0 || cropRow >= PROJECTOR_SIZE) return null;
  const resizedCol = CROP_COL0 + cropCol;
  const resizedRow = CROP_ROW0 + cropRow;
  const x = Math.floor(resizedCol / FACTOR_X);
  const y = Math.floor(resizedRow / FACTOR_Y);
  if (x < 0 || x >= SIM_W || y < 0 || y >= SIM_H) return null;
  return { x, y };
}
function gaussianNoise() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

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
  lightMask = new Uint8Array(SPACE_SIZE * SPACE_SIZE);
  wallMask = new Uint8Array(SPACE_SIZE * SPACE_SIZE);
  let lightCount = 0;
  let wallCount = 0;
  for (let row = PROJECTOR_PAD; row < PROJECTOR_PAD + PROJECTOR_SIZE; row += 1) {
    for (let col = PROJECTOR_PAD; col < PROJECTOR_PAD + PROJECTOR_SIZE; col += 1) {
      const pt = maskIndexToCanvas(col, row);
      if (!pt) continue;
      const i = (pt.y * SIM_W + pt.x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const p = maskOffset(row, col);
      const isLight = b > 150 && g > 100 && r < 95;
      const isWall = r > 175 && g < 130 && b < 130;
      if (isLight) { lightMask[p] = 1; lightCount += 1; }
      if (isWall) { wallMask[p] = 1; wallCount += 1; }
    }
  }
  return { lightCount, wallCount };
}

function maskValue(mask, row, col) {
  if (!mask || row < 0 || row >= SPACE_SIZE || col < 0 || col >= SPACE_SIZE) return 0;
  return mask[maskOffset(row, col)];
}
function lightAtMask(row, col) { return maskValue(lightMask, row, col); }
function wallAtMask(row, col) { return maskValue(wallMask, row, col); }
function lightNearMask(row, col, radius = 4) {
  const rr = Math.round(row);
  const cc = Math.round(col);
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      if (dx * dx + dy * dy <= radius * radius && lightAtMask(rr + dy, cc + dx)) return true;
    }
  }
  return false;
}
function noSlipAtCoord(x, y) {
  const { row, col } = coordToMaskIndex(x, y);
  for (let dy = -3; dy <= 3; dy += 1) {
    for (let dx = -3; dx <= 3; dx += 1) {
      if (wallAtMask(row + dy, col + dx)) return true;
    }
  }
  return false;
}
function nodeId(x, y, nx) { return y * nx + x; }
function sliderMassTarget() { return Number(simEl("sim-particles")?.value || 90000); }
function targetGridFromSlider() {
  const requested = Math.max(10000, sliderMassTarget());
  const n = Math.max(100, Math.min(420, Math.round(Math.sqrt(requested))));
  return { nx: n, ny: n };
}

function addSpring(springA, springB, restLengths, springKs, a, b, rawX, rawY, nodeMap) {
  const ia = nodeMap[a], ib = nodeMap[b];
  if (ia < 0 || ib < 0) return;
  const dx = rawX[b] - rawX[a];
  const dy = rawY[b] - rawY[a];
  springA.push(ia);
  springB.push(ib);
  restLengths.push(Math.hypot(dx, dy) || 1);
  springKs.push(DEFAULT_K);
}

function buildMassSpringNetwork() {
  const { nx, ny } = targetGridFromSlider();
  const spacing = SPACE_SIZE / (nx - 1);
  const rawCount = nx * ny;
  const rawX = new Float32Array(rawCount);
  const rawY = new Float32Array(rawCount);
  const nodeMap = new Int32Array(rawCount);
  nodeMap.fill(-1);
  let alive = 0;
  for (let gy = 0; gy < ny; gy += 1) {
    for (let gx = 0; gx < nx; gx += 1) {
      const id = nodeId(gx, gy, nx);
      rawX[id] = -HALF_SPACE + gx * spacing;
      rawY[id] = -HALF_SPACE + gy * spacing;
      if (!noSlipAtCoord(rawX[id], rawY[id])) {
        nodeMap[id] = alive;
        alive += 1;
      }
    }
  }
  const x = new Float32Array(alive);
  const y = new Float32Array(alive);
  const vx = new Float32Array(alive);
  const vy = new Float32Array(alive);
  const ax = new Float32Array(alive);
  const ay = new Float32Array(alive);
  for (let i = 0; i < rawCount; i += 1) {
    const j = nodeMap[i];
    if (j >= 0) {
      x[j] = rawX[i] + gaussianNoise() * spacing * 0.015;
      y[j] = rawY[i] + gaussianNoise() * spacing * 0.015;
    }
  }
  const springA = [];
  const springB = [];
  const restLengths = [];
  const springKs = [];
  for (let gy = 0; gy < ny; gy += 1) {
    for (let gx = 0; gx < nx; gx += 1) {
      const id = nodeId(gx, gy, nx);
      if (gx + 1 < nx) addSpring(springA, springB, restLengths, springKs, id, nodeId(gx + 1, gy, nx), rawX, rawY, nodeMap);
      if (gy + 1 < ny) addSpring(springA, springB, restLengths, springKs, id, nodeId(gx, gy + 1, nx), rawX, rawY, nodeMap);
      if (gx + 1 < nx && gy + 1 < ny) addSpring(springA, springB, restLengths, springKs, id, nodeId(gx + 1, gy + 1, nx), rawX, rawY, nodeMap);
      if (gx > 0 && gy + 1 < ny) addSpring(springA, springB, restLengths, springKs, id, nodeId(gx - 1, gy + 1, nx), rawX, rawY, nodeMap);
    }
  }
  return {
    nx, ny, spacing, alive,
    x, y, vx, vy, ax, ay,
    springA: Int32Array.from(springA),
    springB: Int32Array.from(springB),
    restLengths: Float32Array.from(restLengths),
    springKs: Float32Array.from(springKs),
    springCount: springA.length,
    maxLength: spacing * Math.SQRT2 * MAX_LENGTH_MULTIPLIER,
    activatedK: DEFAULT_K * ACTIVATED_K_MULTIPLIER
  };
}

function springSegmentHitsLight(aRow, aCol, bRow, bCol) {
  const samples = 7;
  for (let i = 0; i <= samples; i += 1) {
    const t = i / samples;
    const row = aRow + (bRow - aRow) * t;
    const col = aCol + (bCol - aCol) * t;
    if (lightNearMask(row, col, 4)) return true;
  }
  return false;
}

function activateSpringsFromMaskOriginal(step) {
  const n = network.alive;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i += 1) {
    const xi = network.x[i], yi = network.y[i];
    if (xi < minX) minX = xi;
    if (xi > maxX) maxX = xi;
    if (yi < minY) minY = yi;
    if (yi > maxY) maxY = yi;
  }
  const spanX = Math.max(1e-6, maxX - minX);
  const spanY = Math.max(1e-6, maxY - minY);
  const strength = Number(simEl("sim-strength")?.value || 100) / 100;
  const activatedK = DEFAULT_K + (network.activatedK - DEFAULT_K) * strength;
  const activatedRest = ACTIVATED_REST_LENGTH + (1 - strength) * network.spacing;
  for (let s = 0; s < network.springCount; s += 1) {
    const a = network.springA[s];
    const b = network.springB[s];
    const aCol = clamp(Math.floor((network.x[a] - minX) / spanX * (SPACE_SIZE - 1)), 0, SPACE_SIZE - 1);
    const aRow = clamp(Math.floor((network.y[a] - minY) / spanY * (SPACE_SIZE - 1)), 0, SPACE_SIZE - 1);
    const bCol = clamp(Math.floor((network.x[b] - minX) / spanX * (SPACE_SIZE - 1)), 0, SPACE_SIZE - 1);
    const bRow = clamp(Math.floor((network.y[b] - minY) / spanY * (SPACE_SIZE - 1)), 0, SPACE_SIZE - 1);
    if (springSegmentHitsLight(aRow, aCol, bRow, bCol)) {
      network.springKs[s] = activatedK;
      network.restLengths[s] = activatedRest;
    }
  }
}

function updateMassDynamicsOriginal() {
  const n = network.alive;
  network.ax.fill(0);
  network.ay.fill(0);
  let write = 0;
  for (let s = 0; s < network.springCount; s += 1) {
    const a = network.springA[s];
    const b = network.springB[s];
    const dx = network.x[b] - network.x[a];
    const dy = network.y[b] - network.y[a];
    const dist = Math.hypot(dx, dy);
    if (dist > network.maxLength) continue;
    if (write !== s) {
      network.springA[write] = a;
      network.springB[write] = b;
      network.springKs[write] = network.springKs[s];
      network.restLengths[write] = network.restLengths[s];
    }
    write += 1;
    const inv = 1 / (dist + 1e-8);
    const forceMag = network.springKs[s] * (dist - network.restLengths[s]);
    const fx = dx * inv * forceMag;
    const fy = dy * inv * forceMag;
    network.ax[a] += fx;
    network.ay[a] += fy;
    network.ax[b] -= fx;
    network.ay[b] -= fy;
  }
  network.springCount = write;
  for (let i = 0; i < n; i += 1) {
    network.ax[i] += -RESISTANCE * network.vx[i];
    network.ay[i] += -RESISTANCE * network.vy[i];
    if (!noSlipAtCoord(network.x[i], network.y[i])) {
      network.vx[i] *= DAMPING;
      network.vy[i] *= DAMPING;
      network.vx[i] += network.ax[i] * DT;
      network.vy[i] += network.ay[i] * DT;
      network.x[i] += network.vx[i] * DT;
      network.y[i] += network.vy[i] * DT;
    }
    network.x[i] = clamp(network.x[i] + gaussianNoise() * NOISE, -HALF_SPACE, HALF_SPACE);
    network.y[i] = clamp(network.y[i] + gaussianNoise() * NOISE, -HALF_SPACE, HALF_SPACE);
  }
}
function stepMassSpring() {
  if (!network) return;
  activateSpringsFromMaskOriginal(simFrame);
  updateMassDynamicsOriginal();
  simFrame += 1;
}

function depositDensity(density, x, y) {
  const gx = (x + HALF_SPACE) / SPACE_SIZE * DENSITY_W - 0.5;
  const gy = (y + HALF_SPACE) / SPACE_SIZE * DENSITY_H - 0.5;
  const ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy;
  for (let dy = 0; dy <= 1; dy += 1) {
    for (let dx = 0; dx <= 1; dx += 1) {
      const px = ix + dx, py = iy + dy;
      if (px >= 0 && px < DENSITY_W && py >= 0 && py < DENSITY_H) density[py * DENSITY_W + px] += (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy);
    }
  }
}
function blurDensity(field) {
  const temp = new Float32Array(field.length);
  for (let y = 0; y < DENSITY_H; y += 1) {
    for (let x = 0; x < DENSITY_W; x += 1) {
      let sum = 0, wsum = 0;
      for (let k = -1; k <= 1; k += 1) {
        const xx = x + k;
        if (xx < 0 || xx >= DENSITY_W) continue;
        const w = k === 0 ? 2 : 1;
        sum += field[y * DENSITY_W + xx] * w;
        wsum += w;
      }
      temp[y * DENSITY_W + x] = sum / wsum;
    }
  }
  for (let y = 0; y < DENSITY_H; y += 1) {
    for (let x = 0; x < DENSITY_W; x += 1) {
      let sum = 0, wsum = 0;
      for (let k = -1; k <= 1; k += 1) {
        const yy = y + k;
        if (yy < 0 || yy >= DENSITY_H) continue;
        const w = k === 0 ? 2 : 1;
        sum += temp[yy * DENSITY_W + x] * w;
        wsum += w;
      }
      field[y * DENSITY_W + x] = sum / wsum;
    }
  }
}
function bwrAt(t) {
  const v = clamp(t, 0, 1);
  if (v < 0.5) {
    const u = v / 0.5;
    return [Math.round(255 * u), Math.round(255 * u), 255];
  }
  const u = (v - 0.5) / 0.5;
  return [255, Math.round(255 * (1 - u)), Math.round(255 * (1 - u))];
}
function colorForRatio(ratio) {
  const lo = Math.log(0.2);
  const hi = Math.log(10.0);
  const value = Math.log(clamp(ratio, 0.2, 10.0));
  return bwrAt((value - lo) / (hi - lo));
}
function blend(base, overlay, alpha) {
  return [
    Math.round(base[0] * (1 - alpha) + overlay[0] * alpha),
    Math.round(base[1] * (1 - alpha) + overlay[1] * alpha),
    Math.round(base[2] * (1 - alpha) + overlay[2] * alpha)
  ];
}
function densityPixelToMask(row, col) {
  const maskCol = clamp(Math.floor(col / DENSITY_W * SPACE_SIZE), 0, SPACE_SIZE - 1);
  const maskRow = clamp(Math.floor(row / DENSITY_H * SPACE_SIZE), 0, SPACE_SIZE - 1);
  return { maskRow, maskCol };
}
function referenceDensity(density) {
  const corner = Math.max(8, Math.round(DENSITY_W * 0.05));
  let sum = 0, count = 0;
  for (let y = 0; y < corner; y += 1) for (let x = 0; x < corner; x += 1) { sum += density[y * DENSITY_W + x]; count += 1; }
  let ref = sum / Math.max(1, count);
  if (!Number.isFinite(ref) || ref <= 0) {
    let maxVal = 0;
    for (const v of density) if (v > maxVal) maxVal = v;
    ref = maxVal > 0 ? maxVal / 10 : 1e-5;
  }
  return ref;
}
function drawColorbar(ctx) {
  const grad = ctx.createLinearGradient(0, BAR_Y + BAR_H, 0, BAR_Y);
  grad.addColorStop(0, "rgb(0,0,255)");
  grad.addColorStop(0.411, "rgb(230,230,255)");
  grad.addColorStop(0.5, "rgb(255,255,255)");
  grad.addColorStop(1, "rgb(255,0,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(BAR_X, BAR_Y, BAR_W, BAR_H);
  ctx.strokeStyle = "#333";
  ctx.lineWidth = 1.2;
  ctx.strokeRect(BAR_X, BAR_Y, BAR_W, BAR_H);
  ctx.fillStyle = "#222";
  ctx.font = "20px system-ui, sans-serif";
  const labels = [["10.00", 10.0], ["8.60", 8.6], ["7.20", 7.2], ["5.80", 5.8], ["4.40", 4.4], ["3.00", 3.0], ["1.60", 1.6], ["0.20", 0.2]];
  const lo = Math.log(0.2), hi = Math.log(10.0);
  for (const [label, value] of labels) {
    const fracFromBottom = (Math.log(value) - lo) / (hi - lo);
    const y = BAR_Y + BAR_H * (1 - fracFromBottom);
    ctx.beginPath();
    ctx.moveTo(BAR_X + BAR_W, y);
    ctx.lineTo(BAR_X + BAR_W + 8, y);
    ctx.stroke();
    ctx.fillText(label, BAR_X + BAR_W + 15, y + 7);
  }
  ctx.save();
  ctx.translate(BAR_X + 128, BAR_Y + BAR_H / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.font = "24px system-ui, sans-serif";
  ctx.fillText("MT concentration ratio", -118, 0);
  ctx.restore();
}
function drawMassSpringFrame() {
  const canvas = simEl("sim-canvas");
  const ctx = canvas.getContext("2d");
  const density = new Float32Array(DENSITY_W * DENSITY_H);
  for (let i = 0; i < network.alive; i += 1) depositDensity(density, network.x[i], network.y[i]);
  blurDensity(density);
  const ref = referenceDensity(density);
  const image = ctx.createImageData(DENSITY_W, DENSITY_H);
  for (let y = 0; y < DENSITY_H; y += 1) {
    for (let x = 0; x < DENSITY_W; x += 1) {
      const p = y * DENSITY_W + x;
      let rgb = colorForRatio(density[p] / ref);
      const { maskRow, maskCol } = densityPixelToMask(y, x);
      if (lightAtMask(maskRow, maskCol)) rgb = blend(rgb, [115, 190, 80], 0.20);
      if (wallAtMask(maskRow, maskCol)) rgb = blend(rgb, [35, 45, 52], 0.50);
      const o = p * 4;
      image.data[o] = rgb[0];
      image.data[o + 1] = rgb[1];
      image.data[o + 2] = rgb[2];
      image.data[o + 3] = 255;
    }
  }
  const heatCanvas = document.createElement("canvas");
  heatCanvas.width = DENSITY_W;
  heatCanvas.height = DENSITY_H;
  heatCanvas.getContext("2d").putImageData(image, 0, 0);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, SIM_W, SIM_H);
  ctx.fillStyle = "#111";
  ctx.font = "26px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(`Mass-Spring System with Density Heatmap: Frame ${simFrame.toLocaleString()}`, PLOT_X + PLOT_SIZE / 2, 38);
  ctx.textAlign = "start";
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(heatCanvas, PLOT_X, PLOT_Y, PLOT_SIZE, PLOT_SIZE);
  ctx.strokeStyle = "#333";
  ctx.lineWidth = 1.2;
  ctx.strokeRect(PLOT_X, PLOT_Y, PLOT_SIZE, PLOT_SIZE);
  drawColorbar(ctx);
}
function loop() {
  if (!simRunning) return;
  const steps = Number(simEl("sim-speed")?.value || 1);
  for (let i = 0; i < steps; i += 1) stepMassSpring();
  drawMassSpringFrame();
  if (simFrame % 10 === 0) setStatus(`Running original-style simulation. Step ${simFrame.toLocaleString()} of 100. ${network.alive.toLocaleString()} masses, ${network.springCount.toLocaleString()} active springs.`);
  if (simFrame >= 100) {
    pauseSim();
    setStatus(`Completed original 100-step simulation. ${network.alive.toLocaleString()} masses, ${network.springCount.toLocaleString()} remaining springs.`);
    return;
  }
  simAnimation = requestAnimationFrame(loop);
}
function runSim() {
  stopSim();
  const masks = readMasksFromInputCanvas();
  network = buildMassSpringNetwork();
  simFrame = 0;
  if (network.alive < 250 || network.springCount < 250) {
    clearOutput("Mask leaves too little free gel to simulate. Clear or reduce red walls.");
    return;
  }
  drawMassSpringFrame();
  const lightPct = (100 * masks.lightCount / (PROJECTOR_SIZE * PROJECTOR_SIZE)).toFixed(1);
  const wallPct = (100 * masks.wallCount / (PROJECTOR_SIZE * PROJECTOR_SIZE)).toFixed(1);
  setStatus(`Running original algorithm port. Projector light area: ${lightPct}%. Projector wall area: ${wallPct}%. ${network.alive.toLocaleString()} masses, ${network.springCount.toLocaleString()} springs.`);
  simRunning = true;
  simAnimation = requestAnimationFrame(loop);
}
function stopSim() { simRunning = false; if (simAnimation) cancelAnimationFrame(simAnimation); simAnimation = null; }
function pauseSim() { stopSim(); setStatus(`Paused at step ${simFrame.toLocaleString()}.`); }
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
