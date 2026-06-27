// Exact original run/grid parameter override for the browser DIY simulator.
// Source files: DIYSim/DIYSimParm.txt and DIYSim/mass_spring_arrays_600x.txt.

const ORIGINAL_GRID_N = 600;
const ORIGINAL_THRESHOLD_DISTANCE = 12;
const ORIGINAL_SPRING_CONSTANT = 10;
const ORIGINAL_MASS_VALUE = 1;
const ORIGINAL_MIN_DISTANCE = 5;
const ORIGINAL_INITIAL_V = 5;
const ORIGINAL_NUM_STEPS = 100;
const ORIGINAL_DT = 0.03;
const ORIGINAL_ACTIVATED_REST_LENGTH = 0.3;
const ORIGINAL_BDRATE = 0.08545;
const ORIGINAL_CDRATE = -0.008405;
const ORIGINAL_ACTIVATED_SPRING_CONSTANT_MULTIPLIER = 25;
const ORIGINAL_MAX_LENGTH_MULTIPLIER = 2.5;
const ORIGINAL_DAMPING = 0.99;
const ORIGINAL_RESIS = 10;
const ORIGINAL_NOISE = 0.1;

function configureOriginalControls() {
  const particles = simEl("sim-particles");
  const particleLabel = simEl("sim-particles-value");
  if (particles) {
    particles.min = "360000";
    particles.max = "360000";
    particles.step = "1";
    particles.value = "360000";
    particles.disabled = true;
  }
  if (particleLabel) particleLabel.textContent = "360,000 masses";

  const strength = simEl("sim-strength");
  const strengthLabel = simEl("sim-strength-value");
  if (strength) {
    strength.value = "100";
    strength.disabled = true;
  }
  if (strengthLabel) strengthLabel.textContent = "100%";

  const speed = simEl("sim-speed");
  const speedLabel = simEl("sim-speed-value");
  if (speed) speed.value = "1";
  if (speedLabel) speedLabel.textContent = "1 steps/frame";
}

sliderMassTarget = function originalSliderMassTarget() {
  return ORIGINAL_GRID_N * ORIGINAL_GRID_N;
};

targetGridFromSlider = function originalTargetGridFromSlider() {
  return { nx: ORIGINAL_GRID_N, ny: ORIGINAL_GRID_N };
};

addSpring = function originalAddSpring(springA, springB, restLengths, springKs, a, b, rawX, rawY, nodeMap) {
  const ia = nodeMap[a], ib = nodeMap[b];
  if (ia < 0 || ib < 0) return;
  const dx = rawX[b] - rawX[a];
  const dy = rawY[b] - rawY[a];
  springA.push(ia);
  springB.push(ib);
  restLengths.push(Math.hypot(dx, dy) || 1);
  springKs.push(ORIGINAL_SPRING_CONSTANT);
};

buildMassSpringNetwork = function originalBuildMassSpringNetwork() {
  const nx = ORIGINAL_GRID_N;
  const ny = ORIGINAL_GRID_N;
  const spacing = ORIGINAL_MIN_DISTANCE;
  const rawCount = nx * ny;
  const rawX = new Float32Array(rawCount);
  const rawY = new Float32Array(rawCount);
  const nodeMap = new Int32Array(rawCount);
  nodeMap.fill(-1);

  let alive = 0;
  const origin = -((nx - 1) * spacing) / 2;
  for (let gy = 0; gy < ny; gy += 1) {
    for (let gx = 0; gx < nx; gx += 1) {
      const id = nodeId(gx, gy, nx);
      rawX[id] = origin + gx * spacing;
      rawY[id] = origin + gy * spacing;
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
  const masses = new Float32Array(alive);

  for (let i = 0; i < rawCount; i += 1) {
    const j = nodeMap[i];
    if (j >= 0) {
      x[j] = rawX[i];
      y[j] = rawY[i];
      vx[j] = 0;
      vy[j] = 0;
      masses[j] = ORIGINAL_MASS_VALUE;
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
    x, y, vx, vy, ax, ay, masses,
    springA: Int32Array.from(springA),
    springB: Int32Array.from(springB),
    restLengths: Float32Array.from(restLengths),
    springKs: Float32Array.from(springKs),
    springCount: springA.length,
    maxLength: ORIGINAL_THRESHOLD_DISTANCE * ORIGINAL_MAX_LENGTH_MULTIPLIER,
    activatedK: ORIGINAL_SPRING_CONSTANT * ORIGINAL_ACTIVATED_SPRING_CONSTANT_MULTIPLIER
  };
};

activateSpringsFromMaskOriginal = function originalActivateSpringsFromMask(step) {
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

  for (let s = 0; s < network.springCount; s += 1) {
    const a = network.springA[s];
    const b = network.springB[s];
    const aCol = clamp(Math.floor((network.x[a] - minX) / spanX * (SPACE_SIZE - 1)), 0, SPACE_SIZE - 1);
    const aRow = clamp(Math.floor((network.y[a] - minY) / spanY * (SPACE_SIZE - 1)), 0, SPACE_SIZE - 1);
    const bCol = clamp(Math.floor((network.x[b] - minX) / spanX * (SPACE_SIZE - 1)), 0, SPACE_SIZE - 1);
    const bRow = clamp(Math.floor((network.y[b] - minY) / spanY * (SPACE_SIZE - 1)), 0, SPACE_SIZE - 1);
    if (lightAtMask(aRow, aCol) || lightAtMask(bRow, bCol)) {
      network.springKs[s] = network.activatedK;
      network.restLengths[s] = ORIGINAL_ACTIVATED_REST_LENGTH;
    }
  }
};

updateMassDynamicsOriginal = function originalUpdateMassDynamics() {
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
    network.ax[a] += fx / ORIGINAL_MASS_VALUE;
    network.ay[a] += fy / ORIGINAL_MASS_VALUE;
    network.ax[b] -= fx / ORIGINAL_MASS_VALUE;
    network.ay[b] -= fy / ORIGINAL_MASS_VALUE;
  }
  network.springCount = write;

  for (let i = 0; i < n; i += 1) {
    network.ax[i] += (-ORIGINAL_RESIS * network.vx[i]) / ORIGINAL_MASS_VALUE;
    network.ay[i] += (-ORIGINAL_RESIS * network.vy[i]) / ORIGINAL_MASS_VALUE;
    if (!noSlipAtCoord(network.x[i], network.y[i])) {
      network.vx[i] *= ORIGINAL_DAMPING;
      network.vy[i] *= ORIGINAL_DAMPING;
      network.vx[i] += network.ax[i] * ORIGINAL_DT;
      network.vy[i] += network.ay[i] * ORIGINAL_DT;
      network.x[i] += network.vx[i] * ORIGINAL_DT;
      network.y[i] += network.vy[i] * ORIGINAL_DT;
    }
    network.x[i] = clamp(network.x[i] + gaussianNoise() * ORIGINAL_NOISE, -HALF_SPACE, HALF_SPACE);
    network.y[i] = clamp(network.y[i] + gaussianNoise() * ORIGINAL_NOISE, -HALF_SPACE, HALF_SPACE);
  }
};

loop = function originalLoop() {
  if (!simRunning) return;
  const steps = Number(simEl("sim-speed")?.value || 1);
  for (let i = 0; i < steps; i += 1) stepMassSpring();
  drawMassSpringFrame();
  if (simFrame % 10 === 0) setStatus(`Running original parameters. Step ${simFrame.toLocaleString()} of ${ORIGINAL_NUM_STEPS}. ${network.alive.toLocaleString()} masses, ${network.springCount.toLocaleString()} springs.`);
  if (simFrame >= ORIGINAL_NUM_STEPS) {
    pauseSim();
    setStatus(`Completed original ${ORIGINAL_NUM_STEPS}-step simulation. ${network.alive.toLocaleString()} masses, ${network.springCount.toLocaleString()} remaining springs.`);
    return;
  }
  simAnimation = requestAnimationFrame(loop);
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", configureOriginalControls);
} else {
  configureOriginalControls();
}
