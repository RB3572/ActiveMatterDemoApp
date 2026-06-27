const DIY_EDITOR_W = 1280;
const DIY_EDITOR_H = 800;
const DIY_PROJECTION = { x: 274.5, y: 34.5, size: 731, microns: 2250 };
const DIY_MICRONS_PER_PX = DIY_PROJECTION.microns / DIY_PROJECTION.size;
const diyEditor = {
  ready: false,
  light: null,
  mask: null,
  operations: [],
  redoStack: [],
  activePoints: [],
  dragStart: null,
  dragging: false,
  cursor: null,
  tangentSnap: null,
};
function de(id) { return document.getElementById(id); }
function deCanvas() { const c = document.createElement("canvas"); c.width = DIY_EDITOR_W; c.height = DIY_EDITOR_H; return c; }
function deColor(layer = de("diy-mode")?.value) { return layer === "mask" ? "#FF3B30" : "#13AEEC"; }
function deLayer() { return de("diy-mode")?.value || "light"; }
function deTool() { return de("diy-tool")?.value || "line"; }
function deWidth() { return Number(de("diy-brush")?.value || 16); }
function deGridMicrons() { return Math.max(25, Math.min(750, Number(de("diy-grid-spacing")?.value || 150))); }
function deGridPx() { return deGridMicrons() / DIY_MICRONS_PER_PX; }
function deGridOn() { return Boolean(de("diy-grid-enabled")?.checked); }
function deSnapOn() { return deGridOn() && Boolean(de("diy-snap-grid")?.checked); }
function deAngleLockOn() { return Boolean(de("diy-angle-lock")?.checked); }
function deClone(p) { return { x: p.x, y: p.y }; }
function deClampProjection(p) { return { x: Math.max(DIY_PROJECTION.x, Math.min(DIY_PROJECTION.x + DIY_PROJECTION.size, p.x)), y: Math.max(DIY_PROJECTION.y, Math.min(DIY_PROJECTION.y + DIY_PROJECTION.size, p.y)) }; }
function dePointer(event) { const canvas = de("diy-canvas"); const rect = canvas.getBoundingClientRect(); return { x: (event.clientX - rect.left) * (DIY_EDITOR_W / rect.width), y: (event.clientY - rect.top) * (DIY_EDITOR_H / rect.height) }; }
function deSnap(raw) {
  let p = deClampProjection(raw);
  if (deSnapOn()) {
    const spacing = deGridPx();
    p = deClampProjection({ x: DIY_PROJECTION.x + Math.round((p.x - DIY_PROJECTION.x) / spacing) * spacing, y: DIY_PROJECTION.y + Math.round((p.y - DIY_PROJECTION.y) / spacing) * spacing });
  }
  if (deAngleLockOn() && diyEditor.activePoints.length) {
    const anchor = diyEditor.activePoints[diyEditor.activePoints.length - 1];
    const dx = p.x - anchor.x;
    const dy = p.y - anchor.y;
    const length = Math.hypot(dx, dy);
    if (length > 0.1) {
      const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
      p = deClampProjection({ x: anchor.x + Math.cos(angle) * length, y: anchor.y + Math.sin(angle) * length });
    }
  }
  return p;
}
function deSetStatus(message) { const el = de("diy-drawing-status"); if (el) el.textContent = message; }
function deInstructions() {
  const tool = deTool();
  if (tool === "line") return "Line path: click points. Press Done or Escape to finish.";
  if (tool === "arc") return "3-point arc: click start, end, then midpoint. Tangent marker appears near existing lines.";
  if (tool === "polygon") return "Filled polygon: click vertices. Press Done or Escape to close and fill.";
  if (tool === "rect") return "Filled rectangle: drag from one corner to the opposite corner.";
  if (tool === "ellipse") return "Filled ellipse: drag the bounding box.";
  return "Build a mask, then run the simulation.";
}
function deUpdateGridLabel() { const label = de("diy-grid-spacing-value"); if (label) label.textContent = `${deGridMicrons().toLocaleString()} µm grid, ${deGridPx().toFixed(1)} px spacing`; }
function deGuide(ctx) {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, DIY_EDITOR_W, DIY_EDITOR_H);
  ctx.fillStyle = "rgba(128,128,128,0.25)";
  ctx.fillRect(DIY_PROJECTION.x, DIY_PROJECTION.y, DIY_PROJECTION.size, DIY_PROJECTION.size);
  if (deGridOn()) deGrid(ctx);
  ctx.strokeStyle = "#9ca3af";
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 6]);
  ctx.strokeRect(DIY_PROJECTION.x, DIY_PROJECTION.y, DIY_PROJECTION.size, DIY_PROJECTION.size);
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(255,255,255,0.72)";
  ctx.font = "15px system-ui, sans-serif";
  ctx.fillText("2,250 µm", DIY_PROJECTION.x + 10, DIY_PROJECTION.y + DIY_PROJECTION.size - 12);
}
function deGrid(ctx) {
  const spacing = deGridPx();
  ctx.save();
  ctx.beginPath();
  ctx.rect(DIY_PROJECTION.x, DIY_PROJECTION.y, DIY_PROJECTION.size, DIY_PROJECTION.size);
  ctx.clip();
  for (let i = 0, x = DIY_PROJECTION.x; x <= DIY_PROJECTION.x + DIY_PROJECTION.size + 0.1; i += 1, x += spacing) {
    ctx.beginPath();
    ctx.strokeStyle = i % 5 === 0 ? "rgba(255,255,255,0.30)" : "rgba(255,255,255,0.12)";
    ctx.lineWidth = i % 5 === 0 ? 1.2 : 0.7;
    ctx.moveTo(x, DIY_PROJECTION.y);
    ctx.lineTo(x, DIY_PROJECTION.y + DIY_PROJECTION.size);
    ctx.stroke();
  }
  for (let i = 0, y = DIY_PROJECTION.y; y <= DIY_PROJECTION.y + DIY_PROJECTION.size + 0.1; i += 1, y += spacing) {
    ctx.beginPath();
    ctx.strokeStyle = i % 5 === 0 ? "rgba(255,255,255,0.30)" : "rgba(255,255,255,0.12)";
    ctx.lineWidth = i % 5 === 0 ? 1.2 : 0.7;
    ctx.moveTo(DIY_PROJECTION.x, y);
    ctx.lineTo(DIY_PROJECTION.x + DIY_PROJECTION.size, y);
    ctx.stroke();
  }
  ctx.restore();
}
function deDrawOp(ctx, op, preview = false) {
  ctx.save();
  ctx.globalAlpha = preview ? 0.72 : 1;
  ctx.strokeStyle = op.color;
  ctx.fillStyle = op.color;
  ctx.lineWidth = op.width || 16;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (op.type === "polyline") dePolyline(ctx, op.points);
  if (op.type === "polygon") dePolygon(ctx, op.points);
  if (op.type === "rect") deRect(ctx, op);
  if (op.type === "ellipse") deEllipse(ctx, op);
  if (op.type === "arc") deArc(ctx, op.points);
  ctx.restore();
}
function dePolyline(ctx, points) { if (points.length < 2) return; ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y); for (const p of points.slice(1)) ctx.lineTo(p.x, p.y); ctx.stroke(); }
function dePolygon(ctx, points) { if (points.length < 3) { dePolyline(ctx, points); return; } ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y); for (const p of points.slice(1)) ctx.lineTo(p.x, p.y); ctx.closePath(); ctx.fill(); }
function deRect(ctx, op) { const x = Math.min(op.start.x, op.end.x); const y = Math.min(op.start.y, op.end.y); const w = Math.abs(op.end.x - op.start.x); const h = Math.abs(op.end.y - op.start.y); ctx.fillRect(x, y, w, h); }
function deEllipse(ctx, op) { const cx = (op.start.x + op.end.x) / 2; const cy = (op.start.y + op.end.y) / 2; const rx = Math.abs(op.end.x - op.start.x) / 2; const ry = Math.abs(op.end.y - op.start.y) / 2; ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.fill(); }
function deCircle3(a, b, c) { const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y)); if (Math.abs(d) < 1e-6) return null; const aa = a.x * a.x + a.y * a.y; const bb = b.x * b.x + b.y * b.y; const cc = c.x * c.x + c.y * c.y; const x = (aa * (b.y - c.y) + bb * (c.y - a.y) + cc * (a.y - b.y)) / d; const y = (aa * (c.x - b.x) + bb * (a.x - c.x) + cc * (b.x - a.x)) / d; return { x, y, r: Math.hypot(a.x - x, a.y - y) }; }
function deNormAngle(a) { while (a < 0) a += Math.PI * 2; while (a >= Math.PI * 2) a -= Math.PI * 2; return a; }
function deBetween(start, end, mid, ccw) { start = deNormAngle(start); end = deNormAngle(end); mid = deNormAngle(mid); if (ccw) { if (end < start) end += Math.PI * 2; if (mid < start) mid += Math.PI * 2; return mid >= start && mid <= end; } if (start < end) start += Math.PI * 2; if (mid > start) mid -= Math.PI * 2; return mid <= start && mid >= end; }
function deArc(ctx, points) {
  if (points.length < 2) return;
  if (points.length < 3) { dePolyline(ctx, points); return; }
  const [a, b, c] = points;
  const circle = deCircle3(a, b, c);
  if (!circle) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(c.x, c.y, b.x, b.y); ctx.stroke(); return; }
  const start = Math.atan2(a.y - circle.y, a.x - circle.x);
  const end = Math.atan2(b.y - circle.y, b.x - circle.x);
  const mid = Math.atan2(c.y - circle.y, c.x - circle.x);
  const ccw = deBetween(start, end, mid, true);
  ctx.beginPath();
  ctx.arc(circle.x, circle.y, circle.r, start, end, !ccw);
  ctx.stroke();
}
function deRenderLayers() {
  for (const layer of [diyEditor.light, diyEditor.mask]) layer.getContext("2d").clearRect(0, 0, DIY_EDITOR_W, DIY_EDITOR_H);
  for (const op of diyEditor.operations) deDrawOp((op.layer === "mask" ? diyEditor.mask : diyEditor.light).getContext("2d"), op);
}
function deMarker(ctx, p, color) { ctx.save(); ctx.fillStyle = color; ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.restore(); }
function deSnapCursor(ctx, p) { ctx.save(); ctx.shadowColor = "rgba(29,110,234,0.85)"; ctx.shadowBlur = 16; ctx.strokeStyle = "rgba(255,255,255,0.95)"; ctx.fillStyle = "rgba(29,110,234,0.22)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, 10, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.moveTo(p.x - 16, p.y); ctx.lineTo(p.x + 16, p.y); ctx.moveTo(p.x, p.y - 16); ctx.lineTo(p.x, p.y + 16); ctx.stroke(); ctx.restore(); }
function deTangentIndicator(ctx, snap) { ctx.save(); ctx.strokeStyle = "#facc15"; ctx.fillStyle = "rgba(250,204,21,0.18)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(snap.point.x, snap.point.y, 20, snap.angle - 0.9, snap.angle + 0.9); ctx.stroke(); ctx.beginPath(); ctx.arc(snap.point.x, snap.point.y, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.restore(); }
function dePreview(ctx) {
  const color = deColor();
  const width = deWidth();
  if (diyEditor.activePoints.length) {
    const points = diyEditor.cursor ? [...diyEditor.activePoints, diyEditor.cursor] : diyEditor.activePoints;
    const type = deTool() === "polygon" ? "polygon" : deTool() === "arc" ? "arc" : "polyline";
    deDrawOp(ctx, { type, points, color, width }, true);
    for (const p of diyEditor.activePoints) deMarker(ctx, p, color);
    if (diyEditor.tangentSnap) deTangentIndicator(ctx, diyEditor.tangentSnap);
  }
  if (diyEditor.dragging && diyEditor.dragStart && diyEditor.cursor && ["rect", "ellipse"].includes(deTool())) deDrawOp(ctx, { type: deTool(), start: diyEditor.dragStart, end: diyEditor.cursor, color, width }, true);
  if (diyEditor.cursor && deSnapOn()) deSnapCursor(ctx, diyEditor.cursor);
}
function deRender() { deRenderLayers(); const ctx = de("diy-canvas").getContext("2d"); deGuide(ctx); ctx.drawImage(diyEditor.light, 0, 0); ctx.drawImage(diyEditor.mask, 0, 0); dePreview(ctx); deUndoState(); }
function deCommit(op) { diyEditor.operations.push(op); diyEditor.redoStack = []; deRender(); }
function deFinish(fill = false) { const tool = deTool(); if (tool === "arc") { deCancel(); return; } if (diyEditor.activePoints.length < 2) { deCancel(); return; } const filled = fill || tool === "polygon"; if (filled && diyEditor.activePoints.length < 3) return; const op = { layer: deLayer(), type: filled ? "polygon" : "polyline", points: diyEditor.activePoints.map(deClone), width: deWidth(), color: deColor() }; diyEditor.activePoints = []; deCommit(op); deSetStatus(deInstructions()); }
function deCancel() { diyEditor.activePoints = []; diyEditor.dragStart = null; diyEditor.dragging = false; diyEditor.tangentSnap = null; deRender(); deSetStatus(deInstructions()); }
function deUndo() { if (diyEditor.activePoints.length) { diyEditor.activePoints.pop(); deRender(); return; } const op = diyEditor.operations.pop(); if (op) diyEditor.redoStack.push(op); deRender(); }
function deRedo() { const op = diyEditor.redoStack.pop(); if (op) diyEditor.operations.push(op); deRender(); }
function deUndoState() { if (de("diy-undo")) de("diy-undo").disabled = !(diyEditor.operations.length || diyEditor.activePoints.length); if (de("diy-redo")) de("diy-redo").disabled = !diyEditor.redoStack.length; }
function deClear() { diyEditor.operations = []; diyEditor.redoStack = []; diyEditor.activePoints = []; diyEditor.dragStart = null; diyEditor.dragging = false; diyEditor.tangentSnap = null; deRender(); }
function deNearest(p, a, b) { const dx = b.x - a.x; const dy = b.y - a.y; const denom = dx * dx + dy * dy; if (denom < 1e-6) return { point: deClone(a), distance: Math.hypot(p.x - a.x, p.y - a.y), angle: 0 }; const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / denom)); const q = { x: a.x + dx * t, y: a.y + dy * t }; return { point: q, distance: Math.hypot(p.x - q.x, p.y - q.y), angle: Math.atan2(dy, dx) }; }
function deSegments(op) { const segs = []; if (["polyline", "polygon"].includes(op.type)) { for (let i = 0; i < op.points.length - 1; i += 1) segs.push([op.points[i], op.points[i + 1]]); if (op.type === "polygon" && op.points.length > 2) segs.push([op.points[op.points.length - 1], op.points[0]]); } if (op.type === "rect") { const a = op.start, b = op.end; const pts = [{ x: a.x, y: a.y }, { x: b.x, y: a.y }, { x: b.x, y: b.y }, { x: a.x, y: b.y }]; for (let i = 0; i < 4; i += 1) segs.push([pts[i], pts[(i + 1) % 4]]); } return segs; }
function deFindSnap(p) { let best = null; for (const op of diyEditor.operations) for (const seg of deSegments(op)) { const hit = deNearest(p, seg[0], seg[1]); if (hit.distance < 18 && (!best || hit.distance < best.distance)) best = hit; } return best; }
function deDown(event) { event.preventDefault(); let p = deSnap(dePointer(event)); const tool = deTool(); if (tool === "arc" && diyEditor.activePoints.length === 2) { const snap = deFindSnap(p); if (snap) p = snap.point; } if (["line", "polygon"].includes(tool)) { diyEditor.activePoints.push(p); deSetStatus(`${tool === "line" ? "Line path" : "Filled polygon"}: ${diyEditor.activePoints.length} point${diyEditor.activePoints.length === 1 ? "" : "s"}. Press Done or Escape to finish.`); deRender(); return; } if (tool === "arc") { diyEditor.activePoints.push(p); if (diyEditor.activePoints.length === 3) { deCommit({ layer: deLayer(), type: "arc", points: diyEditor.activePoints.map(deClone), width: deWidth(), color: deColor() }); diyEditor.activePoints = []; diyEditor.tangentSnap = null; deSetStatus(deInstructions()); } else { deSetStatus(diyEditor.activePoints.length === 1 ? "3-point arc: click the endpoint." : "3-point arc: choose midpoint. Tangent snap appears near existing lines."); deRender(); } return; } if (["rect", "ellipse"].includes(tool)) { diyEditor.dragStart = p; diyEditor.cursor = p; diyEditor.dragging = true; deRender(); } }
function deMove(event) { let p = deSnap(dePointer(event)); diyEditor.tangentSnap = null; if (deTool() === "arc" && diyEditor.activePoints.length === 2) { const snap = deFindSnap(p); if (snap) { p = snap.point; diyEditor.tangentSnap = snap; } } diyEditor.cursor = p; deRender(); }
function deUp(event) { if (!diyEditor.dragging || !diyEditor.dragStart) return; event.preventDefault(); const end = deSnap(dePointer(event)); const tool = deTool(); if (Math.hypot(end.x - diyEditor.dragStart.x, end.y - diyEditor.dragStart.y) > 3) deCommit({ layer: deLayer(), type: tool, start: deClone(diyEditor.dragStart), end: deClone(end), width: deWidth(), color: deColor() }); diyEditor.dragStart = null; diyEditor.dragging = false; deSetStatus(deInstructions()); deRender(); }
function deDownload(kind) { deFinish(deTool() === "polygon"); deRenderLayers(); const output = deCanvas(); const out = output.getContext("2d"); const source = kind === "light" ? diyEditor.light : diyEditor.mask; const data = source.getContext("2d").getImageData(0, 0, DIY_EDITOR_W, DIY_EDITOR_H); const result = out.createImageData(DIY_EDITOR_W, DIY_EDITOR_H); for (let i = 0; i < data.data.length; i += 4) { const value = kind === "light" ? (data.data[i + 3] > 0 ? 255 : 0) : (data.data[i + 3] > 0 ? 0 : 255); result.data[i] = value; result.data[i + 1] = value; result.data[i + 2] = value; result.data[i + 3] = 255; } out.putImageData(result, 0, 0); const link = document.createElement("a"); link.href = output.toDataURL("image/png"); link.download = kind === "light" ? "lightmask.png" : "gelmask.png"; link.click(); }
function deBind(id, event, fn, options) { const el = de(id); if (el) el.addEventListener(event, fn, options); }
function initProDiyCanvas() { if (!diyEditor.light) { diyEditor.light = deCanvas(); diyEditor.mask = deCanvas(); } if (diyEditor.ready) { deRender(); return; } const canvas = de("diy-canvas"); canvas.addEventListener("pointerdown", deDown); canvas.addEventListener("pointermove", deMove); canvas.addEventListener("pointerup", deUp); canvas.addEventListener("pointerleave", () => { diyEditor.cursor = null; diyEditor.tangentSnap = null; deRender(); }); deBind("diy-clear", "click", deClear); deBind("diy-undo", "click", deUndo); deBind("diy-redo", "click", deRedo); deBind("diy-done-path", "click", () => deFinish(deTool() === "polygon")); deBind("diy-cancel-path", "click", deCancel); deBind("diy-fill-path", "click", () => deFinish(true)); deBind("diy-export-light", "click", () => deDownload("light")); deBind("diy-export-gel", "click", () => deDownload("gel")); deBind("diy-brush", "input", (event) => { de("diy-brush-value").textContent = `${event.target.value} px`; deRender(); }); deBind("diy-grid-spacing", "input", () => { deUpdateGridLabel(); deRender(); }); deBind("diy-grid-enabled", "change", () => { deUpdateGridLabel(); deRender(); }); deBind("diy-snap-grid", "change", deRender); deBind("diy-angle-lock", "change", deRender); deBind("diy-tool", "change", () => { deCancel(); deSetStatus(deInstructions()); }); deBind("diy-mode", "change", deRender); deBind("sim-run", "click", () => { deFinish(deTool() === "polygon"); deRender(); }, { capture: true }); document.addEventListener("keydown", (event) => { if (de("diy")?.hidden) return; if (event.key === "Escape") { event.preventDefault(); deFinish(deTool() === "polygon"); } if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") { event.preventDefault(); event.shiftKey ? deRedo() : deUndo(); } if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "y") { event.preventDefault(); deRedo(); } }); deUpdateGridLabel(); deSetStatus(deInstructions()); deRender(); diyEditor.ready = true; }
window.initProDiyCanvas = initProDiyCanvas;
window.renderProDiyCanvas = deRender;
