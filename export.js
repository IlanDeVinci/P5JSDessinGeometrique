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
      // getImageData can fail for CORS; fall back to computed style
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

// Serialize an SVG node to a text string with XML preface
function serializeSvg(node) {
  const preface = '<?xml version="1.0" standalone="no"?>\n';
  return preface + new XMLSerializer().serializeToString(node);
}

// Convert HSB to RGB (H: 0-360, S: 0-100, B: 0-100)
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

// Normalize various color inputs to an SVG-friendly string.
// Accepts arrays like [h,s,b] (HSB), [r,g,b] (RGB), hex strings, or CSS `rgb(...)`/`rgba(...)`.
function normalizeColor(c) {
  if (!c && c !== 0) return null;
  if (Array.isArray(c)) {
    // Detect if HSB or RGB based on value ranges
    // HSB: h can be 0-360, s and b are 0-100
    // RGB: all values are 0-255
    // If second or third value > 100, it's RGB (since S and B in HSB are max 100)
    const [v1, v2, v3] = c;
    const looksLikeRGB = v2 > 100 || v3 > 100;

    if (window._EXPORT_HSB_MODE_ && !looksLikeRGB) {
      // Treat as HSB
      const [h, s, b] = c;
      const [r, g, b2] = hsbToRgb(h, s, b);
      return `rgb(${r},${g},${b2})`;
    }
    // Treat as RGB
    const [r, g, b] = c.map((v) =>
      Math.max(0, Math.min(255, parseInt(v) || 0))
    );
    return `rgb(${r},${g},${b})`;
  }
  if (typeof c === "string") {
    const s = c.trim();
    // bare numeric CSV like "125,0,100"
    if (/^\s*\d+\s*,\s*\d+\s*,\s*\d+\s*$/.test(s)) {
      const parts = s.split(/\s*,\s*/).map((p) => parseInt(p) || 0);
      return `rgb(${parts[0]},${parts[1]},${parts[2]})`;
    }
    // already rgb/rgba
    if (/^rgba?\(/i.test(s)) {
      // if rgba, drop alpha for SVG stroke
      const m = s.match(/^rgba?\(([^)]+)\)/i);
      if (m && m[1]) {
        const parts = m[1].split(",").map((p) => p.trim());
        return `rgb(${parts[0]},${parts[1] || 0},${parts[2] || 0})`;
      }
      return s;
    }
    // hex-like
    if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s)) return s.toLowerCase();
    // fallback: return original string
    return s;
  }
  // number? treat as gray
  if (typeof c === "number") {
    const v = Math.max(0, Math.min(255, parseInt(c) || 0));
    return `rgb(${v},${v},${v})`;
  }
  return null;
}

// Create a minimal temporary SVG with white background sized to `np`
function ensureTempSvg(np, bgColor) {
  const SVG_NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("xmlns", SVG_NS);
  svg.setAttribute("viewBox", `0 0 ${np} ${np}`);
  const bg = document.createElementNS(SVG_NS, "rect");
  bg.setAttribute("width", String(np));
  bg.setAttribute("height", String(np));
  const fill =
    bgColor !== undefined && bgColor !== null
      ? String(bgColor)
      : window.BG_COLOR || "#ffffff";
  bg.setAttribute("fill", fill);
  svg.appendChild(bg);
  return svg;
}

// Ensure an SVG element has explicit `width`/`height` and `viewBox` that
// match the pixel dimensions of the provided canvas element. If no canvas
// is provided, fall back to `np` for sizing.
function setSvgSize(svg, canvasEl, np) {
  try {
    // Prefer CSS style width/height (px) on the canvas created by p5.js,
    // because p5 often sets `width`/`height` attributes for device pixels
    // while the CSS `style` contains the logical display size (e.g. 480x750).
    let w = np;
    let h = np;
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
    if (w) svg.setAttribute("width", String(w));
    if (h) svg.setAttribute("height", String(h));
    if (w && h) svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  } catch (e) {
    /* ignore */
  }
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
    const canvasBg = canvasColors.bg || window.BG_COLOR || "#ffffff";
    // Capture the canvas element and its intrinsic pixel size once so we
    // continue to use the correct dimensions even if the canvas is later
    // replaced in the DOM by a temporary SVG overlay.
    const canvasEl = getCanvas();
    // Prefer CSS style width/height (px) when present (p5 sets these on the
    // canvas element). Fall back to intrinsic attributes or bounding rect.
    let canvasW = np;
    let canvasH = np;
    if (canvasEl) {
      try {
        const cs = window.getComputedStyle && window.getComputedStyle(canvasEl);
        if (cs && cs.width && cs.width.endsWith("px"))
          canvasW = Math.round(parseFloat(cs.width));
        else if (canvasEl.width) canvasW = canvasEl.width;
        else if (canvasEl.getBoundingClientRect)
          canvasW = Math.round(canvasEl.getBoundingClientRect().width);
      } catch (e) {
        if (canvasEl.width) canvasW = canvasEl.width;
      }
      try {
        const cs = window.getComputedStyle && window.getComputedStyle(canvasEl);
        if (cs && cs.height && cs.height.endsWith("px"))
          canvasH = Math.round(parseFloat(cs.height));
        else if (canvasEl.height) canvasH = canvasEl.height;
        else if (canvasEl.getBoundingClientRect)
          canvasH = Math.round(canvasEl.getBoundingClientRect().height);
      } catch (e) {
        if (canvasEl.height) canvasH = canvasEl.height;
      }
    }

    // If a vector `window.svgElmt` is available, clone and normalize attributes
    if (window.svgElmt) {
      const temp = window.svgElmt.cloneNode(true);
      if (!temp.getAttribute("viewBox"))
        temp.setAttribute("viewBox", `0 0 ${np} ${np}`);
      // Ensure there is a background rect matching the canvas or BG_COLOR
      try {
        let bgRect = temp.querySelector("rect");
        if (!bgRect) {
          const SVG_NS = "http://www.w3.org/2000/svg";
          bgRect = document.createElementNS(SVG_NS, "rect");
          bgRect.setAttribute("width", String(canvasW));
          bgRect.setAttribute("height", String(canvasH));
          temp.insertBefore(bgRect, temp.firstChild);
        }
        bgRect.setAttribute("fill", String(canvasBg));
      } catch (e) {
        /* ignore background rect manipulation errors */
      }
      try {
        const shapes = temp.querySelectorAll("polyline,polygon,line,path");
        const defaultStroke =
          normalizeColor(canvasColors.strokeStyle) || canvasColors.strokeStyle;
        shapes.forEach((n) => {
          const stroke = n.getAttribute("stroke");
          // Only set default if stroke is missing or invalid - preserve existing colors!
          if (!stroke || stroke === "null" || stroke === "undefined") {
            if (defaultStroke) n.setAttribute("stroke", defaultStroke);
          }
          // Don't normalize existing valid strokes - they may be intentional rainbow colors
          if (!n.getAttribute("fill")) n.setAttribute("fill", "none");
        });
      } catch (e) {
        console.error("saveSVG: error normalizing existing svgElmt", e);
      }
      // Make sure exported SVG dimensions match the canvas
      try {
        setSvgSize(temp, canvasEl, np);
      } catch (e) {
        /* ignore */
      }
      dl(
        name || "sketch.svg",
        serializeSvg(temp),
        "image/svg+xml;charset=utf-8"
      );
      return;
    }

    // If no vector svgElmt exists, try to populate a temporary SVG by
    // replaying recorded output or re-running the sketch drawing function.
    const tryPopulateSvg = (temp) => {
      const prev2 = {
        svgElmt: window.svgElmt,
        _SVG_: window._SVG_,
        INIT: window.INIT,
        INIT2: window.INIT2,
        INIT_WH: window.INIT_WH,
        noCanvas: window.noCanvas,
        createCanvas: window.createCanvas,
        svgStrokeColor: window.svgStrokeColor,
        svgStrokeWeight: window.svgStrokeWeight,
        stroke_: window.stroke_,
        line: window.line,
        arc: window.arc,
        strokeWeight: window.strokeWeight,
        colorMode: window.colorMode,
        _EXPORT_HSB_MODE_: window._EXPORT_HSB_MODE_,
      };
      let createdSvg = null;
      let currentStrokeColor = window.svgStrokeColor || "#000000";
      let currentStrokeWeight = window.svgStrokeWeight || 1;

      try {
        // Force SVG mode and root to our temporary svg while invoking sketch code.
        window._SVG_ = true;
        window.svgElmt = temp;
        window._EXPORT_HSB_MODE_ = false; // Will be set to true if colorMode(HSB) is called
        if (!window.svgTranslate) window.svgTranslate = { x: 0, y: 0 };

        // Prevent the sketch from removing the existing canvas when it calls
        // `noCanvas()` during INIT; monkey-patch `noCanvas` and `createCanvas`
        // temporarily so the visible bitmap is preserved.
        try {
          window.noCanvas = function () {};
          window.createCanvas = function (w, h) {
            // return existing canvas if available
            return document.querySelector("canvas") || null;
          };
        } catch (e) {
          console.error("saveSVG: error patching noCanvas/createCanvas", e);
        }

        // Intercept colorMode() to detect HSB mode
        window.colorMode = function (mode) {
          if (mode === HSB || mode === "HSB") {
            window._EXPORT_HSB_MODE_ = true;
          }
          // Don't actually call p5's colorMode in SVG mode to avoid errors
        };

        // Intercept stroke_() to capture HSB color arrays and convert them
        const origStroke_ = window.stroke_;
        if (origStroke_) {
          window.stroke_ = function (color) {
            if (Array.isArray(color)) {
              currentStrokeColor = normalizeColor(color);
              window.svgStrokeColor = currentStrokeColor;
            } else {
              currentStrokeColor = color;
              window.svgStrokeColor = color;
            }
            // Don't call original in SVG mode to avoid errors
            if (!window._SVG_) origStroke_.call(this, color);
          };
        }

        // Intercept strokeWeight() to track stroke width
        window.strokeWeight = function (weight) {
          currentStrokeWeight = weight;
          window.svgStrokeWeight = weight;
        };

        // Intercept line() to create SVG line elements
        window.line = function (x1, y1, x2, y2) {
          const SVG_NS = "http://www.w3.org/2000/svg";
          const lineEl = document.createElementNS(SVG_NS, "line");
          lineEl.setAttribute("x1", x1);
          lineEl.setAttribute("y1", y1);
          lineEl.setAttribute("x2", x2);
          lineEl.setAttribute("y2", y2);
          lineEl.setAttribute("stroke", currentStrokeColor);
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

        // Intercept arc() to create SVG path elements
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

        // Ensure INIT / INIT2 used by sketches will create SVGs attached to
        // our temporary mode (or at least create an svg we can capture).
        try {
          if (typeof window.INIT === "function") {
            const origINIT = window.INIT;
            window.INIT = function (opts = {}) {
              opts = opts || {};
              opts.svg = true;
              return origINIT.call(this, opts);
            };
          }
          if (typeof window.INIT2 === "function") {
            const origINIT2 = window.INIT2;
            window.INIT2 = function (h, opts = {}) {
              opts = opts || {};
              opts.svg = true;
              return origINIT2.call(this, h, opts);
            };
          }
          if (typeof window.INIT_WH === "function") {
            const origINIT_WH = window.INIT_WH;
            window.INIT_WH = function (w, h, opts = {}) {
              opts = opts || {};
              opts.svg = true;
              return origINIT_WH.call(this, w, h, opts);
            };
          }
        } catch (e) {
          console.error("saveSVG: error patching INIT functions", e);
        }

        // Make sure traced shapes use the same stroke color as the canvas
        try {
          const cs = getCanvasColors();
          const candidate =
            (cs && cs.strokeStyle) ||
            window.STROKE_COLOR ||
            window.svgStrokeColor;
          const norm = normalizeColor(candidate) || candidate;
          if (norm) window.svgStrokeColor = norm;
        } catch (e) {
          /* ignore */
        }

        // 1) If the sketch records OUTPUT and provides TRACE2(), use it.
        try {
          if (typeof TRACE2 === "function") TRACE2();
        } catch (e) {
          console.error("saveSVG: TRACE2 playback error", e);
        }

        // 2) If nothing was produced, try calling common drawing entrypoints
        // that sketches may define. Call in order: draw_(), draw(), setup().
        let shapes = temp.querySelectorAll("polyline,polygon,line,path");
        if (!shapes || shapes.length === 0) {
          try {
            if (typeof window.draw_ === "function") window.draw_();
            else if (typeof window.draw === "function") window.draw();
            else if (typeof window.setup === "function") window.setup();
          } catch (e) {
            console.error("saveSVG: draw/setup invocation error", e);
          }
        }

        // If setup/INIT created a new svg element and appended it to the DOM,
        // capture it so we can use it and later remove it to avoid side-effects.
        try {
          if (window.svgElmt && window.svgElmt !== temp) {
            createdSvg = window.svgElmt;
          }
        } catch (e) {
          /* ignore */
        }

        // Return the shapes and the SVG node that was populated.
        if (createdSvg)
          return {
            shapes: createdSvg.querySelectorAll("polyline,polygon,line,path"),
            svg: createdSvg,
          };
        return {
          shapes: temp.querySelectorAll("polyline,polygon,line,path"),
          svg: temp,
        };
      } finally {
        // restore create/noCanvas and svg color/refs
        try {
          if (prev2.noCanvas) window.noCanvas = prev2.noCanvas;
          else delete window.noCanvas;
        } catch (e) {
          /* ignore */
        }
        try {
          if (prev2.createCanvas) window.createCanvas = prev2.createCanvas;
          else delete window.createCanvas;
        } catch (e) {
          /* ignore */
        }
        try {
          if (prev2.stroke_) window.stroke_ = prev2.stroke_;
        } catch (e) {
          /* ignore */
        }
        try {
          if (prev2.line) window.line = prev2.line;
        } catch (e) {
          /* ignore */
        }
        try {
          if (prev2.arc) window.arc = prev2.arc;
        } catch (e) {
          /* ignore */
        }
        try {
          if (prev2.strokeWeight) window.strokeWeight = prev2.strokeWeight;
        } catch (e) {
          /* ignore */
        }
        try {
          if (prev2.colorMode) window.colorMode = prev2.colorMode;
        } catch (e) {
          /* ignore */
        }
        window.svgStrokeColor = prev2.svgStrokeColor;
        window.svgStrokeWeight = prev2.svgStrokeWeight;
        window._EXPORT_HSB_MODE_ = prev2._EXPORT_HSB_MODE_;
        // keep prev svgElmt/_SVG_ restored
        window.svgElmt = prev2.svgElmt;
        window._SVG_ = prev2._SVG_;

        // Remove any temporary SVG element that setup appended to the DOM
        try {
          if (createdSvg && createdSvg.parentNode && !prev2.svgElmt) {
            // remove it to avoid leaving duplicate DOM nodes
            createdSvg.parentNode.removeChild(createdSvg);
          }
        } catch (e) {
          console.error("saveSVG: failed to remove temporary svgElmt", e);
        }
      }
    };

    const temp = ensureTempSvg(np, canvasBg);
    // Ensure the temp SVG's background rect uses the canvas pixel size
    try {
      const bgRect0 = temp.querySelector("rect");
      if (bgRect0) {
        bgRect0.setAttribute("width", String(canvasW));
        bgRect0.setAttribute("height", String(canvasH));
      }
    } catch (e) {
      /* ignore */
    }
    const populated = tryPopulateSvg(temp);
    // populated: { shapes: NodeList, svg: SVGElement }
    let shapes = populated && populated.shapes ? populated.shapes : null;
    let exportSvg = populated && populated.svg ? populated.svg : temp;

    // If setup/draw created its own svgElmt and populated it, prefer that one.
    try {
      if (window.svgElmt && window.svgElmt !== temp) {
        const liveShapes = window.svgElmt.querySelectorAll(
          "polyline,polygon,line,path"
        );
        if (liveShapes && liveShapes.length) {
          shapes = liveShapes;
          exportSvg = window.svgElmt;
        }
      }
    } catch (e) {
      console.error("saveSVG: error checking live svgElmt", e);
    }

    // If we obtained shapes, normalize, replace the canvas with the SVG,
    // and export the SVG without the background rect.
    if (shapes && shapes.length) {
      try {
        // Don't override stroke colors that are already set - preserve them!
        shapes.forEach((n) => {
          const stroke = n.getAttribute("stroke");
          // Only set default stroke if missing or invalid
          if (!stroke || stroke === "null" || stroke === "undefined") {
            const rawColor =
              canvasColors.strokeStyle ||
              window.svgStrokeColor ||
              window.STROKE_COLOR;
            const strokeColor = normalizeColor(rawColor) || rawColor;
            if (strokeColor) n.setAttribute("stroke", strokeColor);
          }
          // Ensure fill is none if not set
          if (!n.getAttribute("fill")) n.setAttribute("fill", "none");
        });
      } catch (e) {
        console.error("saveSVG: error normalizing traced svgElmt", e);
      }

      try {
        // Prepare an export clone (no background) to download, and a page clone
        // to replace the canvas in-place.
        const exportClone = exportSvg.cloneNode(true);
        try {
          // Ensure exported clone has a background rect matching canvasBg.
          let bgRect = exportClone.querySelector("rect");
          if (!bgRect) {
            const SVG_NS = "http://www.w3.org/2000/svg";
            bgRect = document.createElementNS(SVG_NS, "rect");
            bgRect.setAttribute("width", String(canvasW));
            bgRect.setAttribute("height", String(canvasH));
            exportClone.insertBefore(bgRect, exportClone.firstChild);
          }
          bgRect.setAttribute("fill", String(canvasBg));
        } catch (e) {
          /* ignore */
        }

        // Ensure exported SVG has explicit width/height/viewBox matching the canvas
        try {
          setSvgSize(exportClone, canvasEl, np);
        } catch (e) {
          /* ignore */
        }
        // remove any inline style that could add background or sizing
        try {
          exportClone.removeAttribute("style");
        } catch (e) {}

        // Replace the canvas on the page with a visual SVG (same size)
        try {
          const pageSvg = exportClone.cloneNode(true);
          pageSvg.id = "export-svg-overlay";
          // style reset: make it fill the original canvas element slot
          pageSvg.style.display = "block";

          if (canvasEl && canvasEl.parentNode) {
            canvasEl.parentNode.replaceChild(pageSvg, canvasEl);
          }
        } catch (e) {
          console.error("saveSVG: replace canvas with svg failed", e);
        }

        // Trigger download using the cleaned exportClone
        dl(
          name || "sketch.svg",
          serializeSvg(exportClone),
          "image/svg+xml;charset=utf-8"
        );
      } catch (e) {
        console.error("saveSVG: export/replace error", e);
      }
      return;
    }

    // Fallback: embed raster canvas into an SVG
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
        img.setAttribute("width", String(canvasW));
        img.setAttribute("height", String(canvasH));
        temp.appendChild(img);
      } catch (e) {
        console.error("saveSVG: error embedding canvas dataURL", e);
      }
    }

    try {
      setSvgSize(temp, canvasEl, np);
    } catch (e) {
      /* ignore */
    }
    dl(name || "sketch.svg", serializeSvg(temp), "image/svg+xml;charset=utf-8");
  } finally {
    window.svgElmt = prev.svgElmt;
    window._SVG_ = prev._SVG_;
  }
}

// Extract arrays of point pairs from polyline/polygon/line/path elements
function extractPolylines(svgNode) {
  const out = [];
  if (!svgNode || !svgNode.querySelectorAll) return out;

  // Handle polyline and polygon elements
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

  // Handle line elements - convert to 2-point polyline
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

  // Handle path elements - extract arc paths (simplified)
  const pathNodes = svgNode.querySelectorAll("path");
  pathNodes.forEach((n) => {
    const d = n.getAttribute("d");
    if (!d) return;
    // Simple extraction of M and A commands for arcs
    // This is a basic approximation - arcs are converted to line segments
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
  let shapes = [];
  if (window.svgElmt) shapes = extractPolylines(window.svgElmt);

  if (!shapes.length) {
    // Try to produce an SVG by replaying output or running the sketch
    const prev = {
      svgElmt: window.svgElmt,
      _SVG_: window._SVG_,
      noCanvas: window.noCanvas,
      createCanvas: window.createCanvas,
      svgStrokeColor: window.svgStrokeColor,
      svgStrokeWeight: window.svgStrokeWeight,
      stroke_: window.stroke_,
      line: window.line,
      arc: window.arc,
      strokeWeight: window.strokeWeight,
      colorMode: window.colorMode,
      _EXPORT_HSB_MODE_: window._EXPORT_HSB_MODE_,
    };
    let currentStrokeColor = window.svgStrokeColor || "#000000";
    let currentStrokeWeight = window.svgStrokeWeight || 1;
    let createdSvg = null;

    try {
      window._SVG_ = true;
      const temp = ensureTempSvg(np);
      window.svgElmt = temp;
      window._EXPORT_HSB_MODE_ = false; // Will be set to true if colorMode(HSB) is called
      if (!window.svgTranslate) window.svgTranslate = { x: 0, y: 0 };

      // prevent canvas removal during INIT/setup
      try {
        window.noCanvas = function () {};
        window.createCanvas = function (w, h) {
          return document.querySelector("canvas") || null;
        };
      } catch (e) {
        /* ignore */
      }

      // Intercept colorMode() to detect HSB mode
      window.colorMode = function (mode) {
        if (mode === HSB || mode === "HSB") {
          window._EXPORT_HSB_MODE_ = true;
        }
        // Don't actually call p5's colorMode in SVG mode to avoid errors
      };

      // Intercept stroke_() to capture HSB color arrays and convert them
      const origStroke_ = window.stroke_;
      if (origStroke_) {
        window.stroke_ = function (color) {
          if (Array.isArray(color)) {
            currentStrokeColor = normalizeColor(color);
            window.svgStrokeColor = currentStrokeColor;
          } else {
            currentStrokeColor = color;
            window.svgStrokeColor = color;
          }
          if (!window._SVG_) origStroke_.call(this, color);
        };
      }

      // Intercept strokeWeight() to track stroke width
      window.strokeWeight = function (weight) {
        currentStrokeWeight = weight;
        window.svgStrokeWeight = weight;
      };

      // Intercept line() to create SVG line elements
      window.line = function (x1, y1, x2, y2) {
        const SVG_NS = "http://www.w3.org/2000/svg";
        const lineEl = document.createElementNS(SVG_NS, "line");
        lineEl.setAttribute("x1", x1);
        lineEl.setAttribute("y1", y1);
        lineEl.setAttribute("x2", x2);
        lineEl.setAttribute("y2", y2);
        lineEl.setAttribute("stroke", currentStrokeColor);
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

      // Intercept arc() to create SVG path elements
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

      try {
        if (typeof TRACE2 === "function") TRACE2();
      } catch (e) {
        console.error("saveDXF: TRACE2 playback error", e);
      }

      // If TRACE2 didn't produce shapes, try draw_/draw/setup
      let shapesFound = temp.querySelectorAll("polyline,polygon,line,path");
      if (!shapesFound || shapesFound.length === 0) {
        try {
          if (typeof window.draw_ === "function") window.draw_();
          else if (typeof window.draw === "function") window.draw();
          else if (typeof window.setup === "function") window.setup();
        } catch (e) {
          console.error("saveDXF: draw/setup invocation error", e);
        }
      }

      // Prefer any svgElmt that the sketch may have created during setup/draw
      try {
        if (window.svgElmt && window.svgElmt !== temp) {
          createdSvg = window.svgElmt;
          shapes = extractPolylines(window.svgElmt);
        } else {
          shapes = extractPolylines(temp);
        }
      } catch (e) {
        shapes = extractPolylines(temp);
      }
    } finally {
      try {
        if (prev.noCanvas) window.noCanvas = prev.noCanvas;
        else delete window.noCanvas;
      } catch (e) {}
      try {
        if (prev.createCanvas) window.createCanvas = prev.createCanvas;
        else delete window.createCanvas;
      } catch (e) {}
      try {
        if (prev.stroke_) window.stroke_ = prev.stroke_;
      } catch (e) {}
      try {
        if (prev.line) window.line = prev.line;
      } catch (e) {}
      try {
        if (prev.arc) window.arc = prev.arc;
      } catch (e) {}
      try {
        if (prev.strokeWeight) window.strokeWeight = prev.strokeWeight;
      } catch (e) {}
      try {
        if (prev.colorMode) window.colorMode = prev.colorMode;
      } catch (e) {}
      window.svgStrokeColor = prev.svgStrokeColor;
      window.svgStrokeWeight = prev.svgStrokeWeight;
      window._EXPORT_HSB_MODE_ = prev._EXPORT_HSB_MODE_;
      window.svgElmt = prev.svgElmt;
      window._SVG_ = prev._SVG_;

      // Remove any temporary SVG element that setup appended to the DOM
      try {
        if (createdSvg && createdSvg.parentNode && !prev.svgElmt) {
          createdSvg.parentNode.removeChild(createdSvg);
        }
      } catch (e) {
        console.error("saveDXF: failed to remove temporary svgElmt", e);
      }
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
