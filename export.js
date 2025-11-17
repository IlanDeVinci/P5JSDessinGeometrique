// Simplified exporters: one PNG, one SVG, one DXF

// download helper
function dl(name, content, type) {
  const b = new Blob([content], { type: type || "application/octet-stream" });
  const u = URL.createObjectURL(b);
  const a = document.createElement("a");
  a.href = u;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(u), 500);
}

// 1) PNG - use the existing init_trace save_() exported by the sketch helpers
function savePNG(name) {
  if (typeof save_ === "function") {
    save_(name || "sketch.png");
    return;
  }
  // fallback: capture canvas as dataURL
  try {
    const c = document.querySelector("canvas");
    if (!c) throw new Error("No canvas found");
    const url = c.toDataURL("image/png");
    dl(name || "sketch.png", atob(url.split(",")[1]).buffer, "image/png");
  } catch (e) {
    console.error("savePNG failed:", e);
  }
}

// helper: serialize a clean clone of an SVG node (remove page layout styles)
function serializeCleanSvg(svgNode) {
  const clone = svgNode.cloneNode(true);
  // remove attributes that are page-layout related
  ["style", "aria-hidden"].forEach((a) => clone.removeAttribute(a));
  clone.removeAttribute("width");
  clone.removeAttribute("height");
  // remove inline styles from descendants
  const withStyle = clone.querySelectorAll("*[style]");
  withStyle.forEach((el) => el.removeAttribute("style"));
  // ensure xmlns
  if (!clone.getAttribute("xmlns"))
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  // ensure viewBox exists (if not, try to infer from width/height or default to 0 0 800 800)
  if (!clone.getAttribute("viewBox")) {
    clone.setAttribute(
      "viewBox",
      clone.getAttribute("viewBox") || "0 0 800 800"
    );
  }
  const serializer = new XMLSerializer();
  const preface = '<?xml version="1.0" standalone="no"?>\r\n';
  return preface + serializer.serializeToString(clone);
}

// 2) SVG - prefer existing mirrored svgElmt, otherwise draw into a detached SVG and serialize
function saveSVG(name) {
  try {
    // if a mirror exists and has shapes, use it
    if (
      window.svgElmt &&
      typeof window.svgElmt.querySelectorAll === "function" &&
      window.svgElmt.querySelectorAll("polyline,polygon,path").length > 0
    ) {
      const svgText = serializeCleanSvg(window.svgElmt);
      dl(name || "sketch.svg", svgText, "image/svg+xml;charset=utf-8");
      return;
    }
  } catch (e) {
    console.warn("saveSVG: mirror read failed", e);
  }

  // fallback: create a detached SVG, set as window.svgElmt temporarily, run the drawing, serialize
  const prevSvg = window.svgElmt;
  const prevSVGFlag = window._SVG_;
  const prevNP = window.NP || 800;
  try {
    window._SVG_ = true;
    const temp = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    temp.setAttribute("viewBox", `0 0 ${prevNP} ${prevNP}`);
    // add background rect so exported SVG has white background
    const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    bg.setAttribute("x", "0");
    bg.setAttribute("y", "0");
    bg.setAttribute("width", String(prevNP));
    bg.setAttribute("height", String(prevNP));
    bg.setAttribute("fill", "#ffffff");
    temp.appendChild(bg);

    window.svgElmt = temp;
    // ensure svgTranslate exists for init_trace
    try {
      window.svgTranslate =
        typeof createVector === "function" ? createVector() : { x: 0, y: 0 };
    } catch (e) {
      window.svgTranslate = { x: 0, y: 0 };
    }
    if (typeof window.drawCourbesTournantes === "function")
      window.drawCourbesTournantes();

    const svgText = serializeCleanSvg(temp);
    dl(name || "sketch.svg", svgText, "image/svg+xml;charset=utf-8");
  } catch (e) {
    console.error("saveSVG failed:", e);
  } finally {
    window.svgElmt = prevSvg;
    window._SVG_ = prevSVGFlag;
  }
}

// helper: extract polylines/polygons/paths from an SVG node into arrays of points
function extractShapesFromSvg(svgNode) {
  const shapes = [];
  if (!svgNode || !svgNode.querySelectorAll) return shapes;
  const nodes = svgNode.querySelectorAll("polyline,polygon,path");
  nodes.forEach((n) => {
    const tag = n.tagName.toLowerCase();
    if (tag === "polyline" || tag === "polygon") {
      const pts = (n.getAttribute("points") || "")
        .trim()
        .split(/\s+/)
        .map((p) => {
          const xy = p.split(",");
          return xy.length === 2
            ? [parseFloat(xy[0]), parseFloat(xy[1])]
            : null;
        })
        .filter(Boolean);
      if (pts.length) shapes.push(pts);
    } else if (tag === "path") {
      // very simple numeric extraction: pick number pairs from the d attribute
      const d = n.getAttribute("d") || "";
      const nums = d.match(/-?\d+\.?\d*/g);
      if (nums && nums.length >= 2) {
        const pts = [];
        for (let i = 0; i < nums.length; i += 2)
          pts.push([parseFloat(nums[i]), parseFloat(nums[i + 1])]);
        if (pts.length) shapes.push(pts);
      }
    }
  });
  return shapes;
}

// 3) DXF - extract shapes from mirror or detached SVG and create ASCII DXF scaled to 210x210 mm
function saveDXF(name) {
  const prevNP = window.NP || 800;
  let shapes = [];

  try {
    if (window.svgElmt && window.svgElmt.querySelectorAll)
      shapes = extractShapesFromSvg(window.svgElmt);
  } catch (e) {
    console.warn("saveDXF: reading mirror failed", e);
  }

  if (!shapes.length) {
    // fallback to detached rendering
    const prevSvg = window.svgElmt;
    const prevSVGFlag = window._SVG_;
    try {
      window._SVG_ = true;
      const temp = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "svg"
      );
      temp.setAttribute("viewBox", `0 0 ${prevNP} ${prevNP}`);
      const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      bg.setAttribute("x", "0");
      bg.setAttribute("y", "0");
      bg.setAttribute("width", String(prevNP));
      bg.setAttribute("height", String(prevNP));
      bg.setAttribute("fill", "#ffffff");
      temp.appendChild(bg);
      window.svgElmt = temp;
      // ensure svgTranslate exists for init_trace
      try {
        window.svgTranslate =
          typeof createVector === "function" ? createVector() : { x: 0, y: 0 };
      } catch (e) {
        window.svgTranslate = { x: 0, y: 0 };
      }
      if (typeof window.drawCourbesTournantes === "function")
        window.drawCourbesTournantes();
      shapes = extractShapesFromSvg(temp);
    } catch (e) {
      console.error("saveDXF fallback failed:", e);
    } finally {
      window.svgElmt = prevSvg;
      window._SVG_ = prevSVGFlag;
    }
  }

  if (!shapes.length) {
    console.warn("saveDXF: no shapes found to export");
    return;
  }

  const S = 210.0 / prevNP; // mm per unit
  let d = "0\nSECTION\n2\nENTITIES\n";
  shapes.forEach((P) => {
    d += "0\nPOLYLINE\n";
    for (let i = 0; i < P.length; i++) {
      const x = (P[i][0] * S).toFixed(4);
      const y = ((prevNP - P[i][1]) * S).toFixed(4);
      d += "0\nVERTEX\n10\n" + x + "\n20\n" + y + "\n";
    }
    d += "0\nSEQEND\n";
  });
  d += "0\nENDSEC\n0\nEOF\n";

  dl(name || "sketch.dxf", d, "application/dxf");
}

// expose functions and bind buttons
window.savePNG = savePNG;
window.saveSVG = saveSVG;
window.saveDXF = saveDXF;

function bindExportButtons() {
  const b1 = document.getElementById("btn-png");
  const b2 = document.getElementById("btn-svg");
  const b3 = document.getElementById("btn-dxf");
  if (b1) b1.onclick = () => savePNG();
  if (b2) b2.onclick = () => saveSVG();
  if (b3) b3.onclick = () => saveDXF();
}

if (document.readyState === "loading")
  document.addEventListener("DOMContentLoaded", bindExportButtons);
else bindExportButtons();
