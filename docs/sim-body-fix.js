// Runtime refinement for filled activation regions.
// The base browser port shortens springs inside the mask. For large uniformly activated areas,
// pairwise spring shortening can mostly show density changes at the boundary. This adds the
// missing body-scale contraction so active masses move inward through the filled activation area.

let activeBodyCenter = null;

function computeActiveBodyCenter() {
  if (!lightMask) {
    activeBodyCenter = null;
    return;
  }
  let sx = 0;
  let sy = 0;
  let count = 0;
  const step = 3;
  for (let row = 0; row < SPACE_SIZE; row += step) {
    const base = row * SPACE_SIZE;
    for (let col = 0; col < SPACE_SIZE; col += step) {
      if (lightMask[base + col]) {
        sx += col - HALF_SPACE;
        sy += row - HALF_SPACE;
        count += 1;
      }
    }
  }
  activeBodyCenter = count ? { x: sx / count, y: sy / count } : null;
}

const baseReadMasksFromInputCanvas = readMasksFromInputCanvas;
readMasksFromInputCanvas = function patchedReadMasksFromInputCanvas() {
  const result = baseReadMasksFromInputCanvas();
  computeActiveBodyCenter();
  return result;
};

const baseUpdateMassDynamicsOriginal = updateMassDynamicsOriginal;
updateMassDynamicsOriginal = function patchedUpdateMassDynamicsOriginal() {
  baseUpdateMassDynamicsOriginal();
  if (!network || !activeBodyCenter) return;

  const strength = Number(simEl("sim-strength")?.value || 100) / 100;
  const rate = 0.010 * strength;
  const activeRadius = Math.max(8, Math.round(network.spacing * 1.25));

  for (let i = 0; i < network.alive; i += 1) {
    const { row, col } = coordToMaskIndex(network.x[i], network.y[i]);
    if (!lightNearMask(row, col, activeRadius) || noSlipAtCoord(network.x[i], network.y[i])) continue;

    const dx = activeBodyCenter.x - network.x[i];
    const dy = activeBodyCenter.y - network.y[i];
    network.x[i] = clamp(network.x[i] + dx * rate, -HALF_SPACE, HALF_SPACE);
    network.y[i] = clamp(network.y[i] + dy * rate, -HALF_SPACE, HALF_SPACE);
    network.vx[i] += dx * rate * 0.35;
    network.vy[i] += dy * rate * 0.35;
  }
};
