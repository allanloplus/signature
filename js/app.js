/* Allan & 阿拉蕾 文件簽核工坊 — 純前端，文件與簽名皆不離開瀏覽器 */
'use strict';
const $ = id => document.getElementById(id);
const S = {
  doc: null,          // {name, kind:'pdf'|'docx'|'image', bytes, sha}
  pages: [],          // {cv, wPt, hPt, el}
  items: [],          // {id, page, x, y, w, ar, cv, vault, el, label}
  sigs: [],           // {id, label, cv, vault, sample}
  armed: null, selected: null, allan: null, seq: 0,
};
const IDLE_MS = 10 * 60 * 1000;

/* ---------- 小工具 ---------- */
const MOBILE = matchMedia('(max-width:860px)');
const sheet = on => { document.body.classList.toggle('sheet', on); $('mTools').textContent = on ? '✖️ 收起工具' : '🧰 工具／簽名'; };
const guide = (text, face = 'explain') => { $('guideText').textContent = text; $('guideImg').src = `assets/chars/arale-${face}.jpg`; };
let toastT; const toast = (m, ms = 3200) => { const t = $('toast'); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, ms); };
const busy = (on, text) => { $('busy').hidden = !on; if (text) $('busyText').textContent = text; };
const nextFrame = () => new Promise(r => setTimeout(r, 30));
const mkCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };
const loadImage = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('圖片無法讀取')); i.src = src; });
const fileToImage = async f => { const u = URL.createObjectURL(f); try { return await loadImage(u); } finally { setTimeout(() => URL.revokeObjectURL(u), 1000); } };
const toBytes = (cv, type = 'image/png', q) => new Promise(r => cv.toBlob(async b => r(new Uint8Array(await b.arrayBuffer())), type, q));
const pad2 = n => String(n).padStart(2, '0');
const stamp = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const FONT = '"PingFang TC","Microsoft JhengHei","Noto Sans TC","Noto Sans CJK TC",sans-serif';
function download(bytes, name, type) {
  const u = URL.createObjectURL(new Blob([bytes], { type })); const a = document.createElement('a');
  a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000);
}

/* ---------- 簽名影像處理：去背 + 裁邊 ---------- */
function cleanSignature(src) {
  const w = src.naturalWidth || src.width, h = src.naturalHeight || src.height;
  const k = Math.min(1, 1600 / Math.max(w, h)), c = mkCanvas(w * k, h * k), x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(src, 0, 0, c.width, c.height);
  const im = x.getImageData(0, 0, c.width, c.height), d = im.data, W = c.width, H = c.height;
  let transparent = 0; for (let i = 3; i < d.length; i += 4) if (d[i] < 200) transparent++;
  if (transparent < d.length / 4 * 0.05) {        // 不透明底 → 以四角估背景亮度後去背
    const lum = i => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const corners = [0, W - 1, (H - 1) * W, H * W - 1].map(p => lum(p * 4)).sort((a, b) => a - b);
    const bg = Math.max(140, (corners[1] + corners[2]) / 2), hi = bg - 10, lo = Math.min(hi - 40, 90);
    for (let i = 0; i < d.length; i += 4) {
      const a = Math.max(0, Math.min(1, (hi - lum(i)) / (hi - lo)));
      if (a > 0) for (let j = 0; j < 3; j++) d[i + j] = Math.max(0, Math.min(255, (d[i + j] - (1 - a) * bg) / a));
      d[i + 3] = Math.round(a * 255);
    }
    x.putImageData(im, 0, 0);
  }
  let x0 = W, y0 = H, x1 = -1, y1 = -1;            // 裁掉空白邊
  for (let yy = 0; yy < H; yy++) for (let xx = 0; xx < W; xx++) if (d[(yy * W + xx) * 4 + 3] > 24) { if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (yy < y0) y0 = yy; if (yy > y1) y1 = yy; }
  if (x1 < 0) throw new Error('看不到筆跡，請換一張圖');
  const p = 6; x0 = Math.max(0, x0 - p); y0 = Math.max(0, y0 - p); x1 = Math.min(W - 1, x1 + p); y1 = Math.min(H - 1, y1 + p);
  const out = mkCanvas(x1 - x0 + 1, y1 - y0 + 1); out.getContext('2d').drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}
function sampleSig(text, font, tilt) {
  const c = mkCanvas(640, 240), x = c.getContext('2d');
  x.translate(320, 120); x.rotate(tilt); x.font = font; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = '#1b2a4e';
  x.fillText(text, 0, -8); x.lineWidth = 5; x.strokeStyle = '#1b2a4e'; x.lineCap = 'round';
  x.beginPath(); x.moveTo(-250, 62); x.quadraticCurveTo(-40, 92, 260, 48); x.stroke();
  return cleanSignature(c);
}
function textStamp(lines, { color = '#14213d', border = true, size = 44 } = {}) {
  const m = mkCanvas(10, 10).getContext('2d'); m.font = `600 ${size}px ${FONT}`;
  const pad = border ? size * 0.6 : 6, lh = size * 1.45, tw = Math.max(...lines.map(l => m.measureText(l).width));
  const c = mkCanvas(tw + pad * 2, lines.length * lh + pad * 2 - (lh - size) * 0.5), x = c.getContext('2d');
  x.font = m.font; x.fillStyle = color; x.textBaseline = 'top';
  lines.forEach((l, i) => x.fillText(l, pad, pad + i * lh));
  if (border) { x.strokeStyle = color; x.lineWidth = 4; x.beginPath(); x.roundRect(3, 3, c.width - 6, c.height - 6, 14); x.stroke(); }
  return c;
}
function withCaption(sig, caption) {
  const fs = Math.max(13, Math.round(sig.width / 17)), m = mkCanvas(1, 1).getContext('2d'); m.font = `500 ${fs}px ${FONT}`;
  const tw = m.measureText(caption).width, W = Math.max(sig.width, tw + 8), c = mkCanvas(W, sig.height + fs * 1.5), x = c.getContext('2d');
  x.drawImage(sig, (W - sig.width) / 2, 0); x.font = m.font; x.fillStyle = '#4a5568'; x.textAlign = 'center'; x.textBaseline = 'top';
  x.fillText(caption, W / 2, sig.height + fs * 0.25);
  return c;
}

/* ---------- 簽名清單 ---------- */
function renderSigs() {
  const box = $('sigList'); box.innerHTML = '';
  S.sigs.forEach(s => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'sig' + (S.armed === s ? ' armed' : '') + (s.vault ? ' vault' : ''); b.draggable = true;
    const img = document.createElement('img'); img.src = s.cv.toDataURL(); img.alt = s.label; img.draggable = false;
    const cap = document.createElement('span'); cap.textContent = (s.vault ? '🔐 ' : s.sample ? '🧪 ' : '') + s.label;
    b.append(img, cap);
    if (!s.vault) { const del = document.createElement('i'); del.textContent = '×'; del.title = '移除'; del.onclick = e => { e.stopPropagation(); S.sigs = S.sigs.filter(q => q !== s); if (S.armed === s) S.armed = null; renderSigs(); }; b.append(del); }
    b.onclick = () => arm(s);
    b.ondragstart = e => { S.dragSig = s; e.dataTransfer.setData('text/plain', 'sig'); e.dataTransfer.effectAllowed = 'copy'; };
    b.oncontextmenu = e => { if (s.vault) e.preventDefault(); };
    box.append(b);
  });
}
function arm(s) {
  if (!S.pages.length) { toast('先上傳文件，才能放簽名喔'); guide('先給我一份文件嘛～左邊第 1 步！', 'confused'); return; }
  S.armed = S.armed === s ? null : s; document.body.classList.toggle('placing', !!S.armed); renderSigs();
  if (S.armed) { sheet(false); if (MOBILE.matches) toast('👉 點文件上要簽的位置', 2200); }
  if (S.armed) guide(`拿好「${s.label}」了！在文件上點一下要簽的位置 👉`, 'go');
}
function resetShareSigs() {
  S.sigs = [
    { id: 'szh', label: '範例中文簽名', sample: true, cv: sampleSig('王小明', `italic 600 120px "DFKai-SB","BiauKai","KaiTi","Kaiti TC","STKaiti",${FONT}`, -0.06) },
    { id: 'sen', label: '範例英文簽名', sample: true, cv: sampleSig('Sample Sign', 'italic 96px "Segoe Script","Brush Script MT","Snell Roundhand","Apple Chancery",cursive', -0.05) },
  ];
  renderSigs();
}

/* ---------- 文件載入 ---------- */
async function openDoc(file) {
  const name = file.name, ext = name.split('.').pop().toLowerCase();
  if (ext === 'doc') { toast('舊版 .doc 不支援，請先另存為 .docx 或 PDF'); guide('舊版 .doc 我看不懂…請另存成 .docx 或 PDF 再給我 🙏', 'cry'); return; }
  busy(true, '阿拉蕾正在翻開文件…'); await nextFrame();
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let sha = ''; try { sha = hex(await crypto.subtle.digest('SHA-256', bytes)); } catch (e) {}
    let kind, pages;
    if (ext === 'pdf' || file.type === 'application/pdf') { kind = 'pdf'; pages = await loadPdf(bytes); }
    else if (ext === 'docx') { kind = 'docx'; pages = await loadDocx(bytes); }
    else if (file.type.startsWith('image/')) { kind = 'image'; pages = await loadImg(file); }
    else throw new Error('不支援的檔案格式');
    clearDoc(); S.doc = { name, kind, bytes, sha }; S.pages = pages; renderPages();
    $('docInfo').hidden = false; $('docInfo').textContent = `📎 ${name}｜${pages.length} 頁` + (sha ? `｜指紋 ${sha.slice(0, 8)}` : '');
    $('btnPdf').disabled = $('btnPng').disabled = $('mPdf').disabled = $('mPng').disabled = false; sheet(false);
    guide(kind === 'docx' ? 'Word 開好了！版面是我盡力還原的，若要 100% 原樣，建議先在 Word 另存 PDF。接著選個簽名吧～' : '文件開好了！從左邊第 2 步挑一個簽名，再點文件上的位置。', 'explain');
  } catch (e) { console.error(e); toast('開啟失敗：' + e.message, 5000); guide('嗚…這份文件我打不開：' + e.message, 'cry'); }
  finally { busy(false); }
}
async function loadPdf(bytes) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
  const pdf = await pdfjsLib.getDocument({ data: bytes.slice(), cMapUrl: 'vendor/cmaps/', cMapPacked: true }).promise, out = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const pg = await pdf.getPage(i), v1 = pg.getViewport({ scale: 1 });
    const vp = pg.getViewport({ scale: Math.min(3, Math.max(1.5, (MOBILE.matches ? 1200 : 1600) / v1.width)) }), cv = mkCanvas(vp.width, vp.height);
    await pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
    out.push({ cv, wPt: v1.width, hPt: v1.height });
  }
  return out;
}
async function loadImg(file) {
  const img = await fileToImage(file), cv = mkCanvas(img.naturalWidth, img.naturalHeight), x = cv.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, cv.width, cv.height); x.drawImage(img, 0, 0);
  return [{ cv, wPt: 595.28, hPt: 595.28 * cv.height / cv.width }];
}
async function loadDocx(bytes) {
  const host = $('docxHost'); host.innerHTML = '';
  await docx.renderAsync(bytes, host, null, { inWrapper: false, breakPages: true, ignoreLastRenderedPageBreak: false, experimental: true, useBase64URL: true });
  const out = [];
  for (const sec of host.querySelectorAll('section.docx')) {
    const wPx = sec.offsetWidth, pageH = parseFloat(getComputedStyle(sec).minHeight) || wPx * 1.4142;
    const cv = await html2canvas(sec, { scale: 2, backgroundColor: '#ffffff', logging: false, useCORS: false });
    const k = cv.width / wPx, ph = pageH * k, x = cv.getContext('2d', { willReadFrequently: true });
    let y = 0;
    while (y < cv.height - 4) {                       // 過長的節依頁高切開，盡量切在空白列
      let cut = Math.min(cv.height, y + ph);
      if (cut < cv.height) for (let t = 0; t < ph * 0.08; t++) {
        const row = x.getImageData(0, Math.round(cut - t), cv.width, 1).data; let blank = true;
        for (let i = 0; i < row.length; i += 16) if (row[i] < 245 || row[i + 1] < 245 || row[i + 2] < 245) { blank = false; break; }
        if (blank) { cut = Math.round(cut - t); break; }
      }
      const pc = mkCanvas(cv.width, ph), px = pc.getContext('2d'); px.fillStyle = '#fff'; px.fillRect(0, 0, pc.width, pc.height);
      px.drawImage(cv, 0, y, cv.width, cut - y, 0, 0, cv.width, cut - y);
      out.push({ cv: pc, wPt: wPx * 0.75, hPt: pageH * 0.75 }); y = cut;
    }
  }
  host.innerHTML = '';
  if (!out.length) throw new Error('Word 內容是空的');
  return out;
}
function clearDoc() { S.items = []; S.pages = []; S.selected = null; $('pages').innerHTML = ''; }
function renderPages() {
  const box = $('pages'); box.innerHTML = ''; $('empty').hidden = true;
  S.pages.forEach((p, i) => {
    const wrap = document.createElement('div'); wrap.className = 'page'; wrap.dataset.i = i; wrap.style.aspectRatio = `${p.cv.width} / ${p.cv.height}`;
    const tag = document.createElement('span'); tag.className = 'pno'; tag.textContent = `第 ${i + 1} / ${S.pages.length} 頁`;
    wrap.append(p.cv, tag); p.el = wrap; box.append(wrap);
    wrap.addEventListener('click', e => { if (e.target.closest('.item')) return; if (S.armed) placeAt(S.armed, i, e); else select(null); });
    wrap.addEventListener('dragover', e => { if (S.dragSig) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
    wrap.addEventListener('drop', e => { if (S.dragSig) { e.preventDefault(); placeAt(S.dragSig, i, e); S.dragSig = null; } });
  });
}

/* ---------- 放置／拖曳／縮放 ---------- */
function placeAt(sig, pi, ev) {
  const r = S.pages[pi].el.getBoundingClientRect();
  let cv = sig.cv;
  if (sig.stampLike !== true && $('optBind').checked) {
    const who = $('fName').value.trim(); cv = withCaption(sig.cv, `${who ? who + ' ' : ''}簽署 ${stamp()}` + (S.doc.sha ? ` · DOC ${S.doc.sha.slice(0, 8)}` : ''));
  }
  addItem(cv, pi, (ev.clientX - r.left) / r.width, (ev.clientY - r.top) / r.height, sig.defW || 0.22, !!sig.vault, sig.label);
  if (sig.once) { S.armed = null; document.body.classList.remove('placing'); }
  guide('放好了！可以拖曳移動、拉右下角縮放、按 × 刪除。同一個簽名可以繼續點別處再簽，滿意後到第 4 步匯出 🎉', 'ok');
}
function addItem(cv, pi, cx, cy, w, vault, label) {
  const p = S.pages[pi], ar = cv.height / cv.width, hf = w * ar * p.cv.width / p.cv.height;
  const it = { id: ++S.seq, page: pi, x: cx - w / 2, y: cy - hf / 2, w, ar, cv, vault, label };
  const el = document.createElement('div'); el.className = 'item'; el.tabIndex = 0;
  const img = document.createElement('img'); img.src = cv.toDataURL(); img.draggable = false; img.alt = label;
  const del = document.createElement('button'); del.className = 'del'; del.textContent = '×'; del.title = '刪除';
  const hd = document.createElement('span'); hd.className = 'handle';
  el.append(img, del, hd); it.el = el; S.items.push(it); layout(it); select(it);
  del.onclick = e => { e.stopPropagation(); removeItem(it); };
  el.oncontextmenu = e => e.preventDefault();
  el.addEventListener('pointerdown', e => {
    if (e.target === del) return; e.preventDefault(); select(it); el.setPointerCapture(e.pointerId);
    const resize = e.target === hd, r = S.pages[it.page].el.getBoundingClientRect(), sx = e.clientX, sy = e.clientY, o = { x: it.x, y: it.y, w: it.w };
    const move = m => {
      const dx = (m.clientX - sx) / r.width, dy = (m.clientY - sy) / r.height;
      if (resize) it.w = Math.max(0.03, Math.min(1.2, o.w + dx)); else { it.x = o.x + dx; it.y = o.y + dy; }
      layout(it, true);
    };
    const up = u => {
      el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
      if (!resize) {                                   // 拖到別頁 → 換頁
        const t = S.pages.findIndex(q => { const b = q.el.getBoundingClientRect(); return u.clientY >= b.top && u.clientY <= b.bottom && u.clientX >= b.left && u.clientX <= b.right; });
        if (t >= 0 && t !== it.page) {
          const a = el.getBoundingClientRect(), b = S.pages[t].el.getBoundingClientRect();
          it.page = t; it.w = a.width / b.width; it.x = (a.left - b.left) / b.width; it.y = (a.top - b.top) / b.height;
        }
      }
      layout(it);
    };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  });
}
function layout(it, soft) {
  const p = S.pages[it.page], hf = it.w * it.ar * p.cv.width / p.cv.height;
  if (!soft) { it.x = Math.max(-it.w / 2, Math.min(1 - it.w / 2, it.x)); it.y = Math.max(-hf / 2, Math.min(1 - hf / 2, it.y)); }
  if (it.el.parentNode !== p.el) p.el.append(it.el);
  Object.assign(it.el.style, { left: it.x * 100 + '%', top: it.y * 100 + '%', width: it.w * 100 + '%', height: hf * 100 + '%' });
}
function select(it) { S.selected = it; S.items.forEach(q => q.el.classList.toggle('sel', q === it)); }
function removeItem(it) { it.el.remove(); S.items = S.items.filter(q => q !== it); if (S.selected === it) S.selected = null; }
document.addEventListener('keydown', e => {
  const it = S.selected; if (!it || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
  if (e.key === 'Escape' && S.armed) { S.armed = null; document.body.classList.remove('placing'); renderSigs(); return; }
  if (e.key === 'Delete' || e.key === 'Backspace') { removeItem(it); e.preventDefault(); return; }
  const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
  if (d) { const s = e.shiftKey ? 0.01 : 0.002; it.x += d[0] * s; it.y += d[1] * s; layout(it); e.preventDefault(); }
});

/* ---------- 資訊章 ---------- */
function infoLines(dateOnly) {
  const d = $('fDate').value || stamp().slice(0, 10);
  if (dateOnly) return [d];
  const L = []; const n = $('fName').value.trim(), t = $('fTitle').value.trim(), o = $('fNote').value.trim();
  if (n) L.push('簽核人：' + n); if (t) L.push('職　稱：' + t); L.push('日　期：' + d); if (o) L.push('事　由：' + o);
  return L;
}
function armStamp(dateOnly) {
  const cv = textStamp(infoLines(dateOnly), { color: $('fColor').value, border: !dateOnly && $('fBorder').checked });
  arm({ label: dateOnly ? '日期' : '資訊章', cv, stampLike: true, once: true, defW: dateOnly ? 0.16 : 0.3 });
}

/* ---------- 匯出 ---------- */
function composite(pi) {
  const p = S.pages[pi], c = mkCanvas(p.cv.width, p.cv.height), x = c.getContext('2d'); x.drawImage(p.cv, 0, 0);
  x.imageSmoothingQuality = 'high';
  S.items.filter(i => i.page === pi).forEach(i => x.drawImage(i.cv, i.x * c.width, i.y * c.height, i.w * c.width, i.w * c.width * i.ar));
  return c;
}
function auditCanvas() {
  const c = mkCanvas(1240, 1754), x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
  x.fillStyle = '#14213d'; x.font = `700 46px ${FONT}`; x.fillText('簽核紀錄 Signing Record', 90, 150);
  x.fillRect(90, 180, 1060, 4); x.font = `400 27px ${FONT}`;
  const rows = [['文件名稱', S.doc.name], ['原始檔 SHA-256', S.doc.sha.slice(0, 32)], ['', S.doc.sha.slice(32)], ['簽核人', $('fName').value.trim() || '（未填）'],
    ['職稱／角色', $('fTitle').value.trim() || '—'], ['事由／意見', $('fNote').value.trim() || '—'], ['簽核時間', stamp() + '（本機時間）'], ['總頁數', String(S.pages.length)], ['簽核標記', `共 ${S.items.length} 處`]];
  let y = 260; rows.forEach(([k, v]) => { x.fillStyle = '#5b6478'; x.fillText(k, 90, y); x.fillStyle = '#14213d'; x.fillText(v, 360, y); y += 54; });
  y += 20; S.items.forEach((i, n) => { if (y > 1620) return; x.fillStyle = '#14213d'; x.fillText(`${n + 1}. 第 ${i.page + 1} 頁「${i.label}」 位置 (${(i.x * 100).toFixed(1)}%, ${(i.y * 100).toFixed(1)}%)`, 90, y); y += 44; });
  x.fillStyle = '#8a93a6'; x.font = `400 22px ${FONT}`; x.fillText('本頁由「Allan & 阿拉蕾 文件簽核工坊」於瀏覽器本機產生；簽名為影像簽核，非數位憑證簽章。', 90, 1690);
  return c;
}
const outName = ext => S.doc.name.replace(/\.[^.]+$/, '') + '_signed.' + ext;
async function exportPdf() {
  const { PDFDocument, degrees } = PDFLib; let pdf = null, native = false;
  if (S.doc.kind === 'pdf') try { pdf = await PDFDocument.load(S.doc.bytes); native = pdf.getPageCount() === S.pages.length; } catch (e) { console.warn('改用影像模式', e); }
  if (!native) {
    pdf = await PDFDocument.create();
    for (let i = 0; i < S.pages.length; i++) {
      const p = S.pages[i], jpg = await pdf.embedJpg(await toBytes(p.cv, 'image/jpeg', 0.93));
      pdf.addPage([p.wPt, p.hPt]).drawImage(jpg, { x: 0, y: 0, width: p.wPt, height: p.hPt });
    }
  }
  const cache = new Map(), pages = pdf.getPages();
  for (const it of S.items) {
    if (!cache.has(it.cv)) cache.set(it.cv, await pdf.embedPng(await toBytes(it.cv)));
    const pg = pages[it.page], cb = pg.getCropBox(), pw = cb.width, ph = cb.height, rot = ((pg.getRotation().angle % 360) + 360) % 360;
    const src = S.pages[it.page].cv, u = it.x, v = it.y, wf = it.w, hf = it.w * it.ar * src.width / src.height; let o;
    if (rot === 90) o = { x: cb.x + (v + hf) * pw, y: cb.y + u * ph, width: wf * ph, height: hf * pw };
    else if (rot === 180) o = { x: cb.x + (1 - u) * pw, y: cb.y + (v + hf) * ph, width: wf * pw, height: hf * ph };
    else if (rot === 270) o = { x: cb.x + (1 - v - hf) * pw, y: cb.y + (1 - u) * ph, width: wf * ph, height: hf * pw };
    else o = { x: cb.x + u * pw, y: cb.y + (1 - v - hf) * ph, width: wf * pw, height: hf * ph };
    pg.drawImage(cache.get(it.cv), { ...o, rotate: degrees(rot) });
  }
  if ($('optAudit').checked) { const a = await pdf.embedPng(await toBytes(auditCanvas())); pdf.addPage([595.28, 841.89]).drawImage(a, { x: 0, y: 0, width: 595.28, height: 841.89 }); }
  const who = $('fName').value.trim();
  if (who) pdf.setAuthor(who);
  pdf.setSubject(`Signed ${stamp()}` + (who ? ` by ${who}` : '')); pdf.setKeywords(['signed', 'source-sha256:' + S.doc.sha]);
  pdf.setProducer('Allan & ARALE Sign Studio'); pdf.setModificationDate(new Date());
  download(await pdf.save(), outName('pdf'), 'application/pdf');
}
async function exportPng() {
  const cvs = S.pages.map((_, i) => composite(i)); if ($('optAudit').checked) cvs.push(auditCanvas());
  if (cvs.length === 1) return download(await toBytes(cvs[0]), outName('png'), 'image/png');
  const zip = new JSZip(), base = S.doc.name.replace(/\.[^.]+$/, '');
  for (let i = 0; i < cvs.length; i++) zip.file(`${base}_signed_p${pad2(i + 1)}.png`, await toBytes(cvs[i]));
  download(await zip.generateAsync({ type: 'uint8array' }), base + '_signed_png.zip', 'application/zip');
}
async function runExport(fn, what) {
  if (!S.items.length && !confirm('文件上還沒有任何簽名，確定要直接匯出嗎？')) return;
  select(null); busy(true, `阿拉蕾正在裝訂${what}…`); await nextFrame();
  try { await fn(); guide(`${what}完成，已經下載囉！記得打開檢查一下簽名位置 ✅`, 'happy'); }
  catch (e) { console.error(e); toast('匯出失敗：' + e.message, 5000); guide('匯出失敗了…' + e.message, 'cry'); }
  finally { busy(false); }
}

/* ---------- 手寫板 ---------- */
(function pad() {
  const c = $('pad'), x = c.getContext('2d'); let on = false, last = null, dirty = false;
  const pt = e => { const r = c.getBoundingClientRect(); return { x: (e.clientX - r.left) * c.width / r.width, y: (e.clientY - r.top) * c.height / r.height }; };
  const clear = () => { x.clearRect(0, 0, c.width, c.height); dirty = false; };
  c.addEventListener('pointerdown', e => { on = true; last = pt(e); c.setPointerCapture(e.pointerId); e.preventDefault(); });
  c.addEventListener('pointermove', e => {
    if (!on) return; const p = pt(e); x.strokeStyle = '#14213d'; x.lineCap = x.lineJoin = 'round';
    x.lineWidth = 5 + 5 * (e.pressure && e.pressure !== 0.5 ? e.pressure : 0.5);
    x.beginPath(); x.moveTo(last.x, last.y); x.lineTo(p.x, p.y); x.stroke(); last = p; dirty = true;
  });
  ['pointerup', 'pointercancel'].forEach(t => c.addEventListener(t, () => on = false));
  $('btnDraw').onclick = () => { clear(); $('dlgDraw').showModal(); };
  $('padClear').onclick = clear; $('padCancel').onclick = () => $('dlgDraw').close();
  $('padOk').onclick = () => {
    if (!dirty) return toast('先簽個名嘛～');
    const s = { id: 'u' + Date.now(), label: '我的手寫簽名', cv: cleanSignature(c) }; S.sigs.push(s); $('dlgDraw').close(); renderSigs(); if (S.pages.length) arm(s);
  };
})();

/* ---------- Allan 專屬模式 ---------- */
let found = null, fails = 0, lockUntil = 0, idleT;
const lockFace = (f, msg) => { $('lockImg').src = `assets/chars/allan-${f}.jpg`; if (msg) $('lockMsg').textContent = msg; };
async function showLock() {
  if (S.allan) return lockNow('已上鎖，簽名已從記憶體清除');
  if (!window.isSecureContext || !crypto.subtle) return toast('需要 HTTPS 或 localhost 才能使用加密功能', 5000);
  found = await Vault.locate(); $('lockPass').value = '';
  $('vaultState').textContent = found ? `已找到保險箱（來源：${found.from === 'device' ? '此瀏覽器' : '網站 vault/ 目錄'}）` : '尚未找到保險箱。第一次使用請按「建立保險箱」，或載入先前下載的保險箱檔。';
  lockFace('point', found ? '請輸入通關密語，解開簽名保險箱。' : '這台裝置還沒有保險箱，請先在下方「保險箱管理」建立或載入。');
  $('dlgLock').showModal(); $('lockPass').focus();
}
async function tryUnlock() {
  if (!found) return lockFace('confused', '還沒有保險箱可以解鎖，請先建立或載入。');
  const wait = lockUntil - Date.now(); if (wait > 0) return lockFace('think', `請等 ${Math.ceil(wait / 1000)} 秒再試。`);
  const pass = $('lockPass').value; if (!pass) return;
  $('lockGo').disabled = true; lockFace('think', '驗證中…');
  try { const data = await Vault.open(found.vault, pass); fails = 0; $('lockPass').value = ''; $('dlgLock').close(); await enterAllan(data); }
  catch (e) { fails++; lockUntil = Date.now() + Math.min(60, 2 ** fails) * 1000; lockFace('confused', `密語不對喔（第 ${fails} 次）。${Math.min(60, 2 ** fails)} 秒後可再試。`); }
  finally { $('lockGo').disabled = false; }
}
async function enterAllan(data) {
  const sigs = []; for (const s of data.sigs) { const im = await loadImage(s.png), cv = mkCanvas(im.naturalWidth, im.naturalHeight); cv.getContext('2d').drawImage(im, 0, 0); sigs.push({ id: s.id, label: s.label, cv, vault: true }); }
  S.allan = { name: data.owner }; S.sigs = sigs; S.armed = null; renderSigs();
  document.body.classList.add('allan'); $('modeBadge').textContent = '👑 Allan 專屬模式'; $('modeBadge').className = 'badge allan'; $('btnLock').textContent = '🔒 立即上鎖';
  $('fName').value = data.owner || ''; $('fTitle').value = data.title || ''; $('optBind').checked = true;
  guide(`歡迎回來，${data.owner}！你的簽名已解鎖（只存在記憶體，閒置 10 分鐘自動上鎖）。`, 'happy'); armIdle();
}
function lockNow(msg) {
  if (!S.allan) return; clearTimeout(idleT);
  S.items.filter(i => i.vault).forEach(removeItem);                 // 尚未匯出的 Allan 簽名一併清除
  S.sigs.forEach(s => { if (s.vault) { s.cv.width = s.cv.height = 1; } });
  S.allan = null; S.armed = null; document.body.classList.remove('allan', 'placing');
  $('modeBadge').textContent = '🌈 分享模式'; $('modeBadge').className = 'badge share'; $('btnLock').textContent = '🔐 Allan 專屬';
  $('fName').value = $('fTitle').value = ''; $('optBind').checked = false; resetShareSigs();
  toast('🔒 ' + msg); guide('Allan 的簽名已經鎖回保險箱了。現在是分享模式～', 'ok');
}
function armIdle() { clearTimeout(idleT); if (S.allan) idleT = setTimeout(() => lockNow('閒置 10 分鐘，已自動上鎖'), IDLE_MS); }
['pointerdown', 'keydown'].forEach(t => document.addEventListener(t, armIdle, true));

async function buildVault() {
  const msg = m => $('bMsg').textContent = m, zh = $('bZh').files[0], en = $('bEn').files[0], p1 = $('bP1').value;
  if (!zh && !en) return msg('請至少選一張簽名圖。');
  if (p1.length < 12) return msg('通關密語至少 12 個字元，建議用一句只有你知道的話。');
  if (p1 !== $('bP2').value) return msg('兩次輸入的密語不一致。');
  $('bGo').disabled = true; msg('加密中…');
  try {
    const sigs = [];
    if (zh) sigs.push({ id: 'zh', label: '中文簽名', png: cleanSignature(await fileToImage(zh)).toDataURL('image/png') });
    if (en) sigs.push({ id: 'en', label: '英文簽名', png: cleanSignature(await fileToImage(en)).toDataURL('image/png') });
    const data = { owner: $('bName').value.trim() || 'Allan Lo', title: $('bTitle').value.trim(), created: new Date().toISOString(), sigs };
    const vault = await Vault.seal(data, p1);
    await Vault.open(vault, p1);                                    // 回讀驗證
    if ($('bRemember').checked) Vault.remember(vault);
    download(new TextEncoder().encode(JSON.stringify(vault)), 'allan.vault.json', 'application/json');
    ['bP1', 'bP2', 'bZh', 'bEn'].forEach(i => $(i).value = ''); msg(''); $('dlgBuild').close(); $('dlgLock').close();
    found = { vault, from: 'device' }; await enterAllan(data); toast('保險箱已建立並下載備份，請妥善保存 allan.vault.json', 6000);
  } catch (e) { console.error(e); msg('失敗：' + e.message); } finally { $('bGo').disabled = false; }
}

/* ---------- 事件繫結 ---------- */
$('fileDoc').onchange = e => { if (e.target.files[0]) openDoc(e.target.files[0]); e.target.value = ''; };
const drop = $('drop');
['dragenter', 'dragover'].forEach(t => document.addEventListener(t, e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); drop.classList.add('over'); } }));
['dragleave', 'drop'].forEach(t => document.addEventListener(t, () => drop.classList.remove('over')));
document.addEventListener('drop', e => { if (e.dataTransfer.files.length) { e.preventDefault(); openDoc(e.dataTransfer.files[0]); } });
$('fileSig').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try { const s = { id: 'u' + Date.now(), label: f.name.replace(/\.[^.]+$/, '').slice(0, 14) || '我的簽名', cv: cleanSignature(await fileToImage(f)) }; S.sigs.push(s); renderSigs(); guide('簽名收到！我已經幫你去掉白底了。點它再點文件就能簽囉～', 'ok'); if (S.pages.length) arm(s); }
  catch (err) { toast(err.message); }
};
$('btnInfo').onclick = () => armStamp(false); $('btnDate').onclick = () => armStamp(true);
$('btnPdf').onclick = () => runExport(exportPdf, ' PDF '); $('btnPng').onclick = () => runExport(exportPng, '圖檔');
$('btnLock').onclick = showLock; $('lockGo').onclick = tryUnlock; $('lockCancel').onclick = () => $('dlgLock').close();
$('lockPass').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); tryUnlock(); } });
$('btnBuild').onclick = () => { $('bMsg').textContent = ''; $('dlgBuild').showModal(); }; $('bCancel').onclick = () => $('dlgBuild').close(); $('bGo').onclick = buildVault;
$('btnForget').onclick = () => { if (confirm('確定清除此瀏覽器記住的加密保險箱？（不影響你另存的保險箱檔）')) { Vault.forget(); found = null; $('vaultState').textContent = '已清除。'; } };
$('fileVault').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try { const v = JSON.parse(await f.text()); if (v.format !== 'allan-sign-vault') throw 0; found = { vault: v, from: 'device' }; Vault.remember(v); $('vaultState').textContent = '保險箱檔已載入，請輸入通關密語。'; lockFace('point', '保險箱檔已載入，請輸入通關密語。'); }
  catch (err) { $('vaultState').textContent = '這不是有效的保險箱檔。'; }
};
$('btnShare').onclick = async () => {
  const url = location.origin + location.pathname;
  try { await navigator.clipboard.writeText(url); toast('已複製分享連結！對方看到的是分享模式，拿不到 Allan 的簽名 👍'); } catch (e) { prompt('複製這個連結分享：', url); }
};
window.addEventListener('beforeunload', e => { if (S.items.length) { e.preventDefault(); e.returnValue = ''; } });
$('mTools').onclick = () => sheet(!document.body.classList.contains('sheet'));
$('mPdf').onclick = () => $('btnPdf').click(); $('mPng').onclick = () => $('btnPng').click();
$('stage').addEventListener('pointerdown', () => { if (MOBILE.matches) sheet(false); });
sheet(MOBILE.matches);
$('fDate').value = stamp().slice(0, 10);
resetShareSigs();
if (location.hash === '#allan') showLock();
