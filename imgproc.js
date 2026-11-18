/* معالجة الصور على الجهاز: كشف حدود الورقة، تصحيح الميل (perspective)، تحسين «سكان»، وفحص السيلفي */
(function () {
  'use strict';
  function loadImg(src) {
    return new Promise(function (ok, no) { var im = new Image(); im.onload = function () { ok(im); }; im.onerror = function () { no(new Error('تعذر فتح الصورة')); }; im.src = src; });
  }
  async function fileToCanvas(file, max) {
    var u = URL.createObjectURL(file);
    try {
      var im = await loadImg(u);
      var w = im.naturalWidth, h = im.naturalHeight, k = Math.min(1, max / Math.max(w, h));
      var c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
      var x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(im, 0, 0, c.width, c.height);
      return c;
    } finally { URL.revokeObjectURL(u); }
  }
  function scaled(src, max) {
    var k = Math.min(1, max / Math.max(src.width, src.height));
    var c = document.createElement('canvas'); c.width = Math.max(1, Math.round(src.width * k)); c.height = Math.max(1, Math.round(src.height * k));
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height); return c;
  }
  function grayOf(c) {
    var d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, n = c.width * c.height, g = new Float32Array(n);
    for (var i = 0, j = 0; i < n; i++, j += 4) g[i] = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2];
    return g;
  }
  function otsu(g) {
    var hist = new Float64Array(256), n = g.length; for (var i = 0; i < n; i++) hist[g[i] | 0]++;
    var sum = 0; for (i = 0; i < 256; i++) sum += i * hist[i];
    var sB = 0, wB = 0, best = 0, t = 128;
    for (i = 0; i < 256; i++) { wB += hist[i]; if (!wB) continue; var wF = n - wB; if (!wF) break; sB += i * hist[i];
      var mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) * (mB - mF); if (v > best) { best = v; t = i; } }
    return t;
  }
  /* كشف الورقة: أكبر منطقة فاتحة متصلة (الورق الأبيض على خلفية أغمق) ثم أطرافها الأربعة */
  function detectQuad(src) {
    var c = scaled(src, 360), W = c.width, H = c.height, g = grayOf(c), t = otsu(g);
    var m = new Uint8Array(W * H); for (var i = 0; i < m.length; i++) m[i] = g[i] > t ? 1 : 0;
    var lab = new Int32Array(W * H), best = 0, bestId = 0, id = 0, st = new Int32Array(W * H);
    for (var p = 0; p < m.length; p++) {
      if (!m[p] || lab[p]) continue; id++; var sp = 0, cnt = 0; st[sp++] = p; lab[p] = id;
      while (sp) { var q = st[--sp]; cnt++; var x = q % W, y = (q / W) | 0;
        if (x > 0 && m[q - 1] && !lab[q - 1]) { lab[q - 1] = id; st[sp++] = q - 1; }
        if (x < W - 1 && m[q + 1] && !lab[q + 1]) { lab[q + 1] = id; st[sp++] = q + 1; }
        if (y > 0 && m[q - W] && !lab[q - W]) { lab[q - W] = id; st[sp++] = q - W; }
        if (y < H - 1 && m[q + W] && !lab[q + W]) { lab[q + W] = id; st[sp++] = q + W; } }
      if (cnt > best) { best = cnt; bestId = id; }
    }
    var frac = best / (W * H), full = fullQuad(src);
    if (!bestId || frac < 0.12 || frac > 0.97) return { quad: full, auto: false };
    var tl = [0, 0, 1e9], tr = [0, 0, -1e9], br = [0, 0, -1e9], bl = [0, 0, 1e9];
    for (p = 0; p < lab.length; p++) { if (lab[p] !== bestId) continue; var X = p % W, Y = (p / W) | 0, s = X + Y, d = X - Y;
      if (s < tl[2]) tl = [X, Y, s]; if (s > br[2]) br = [X, Y, s]; if (d > tr[2]) tr = [X, Y, d]; if (d < bl[2]) bl = [X, Y, d]; }
    var k = src.width / W;
    var quad = [tl, tr, br, bl].map(function (v) { return [v[0] * k, v[1] * k]; });
    var area = polyArea(quad) / (src.width * src.height);
    if (area < 0.1) return { quad: full, auto: false };
    return { quad: quad, auto: true };
  }
  function fullQuad(src) { var w = src.width, h = src.height, e = 0; return [[e, e], [w - e, e], [w - e, h - e], [e, h - e]]; }
  function polyArea(q) { var a = 0; for (var i = 0; i < 4; i++) { var j = (i + 1) % 4; a += q[i][0] * q[j][1] - q[j][0] * q[i][1]; } return Math.abs(a) / 2; }
  function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }
  // حل نظام 8×8: homography من مستطيل الوجهة إلى رباعي المصدر
  function homography(dst, srcQ) {
    var A = [], B = [];
    for (var i = 0; i < 4; i++) { var u = dst[i][0], v = dst[i][1], x = srcQ[i][0], y = srcQ[i][1];
      A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]); B.push(x); A.push([0, 0, 0, u, v, 1, -u * y, -v * y]); B.push(y); }
    var n = 8; for (var c = 0; c < n; c++) { var piv = c; for (var r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
      var tA = A[c]; A[c] = A[piv]; A[piv] = tA; var tB = B[c]; B[c] = B[piv]; B[piv] = tB;
      for (r = 0; r < n; r++) { if (r === c) continue; var f = A[r][c] / A[c][c]; if (!f) continue; for (var k = c; k < n; k++) A[r][k] -= f * A[c][k]; B[r] -= f * B[c]; } }
    var h = []; for (i = 0; i < n; i++) h.push(B[i] / A[i][i]); h.push(1); return h;
  }
  function warp(src, quad, maxOut) {
    var wTop = dist(quad[0], quad[1]), wBot = dist(quad[3], quad[2]), hL = dist(quad[0], quad[3]), hR = dist(quad[1], quad[2]);
    var OW = Math.max(wTop, wBot), OH = Math.max(hL, hR), k = Math.min(1, maxOut / Math.max(OW, OH));
    OW = Math.max(10, Math.round(OW * k)); OH = Math.max(10, Math.round(OH * k));
    var H = homography([[0, 0], [OW - 1, 0], [OW - 1, OH - 1], [0, OH - 1]], quad);
    var sd = src.getContext('2d').getImageData(0, 0, src.width, src.height).data, SW = src.width, SH = src.height;
    var out = document.createElement('canvas'); out.width = OW; out.height = OH;
    var ox = out.getContext('2d'), id = ox.createImageData(OW, OH), od = id.data;
    for (var v = 0; v < OH; v++) for (var u = 0; u < OW; u++) {
      var z = H[6] * u + H[7] * v + 1, x = (H[0] * u + H[1] * v + H[2]) / z, y = (H[3] * u + H[4] * v + H[5]) / z;
      var o = (v * OW + u) * 4;
      if (x < 0 || y < 0 || x > SW - 1 || y > SH - 1) { od[o] = od[o + 1] = od[o + 2] = 255; od[o + 3] = 255; continue; }
      var x0 = x | 0, y0 = y | 0, x1 = Math.min(x0 + 1, SW - 1), y1 = Math.min(y0 + 1, SH - 1), fx = x - x0, fy = y - y0;
      var i00 = (y0 * SW + x0) * 4, i10 = (y0 * SW + x1) * 4, i01 = (y1 * SW + x0) * 4, i11 = (y1 * SW + x1) * 4;
      for (var ch = 0; ch < 3; ch++) od[o + ch] = (sd[i00 + ch] * (1 - fx) + sd[i10 + ch] * fx) * (1 - fy) + (sd[i01 + ch] * (1 - fx) + sd[i11 + ch] * fx) * fy;
      od[o + 3] = 255;
    }
    ox.putImageData(id, 0, 0); return out;
  }
  /* تحسين «سكان»: تسوية الإضاءة (قسمة على خلفية مموهة) + شد التباين. mode: gray | bw | color */
  function enhance(c, mode) {
    if (mode === 'color') return autoLevels(c);
    var W = c.width, H = c.height, x = c.getContext('2d'), img = x.getImageData(0, 0, W, H), d = img.data;
    var sm = document.createElement('canvas'), sw = Math.max(8, Math.round(W / 24)), sh = Math.max(8, Math.round(H / 24)); sm.width = sw; sm.height = sh;
    var sx = sm.getContext('2d'); sx.imageSmoothingQuality = 'high'; sx.drawImage(c, 0, 0, sw, sh);
    // تكبير الخلفية تاني لنفس الحجم (تمويه ناعم)
    var bg = document.createElement('canvas'); bg.width = W; bg.height = H; var bx = bg.getContext('2d'); bx.imageSmoothingEnabled = true; bx.imageSmoothingQuality = 'high';
    try { bx.filter = 'blur(' + Math.round(Math.max(W, H) / 60) + 'px)'; } catch (e) {}
    bx.drawImage(sm, 0, 0, W, H); var b = bx.getImageData(0, 0, W, H).data;
    var n = W * H, g = new Float32Array(n), lo = 255, hi = 0;
    for (var i = 0, j = 0; i < n; i++, j += 4) { var gv = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2], bv = 0.299 * b[j] + 0.587 * b[j + 1] + 0.114 * b[j + 2];
      var r = Math.min(1.2, gv / Math.max(30, bv)); g[i] = r; }
    // نسب مئوية لشد التباين
    var hist = new Uint32Array(256); for (i = 0; i < n; i++) hist[Math.min(255, (g[i] / 1.2 * 255) | 0)]++;
    var acc = 0, p2 = 0, p98 = 255; for (i = 0; i < 256; i++) { acc += hist[i]; if (acc < n * 0.01) p2 = i; if (acc < n * 0.95) p98 = i; }
    lo = p2 / 255 * 1.2; hi = Math.max(lo + 0.05, Math.min(1.0, p98 / 255 * 1.2));
    for (i = 0, j = 0; i < n; i++, j += 4) { var t = (g[i] - lo) / (hi - lo); t = Math.max(0, Math.min(1, t));
      var out = mode === 'bw' ? (t > 0.72 ? 255 : (t < 0.5 ? 0 : Math.round((t - 0.5) / 0.22 * 255))) : Math.round(255 * Math.pow(t, 1.25));
      d[j] = d[j + 1] = d[j + 2] = out; }
    x.putImageData(img, 0, 0); return c;
  }
  function autoLevels(c) {
    var x = c.getContext('2d'), img = x.getImageData(0, 0, c.width, c.height), d = img.data, n = d.length / 4, hist = new Uint32Array(256);
    for (var j = 0; j < d.length; j += 4) hist[(0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2]) | 0]++;
    var acc = 0, lo = 0, hi = 255; for (var i = 0; i < 256; i++) { acc += hist[i]; if (acc < n * 0.01) lo = i; if (acc < n * 0.97) hi = i; }
    var k = 255 / Math.max(20, hi - lo);
    for (j = 0; j < d.length; j += 4) for (var ch = 0; ch < 3; ch++) d[j + ch] = Math.max(0, Math.min(255, (d[j + ch] - lo) * k));
    x.putImageData(img, 0, 0); return c;
  }
  function rotate(c, deg) {
    deg = ((deg % 360) + 360) % 360; if (!deg) return c;
    var o = document.createElement('canvas'), sw = deg % 180 !== 0; o.width = sw ? c.height : c.width; o.height = sw ? c.width : c.height;
    var x = o.getContext('2d'); x.translate(o.width / 2, o.height / 2); x.rotate(deg * Math.PI / 180); x.drawImage(c, -c.width / 2, -c.height / 2); return o;
  }
  function toBlob(c, q, type) { return new Promise(function (ok, no) { c.toBlob(function (b) { b ? ok(b) : no(new Error('toBlob')); }, type || 'image/jpeg', q); }); }

  /* فحص وضوح السيلفي: الإضاءة (متوسط/تشبع) + الحدة (تباين لابلاسيان) */
  function quality(src) {
    var c = scaled(src, 400), W = c.width, H = c.height, g = grayOf(c), n = g.length, sum = 0, dark = 0, bright = 0;
    for (var i = 0; i < n; i++) { sum += g[i]; if (g[i] < 35) dark++; if (g[i] > 245) bright++; }
    var mean = sum / n, lm = 0, l2 = 0, cnt = 0;
    // الحدة: نحسبها على وسط الصورة (مكان الوش غالبًا)
    for (var y = Math.round(H * 0.15); y < Math.round(H * 0.85); y++) for (var x = Math.round(W * 0.15); x < Math.round(W * 0.85); x++) {
      var p = y * W + x, L = 4 * g[p] - g[p - 1] - g[p + 1] - g[p - W] - g[p + W]; lm += L; l2 += L * L; cnt++; }
    lm /= cnt; var lapVar = l2 / cnt - lm * lm;
    return { mean: Math.round(mean), darkFrac: dark / n, brightFrac: bright / n, sharp: Math.round(lapVar) };
  }
  var mpPromise = null;
  async function detectFaces(c) {
    try {
      if ('FaceDetector' in window) {
        var fd = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 5 });
        var r = await fd.detect(c); return { method: 'FaceDetector', faces: r.map(function (f) { var b = f.boundingBox; return { x: b.x, y: b.y, w: b.width, h: b.height }; }) };
      }
    } catch (e) { /* يكمل للمكتبة */ }
    try {
      if (!mpPromise) mpPromise = (async function () {
        var base = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
        var mod = await import(base + '/vision_bundle.mjs');
        var fs = await mod.FilesetResolver.forVisionTasks(base + '/wasm');
        return mod.FaceDetector.createFromOptions(fs, { baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite' }, runningMode: 'IMAGE', minDetectionConfidence: 0.5 });
      })();
      var det = await Promise.race([mpPromise, new Promise(function (_, no) { setTimeout(function () { no(new Error('timeout')); }, 15000); })]);
      var res = det.detect(c);
      return { method: 'MediaPipe', faces: (res.detections || []).map(function (d) { var b = d.boundingBox; return { x: b.originX, y: b.originY, w: b.width, h: b.height, score: d.categories && d.categories[0] && d.categories[0].score }; }) };
    } catch (e) { mpPromise = null; return { method: 'none', faces: null, error: String(e && e.message || e) }; }
  }
  window.HOImg = { loadImg: loadImg, fileToCanvas: fileToCanvas, scaled: scaled, detectQuad: detectQuad, fullQuad: fullQuad, warp: warp, enhance: enhance, rotate: rotate, toBlob: toBlob, quality: quality, detectFaces: detectFaces };
})();
