const SIM_W = 1280;
const SIM_H = 800;
let simRunning = false;
let simAnimation = null;
let simFrame = 0;
let particles = [];
let lightMask = null;
let wallMask = null;

function simEl(id) {
  return document.getElementById(id);
}

function setStatus(message) {
  const el = simEl("sim-status");
  if (el) el.textContent = message;
}

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
  const input = simEl("diy-canvas");
  const ctx = input.getContext("2d");
  const data = ctx.getImageData(0, 0, SIM_W, SIM_H).data;
  lightMask = new Uint8Array(SIM_W * SIM_H);
  wallMask = new Uint8Array(SIM_W * SIM_H);
  let lightCount = 0;
  let wallCount = 0;
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const isLight = b > 150 && g > 100 && r < 80;
    const isWall = r > 180 && g < 120 && b < 120;
    if (isLight) {
      lightMask[p] = 1;
      lightCount += 1;
    }
    if (isWall) {
      wallMask[p] = 1;
      wallCount += 1;
    }
  }
  return { lightCount, wallCount };
}

function idx(x, y) {
  const xx = Math.max(0, Math.min(SIM_W - 1, Math.floor(x)));
  const yy = Math.max(0, Math.min(SIM_H - 1, Math.floor(y)));
  return yy * SIM_W + xx;
}

function isWall(x, y) {
  if (x < 0 || x >= SIM_W || y < 0 || y >= SIM_H) return true;
  return wallMask && wallMask[idx(x, y)] === 1;
}

function lightAt(x, y) {
  if (!lightMask || x < 0 || x >= SIM_W || y < 0 || y >= SIM_H) return 0;
  return lightMask[idx(x, y)];
}

function freePoint() {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const x = Math.random() * SIM_W;
    const y = Math.random() * SIM_H;
    if (!isWall(x, y)) return { x, y };
  }
  return { x: SIM_W / 2, y: SIM_H / 2 };
}

function setupParticles() {
  const count = Number(simEl("sim-particles")?.value || 2500);
  particles = [];
  for (let i = 0; i < count; i += 1) {
    const p = freePoint();
    particles.push({ x: p.x, y: p.y, vx: 0, vy: 0 });
  }
}

function drawFrame() {
  const canvas = simEl("sim-canvas");
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "rgba(2, 8, 23, 0.32)";
  ctx.fillRect(0, 0, SIM_W, SIM_H);
  ctx.save();
  ctx.globalAlpha = 0.14;
  ctx.drawImage(simEl("diy-canvas"), 0, 0);
  ctx.restore();
  ctx.fillStyle = "rgba(219, 234, 254, 0.9)";
  for (const p of particles) ctx.fillRect(p.x, p.y, 2, 2);
}

function stepSimulation() {
  const strength = Number(simEl("sim-strength")?.value || 65) / 100;
  for (const p of particles) {
    const inLight = lightAt(p.x, p.y);
    const gx = lightAt(p.x + 9, p.y) - lightAt(p.x - 9, p.y);
    const gy = lightAt(p.x, p.y + 9) - lightAt(p.x, p.y - 9);
    const active = inLight ? 1 : 0.15;
    p.vx = p.vx * 0.91 + strength * active * (0.72 + 0.35 * gx) + (Math.random() - 0.5) * 1.2;
    p.vy = p.vy * 0.91 + strength * active * (0.35 * gy) + (Math.random() - 0.5) * 1.2;
    let nx = p.x + p.vx;
    let ny = p.y + p.vy;
    if (isWall(nx, ny)) {
      p.vx *= -0.45;
      p.vy *= -0.45;
      nx = p.x + p.vx + (Math.random() - 0.5) * 4;
      ny = p.y + p.vy + (Math.random() - 0.5) * 4;
    }
    if (nx < 0 || nx >= SIM_W) {
      p.vx *= -0.7;
      nx = Math.max(1, Math.min(SIM_W - 2, nx));
    }
    if (ny < 0 || ny >= SIM_H) {
      p.vy *= -0.7;
      ny = Math.max(1, Math.min(SIM_H - 2, ny));
    }
    if (!isWall(nx, ny)) {
      p.x = nx;
      p.y = ny;
    }
  }
  simFrame += 1;
}

function loop() {
  if (!simRunning) return;
  const steps = Number(simEl("sim-speed")?.value || 4);
  for (let i = 0; i < steps; i += 1) stepSimulation();
  drawFrame();
  if (simFrame % 20 === 0) {
    setStatus(`Running. Frame ${simFrame.toLocaleString()} with ${particles.length.toLocaleString()} particles.`);
  }
  simAnimation = requestAnimationFrame(loop);
}

function runSim() {
  stopSim();
  const masks = readMasksFromInputCanvas();
  setupParticles();
  simFrame = 0;
  simRunning = true;
  drawFrame();
  const lightPct = (100 * masks.lightCount / (SIM_W * SIM_H)).toFixed(1);
  const wallPct = (100 * masks.wallCount / (SIM_W * SIM_H)).toFixed(1);
  setStatus(`Running browser simulation. Light area: ${lightPct}%. Wall area: ${wallPct}%.`);
  simAnimation = requestAnimationFrame(loop);
}

function stopSim() {
  simRunning = false;
  if (simAnimation) cancelAnimationFrame(simAnimation);
  simAnimation = null;
}

function pauseSim() {
  stopSim();
  setStatus(`Paused at frame ${simFrame.toLocaleString()}.`);
}

function resetSim() {
  stopSim();
  particles = [];
  simFrame = 0;
  clearOutput("Simulation reset. Click Run simulation to start.");
}

function exportFrame() {
  const link = document.createElement("a");
  link.href = simEl("sim-canvas").toDataURL("image/png");
  link.download = "active-matter-simulation-frame.png";
  link.click();
}

function bindSlider(id, labelId, suffix) {
  const slider = simEl(id);
  const label = simEl(labelId);
  if (!slider || !label) return;
  slider.addEventListener("input", () => {
    label.textContent = `${slider.value}${suffix}`;
  });
}

function installSimulationControls() {
  simEl("sim-run")?.addEventListener("click", runSim);
  simEl("sim-pause")?.addEventListener("click", pauseSim);
  simEl("sim-reset")?.addEventListener("click", resetSim);
  simEl("sim-export-frame")?.addEventListener("click", exportFrame);
  bindSlider("sim-particles", "sim-particles-value", " particles");
  bindSlider("sim-strength", "sim-strength-value", "%");
  bindSlider("sim-speed", "sim-speed-value", " steps/frame");
  clearOutput();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", installSimulationControls);
} else {
  installSimulationControls();
}
