// Refactored export system with reliable SVG and DXF generation
// Fixed state management and canvas preservation

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

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

function getCanvas() {
  try {
    return document.querySelector("canvas");
  } catch (e) {
    return null;
  }
}

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
      if (d && d.length >= 3) {
        // Normalize to hex if it's pure white
        if (d[0] === 255 && d[1] === 255 && d[2] === 255) {
          out.bg = "#ffffff";
        } else {
          out.bg = `rgb(${d[0]},${d[1]},${d[2]})`;
        }
      }
    } catch (e) {
      try {
        const cs = window.getComputedStyle && window.getComputedStyle(canvas);
        out.bg = cs && cs.backgroundColor ? cs.backgroundColor : null;
      } catch (ee) {
        out.bg = null;
      }
    }
  } catch (e) {
    console.error("getCanvasColors error", e);
  }
  return out;
}

function serializeSvg(node) {
  const preface = '<?xml version="1.0" standalone="no"?>\n';
  return preface + new XMLSerializer().serializeToString(node);
}

function hsbToRgb(h, s, b) {
  s = s / 100;
  b = b / 100;
  const k = (n) => (n + h / 60) % 6;
  const f = (n) => b * (1 - s * Math.max(0, Math.min(k(n), 4 - k(n), 1)));
  return [
    Math.round(255 * f(5)),
    Math.round(255 * f(3)),
    Math.round(255 * f(1)),
  ];
}

function normalizeColor(c) {
  if (!c && c !== 0) return null;
  if (Array.isArray(c)) {
    const [v1, v2, v3] = c;
    const looksLikeRGB = v2 > 100 || v3 > 100;

    if (window._EXPORT_HSB_MODE_ && !looksLikeRGB) {
      const [h, s, b] = c;
      const [r, g, b2] = hsbToRgb(h, s, b);
      return `rgb(${r},${g},${b2})`;
    }
    const [r, g, b] = c.map((v) =>
      Math.max(0, Math.min(255, parseInt(v) || 0))
    );
    return `rgb(${r},${g},${b})`;
  }
  if (typeof c === "string") {
    const s = c.trim();
    if (/^\s*\d+\s*,\s*\d+\s*,\s*\d+\s*$/.test(s)) {
      const parts = s.split(/\s*,\s*/).map((p) => parseInt(p) || 0);
      return `rgb(${parts[0]},${parts[1]},${parts[2]})`;
    }
    if (/^rgba?\(/i.test(s)) {
      const m = s.match(/^rgba?\(([^)]+)\)/i);
      if (m && m[1]) {
        const parts = m[1].split(",").map((p) => p.trim());
        return `rgb(${parts[0]},${parts[1] || 0},${parts[2] || 0})`;
      }
      return s;
    }
    if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s)) return s.toLowerCase();
    return s;
  }
  if (typeof c === "number") {
    const v = Math.max(0, Math.min(255, parseInt(c) || 0));
    return `rgb(${v},${v},${v})`;
  }
  return null;
}

function getCanvasDimensions(canvasEl, fallbackSize) {
  let w = fallbackSize;
  let h = fallbackSize;
  if (canvasEl) {
    try {
      const cs = window.getComputedStyle && window.getComputedStyle(canvasEl);
      if (cs && cs.width && cs.width.endsWith("px"))
        w = Math.round(parseFloat(cs.width));
      else if (canvasEl.width) w = canvasEl.width;
      else if (canvasEl.getBoundingClientRect)
        w = Math.round(canvasEl.getBoundingClientRect().width);
    } catch (e) {
      if (canvasEl.width) w = canvasEl.width;
    }
    try {
      const cs = window.getComputedStyle && window.getComputedStyle(canvasEl);
      if (cs && cs.height && cs.height.endsWith("px"))
        h = Math.round(parseFloat(cs.height));
      else if (canvasEl.height) h = canvasEl.height;
      else if (canvasEl.getBoundingClientRect)
        h = Math.round(canvasEl.getBoundingClientRect().height);
    } catch (e) {
      if (canvasEl.height) h = canvasEl.height;
    }
  }
  return { w, h };
}

// ============================================================================
// SVG GENERATION CORE
// ============================================================================

function createBaseSvg(width, height, bgColor) {
  const SVG_NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("xmlns", SVG_NS);
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));

  const bg = document.createElementNS(SVG_NS, "rect");
  bg.setAttribute("width", String(width));
  bg.setAttribute("height", String(height));
  bg.setAttribute("fill", bgColor || "#ffffff");
  svg.appendChild(bg);

  return svg;
}

function generateSvg(width, height, bgColor, strokeColor) {
  // Store original canvas to restore later
  const originalCanvas = getCanvas();

  // Save current state
  const savedState = {
    svgElmt: window.svgElmt,
    _SVG_: window._SVG_,
    svgStrokeColor: window.svgStrokeColor,
    svgStrokeWeight: window.svgStrokeWeight,
    _EXPORT_HSB_MODE_: window._EXPORT_HSB_MODE_,
  };

  let generatedSvg = null;
  let currentStrokeColor = strokeColor;
  let currentStrokeWeight = 1;

  try {
    // Create target SVG
    const svg = createBaseSvg(width, height, bgColor);

    // Setup SVG mode
    window._SVG_ = true;
    window.svgElmt = svg;
    window.svgStrokeColor = strokeColor;
    window.svgStrokeWeight = 1;
    window._EXPORT_HSB_MODE_ = false;

    // Reset svgTranslate to prevent offset issues
    if (typeof window.createVector === "function") {
      window.svgTranslate = window.createVector(0, 0);
    } else {
      window.svgTranslate = {
        x: 0,
        y: 0,
        add: function (dx, dy) {
          this.x += dx;
          this.y += dy;
        },
      };
    }

    // Store original functions
    const origNoCanvas = window.noCanvas;
    const origCreateCanvas = window.createCanvas;
    const origStroke = window.stroke_;
    const origLine = window.line;
    const origArc = window.arc;
    const origStrokeWeight = window.strokeWeight;
    const origColorMode = window.colorMode;
    const origTranslate = window.translate_;
    const origBeginShape = window.beginShape_;
    const origVertex = window.vertex_;
    const origEndShape = window.endShape_;

    // Track vertices and colors for shape drawing
    let shapeVertices = [];
    let shapeColors = [];

    // Patch functions to prevent canvas destruction and capture drawing
    window.noCanvas = function () {};
    window.createCanvas = function () {
      return originalCanvas;
    };

    window.colorMode = function (mode) {
      if (mode === window.HSB || mode === "HSB") {
        window._EXPORT_HSB_MODE_ = true;
      }
    };

    window.stroke_ = function (color) {
      const normalized = normalizeColor(color);
      currentStrokeColor = normalized || color;
      window.svgStrokeColor = currentStrokeColor;
    };

    window.strokeWeight = function (weight) {
      currentStrokeWeight = weight;
      window.svgStrokeWeight = weight;
    };

    window.translate_ = function (x, y) {
      if (window.svgTranslate) {
        if (typeof window.svgTranslate.add === "function") {
          window.svgTranslate.add(x, y);
        } else {
          window.svgTranslate.x += x;
          window.svgTranslate.y += y;
        }
      }
    };

    window.beginShape_ = function () {
      shapeVertices = [];
      shapeColors = [];
    };

    window.vertex_ = function (x, y) {
      shapeVertices.push({ x: x, y: y });
      shapeColors.push(currentStrokeColor);
    };

    window.endShape_ = function (mode) {
      const SVG_NS = "http://www.w3.org/2000/svg";

      // If we have 2 vertices with potentially different colors, draw as a line
      if (shapeVertices.length === 2) {
        const lineEl = document.createElementNS(SVG_NS, "line");
        lineEl.setAttribute("x1", shapeVertices[0].x);
        lineEl.setAttribute("y1", shapeVertices[0].y);
        lineEl.setAttribute("x2", shapeVertices[1].x);
        lineEl.setAttribute("y2", shapeVertices[1].y);
        // Use the color from the second vertex (the target)
        lineEl.setAttribute("stroke", shapeColors[1] || currentStrokeColor);
        lineEl.setAttribute("stroke-width", currentStrokeWeight);
        lineEl.setAttribute("fill", "none");

        const translate = window.svgTranslate;
        if (translate && (translate.x !== 0 || translate.y !== 0)) {
          lineEl.setAttribute(
            "transform",
            `translate(${translate.x} ${translate.y})`
          );
        }
        window.svgElmt.appendChild(lineEl);
      } else if (shapeVertices.length > 2) {
        // For multiple vertices, create a polyline
        const polyline = document.createElementNS(
          SVG_NS,
          mode === window.CLOSE ? "polygon" : "polyline"
        );
        polyline.setAttribute("stroke", currentStrokeColor);
        polyline.setAttribute("stroke-width", currentStrokeWeight);
        polyline.setAttribute("fill", "none");

        let strPoints = "";
        shapeVertices.forEach((v, idx) => {
          strPoints += `${idx > 0 ? " " : ""}${v.x},${v.y}`;
        });
        polyline.setAttribute("points", strPoints);

        const translate = window.svgTranslate;
        if (translate && (translate.x !== 0 || translate.y !== 0)) {
          polyline.setAttribute(
            "transform",
            `translate(${translate.x} ${translate.y})`
          );
        }
        window.svgElmt.appendChild(polyline);
      }

      shapeVertices = [];
      shapeColors = [];
    };

    window.line = function (x1, y1, x2, y2) {
      const SVG_NS = "http://www.w3.org/2000/svg";
      const lineEl = document.createElementNS(SVG_NS, "line");
      lineEl.setAttribute("x1", x1);
      lineEl.setAttribute("y1", y1);
      lineEl.setAttribute("x2", x2);
      lineEl.setAttribute("y2", y2);
      // Use the most current stroke color from svgStrokeColor or currentStrokeColor
      const strokeToUse = window.svgStrokeColor || currentStrokeColor;
      lineEl.setAttribute("stroke", strokeToUse);
      lineEl.setAttribute("stroke-width", currentStrokeWeight);
      lineEl.setAttribute("fill", "none");

      const translate = window.svgTranslate;
      if (translate && (translate.x !== 0 || translate.y !== 0)) {
        lineEl.setAttribute(
          "transform",
          `translate(${translate.x} ${translate.y})`
        );
      }
      window.svgElmt.appendChild(lineEl);
    };

    window.arc = function (x, y, w, h, start, stop) {
      const SVG_NS = "http://www.w3.org/2000/svg";
      const rx = w / 2;
      const ry = h / 2;
      const startX = x + rx * Math.cos(start);
      const startY = y + ry * Math.sin(start);
      const endX = x + rx * Math.cos(stop);
      const endY = y + ry * Math.sin(stop);
      const largeArc = stop - start > Math.PI ? 1 : 0;

      const pathEl = document.createElementNS(SVG_NS, "path");
      const d = `M ${startX} ${startY} A ${rx} ${ry} 0 ${largeArc} 1 ${endX} ${endY}`;
      pathEl.setAttribute("d", d);
      pathEl.setAttribute("stroke", currentStrokeColor);
      pathEl.setAttribute("stroke-width", currentStrokeWeight);
      pathEl.setAttribute("fill", "none");

      const translate = window.svgTranslate;
      if (translate && (translate.x !== 0 || translate.y !== 0)) {
        pathEl.setAttribute(
          "transform",
          `translate(${translate.x} ${translate.y})`
        );
      }
      window.svgElmt.appendChild(pathEl);
    };

    // Try to generate shapes
    let shapesGenerated = false;

    // Method 1: TRACE2
    if (typeof window.TRACE2 === "function") {
      try {
        window.TRACE2();
        const shapes = svg.querySelectorAll("polyline,polygon,line,path");
        if (shapes && shapes.length > 0) {
          shapesGenerated = true;
        }
      } catch (e) {
        console.warn("TRACE2 failed:", e);
      }
    }

    // Method 2: draw_/draw/setup
    if (!shapesGenerated) {
      try {
        if (typeof window.draw_ === "function") {
          window.draw_();
        } else if (typeof window.draw === "function") {
          window.draw();
        } else if (typeof window.setup === "function") {
          window.setup();
        }

        const shapes = svg.querySelectorAll("polyline,polygon,line,path");
        if (shapes && shapes.length > 0) {
          shapesGenerated = true;
        }
      } catch (e) {
        console.warn("draw/setup execution failed:", e);
      }
    }

    // Check if new svgElmt was created
    if (window.svgElmt && window.svgElmt !== svg) {
      const liveShapes = window.svgElmt.querySelectorAll(
        "polyline,polygon,line,path"
      );
      if (liveShapes && liveShapes.length > 0) {
        generatedSvg = window.svgElmt.cloneNode(true);
        shapesGenerated = true;
      }
    }

    if (!generatedSvg && shapesGenerated) {
      generatedSvg = svg.cloneNode(true);
    }

    // Normalize stroke colors
    if (generatedSvg) {
      const shapes = generatedSvg.querySelectorAll(
        "polyline,polygon,line,path"
      );
      shapes.forEach((shape) => {
        const currentStroke = shape.getAttribute("stroke");
        if (
          !currentStroke ||
          currentStroke === "null" ||
          currentStroke === "undefined"
        ) {
          shape.setAttribute("stroke", strokeColor);
        }
        if (!shape.getAttribute("fill")) {
          shape.setAttribute("fill", "none");
        }
      });
    }

    // Restore original functions
    window.noCanvas = origNoCanvas;
    window.createCanvas = origCreateCanvas;
    window.stroke_ = origStroke;
    window.line = origLine;
    window.arc = origArc;
    window.strokeWeight = origStrokeWeight;
    window.colorMode = origColorMode;
    window.translate_ = origTranslate;
    window.beginShape_ = origBeginShape;
    window.vertex_ = origVertex;
    window.endShape_ = origEndShape;
  } catch (e) {
    console.error("SVG generation error:", e);
  } finally {
    // Restore state
    window.svgElmt = savedState.svgElmt;
    window._SVG_ = savedState._SVG_;
    window.svgStrokeColor = savedState.svgStrokeColor;
    window.svgStrokeWeight = savedState.svgStrokeWeight;
    window._EXPORT_HSB_MODE_ = savedState._EXPORT_HSB_MODE_;
  }

  return generatedSvg;
}

// ============================================================================
// EXPORT FUNCTIONS
// ============================================================================

function savePNG(name) {
  const canvas = getCanvas();
  if (canvas && canvas.toBlob) {
    canvas.toBlob((blob) => {
      if (blob) {
        dl(name || "sketch.png", blob, "image/png");
      } else if (typeof window.save_ === "function") {
        window.save_(name || "sketch.png");
      }
    });
    return;
  }
  if (typeof window.save_ === "function") {
    window.save_(name || "sketch.png");
  }
}

function saveSVG(name) {
  const np = window.NP || 800;
  const canvasEl = getCanvas();

  // Use window.width/height if available, otherwise use canvas dimensions
  let w = window.width || np;
  let h = window.height || np;
  if (!window.width || !window.height) {
    const dims = getCanvasDimensions(canvasEl, np);
    w = dims.w;
    h = dims.h;
  }
  const dims = { w, h };

  const canvasColors = getCanvasColors();
  const bgColor = canvasColors.bg || window.BG_COLOR || "#ffffff";
  const strokeColor =
    normalizeColor(canvasColors.strokeStyle) ||
    canvasColors.strokeStyle ||
    window.STROKE_COLOR ||
    "#000000";

  // Check if we already have a vector SVG
  if (window.svgElmt && window.svgElmt.querySelectorAll) {
    const shapes = window.svgElmt.querySelectorAll(
      "polyline,polygon,line,path"
    );
    if (shapes && shapes.length > 0) {
      const exportSvg = window.svgElmt.cloneNode(true);

      exportSvg.setAttribute("width", String(dims.w));
      exportSvg.setAttribute("height", String(dims.h));
      exportSvg.setAttribute("viewBox", `0 0 ${dims.w} ${dims.h}`);

      let bgRect = exportSvg.querySelector("rect");
      if (!bgRect) {
        const SVG_NS = "http://www.w3.org/2000/svg";
        bgRect = document.createElementNS(SVG_NS, "rect");
        bgRect.setAttribute("width", String(dims.w));
        bgRect.setAttribute("height", String(dims.h));
        exportSvg.insertBefore(bgRect, exportSvg.firstChild);
      }
      bgRect.setAttribute("fill", bgColor);

      const exportShapes = exportSvg.querySelectorAll(
        "polyline,polygon,line,path"
      );
      exportShapes.forEach((shape) => {
        const currentStroke = shape.getAttribute("stroke");
        if (
          !currentStroke ||
          currentStroke === "null" ||
          currentStroke === "undefined"
        ) {
          shape.setAttribute("stroke", strokeColor);
        }
        if (!shape.getAttribute("fill")) {
          shape.setAttribute("fill", "none");
        }
      });

      // Replace canvas with SVG overlay
      const displaySvg = exportSvg.cloneNode(true);
      displaySvg.style.display = "block";
      if (canvasEl && canvasEl.parentNode) {
        canvasEl.parentNode.replaceChild(displaySvg, canvasEl);
      }

      dl(
        name || "sketch.svg",
        serializeSvg(exportSvg),
        "image/svg+xml;charset=utf-8"
      );
      return;
    }
  }

  // Generate SVG by re-running sketch
  const generatedSvg = generateSvg(dims.w, dims.h, bgColor, strokeColor);

  if (generatedSvg) {
    generatedSvg.setAttribute("width", String(dims.w));
    generatedSvg.setAttribute("height", String(dims.h));
    generatedSvg.setAttribute("viewBox", `0 0 ${dims.w} ${dims.h}`);

    // Replace canvas with SVG overlay
    const displaySvg = generatedSvg.cloneNode(true);
    displaySvg.style.display = "block";
    if (canvasEl && canvasEl.parentNode) {
      canvasEl.parentNode.replaceChild(displaySvg, canvasEl);
    }

    dl(
      name || "sketch.svg",
      serializeSvg(generatedSvg),
      "image/svg+xml;charset=utf-8"
    );
    return;
  }

  // Fallback: embed canvas as raster
  const fallbackSvg = createBaseSvg(dims.w, dims.h, bgColor);
  if (canvasEl) {
    try {
      const dataUrl = canvasEl.toDataURL("image/png");
      const img = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "image"
      );
      img.setAttributeNS("http://www.w3.org/1999/xlink", "href", dataUrl);
      img.setAttribute("width", String(dims.w));
      img.setAttribute("height", String(dims.h));
      fallbackSvg.appendChild(img);
    } catch (e) {
      console.error("Failed to embed canvas:", e);
    }
  }

  dl(
    name || "sketch.svg",
    serializeSvg(fallbackSvg),
    "image/svg+xml;charset=utf-8"
  );
}

function extractPolylines(svgNode) {
  const out = [];
  if (!svgNode || !svgNode.querySelectorAll) return out;

  const polyNodes = svgNode.querySelectorAll("polyline,polygon");
  polyNodes.forEach((n) => {
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

  const lineNodes = svgNode.querySelectorAll("line");
  lineNodes.forEach((n) => {
    const x1 = parseFloat(n.getAttribute("x1"));
    const y1 = parseFloat(n.getAttribute("y1"));
    const x2 = parseFloat(n.getAttribute("x2"));
    const y2 = parseFloat(n.getAttribute("y2"));
    if (!isNaN(x1) && !isNaN(y1) && !isNaN(x2) && !isNaN(y2)) {
      out.push([
        [x1, y1],
        [x2, y2],
      ]);
    }
  });

  const pathNodes = svgNode.querySelectorAll("path");
  pathNodes.forEach((n) => {
    const d = n.getAttribute("d");
    if (!d) return;
    const pts = [];
    const matches = d.match(/[ML]\s*([0-9.-]+)\s+([0-9.-]+)/g);
    if (matches) {
      matches.forEach((match) => {
        const coords = match.match(/([0-9.-]+)\s+([0-9.-]+)/);
        if (coords && coords.length >= 3) {
          pts.push([parseFloat(coords[1]), parseFloat(coords[2])]);
        }
      });
    }
    if (pts.length) out.push(pts);
  });

  return out;
}

function saveDXF(name) {
  const np = window.NP || 800;
  const canvasEl = getCanvas();

  // Use window.width/height if available, otherwise use canvas dimensions
  let w = window.width || np;
  let h = window.height || np;
  if (!window.width || !window.height) {
    const dims = getCanvasDimensions(canvasEl, np);
    w = dims.w;
    h = dims.h;
  }
  const dims = { w, h };

  const canvasColors = getCanvasColors();
  const bgColor = canvasColors.bg || window.BG_COLOR || "#ffffff";
  const strokeColor =
    normalizeColor(canvasColors.strokeStyle) ||
    canvasColors.strokeStyle ||
    window.STROKE_COLOR ||
    "#000000";

  let shapes = [];

  // Try existing svgElmt
  if (window.svgElmt) {
    shapes = extractPolylines(window.svgElmt);
  }

  // Generate SVG if needed
  if (!shapes.length) {
    const generatedSvg = generateSvg(dims.w, dims.h, bgColor, strokeColor);
    if (generatedSvg) {
      shapes = extractPolylines(generatedSvg);

      // Replace canvas with SVG overlay
      const displaySvg = generatedSvg.cloneNode(true);
      displaySvg.style.display = "block";
      if (canvasEl && canvasEl.parentNode) {
        canvasEl.parentNode.replaceChild(displaySvg, canvasEl);
      }
    }
  }

  if (!shapes.length) {
    console.error("No shapes found for DXF export");
    return;
  }

  // Convert to DXF
  const scale = 210.0 / np;
  let dxf = "0\nSECTION\n2\nENTITIES\n";

  shapes.forEach((poly) => {
    dxf += "0\nPOLYLINE\n";
    poly.forEach((pt) => {
      const x = (pt[0] * scale).toFixed(4);
      const y = ((np - pt[1]) * scale).toFixed(4);
      dxf += `0\nVERTEX\n10\n${x}\n20\n${y}\n`;
    });
    dxf += "0\nSEQEND\n";
  });

  dxf += "0\nENDSEC\n0\nEOF\n";
  dl(name || "sketch.dxf", dxf, "application/dxf");
}

// ============================================================================
// PUBLIC API
// ============================================================================

window.savePNG = savePNG;
window.saveSVG = saveSVG;
window.saveDXF = saveDXF;

function bindExportButtons() {
  const map = {
    "btn-png": savePNG,
    "btn-svg": saveSVG,
    "btn-dxf": saveDXF,
  };
  Object.keys(map).forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.onclick = () => map[id]();
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bindExportButtons);
} else {
  bindExportButtons();
}
