// Native jsPDF vector chart primitives for report PDFs.
// No html2canvas, no image rasterization — all drawn as crisp PDF vectors.
// Follows the FONT / SIZES / C palette from reportExport.js.
import { FONT, SIZES, C, setColor, wrap, drawLines, lineMm, ascentMm } from './reportExport';

const PT_TO_MM = 25.4 / 72;
const sz = (pt) => pt * PT_TO_MM;

// ── Chart colour palette (aligned with Tailwind values used in the app) ──────
export const CHART_COLORS = {
  green:   [16, 185, 129],
  amber:   [245, 158, 11],
  red:     [239, 68, 68],
  blue:    [59, 130, 246],
  grey:    [148, 163, 184],
  indigo:  [99, 102, 241],
  violet:  [139, 92, 246],
  emerald: [16, 185, 129],
  slate:   [100, 116, 139],
};

// Resolve a colour spec (string name or [r,g,b]) to an RGB array.
export function resolveColor(color) {
  if (Array.isArray(color)) return color;
  if (typeof color === 'string') return CHART_COLORS[color] || C.accent;
  return C.accent;
}

// Callout tone colours: { bg, border, text }
export const CALLOUT_TONES = {
  good: { bg: [236, 253, 245], border: CHART_COLORS.green, text: [4, 120, 87] },
  warn: { bg: [255, 251, 235], border: CHART_COLORS.amber, text: [161, 98, 7] },
  bad:  { bg: [254, 242, 242], border: CHART_COLORS.red,   text: [185, 28, 28] },
};

// ── Internal: fill a circular arc segment using thin triangles from centre ───
function fillArc(doc, cx, cy, r, startAngle, endAngle, color) {
  setColor(doc, color, 'fill');
  const sweep = endAngle - startAngle;
  const steps = Math.max(2, Math.ceil(Math.abs(sweep) / (Math.PI / 36)));
  for (let i = 0; i < steps; i++) {
    const a1 = startAngle + sweep * (i / steps);
    const a2 = startAngle + sweep * ((i + 1) / steps);
    doc.triangle(
      cx, cy,
      cx + r * Math.cos(a1), cy + r * Math.sin(a1),
      cx + r * Math.cos(a2), cy + r * Math.sin(a2),
      'F'
    );
  }
}

// ── drawKpiCards ─────────────────────────────────────────────────────────────
// A row of 3-5 cards, each with a large value, a small uppercase label, and
// an optional coloured left rule. Returns the height consumed.
export function drawKpiCards(doc, x, y, w, cards, opts = {}) {
  if (!cards || !cards.length) return 0;
  const maxH = opts.maxH ?? 30;
  const gap = 2;
  const cardW = (w - gap * (cards.length - 1)) / cards.length;
  const cardH = 16;
  if (cardH > maxH) return 0;

  cards.forEach((card) => {
    const cx = x + (cards.indexOf(card)) * (cardW + gap);
    // Card background
    setColor(doc, C.zebra, 'fill');
    doc.rect(cx, y, cardW, cardH, 'F');
    // Coloured left rule
    const color = resolveColor(card.color);
    setColor(doc, color, 'fill');
    doc.rect(cx, y, 2, cardH, 'F');
    // Value
    doc.setFont(FONT, 'bold');
    doc.setFontSize(13);
    setColor(doc, C.ink, 'text');
    doc.text(String(card.value ?? '—'), cx + 4, y + 5 + sz(13) * 0.7);
    // Label (uppercase)
    doc.setFont(FONT, 'normal');
    doc.setFontSize(7);
    setColor(doc, C.subInk, 'text');
    const labelLines = wrap(doc, String(card.label || '').toUpperCase(), cardW - 6, 7, 'normal');
    drawLines(doc, labelLines, cx + 4, y + 9, 7, 'left', cx + cardW - 2);
  });

  return cardH;
}

// ── drawDonut ────────────────────────────────────────────────────────────────
// A progress ring with the percentage centred. Accent colour from opts.color
// (default C.accent), track in C.hairline. Optional label beneath.
export function drawDonut(doc, cx, cy, r, pct, opts = {}) {
  const maxH = opts.maxH ?? 60;
  const labelH = opts.label ? 8 : 0;
  if (r * 2 + labelH > maxH) return 0;

  const p = Math.max(0, Math.min(100, pct));
  const color = resolveColor(opts.color);
  const trackColor = opts.trackColor || C.hairline;

  // Track (full circle)
  fillArc(doc, cx, cy, r, 0, Math.PI * 2, trackColor);
  // Progress arc (from top, clockwise)
  if (p > 0) {
    fillArc(doc, cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (p / 100), color);
  }
  // Punch hole
  setColor(doc, C.white, 'fill');
  doc.circle(cx, cy, r * 0.62, 'F');

  // Percentage text centred
  doc.setFont(FONT, 'bold');
  doc.setFontSize(13);
  setColor(doc, C.ink, 'text');
  doc.text(`${Math.round(p)}%`, cx, cy + sz(13) * 0.35, { align: 'center' });

  if (opts.label) {
    doc.setFont(FONT, 'normal');
    doc.setFontSize(8);
    setColor(doc, C.subInk, 'text');
    const labelLines = wrap(doc, opts.label, r * 2.2, 8, 'normal');
    drawLines(doc, labelLines, cx - r, cy + r + 2, 8, 'center', cx + r);
    return r * 2 + 2 + labelLines.length * lineMm(8);
  }

  return r * 2;
}

// ── drawHBars ────────────────────────────────────────────────────────────────
// Horizontal bars — rows: { label, value, max, color? }.
// Label on the left in a fixed gutter, bar in the middle, value right-aligned.
// Wraps long labels using wrap(). Returns height consumed.
export function drawHBars(doc, x, y, w, rows, opts = {}) {
  if (!rows || !rows.length) return 0;
  const maxH = opts.maxH ?? 200;
  const labelW = opts.labelW ?? 42;
  const valueW = opts.valueW ?? 14;
  const barW = w - labelW - valueW;
  const barH = opts.barH ?? 5;
  const gap = opts.gap ?? 3;

  let yy = y;
  for (const row of rows) {
    const labelLines = wrap(doc, String(row.label ?? '—'), labelW - 2, 8, 'normal');
    const rowH = Math.max(barH, labelLines.length * lineMm(8));
    if (yy - y + rowH + gap > maxH) break;

    // Label
    doc.setFont(FONT, 'normal');
    doc.setFontSize(8);
    setColor(doc, C.subInk, 'text');
    drawLines(doc, labelLines, x, yy, 8, 'left', x + labelW - 2);

    // Bar track
    setColor(doc, C.hairline, 'fill');
    doc.roundedRect(x + labelW, yy + (rowH - barH) / 2, barW, barH, 1, 1, 'F');

    // Bar fill
    const max = row.max ?? 100;
    const val = Math.max(0, Math.min(max, Number(row.value) || 0));
    const fillW = (val / max) * barW;
    if (fillW > 0.5) {
      setColor(doc, resolveColor(row.color || 'blue'), 'fill');
      doc.roundedRect(x + labelW, yy + (rowH - barH) / 2, fillW, barH, 1, 1, 'F');
    }

    // Value right-aligned
    doc.setFont(FONT, 'bold');
    doc.setFontSize(8);
    setColor(doc, C.ink, 'text');
    const valStr = typeof row.value === 'number' ? `${Math.round(row.value)}%` : String(row.value ?? '—');
    doc.text(valStr, x + w, yy + (rowH - barH) / 2 + barH * 0.75, { align: 'right' });

    yy += rowH + gap;
  }

  return yy - y;
}

// ── drawStackedBar ────────────────────────────────────────────────────────────
// One horizontal stacked bar + legend beneath. segments: { label, value, color }.
export function drawStackedBar(doc, x, y, w, h, segments, opts = {}) {
  if (!segments || !segments.length) return 0;
  const maxH = opts.maxH ?? 40;
  const barH = h || 6;
  const legendH = 8;
  const totalH = barH + 4 + legendH;
  if (totalH > maxH) return 0;

  const total = segments.reduce((s, seg) => s + (Number(seg.value) || 0), 0);
  if (total === 0) return 0;

  // Background
  setColor(doc, C.hairline, 'fill');
  doc.rect(x, y, w, barH, 'F');

  // Segments
  let sx = x;
  segments.forEach((seg) => {
    const segW = ((Number(seg.value) || 0) / total) * w;
    if (segW > 0.5) {
      setColor(doc, resolveColor(seg.color || 'grey'), 'fill');
      doc.rect(sx, y, segW, barH, 'F');
    }
    sx += segW;
  });

  // Border
  setColor(doc, C.hairline, 'draw');
  doc.setLineWidth(0.2);
  doc.rect(x, y, w, barH, 'S');

  // Legend
  let lx = x;
  const ly = y + barH + 3;
  doc.setFontSize(7);
  doc.setFont(FONT, 'normal');
  segments.forEach((seg) => {
    const swatch = 2.5;
    setColor(doc, resolveColor(seg.color || 'grey'), 'fill');
    doc.rect(lx, ly, swatch, swatch, 'F');
    setColor(doc, C.subInk, 'text');
    const text = `${seg.label} (${seg.value})`;
    doc.text(text, lx + swatch + 1, ly + 2);
    lx += swatch + 1 + doc.getTextWidth(text) + 4;
  });

  return totalH;
}

// ── drawLineChart ──────────────────────────────────────────────────────────────
// series: [{ name, color, points: [{ date, value }] }]
// Draws axes, gridlines, connected line segments, and a legend.
export function drawLineChart(doc, x, y, w, h, series, opts = {}) {
  if (!series || !series.length) return 0;
  const maxH = opts.maxH ?? 100;
  if (h > maxH) return 0;

  const padL = 12, padR = 4, padT = 4, padB = 8;
  const plotX = x + padL;
  const plotY = y + padT;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  // Determine value range
  let minV = Infinity, maxV = -Infinity;
  series.forEach((s) => {
    (s.points || []).forEach((p) => {
      const v = Number(p.value) || 0;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    });
  });
  if (minV === Infinity) { minV = 0; maxV = 100; }
  if (minV === maxV) maxV = minV + 1;
  const range = maxV - minV;
  minV = Math.max(0, minV - range * 0.1);
  maxV = maxV + range * 0.1;

  // Determine date range
  let minD = Infinity, maxD = -Infinity;
  series.forEach((s) => {
    (s.points || []).forEach((p) => {
      const d = new Date(p.date).getTime();
      if (!isNaN(d)) {
        if (d < minD) minD = d;
        if (d > maxD) maxD = d;
      }
    });
  });
  if (minD === Infinity) return 0;
  if (minD === maxD) maxD = minD + 86400000;
  const dRange = maxD - minD;

  // Gridlines (4 horizontal)
  doc.setFontSize(7);
  doc.setFont(FONT, 'normal');
  for (let i = 0; i <= 4; i++) {
    const gy = plotY + (plotH / 4) * i;
    setColor(doc, C.hairline, 'draw');
    doc.setLineWidth(0.1);
    doc.line(plotX, gy, plotX + plotW, gy);
    const val = maxV - (maxV - minV) * (i / 4);
    setColor(doc, C.muted, 'text');
    doc.text(`${Math.round(val)}`, plotX - 1, gy + 1.5, { align: 'right' });
  }

  // X axis
  setColor(doc, C.subInk, 'draw');
  doc.setLineWidth(0.2);
  doc.line(plotX, plotY + plotH, plotX + plotW, plotY + plotH);

  // X labels (up to 5)
  const xLabelCount = Math.min(5, series[0]?.points?.length || 0);
  setColor(doc, C.muted, 'text');
  doc.setFontSize(7);
  for (let i = 0; i < xLabelCount; i++) {
    const frac = xLabelCount === 1 ? 0 : i / (xLabelCount - 1);
    const lx = plotX + frac * plotW;
    const date = new Date(minD + frac * dRange);
    const label = date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
    doc.text(label, lx, plotY + plotH + 4, { align: 'center' });
  }

  // Plot series
  series.forEach((s) => {
    const pts = (s.points || []).filter(p => !isNaN(new Date(p.date).getTime()));
    if (pts.length < 2) return;
    setColor(doc, resolveColor(s.color || 'blue'), 'draw');
    doc.setLineWidth(0.5);
    for (let i = 1; i < pts.length; i++) {
      const d1 = new Date(pts[i - 1].date).getTime();
      const d2 = new Date(pts[i].date).getTime();
      const x1 = plotX + ((d1 - minD) / dRange) * plotW;
      const y1 = plotY + plotH - ((Number(pts[i - 1].value) - minV) / (maxV - minV)) * plotH;
      const x2 = plotX + ((d2 - minD) / dRange) * plotW;
      const y2 = plotY + plotH - ((Number(pts[i].value) - minV) / (maxV - minV)) * plotH;
      doc.line(x1, y1, x2, y2);
    }
  });

  // Legend
  let lx = plotX;
  const ly = y + h - 1;
  doc.setFontSize(7);
  doc.setFont(FONT, 'normal');
  series.forEach((s) => {
    setColor(doc, resolveColor(s.color || 'blue'), 'draw');
    doc.setLineWidth(0.8);
    doc.line(lx, ly - 1, lx + 4, ly - 1);
    setColor(doc, C.subInk, 'text');
    doc.text(s.name, lx + 5, ly);
    lx += 5 + doc.getTextWidth(s.name) + 6;
  });

  return h;
}

// ── drawGauge ─────────────────────────────────────────────────────────────────
// A horizontal RAG gauge. value: 0-100.
// thresholds: { green, amber } — green below, amber mid, red above.
export function drawGauge(doc, x, y, w, value, thresholds, opts = {}) {
  const maxH = opts.maxH ?? 20;
  const barH = 5;
  const labelH = opts.label ? 5 : 0;
  const totalH = barH + 3 + labelH;
  if (totalH > maxH) return 0;

  const g = thresholds?.green ?? 60;
  const a = thresholds?.amber ?? 80;
  const v = Math.max(0, Math.min(100, value));

  // Segments
  setColor(doc, CHART_COLORS.green, 'fill');
  doc.rect(x, y, (g / 100) * w, barH, 'F');
  setColor(doc, CHART_COLORS.amber, 'fill');
  doc.rect(x + (g / 100) * w, y, ((a - g) / 100) * w, barH, 'F');
  setColor(doc, CHART_COLORS.red, 'fill');
  doc.rect(x + (a / 100) * w, y, ((100 - a) / 100) * w, barH, 'F');

  // Marker (triangle pointing down)
  const mx = x + (v / 100) * w;
  setColor(doc, C.ink, 'fill');
  doc.triangle(mx - 1.5, y - 1, mx + 1.5, y - 1, mx, y + 1.5, 'F');

  // Value label above marker
  doc.setFont(FONT, 'bold');
  doc.setFontSize(8);
  setColor(doc, C.ink, 'text');
  doc.text(`${Math.round(v)}%`, mx, y - 2, { align: 'center' });

  // Border
  setColor(doc, C.hairline, 'draw');
  doc.setLineWidth(0.2);
  doc.rect(x, y, w, barH, 'S');

  if (opts.label) {
    doc.setFont(FONT, 'normal');
    doc.setFontSize(7);
    setColor(doc, C.subInk, 'text');
    doc.text(opts.label, x, y + barH + 4);
  }

  return totalH;
}

// ── drawCallout ───────────────────────────────────────────────────────────────
// A coloured callout box with title + body. tone: 'good'|'warn'|'bad'.
export function drawCallout(doc, x, y, w, tone, title, body, opts = {}) {
  const maxH = opts.maxH ?? 40;
  const colors = CALLOUT_TONES[tone] || CALLOUT_TONES.good;
  const padX = 4, padY = 3;
  const innerW = w - 6 - padX * 2; // 6mm left border area

  doc.setFont(FONT, 'bold');
  doc.setFontSize(9);
  const titleLines = wrap(doc, title || '', innerW, 9, 'bold');
  doc.setFont(FONT, 'normal');
  doc.setFontSize(8);
  const bodyLines = body ? wrap(doc, body, innerW, 8, 'normal') : [];

  const contentH = titleLines.length * lineMm(9) + (bodyLines.length ? 1 + bodyLines.length * lineMm(8) : 0);
  const boxH = Math.max(12, contentH + padY * 2);
  if (boxH > maxH) return 0;

  // Background
  setColor(doc, colors.bg, 'fill');
  doc.rect(x, y, w, boxH, 'F');
  // Left border
  setColor(doc, colors.border, 'fill');
  doc.rect(x, y, 3, boxH, 'F');

  // Title
  setColor(doc, colors.text, 'text');
  drawLines(doc, titleLines, x + 6, y + padY, 9, 'left', x + w - padX);

  // Body
  if (bodyLines.length) {
    setColor(doc, C.subInk, 'text');
    drawLines(doc, bodyLines, x + 6, y + padY + titleLines.length * lineMm(9) + 1, 8, 'left', x + w - padX);
  }

  return boxH;
}