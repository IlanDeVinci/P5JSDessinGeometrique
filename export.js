// Minimal exporters: PNG (via `save_` fallback), SVG (vector or raster embedded),
// and DXF (constructed from SVG polylines).

// Create and trigger a download for content or blob
function dl(name, content, type) {
  const blob =
    content instanceof Blob
      ? content
      : new Blob([content], { type: type || "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

// --- Helpers ---
// Return the first canvas element or null
function getCanvas() {
  try {
    return document.querySelector("canvas");
  } catch (e) {
    console.error("getCanvas error", e);
    return null;
  }
}

// Sample canvas drawing state and top-left pixel for a sensible background fallback.
// Returns { strokeStyle, fillStyle, bg }
function getCanvasColors() {
  const canvas = getCanvas();
  const out = { strokeStyle: null, fillStyle: null, bg: null };
  if (!canvas) return out;
  try {
    const ctx = canvas.getContext("2d");
    if (!ctx) return out;
    out.strokeStyle = ctx.strokeStyle || null;
    out.fillStyle = ctx.fillStyle || null;
    try {
      const d = ctx.getImageData(0, 0, 1, 1).data;
      if (d && d.length >= 3) out.bg = `rgb(${d[0]},${d[1]},${d[2]})`;
    } catch (e) {
      console.error("getCanvasColors getImageData error", e);
      // getImageData can fail for CORS; fall back to computed style
      try {
        const cs = window.getComputedStyle && window.getComputedStyle(canvas);
        out.bg = cs && cs.backgroundColor ? cs.backgroundColor : null;
      } catch (ee) {
        console.error("getCanvasColors computedStyle error", ee);
        out.bg = null;
      }
    }
  } catch (e) {
    console.error("getCanvasColors error", e);
  }
  return out;
}

// Serialize an SVG node to a text string with XML preface
function serializeSvg(node) {
  const preface = '<?xml version="1.0" standalone="no"?>\n';
  return preface + new XMLSerializer().serializeToString(node);
}

// Create a minimal temporary SVG with white background sized to `np`
function ensureTempSvg(np) {
  const SVG_NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${np} ${np}`);
  const bg = document.createElementNS(SVG_NS, "rect");
  bg.setAttribute("width", String(np));
  bg.setAttribute("height", String(np));
  bg.setAttribute("fill", "#ffffff");
  svg.appendChild(bg);
  return svg;
}

// --- Exporters ---
function savePNG(name) {
  // Prefer exporting from the visible canvas if present
  const canvas = getCanvas();
  if (canvas && canvas.toBlob) {
    canvas.toBlob((blob) => {
      if (blob) dl(name || "sketch.png", blob, "image/png");
      else if (typeof save_ === "function") save_(name || "sketch.png");
    });
    return;
  }
  if (typeof save_ === "function") save_(name || "sketch.png");
}

function saveSVG(name) {
  const np = window.NP || 800;
  const prev = { svgElmt: window.svgElmt, _SVG_: window._SVG_ };
  try {
    const canvasColors = getCanvasColors();

    // If a vector `window.svgElmt` is available, clone and normalize attributes
    if (window.svgElmt) {
      const temp = window.svgElmt.cloneNode(true);
      if (!temp.getAttribute("viewBox"))
        temp.setAttribute("viewBox", `0 0 ${np} ${np}`);
      try {
        const shapes = temp.querySelectorAll("polyline,polygon");
        shapes.forEach((n) => {
          const stroke = n.getAttribute("stroke");
          if (!stroke || stroke === "null" || stroke === "undefined") {
            if (canvasColors.strokeStyle)
              n.setAttribute("stroke", canvasColors.strokeStyle);
          }
          if (!n.getAttribute("fill")) n.setAttribute("fill", "none");
        });
      } catch (e) {
        console.error("saveSVG: error normalizing existing svgElmt", e);
      }
      dl(
        name || "sketch.svg",
        serializeSvg(temp),
        "image/svg+xml;charset=utf-8"
      );
      return;
    }

    // Fallback: embed raster canvas into an SVG
    const temp = ensureTempSvg(np);
    const canvasBg =
      (canvasColors && canvasColors.bg) || window.BG_COLOR || "#ffffff";
    try {
      const bgRect = temp.querySelector("rect");
      if (bgRect) bgRect.setAttribute("fill", canvasBg);
    } catch (e) {
      console.error("saveSVG: set bg error", e);
    }

    const canvas = getCanvas();
    if (canvas) {
      try {
        const dataUrl = canvas.toDataURL("image/png");
        const img = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "image"
        );
        img.setAttributeNS("http://www.w3.org/1999/xlink", "href", dataUrl);
        img.setAttribute("width", String(np));
        img.setAttribute("height", String(np));
        temp.appendChild(img);
      } catch (e) {
        console.error("saveSVG: error embedding canvas dataURL", e);
      }
    }

    dl(name || "sketch.svg", serializeSvg(temp), "image/svg+xml;charset=utf-8");
  } finally {
    window.svgElmt = prev.svgElmt;
    window._SVG_ = prev._SVG_;
  }
}

// Extract arrays of point pairs from polyline/polygon `points` attributes
function extractPolylines(svgNode) {
  const out = [];
  if (!svgNode || !svgNode.querySelectorAll) return out;
  const nodes = svgNode.querySelectorAll("polyline,polygon");
  nodes.forEach((n) => {
    const pts = (n.getAttribute("points") || "")
      .trim()
      .split(/\s+/)
      .map((p) => {
        const [x, y] = p.split(",");
        return x && y ? [parseFloat(x), parseFloat(y)] : null;
      })
      .filter(Boolean);
    if (pts.length) out.push(pts);
  });
  return out;
}

function saveDXF(name) {
  const np = window.NP || 800;
  let shapes = [];
  if (window.svgElmt) shapes = extractPolylines(window.svgElmt);

  if (!shapes.length) {
    // Try to produce an SVG by running the sketch in SVG mode
    const prev = { svgElmt: window.svgElmt, _SVG_: window._SVG_ };
    try {
      // Turn on SVG mode and create a temporary svg element.
      // Many sketches record drawing output commands in `OUTPUT` and
      // provide a `TRACE2()` helper (from `init_trace.js`) that will
      // replay `OUTPUT` into the current `svgElmt`. Call it so the
      // temporary SVG is actually populated with polylines/polygons.
      window._SVG_ = true;
      const temp = ensureTempSvg(np);
      window.svgElmt = temp;
      if (!window.svgTranslate) window.svgTranslate = { x: 0, y: 0 };

      // If TRACE2 is available (init_trace.js), use it to populate
      // the temporary svg from the recorded `OUTPUT` commands.
      try {
        if (typeof TRACE2 === "function") {
          TRACE2();
        }
      } catch (e) {
        console.error("saveDXF: TRACE2 playback error", e);
      }

      // Now extract polylines/polygons from the populated temp svg
      shapes = extractPolylines(temp);
    } finally {
      window.svgElmt = prev.svgElmt;
      window._SVG_ = prev._SVG_;
    }
  }

  if (!shapes.length) return;

  const scale = 210.0 / np; // convert unit to mm
  let d = "0\nSECTION\n2\nENTITIES\n";
  shapes.forEach((poly) => {
    d += "0\nPOLYLINE\n";
    poly.forEach((pt) => {
      const x = (pt[0] * scale).toFixed(4);
      const y = ((np - pt[1]) * scale).toFixed(4);
      d += `0\nVERTEX\n10\n${x}\n20\n${y}\n`;
    });
    d += "0\nSEQEND\n";
  });
  d += "0\nENDSEC\n0\nEOF\n";
  dl(name || "sketch.dxf", d, "application/dxf");
}

// Public API + button binding
window.savePNG = savePNG;
window.saveSVG = saveSVG;
window.saveDXF = saveDXF;

function bindExportButtons() {
  const map = { "btn-png": savePNG, "btn-svg": saveSVG, "btn-dxf": saveDXF };
  Object.keys(map).forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.onclick = () => map[id]();
  });
}

if (document.readyState === "loading")
  document.addEventListener("DOMContentLoaded", bindExportButtons);
else bindExportButtons();
