'use strict';

const COLS = 5, ROWS = 3, CELLS = COLS * ROWS;

let cfg = null;
let editing = false;
let currentPage = 0;
let editIndex = -1;
let draft = null;

const grid = document.getElementById('grid');
const pagerail = document.getElementById('pagerail');

function emptyPage() { return Array.from({ length: CELLS }, () => null); }
function curButtons() { return cfg.pages[currentPage]; }

// ================= 音效 =================
const sndPress = new Audio('../assets/press.mp3');
const sndRelease = new Audio('../assets/release.mp3');
[sndPress, sndRelease].forEach((a) => { a.preload = 'auto'; a.volume = 0.8; });
function playDown() { try { sndPress.currentTime = 0; sndPress.play(); } catch {} }
function playUp() { try { sndRelease.currentTime = 0; sndRelease.play(); } catch {} }

// ================= 图标像素化 =================
function pixelateInto(canvas, srcDataUrl, pixelSize) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      canvas.width = pixelSize; canvas.height = pixelSize;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.clearRect(0, 0, pixelSize, pixelSize);
      ctx.imageSmoothingEnabled = false;
      const pad = 1, box = pixelSize - pad * 2;
      const scale = Math.min(box / img.width, box / img.height);
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      ctx.drawImage(img, Math.floor((pixelSize - w) / 2), Math.floor((pixelSize - h) / 2), w, h);
      try {
        const id = ctx.getImageData(0, 0, pixelSize, pixelSize);
        const d = id.data;
        for (let i = 0; i < d.length; i += 4) d[i + 3] = d[i + 3] >= 110 ? 255 : 0;
        ctx.putImageData(id, 0, 0);
      } catch {}
      resolve(true);
    };
    img.onerror = () => resolve(false);
    img.src = srcDataUrl;
  });
}
function drawDefaultIcon(canvas, type, pixelSize) {
  canvas.width = pixelSize; canvas.height = pixelSize;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false; ctx.clearRect(0, 0, pixelSize, pixelSize);
  const c = pixelSize / 2;
  if (type === 'url') {
    ctx.fillStyle = '#3aa0ff';
    ctx.beginPath(); ctx.arc(c, c, pixelSize * 0.38, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#06203f'; ctx.lineWidth = Math.max(1, pixelSize * 0.05);
    ctx.beginPath(); ctx.ellipse(c, c, pixelSize * 0.16, pixelSize * 0.38, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(c - pixelSize * 0.38, c); ctx.lineTo(c + pixelSize * 0.38, c); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(c - pixelSize * 0.30, c - pixelSize * 0.18); ctx.lineTo(c + pixelSize * 0.30, c - pixelSize * 0.18); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(c - pixelSize * 0.30, c + pixelSize * 0.18); ctx.lineTo(c + pixelSize * 0.30, c + pixelSize * 0.18); ctx.stroke();
  } else {
    ctx.fillStyle = '#cfd6df';
    const x = pixelSize * 0.28, y = pixelSize * 0.18, w = pixelSize * 0.44, h = pixelSize * 0.64;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#6b7480';
    for (let i = 0; i < 4; i++) ctx.fillRect(x + 2, y + h * 0.25 + i * (h * 0.16), w - 4, Math.max(1, pixelSize * 0.04));
  }
}
async function renderIcon(canvas, btn) {
  const px = cfg.pixelSize;
  if (btn.icon) { if (await pixelateInto(canvas, btn.icon, px)) return; }
  if (btn.type === 'app' || btn.type === 'file') {
    const dataUrl = await window.deck.iconForPath(btn.target);
    if (dataUrl && await pixelateInto(canvas, dataUrl, px)) return;
    drawDefaultIcon(canvas, 'file', px); return;
  }
  drawDefaultIcon(canvas, 'url', px);
}

// ================= 组件（活信息按键）=================
const widgetView = {};          // 运行时视图索引 key=`page:idx`
let widgetCanvases = [];
let sysData = { cpu: 0, mem: 0, memUsedGB: 0, memTotalGB: 0, netDownText: '0B/s', netUpText: '0B/s' };
let weatherData = null, weatherFetchedAt = 0, wxFetching = false;

function widgetViews(btn) { return btn.widget === 'clock' ? 2 : (btn.widget === 'weather' ? 2 : (btn.widget === 'system' ? 2 : 1)); }
function widgetName(w) { return w === 'clock' ? '时钟' : w === 'system' ? '系统' : w === 'weather' ? '天气' : '组件'; }

function drawWidget(cv, btn, i) {
  const S = 100; cv.width = S; cv.height = S;
  const x = cv.getContext('2d'); x.imageSmoothingEnabled = false; x.clearRect(0, 0, S, S);
  const view = widgetView[currentPage + ':' + i] || 0;
  if (btn.widget === 'clock') drawClock(x, S, view);
  else if (btn.widget === 'system') drawSystemW(x, S, view);
  else if (btn.widget === 'weather') drawWeatherW(x, S, view);
}
function drawClock(x, S, view) {
  const d = new Date(); x.textAlign = 'center'; x.fillStyle = '#62ff9a';
  if (view === 0) {
    const hh = String(d.getHours()).padStart(2, '0'), mm = String(d.getMinutes()).padStart(2, '0');
    x.textBaseline = 'middle'; x.font = '15px PixHead, monospace';
    x.fillText(hh + ':' + mm, S / 2, S / 2 - 8);
    x.font = '9px PixHead, monospace'; x.fillStyle = '#2fae66';
    x.fillText(String(d.getSeconds()).padStart(2, '0'), S / 2, S / 2 + 16);
  } else {
    const wd = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
    x.textBaseline = 'middle'; x.font = '15px PixHead, monospace';
    x.fillText(String(d.getMonth() + 1).padStart(2, '0') + '/' + String(d.getDate()).padStart(2, '0'), S / 2, S / 2 - 8);
    x.font = '13px Pix, monospace'; x.fillStyle = '#7fd8a0';
    x.fillText(wd, S / 2, S / 2 + 18);
  }
}
function bar(x, label, pct, y, S) {
  x.textAlign = 'left'; x.textBaseline = 'alphabetic';
  x.fillStyle = '#7fd8a0'; x.font = '10px PixHead, monospace';
  x.fillText(label, 8, y - 3);
  x.textAlign = 'right'; x.fillText(pct + '%', S - 8, y - 3); x.textAlign = 'left';
  const bx = 8, bw = S - 16, bh = 9;
  x.fillStyle = '#0a2016'; x.fillRect(bx, y, bw, bh);
  x.fillStyle = pct > 85 ? '#ff6a6a' : (pct > 60 ? '#ffcf4d' : '#62ff9a');
  x.fillRect(bx, y, Math.round(bw * pct / 100), bh);
  x.strokeStyle = '#063'; x.strokeRect(bx + .5, y + .5, bw - 1, bh - 1);
}
function drawSystemW(x, S, view) {
  if (view === 0) {
    bar(x, 'CPU', sysData.cpu, 26, S);
    bar(x, 'MEM', sysData.mem, 64, S);
    return;
  }
  drawNetRow(x, '下', sysData.netDownText, 38, S);
  x.strokeStyle = '#063';
  x.beginPath(); x.moveTo(10.5, 53.5); x.lineTo(S - 10.5, 53.5); x.stroke();
  drawNetRow(x, '上', sysData.netUpText, 70, S);
}
function drawNetRow(x, label, value, y, S) {
  const speed = String(value || '0B/s').replace(/^\+/, '');
  x.textBaseline = 'middle';
  x.textAlign = 'left';
  x.fillStyle = '#2fae66';
  x.font = '11px Pix, monospace';
  x.fillText(label, 10, y);

  x.textAlign = 'right';
  x.fillStyle = '#62ff9a';
  let size = 12;
  do {
    x.font = size + 'px PixLatin, PixHead, monospace';
    if (x.measureText(speed).width <= S - 30 || size <= 8) break;
    size -= 1;
  } while (true);
  x.fillText(speed, S - 8, y);
}
function wxCat(code) {
  if (code === 113) return 'sun';
  if ([116, 119, 122].includes(code)) return 'cloud';
  if ([143, 248, 260].includes(code)) return 'fog';
  if ([200, 386, 389, 392, 395].includes(code)) return 'storm';
  if ([179, 227, 230, 320, 323, 326, 329, 332, 335, 338, 350, 368, 371, 374, 377].includes(code)) return 'snow';
  return 'rain';
}
function cloud(x, cx, cy, col) { x.fillStyle = col; x.beginPath(); x.arc(cx - 8, cy + 2, 7, 0, 7); x.arc(cx, cy - 3, 9, 0, 7); x.arc(cx + 9, cy + 2, 7, 0, 7); x.fill(); x.fillRect(cx - 15, cy + 1, 30, 8); }
function drawWxGlyph(x, cx, cy, cat) {
  if (cat === 'sun') { x.fillStyle = '#ffcf4d'; x.beginPath(); x.arc(cx, cy, 11, 0, 7); x.fill(); x.strokeStyle = '#ffcf4d'; x.lineWidth = 2; for (let a = 0; a < 8; a++) { const an = a * Math.PI / 4; x.beginPath(); x.moveTo(cx + Math.cos(an) * 14, cy + Math.sin(an) * 14); x.lineTo(cx + Math.cos(an) * 19, cy + Math.sin(an) * 19); x.stroke(); } }
  else if (cat === 'cloud' || cat === 'fog') cloud(x, cx, cy, '#cfd6df');
  else if (cat === 'rain') { cloud(x, cx, cy, '#9fb0c0'); x.strokeStyle = '#5aa9ff'; x.lineWidth = 2; for (let k = -1; k <= 1; k++) { x.beginPath(); x.moveTo(cx + k * 8, cy + 10); x.lineTo(cx + k * 8 - 3, cy + 17); x.stroke(); } }
  else if (cat === 'snow') { cloud(x, cx, cy, '#cfe'); x.fillStyle = '#fff'; for (let k = -1; k <= 1; k++) x.fillRect(cx + k * 8 - 1, cy + 12, 2, 2); }
  else if (cat === 'storm') { cloud(x, cx, cy, '#9aa'); x.fillStyle = '#ffcf4d'; x.beginPath(); x.moveTo(cx, cy + 8); x.lineTo(cx - 5, cy + 17); x.lineTo(cx, cy + 17); x.lineTo(cx - 3, cy + 25); x.lineTo(cx + 6, cy + 13); x.lineTo(cx, cy + 13); x.closePath(); x.fill(); }
  else cloud(x, cx, cy, '#bcc');
}
function fitText(x, text, cx, y, maxWidth) {
  let s = String(text || '');
  while (s.length > 1 && x.measureText(s).width > maxWidth) s = s.slice(0, -1);
  if (s !== String(text || '')) s = s.slice(0, Math.max(1, s.length - 1)) + '…';
  x.fillText(s, cx, y);
}
function drawWeatherW(x, S, view) {
  x.textAlign = 'center'; x.textBaseline = 'middle';
  if (!weatherData) { x.fillStyle = '#2fae66'; x.font = '11px Pix, monospace'; x.fillText('载入天气…', S / 2, S / 2); return; }
  if (view === 0) {
    drawWxGlyph(x, S / 2, 34, wxCat(weatherData.code));
    x.fillStyle = '#62ff9a'; x.font = '18px PixHead, monospace';
    x.fillText(weatherData.tempC + '°', S / 2, 76);
  } else {
    x.fillStyle = '#7fd8a0'; x.font = '12px Pix, monospace'; fitText(x, weatherData.desc || '天气', S / 2, 28, S - 12);
    x.fillStyle = '#2fae66'; x.font = '11px Pix, monospace';
    x.fillText('湿度 ' + weatherData.humidity + '%', S / 2, 52);
    fitText(x, weatherData.city || '当前位置', S / 2, 72, S - 10);
  }
}
function redrawWidgets() { for (const w of widgetCanvases) drawWidget(w.canvas, w.btn, w.i); }
function tick() {
  if (saver.active) return;
  const btns = curButtons();
  let hasSys = false, hasWx = false;
  for (const b of btns) if (b && b.type === 'widget') { if (b.widget === 'system') hasSys = true; if (b.widget === 'weather') hasWx = true; }
  if (hasSys) window.deck.sysStats().then(d => { if (d) sysData = d; });
  if (hasWx && (!weatherData || performance.now() - weatherFetchedAt > 6e5) && !wxFetching) {
    wxFetching = true;
    window.deck.weather().then(d => { wxFetching = false; if (d) { weatherData = d; weatherFetchedAt = performance.now(); } });
  }
  redrawWidgets();
}
setInterval(tick, 1000);
setInterval(() => {
  if (saver.active) return;
  let changed = false;
  for (const w of widgetCanvases) {
    if (w.btn.widget === 'system') continue;
    const v = widgetViews(w.btn);
    if (v > 1) { const k = currentPage + ':' + w.i; widgetView[k] = ((widgetView[k] || 0) + 1) % v; changed = true; }
  }
  if (changed) redrawWidgets();
}, 7000);

// ================= 分页 + 网格 =================
function renderRail() {
  pagerail.innerHTML = '';
  cfg.pages.forEach((p, idx) => {
    const d = document.createElement('div');
    d.className = 'pdot' + (idx === currentPage ? ' active' : '');
    d.title = '第 ' + (idx + 1) + ' 页（共 ' + cfg.pages.length + ' 页）';
    d.addEventListener('click', () => { currentPage = idx; renderAll(); });
    pagerail.appendChild(d);
  });
}
async function addPage() {
  cfg.pages.push(emptyPage());
  currentPage = cfg.pages.length - 1;
  await persist(); renderAll();
}
async function deletePage() {
  if (cfg.pages.length <= 1) { window.alert('至少保留一页。'); return; }
  const used = curButtons().filter(Boolean).length;
  const msg = '确定删除第 ' + (currentPage + 1) + ' 页？' + (used ? '该页 ' + used + ' 个按钮将一并删除。' : '');
  if (!window.confirm(msg)) return;
  cfg.pages.splice(currentPage, 1);
  currentPage = Math.max(0, currentPage - 1);
  await persist(); renderAll();
}

function renderGrid() {
  grid.innerHTML = '';
  widgetCanvases = [];
  const btns = curButtons();
  for (let i = 0; i < CELLS; i++) {
    const btn = btns[i];
    const key = document.createElement('div');
    key.className = 'key'; key.dataset.idx = i;
    key.title = btn ? (btn.label || btn.target || widgetName(btn.widget)) : '点击或右键绑定';

    const screen = document.createElement('div');
    screen.className = 'screen' + (btn ? '' : ' empty');

    const sweep = document.createElement('div');
    sweep.className = 'scan-sweep'; screen.appendChild(sweep);

    if (btn && btn.type === 'widget') {
      screen.classList.add('widget');
      const cv = document.createElement('canvas'); cv.className = 'wfull';
      screen.appendChild(cv);
      widgetCanvases.push({ i, btn, canvas: cv });
      drawWidget(cv, btn, i);
    } else if (btn) {
      const cv = document.createElement('canvas'); cv.className = 'ico'; screen.appendChild(cv);
      const label = document.createElement('div'); label.className = 'label'; label.textContent = btn.label || '';
      screen.appendChild(label);
      renderIcon(cv, btn);
    } else {
      const label = document.createElement('div'); label.className = 'label'; label.textContent = '未绑定';
      screen.appendChild(label);
    }

    key.appendChild(screen);
    key.addEventListener('mousedown', playDown);
    key.addEventListener('mouseup', playUp);
    key.addEventListener('click', () => onKeyClick(i));
    key.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); openModal(i); });

    key.draggable = editing;
    key.addEventListener('dragstart', (e) => {
      if (!editing) { e.preventDefault(); return; }
      e.dataTransfer.setData('application/x-deck-index', String(i));
      e.dataTransfer.effectAllowed = 'move'; key.classList.add('dragging');
    });
    key.addEventListener('dragend', () => key.classList.remove('dragging'));
    key.addEventListener('dragover', (e) => {
      e.preventDefault();
      const internal = e.dataTransfer.types.includes('application/x-deck-index');
      e.dataTransfer.dropEffect = internal ? 'move' : 'copy'; key.classList.add('dragover');
    });
    key.addEventListener('dragleave', () => key.classList.remove('dragover'));
    key.addEventListener('drop', async (e) => {
      e.preventDefault(); e.stopPropagation(); key.classList.remove('dragover');
      const srcIdx = e.dataTransfer.getData('application/x-deck-index');
      if (srcIdx !== '') {
        const s = parseInt(srcIdx, 10);
        if (!Number.isNaN(s) && s !== i) {
          const b = curButtons(); const tmp = b[i]; b[i] = b[s]; b[s] = tmp;
          await persist(); renderGrid();
        }
        return;
      }
      await handleExternalDrop(e.dataTransfer, i);
    });

    grid.appendChild(key);
  }
}
function renderAll() { renderRail(); renderGrid(); }

async function onKeyClick(i) {
  const btn = curButtons()[i];
  if (editing) { openModal(i); return; }
  if (!btn) { openModal(i); return; }
  if (btn.type === 'widget') {
    const v = widgetViews(btn);
    if (v > 1) { const k = currentPage + ':' + i; widgetView[k] = ((widgetView[k] || 0) + 1) % v; const w = widgetCanvases.find(w => w.i === i); if (w) drawWidget(w.canvas, w.btn, i); }
    return;
  }
  const r = await window.deck.launch(btn);
  if (!r.ok) flashError(grid.children[i]);
}
function flashError(key) {
  const scr = key.querySelector('.screen'); if (!scr) return;
  scr.animate([{ filter: 'none' }, { filter: 'hue-rotate(-60deg) brightness(1.5)' }, { filter: 'none' }], { duration: 320 });
}

// 外部拖入
async function handleExternalDrop(dt, i) {
  if (dt.files && dt.files.length) {
    const p = window.deck.getPathForFile(dt.files[0]);
    if (p) { const resolved = await window.deck.resolveDrop(p); if (resolved) return applyDrop(i, resolved); }
  }
  const uri = (dt.getData('text/uri-list') || dt.getData('text/plain') || '').split('\n')[0].trim();
  if (/^https?:\/\//i.test(uri)) return applyDrop(i, { type: 'url', target: uri, label: uri.replace(/^https?:\/\//, '').split('/')[0] });
}
async function applyDrop(i, b) {
  const btn = { type: b.type, target: b.target, label: (b.label || '').slice(0, 16), icon: null };
  curButtons()[i] = btn; renderGrid();
  if (btn.type === 'url') { const ico = await window.deck.iconForUrl(btn.target); if (ico) btn.icon = ico; }
  else if (btn.type === 'app' || btn.type === 'file') { const ico = await window.deck.iconForPath(btn.target); if (ico) btn.icon = ico; }
  await persist(); renderGrid();
}

// ================= 绑定弹窗 =================
const modal = document.getElementById('modal');
const fTarget = document.getElementById('f-target');
const fLabel = document.getElementById('f-label');
const fIconCanvas = document.getElementById('f-iconcanvas');
const iconPrev = document.querySelector('.iconprev');
let iconFetchToken = 0;
function setIconLoading(on) { iconPrev.classList.toggle('loading', on); }

function openModal(i) {
  editIndex = i;
  const ex = curButtons()[i];
  if (ex && ex.type === 'widget') draft = { type: 'widget', widget: ex.widget || 'clock', label: ex.label || '' };
  else if (ex) draft = { type: ex.type, target: ex.target, label: ex.label, icon: ex.icon || null, custom: !!ex.icon };
  else draft = { type: 'app', target: '', label: '', icon: null, custom: false, widget: 'clock' };

  document.getElementById('modal-idx').textContent = '#' + (i + 1) + ' · P' + (currentPage + 1);
  fTarget.value = draft.target || '';
  fLabel.value = draft.label || '';
  document.querySelectorAll('.wkbtn').forEach(b => b.classList.toggle('active', b.dataset.wk === (draft.widget || 'clock')));
  setSeg(draft.type, false);
  refreshModalIcon();
  modal.classList.remove('hidden');
  if (draft.type !== 'widget') fTarget.focus();
}
function setSeg(type, doAuto = true) {
  draft.type = type;
  document.querySelectorAll('.segbtn').forEach(b => b.classList.toggle('active', b.dataset.type === type));
  const isW = type === 'widget';
  document.getElementById('widget-row').style.display = isW ? 'flex' : 'none';
  document.getElementById('target-row').style.display = isW ? 'none' : 'flex';
  document.getElementById('icon-row').style.display = isW ? 'none' : 'flex';
  fTarget.placeholder = type === 'url' ? '网址，如 github.com' : (type === 'file' ? '文件或文件夹路径' : 'exe / lnk 路径');
  if (doAuto && !isW) onTargetChanged();
}
async function refreshModalIcon() {
  if (draft.type === 'widget') return;
  const tmp = { type: draft.type, target: fTarget.value.trim(), label: draft.label, icon: draft.icon };
  await renderIcon(fIconCanvas, tmp);
}
async function autoIcon() {
  draft.custom = false; const t = fTarget.value.trim();
  if (draft.type === 'url' && t) {
    const my = ++iconFetchToken; setIconLoading(true);
    const d = await window.deck.iconForUrl(t);
    if (my !== iconFetchToken) return;
    setIconLoading(false); draft.icon = d || null; refreshModalIcon();
  } else if ((draft.type === 'app' || draft.type === 'file') && t) {
    const my = ++iconFetchToken; setIconLoading(true);
    const d = await window.deck.iconForPath(t);
    if (my !== iconFetchToken) return;
    setIconLoading(false); draft.icon = d || null; refreshModalIcon();
  } else { draft.icon = null; refreshModalIcon(); }
}
function onTargetChanged() { if ((draft.type === 'url' || draft.type === 'app' || draft.type === 'file') && !draft.custom) autoIcon(); else refreshModalIcon(); }

document.querySelectorAll('.segbtn').forEach(b => b.addEventListener('click', () => setSeg(b.dataset.type, true)));
document.querySelectorAll('.wkbtn').forEach(b => b.addEventListener('click', () => {
  draft.widget = b.dataset.wk;
  document.querySelectorAll('.wkbtn').forEach(x => x.classList.toggle('active', x === b));
}));
document.getElementById('f-browse').addEventListener('click', async () => {
  if (draft.type === 'url') { fTarget.focus(); return; }
  const p = draft.type === 'app' ? await window.deck.pickApp() : await window.deck.pickAny(false);
  if (p) {
    fTarget.value = p;
    if (!fLabel.value) { const base = p.replace(/\\/g, '/').split('/').pop().replace(/\.(exe|lnk|bat|cmd|com)$/i, ''); fLabel.value = base; draft.label = base; }
    draft.custom = false;
    draft.icon = await window.deck.iconForPath(p);
    refreshModalIcon();
  }
});
document.getElementById('f-pickicon').addEventListener('click', async () => { const d = await window.deck.pickIcon(); if (d) { draft.icon = d; draft.custom = true; refreshModalIcon(); } });
document.getElementById('f-autoicon').addEventListener('click', autoIcon);
fTarget.addEventListener('change', onTargetChanged);
fTarget.addEventListener('blur', onTargetChanged);
fLabel.addEventListener('input', () => { draft.label = fLabel.value; });
document.getElementById('f-cancel').addEventListener('click', () => modal.classList.add('hidden'));
document.getElementById('f-clear').addEventListener('click', async () => { curButtons()[editIndex] = null; await persist(); modal.classList.add('hidden'); renderGrid(); });
document.getElementById('f-save').addEventListener('click', async () => {
  if (draft.type === 'widget') {
    curButtons()[editIndex] = { type: 'widget', widget: draft.widget || 'clock', label: fLabel.value.trim() };
  } else {
    const target = fTarget.value.trim();
    if (!target) { fTarget.focus(); return; }
    curButtons()[editIndex] = {
      type: draft.type, target,
      label: (fLabel.value.trim() || target.replace(/^https?:\/\//, '').split(/[\\/]/)[0]).slice(0, 16),
      icon: draft.icon || null
    };
  }
  await persist(); modal.classList.add('hidden'); renderGrid();
});

// ================= 设置弹窗 =================
const settings = document.getElementById('settings');
const sAuto = document.getElementById('s-autolaunch');
const sPixel = document.getElementById('s-pixel');
const sPixelVal = document.getElementById('s-pixelval');
function openSettings() {
  sAuto.checked = !!cfg.autoLaunch; sPixel.value = cfg.pixelSize; sPixelVal.textContent = cfg.pixelSize + 'px';
  settings.classList.remove('hidden');
}
sPixel.addEventListener('input', () => { sPixelVal.textContent = sPixel.value + 'px'; });
document.getElementById('s-cancel').addEventListener('click', () => settings.classList.add('hidden'));
document.getElementById('s-save').addEventListener('click', async () => {
  cfg.autoLaunch = sAuto.checked; cfg.pixelSize = parseInt(sPixel.value, 10);
  await persist(); settings.classList.add('hidden'); renderGrid();
});

// ================= 屏保 =================
const BUILTINS = [
  { id: 'matrix', name: '数字雨' },
  { id: 'starfield', name: '星空穿越' },
  { id: 'life', name: '生命游戏' },
  { id: 'plasma', name: '等离子' },
  { id: 'fireworks', name: '像素烟花' },
  { id: 'pong', name: '弹球时间' },
  { id: 'equalizer', name: '音浪派对' },
  { id: 'city', name: '霓虹城市' },
  { id: 'tunnel', name: '隧道穿梭' }
];
function ensureSaverConfig() {
  if (!cfg.saver || typeof cfg.saver !== 'object') cfg.saver = {};
  if (typeof cfg.saver.enabled !== 'boolean') cfg.saver.enabled = true;
  if (!Number.isFinite(cfg.saver.idleSec)) cfg.saver.idleSec = 90;
  if (!Number.isFinite(cfg.saver.rotateSec)) cfg.saver.rotateSec = 15;
  if (!Number.isFinite(cfg.saver.pixelSize)) cfg.saver.pixelSize = 80;
  if (!Array.isArray(cfg.saver.activeIds)) cfg.saver.activeIds = BUILTINS.slice(0, 3).map(b => b.id);
  if (!Array.isArray(cfg.saver.videos)) cfg.saver.videos = [];
}
const saver = { active: false, items: [], idx: 0, raf: 0, rotate: 0, cells: [], W: 0, H: 0, dpr: 1, pixelBlock: 1, pix: null, pctx: null, anim: {}, startedAt: 0 };
const saverVideo = document.getElementById('saver-video');
const saverCanvas = document.getElementById('saver-canvas');
const saverCatch = document.createElement('div');
saverCatch.id = 'saver-catch';
Object.assign(saverCatch.style, { position: 'fixed', inset: '0', zIndex: '55', display: 'none' });
document.body.appendChild(saverCatch);
saverCatch.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); stopSaver(); resetIdle(); });

function localFileUrl(filePath) {
  const fromBridge = window.deck.toFileUrl(filePath);
  if (fromBridge) return fromBridge;
  return encodeURI('file:///' + String(filePath).replace(/\\/g, '/'));
}

function buildSaverItems() {
  ensureSaverConfig();
  const out = [];
  for (const id of cfg.saver.activeIds) {
    if (BUILTINS.find(b => b.id === id)) out.push({ id, type: 'builtin' });
    else { const v = cfg.saver.videos.find(v => v.id === id); if (v) out.push({ id, type: 'video', file: v.file }); }
  }
  return out;
}
function measureCells() {
  const gridRect = grid.getBoundingClientRect();
  const well = document.getElementById('screen-well').getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  saverCanvas.style.left = (gridRect.left - well.left) + 'px';
  saverCanvas.style.top = (gridRect.top - well.top) + 'px';
  saverCanvas.style.width = gridRect.width + 'px';
  saverCanvas.style.height = gridRect.height + 'px';
  saverCanvas.width = Math.round(gridRect.width * dpr);
  saverCanvas.height = Math.round(gridRect.height * dpr);
  saver.W = saverCanvas.width; saver.H = saverCanvas.height; saver.dpr = dpr;
  saver.cells = [...grid.children].map(k => {
    const r = k.getBoundingClientRect();
    return { x: (r.left - gridRect.left) * dpr, y: (r.top - gridRect.top) * dpr, w: r.width * dpr, h: r.height * dpr, r: 6 * dpr };
  });
  const avgCellW = saver.cells.length ? saver.cells.reduce((sum, c) => sum + c.w, 0) / saver.cells.length : saver.W;
  const saverPixelSize = Math.max(20, Math.min(180, cfg.saver.pixelSize || 80));
  saver.pixelBlock = Math.max(1, avgCellW / saverPixelSize);
  const lowW = Math.max(1, Math.round(saver.W / saver.pixelBlock));
  const lowH = Math.max(1, Math.round(saver.H / saver.pixelBlock));
  if (!saver.pix) { saver.pix = document.createElement('canvas'); saver.pctx = saver.pix.getContext('2d'); }
  saver.pix.width = lowW; saver.pix.height = lowH;
  saver.pctx.imageSmoothingEnabled = false;
}
function clipCells(x) { x.beginPath(); for (const c of saver.cells) x.roundRect(c.x, c.y, c.w, c.h, c.r); x.clip(); }
function drawSaverScanlines(x) {
  const step = Math.max(2, Math.round(3 * saver.dpr));
  const lineH = Math.max(1, Math.round(1 * saver.dpr));
  x.fillStyle = 'rgba(0,0,0,.20)';
  for (let y = 0; y < saver.H; y += step) x.fillRect(0, y, saver.W, lineH);
  x.fillStyle = 'rgba(255,255,255,.06)';
  for (let y = Math.round(1 * saver.dpr); y < saver.H; y += step) x.fillRect(0, y, saver.W, lineH);
}
function startSaver() {
  const items = buildSaverItems();
  if (!items.length || saver.active) { if (!items.length) openSaverUI(); return; }
  saver.items = items; saver.idx = 0; saver.active = true;
  saver.startedAt = performance.now();
  document.body.classList.add('saver'); saverCatch.style.display = 'block';
  measureCells(); loadSaverItem(0);
  cancelAnimationFrame(saver.raf); saver.raf = requestAnimationFrame(saverFrame);
  clearInterval(saver.rotate);
  if (items.length > 1) saver.rotate = setInterval(nextSaverItem, Math.max(5, cfg.saver.rotateSec) * 1000);
}
function loadSaverItem(i) {
  const item = saver.items[i]; if (!item) return;
  saver.anim = { id: item.id, init: false };
  if (item.type === 'video') {
    const url = localFileUrl(item.file);
    saverVideo.muted = true;
    saverVideo.loop = true;
    saverVideo.playsInline = true;
    saverVideo.onloadeddata = () => { if (saver.active) drawSaverNow(); };
    saverVideo.oncanplay = () => { if (saver.active) drawSaverNow(); };
    saverVideo.src = url;
    saverVideo.load();
    saverVideo.play().catch(() => { if (saver.active) drawSaverNow(); });
  }
  else { try { saverVideo.pause(); saverVideo.removeAttribute('src'); saverVideo.load(); } catch {} }
}
function nextSaverItem() { if (!saver.active) return; saver.idx = (saver.idx + 1) % saver.items.length; loadSaverItem(saver.idx); }
function stopSaver() {
  if (!saver.active) return;
  saver.active = false; document.body.classList.remove('saver'); saverCatch.style.display = 'none';
  cancelAnimationFrame(saver.raf); clearInterval(saver.rotate);
  try { saverVideo.pause(); } catch {}
}
function drawSaverNow() {
  cancelAnimationFrame(saver.raf);
  saverFrame(performance.now());
}
function saverFrame(t) {
  if (!saver.active) return;
  const x = saverCanvas.getContext('2d');
  const px = saver.pctx;
  const pW = saver.pix.width, pH = saver.pix.height;
  px.imageSmoothingEnabled = false;
  px.clearRect(0, 0, pW, pH);
  px.fillStyle = '#050507';
  px.fillRect(0, 0, pW, pH);
  const item = saver.items[saver.idx];
  if (item) {
    if (item.type === 'video') {
      if (saverVideo.readyState >= 2 && saverVideo.videoWidth > 0) {
        try { px.drawImage(saverVideo, 0, 0, pW, pH); } catch {}
      }
    }
    else drawBuiltin(item.id, px, pW, pH, t);
  }
  x.clearRect(0, 0, saver.W, saver.H);
  x.save(); clipCells(x);
  x.imageSmoothingEnabled = false;
  x.drawImage(saver.pix, 0, 0, pW, pH, 0, 0, saver.W, saver.H);
  drawSaverScanlines(x);
  x.restore();
  saver.raf = requestAnimationFrame(saverFrame);
}
// ---- 内置动画 ----
function drawBuiltin(id, x, W, H, t) {
  if (id === 'matrix') return drawMatrix(x, W, H, t);
  if (id === 'starfield') return drawStars(x, W, H, t);
  if (id === 'life') return drawLife(x, W, H, t);
  if (id === 'plasma') return drawPlasma(x, W, H, t);
  if (id === 'fireworks') return drawFireworks(x, W, H, t);
  if (id === 'pong') return drawPong(x, W, H, t);
  if (id === 'equalizer') return drawEqualizer(x, W, H, t);
  if (id === 'city') return drawCity(x, W, H, t);
  if (id === 'tunnel') return drawTunnel(x, W, H, t);
}
function drawMatrix(x, W, H, t) {
  const a = saver.anim, fs = Math.max(10, Math.round(W / 34));
  if (!a.init) { a.init = true; a.fs = fs; a.cols = Math.floor(W / fs); a.drops = Array.from({ length: a.cols }, () => Math.random() * -H); a.last = t; }
  x.fillStyle = 'rgba(0,8,0,0.26)'; x.fillRect(0, 0, W, H);
  x.font = a.fs + 'px monospace'; x.textBaseline = 'top'; x.textAlign = 'left';
  const dt = Math.min(3, (t - a.last) / 16.7); a.last = t;
  for (let i = 0; i < a.cols; i++) {
    const ch = String.fromCharCode(0x30A0 + Math.floor(Math.random() * 96)), yy = a.drops[i];
    x.fillStyle = '#bdffd0'; x.fillText(ch, i * a.fs, yy);
    x.fillStyle = '#28e06a'; x.fillText(ch, i * a.fs, yy - a.fs);
    a.drops[i] += a.fs * 0.6 * dt;
    if (a.drops[i] > H && Math.random() > 0.975) a.drops[i] = Math.random() * -40;
  }
}
function drawStars(x, W, H, t) {
  const a = saver.anim;
  if (!a.init) { a.init = true; a.stars = Array.from({ length: 150 }, () => ({ x: Math.random() * 2 - 1, y: Math.random() * 2 - 1, z: Math.random() })); a.last = t; }
  x.fillStyle = 'rgba(0,0,8,0.4)'; x.fillRect(0, 0, W, H);
  const dt = Math.min(3, (t - a.last) / 16.7); a.last = t; const cx = W / 2, cy = H / 2;
  for (const s of a.stars) {
    s.z -= 0.006 * dt; if (s.z <= 0.02) { s.x = Math.random() * 2 - 1; s.y = Math.random() * 2 - 1; s.z = 1; }
    const px = cx + (s.x / s.z) * cx, py = cy + (s.y / s.z) * cy, sz = Math.max(1, (1 - s.z) * W / 110);
    if (px >= 0 && px < W && py >= 0 && py < H) { x.fillStyle = '#8effb0'; x.fillRect(px, py, sz, sz); }
  }
}
function lifeStep(g, w, h) {
  const n = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let xx = 0; xx < w; xx++) {
    let c = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; c += g[((y + dy + h) % h) * w + ((xx + dx + w) % w)]; }
    const i = y * w + xx; n[i] = g[i] ? (c === 2 || c === 3 ? 1 : 0) : (c === 3 ? 1 : 0);
  }
  return n;
}
function drawLife(x, W, H, t) {
  const a = saver.anim, cw = 44, ch = 26;
  if (!a.init) { a.init = true; a.cw = cw; a.ch = ch; a.grid = Uint8Array.from({ length: cw * ch }, () => Math.random() > 0.72 ? 1 : 0); a.acc = 0; a.last = t; }
  a.acc += (t - a.last); a.last = t;
  if (a.acc > 120) {
    a.acc = 0; a.grid = lifeStep(a.grid, a.cw, a.ch);
    let pop = 0; for (let i = 0; i < a.grid.length; i++) pop += a.grid[i];
    if (pop < a.grid.length * 0.03) a.grid = Uint8Array.from({ length: a.cw * a.ch }, () => Math.random() > 0.72 ? 1 : 0);
  }
  x.fillStyle = '#04140b'; x.fillRect(0, 0, W, H);
  const bw = W / a.cw, bh = H / a.ch; x.fillStyle = '#5cff8f';
  for (let yy = 0; yy < a.ch; yy++) for (let xx = 0; xx < a.cw; xx++) if (a.grid[yy * a.cw + xx]) x.fillRect(Math.floor(xx * bw), Math.floor(yy * bh), Math.ceil(bw), Math.ceil(bh));
}
function drawPlasma(x, W, H, t) {
  const a = saver.anim, pw = 72, ph = 42;
  if (!a.init) { a.init = true; a.buf = document.createElement('canvas'); a.buf.width = pw; a.buf.height = ph; a.bx = a.buf.getContext('2d'); a.img = a.bx.createImageData(pw, ph); a.t0 = t; }
  const tt = (t - a.t0) / 1000, d = a.img.data;
  for (let y = 0; y < ph; y++) for (let xx = 0; xx < pw; xx++) {
    const v = Math.sin(xx / 8 + tt) + Math.sin(y / 6 - tt) + Math.sin((xx + y) / 10 + tt) + Math.sin(Math.sqrt(xx * xx + y * y) / 8 - tt);
    const h = (v + 4) / 8, i = (y * pw + xx) * 4;
    d[i] = Math.floor(40 * h); d[i + 1] = Math.floor(170 + 70 * h); d[i + 2] = Math.floor(90 + 120 * (1 - h)); d[i + 3] = 255;
  }
  a.bx.putImageData(a.img, 0, 0); x.imageSmoothingEnabled = false; x.drawImage(a.buf, 0, 0, W, H);
}
function drawFireworks(x, W, H, t) {
  const a = saver.anim;
  if (!a.init) { a.init = true; a.bits = []; a.last = t; a.next = 0; }
  const dt = Math.min(3, (t - a.last) / 16.7); a.last = t; a.next -= dt;
  x.fillStyle = 'rgba(1,2,12,.36)'; x.fillRect(0, 0, W, H);
  if (a.next <= 0) {
    a.next = 20 + Math.random() * 35;
    const cx = W * (0.18 + Math.random() * 0.64), cy = H * (0.18 + Math.random() * 0.45);
    const colors = ['#62ff9a', '#ffcf4d', '#ff5a8a', '#66d9ff', '#b68cff'];
    const col = colors[Math.floor(Math.random() * colors.length)];
    for (let i = 0; i < 38; i++) {
      const an = i / 38 * Math.PI * 2, sp = 0.35 + Math.random() * 1.4;
      a.bits.push({ x: cx, y: cy, vx: Math.cos(an) * sp, vy: Math.sin(an) * sp, life: 45 + Math.random() * 35, col });
    }
  }
  for (let i = a.bits.length - 1; i >= 0; i--) {
    const p = a.bits[i]; p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 0.025 * dt;
    if (p.life <= 0) { a.bits.splice(i, 1); continue; }
    x.fillStyle = p.col; const s = Math.max(1, Math.round(W / 180));
    x.fillRect(Math.round(p.x), Math.round(p.y), s, s);
  }
}
function drawPong(x, W, H, t) {
  const a = saver.anim;
  if (!a.init) { a.init = true; a.x = W / 2; a.y = H / 2; a.vx = W / 150; a.vy = H / 120; a.l = H / 2; a.r = H / 2; a.last = t; a.lp = 0; a.rp = 0; }
  const dt = Math.min(3, (t - a.last) / 16.7); a.last = t;
  x.fillStyle = '#020806'; x.fillRect(0, 0, W, H);
  const padW = Math.max(2, W / 48), padH = Math.max(12, H / 4), ball = Math.max(3, W / 32);
  a.l += (a.y - a.l) * 0.05 * dt; a.r += (a.y - a.r) * 0.055 * dt;
  a.x += a.vx * dt; a.y += a.vy * dt;
  if (a.y < ball || a.y > H - ball) a.vy *= -1;
  if (a.x < padW * 3 && Math.abs(a.y - a.l) < padH / 2) { a.vx = Math.abs(a.vx) * 1.03; a.vy += (Math.random() - .5) * .5; }
  if (a.x > W - padW * 3 && Math.abs(a.y - a.r) < padH / 2) { a.vx = -Math.abs(a.vx) * 1.03; a.vy += (Math.random() - .5) * .5; }
  if (a.x < -ball) { a.rp++; a.x = W / 2; a.vx = Math.abs(W / 150); }
  if (a.x > W + ball) { a.lp++; a.x = W / 2; a.vx = -Math.abs(W / 150); }
  x.fillStyle = '#17452b'; for (let y = 0; y < H; y += 8) x.fillRect(W / 2 - 1, y, 2, 4);
  x.fillStyle = '#62ff9a';
  x.fillRect(4, Math.round(a.l - padH / 2), padW, padH);
  x.fillRect(W - 4 - padW, Math.round(a.r - padH / 2), padW, padH);
  x.fillStyle = '#ffcf4d'; x.fillRect(Math.round(a.x - ball / 2), Math.round(a.y - ball / 2), ball, ball);
  x.font = Math.max(8, W / 13) + 'px monospace'; x.textAlign = 'center'; x.fillStyle = '#2fae66';
  x.fillText((a.lp % 10) + '  ' + (a.rp % 10), W / 2, Math.max(10, H * .16));
}
function drawEqualizer(x, W, H, t) {
  const a = saver.anim, bars = 24;
  if (!a.init) { a.init = true; a.phase = Array.from({ length: bars }, () => Math.random() * 9); }
  x.fillStyle = '#03050b'; x.fillRect(0, 0, W, H);
  const bw = W / bars;
  for (let i = 0; i < bars; i++) {
    const wave = Math.sin(t / 180 + a.phase[i]) * .35 + Math.sin(t / 360 + i * .7) * .25 + .5;
    const h = Math.max(2, wave * H * .82);
    const hue = i / bars;
    x.fillStyle = hue < .33 ? '#62ff9a' : hue < .66 ? '#66d9ff' : '#ff5a8a';
    x.fillRect(Math.floor(i * bw + 1), Math.floor(H - h), Math.max(1, Math.floor(bw - 2)), Math.ceil(h));
    x.fillStyle = 'rgba(255,255,255,.18)';
    x.fillRect(Math.floor(i * bw + 1), Math.floor(H - h), Math.max(1, Math.floor(bw - 2)), 1);
  }
}
function drawCity(x, W, H, t) {
  const a = saver.anim;
  if (!a.init) {
    a.init = true; a.off = 0;
    a.b = Array.from({ length: 18 }, (_, i) => ({ x: i / 18, w: .035 + Math.random() * .055, h: .22 + Math.random() * .52, lit: Math.random() }));
  }
  a.off = (t / 9000) % 1;
  x.fillStyle = '#03020c'; x.fillRect(0, 0, W, H);
  for (let y = 0; y < H * .55; y += 3) { x.fillStyle = y % 9 ? '#050a18' : '#08122c'; x.fillRect(0, y, W, 1); }
  x.fillStyle = '#10304d'; x.fillRect(0, Math.floor(H * .78), W, H);
  for (const b of a.b) {
    let bx = ((b.x - a.off) % 1); if (bx < -0.1) bx += 1; bx *= W;
    const bw = Math.max(4, b.w * W), bh = b.h * H, by = H * .78 - bh;
    x.fillStyle = '#08151e'; x.fillRect(bx, by, bw, bh);
    x.fillStyle = b.lit > .5 ? '#ffcf4d' : '#62ff9a';
    for (let yy = by + 5; yy < H * .76; yy += 8) for (let xx = bx + 3; xx < bx + bw - 2; xx += 7) if (((xx + yy + Math.floor(t / 400)) % 5) < 2) x.fillRect(xx, yy, 2, 2);
  }
  x.fillStyle = '#66d9ff'; x.fillRect(0, Math.floor(H * .78), W, 1);
}
function drawTunnel(x, W, H, t) {
  const cx = W / 2, cy = H / 2, maxR = Math.hypot(W, H), phase = (t / 35) % 28;
  x.fillStyle = '#03030a'; x.fillRect(0, 0, W, H);
  for (let r = phase; r < maxR; r += 28) {
    const p = r / maxR, col = Math.floor(60 + p * 170);
    x.strokeStyle = r % 56 < 28 ? `rgb(${col},255,154)` : `rgb(102,217,255)`;
    x.lineWidth = Math.max(1, (1 - p) * 3);
    x.beginPath(); x.rect(cx - r, cy - r * .62, r * 2, r * 1.24); x.stroke();
  }
  x.strokeStyle = '#1f7a45'; x.lineWidth = 1;
  for (let i = 0; i < 12; i++) {
    const an = i / 12 * Math.PI * 2 + t / 1800;
    x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx + Math.cos(an) * maxR, cy + Math.sin(an) * maxR); x.stroke();
  }
}

// ---- 屏保面板 ----
const saverUI = document.getElementById('saver-ui');
let svWork = null;
function ensureSaverPixelControl() {
  let input = document.getElementById('sv-pixel');
  if (input) return input;
  const rotate = document.getElementById('sv-rotate');
  const row = document.createElement('div');
  row.className = 'row';
  row.innerHTML = '<label>清晰度</label><input id="sv-pixel" type="range" min="20" max="180" step="2" /><span id="sv-pixelval"></span>';
  rotate.closest('.row').after(row);
  input = document.getElementById('sv-pixel');
  input.addEventListener('input', () => {
    document.getElementById('sv-pixelval').textContent = input.value + ' px/key';
  });
  return input;
}
function fmtIdle(s) { return s >= 60 ? (Math.round(s / 60 * 10) / 10) + ' 分' : s + ' 秒'; }
function openSaverUI() {
  ensureSaverConfig();
  svWork = new Set(cfg.saver.activeIds);
  document.getElementById('sv-enabled').checked = !!cfg.saver.enabled;
  const idle = document.getElementById('sv-idle'); idle.value = cfg.saver.idleSec; document.getElementById('sv-idleval').textContent = fmtIdle(cfg.saver.idleSec);
  const rot = document.getElementById('sv-rotate'); rot.value = cfg.saver.rotateSec; document.getElementById('sv-rotateval').textContent = cfg.saver.rotateSec + ' 秒';
  const pix = ensureSaverPixelControl(); pix.value = Math.max(20, Math.min(180, cfg.saver.pixelSize || 80)); document.getElementById('sv-pixelval').textContent = pix.value + ' px/key';
  renderSaverList();
  saverUI.classList.remove('hidden');
}
function renderSaverList() {
  const list = document.getElementById('sv-list'); list.innerHTML = '';
  const items = [...BUILTINS.map(b => ({ id: b.id, name: b.name, kind: 'builtin' })), ...cfg.saver.videos.map(v => ({ id: v.id, name: v.name, kind: 'video' }))];
  for (const it of items) {
    const row = document.createElement('div'); row.className = 'sv-item';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = svWork.has(it.id);
    cb.addEventListener('change', () => { if (cb.checked) svWork.add(it.id); else svWork.delete(it.id); });
    const nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = it.name;
    const tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = it.kind === 'video' ? '视频' : '内置';
    row.append(cb, nm, tag);
    if (it.kind === 'video') {
      const del = document.createElement('span'); del.className = 'del'; del.textContent = '✕'; del.title = '删除';
      del.addEventListener('click', async () => {
        const v = cfg.saver.videos.find(v => v.id === it.id);
        await window.deck.saverRemoveVideo(v);
        cfg.saver.videos = cfg.saver.videos.filter(x => x.id !== it.id); svWork.delete(it.id);
        await persist(); renderSaverList();
      });
      row.append(del);
    }
    list.appendChild(row);
  }
}
document.getElementById('sv-idle').addEventListener('input', (e) => { document.getElementById('sv-idleval').textContent = fmtIdle(parseInt(e.target.value, 10)); });
document.getElementById('sv-rotate').addEventListener('input', (e) => { document.getElementById('sv-rotateval').textContent = e.target.value + ' 秒'; });
document.getElementById('sv-add').addEventListener('click', async () => {
  const it = await window.deck.saverAddVideo();
  if (it) { cfg.saver.videos.push(it); svWork.add(it.id); await persist(); renderSaverList(); }
});
document.getElementById('sv-template').addEventListener('click', exportTemplate);
function commitSaver() {
  ensureSaverConfig();
  cfg.saver.enabled = document.getElementById('sv-enabled').checked;
  cfg.saver.idleSec = parseInt(document.getElementById('sv-idle').value, 10);
  cfg.saver.rotateSec = parseInt(document.getElementById('sv-rotate').value, 10);
  cfg.saver.pixelSize = parseInt(ensureSaverPixelControl().value, 10);
  cfg.saver.activeIds = [...svWork];
  persist();
}
document.getElementById('sv-preview').addEventListener('click', () => { commitSaver(); saverUI.classList.add('hidden'); startSaver(); });
document.getElementById('sv-close').addEventListener('click', () => { commitSaver(); saverUI.classList.add('hidden'); resetIdle(); });

function exportTemplate() {
  const keys = [...grid.children]; if (!keys.length) return;
  const gridRect = grid.getBoundingClientRect();
  const scale = 1000 / gridRect.width;
  const W = Math.round(gridRect.width * scale), H = Math.round(gridRect.height * scale);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
  keys.forEach((k, idx) => {
    const r = k.getBoundingClientRect();
    const cx = (r.left - gridRect.left) * scale, cy = (r.top - gridRect.top) * scale, cw = r.width * scale, ch = r.height * scale;
    x.fillStyle = 'rgba(98,255,154,.08)'; x.strokeStyle = '#22b864'; x.lineWidth = 3;
    x.beginPath(); x.roundRect(cx, cy, cw, ch, 12); x.fill(); x.stroke();
    x.fillStyle = '#158848'; x.font = 'bold 30px PixHead, monospace';
    x.fillText(String(idx + 1), cx + 12, cy + 40);
  });
  window.deck.saverSaveTemplate(c.toDataURL('image/png'));
}

// ---- 空闲检测 ----
let idleTimer = null;
function resetIdle() {
  if (saver.active && performance.now() - saver.startedAt < 1500) return;
  if (saver.active) stopSaver();
  clearTimeout(idleTimer);
  if (cfg) ensureSaverConfig();
  if (cfg && cfg.saver.enabled && buildSaverItems().length) idleTimer = setTimeout(startSaver, cfg.saver.idleSec * 1000);
}
['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart'].forEach(ev => window.addEventListener(ev, resetIdle, { passive: true }));

// ================= 右键菜单 =================
const ctxmenu = document.getElementById('ctxmenu');
const ctxEditChk = document.getElementById('ctx-editchk');
function toggleEdit() { editing = !editing; document.body.classList.toggle('editing', editing); renderAll(); }
function showCtx(xp, yp) {
  ctxEditChk.classList.toggle('on', editing);
  ctxmenu.classList.remove('hidden');
  const r = ctxmenu.getBoundingClientRect();
  ctxmenu.style.left = Math.max(4, Math.min(xp, window.innerWidth - r.width - 4)) + 'px';
  ctxmenu.style.top = Math.max(4, Math.min(yp, window.innerHeight - r.height - 4)) + 'px';
}
function hideCtx() { ctxmenu.classList.add('hidden'); }
document.addEventListener('contextmenu', (e) => { if (e.target.closest('#modal, #settings, #saver-ui')) return; e.preventDefault(); showCtx(e.clientX, e.clientY); });
document.getElementById('badge').addEventListener('click', (e) => {
  e.stopPropagation();
  if (ctxmenu.classList.contains('hidden')) { const r = e.currentTarget.getBoundingClientRect(); showCtx(r.right - 160, r.bottom + 4); } else hideCtx();
});
ctxmenu.addEventListener('click', (e) => {
  const item = e.target.closest('.ctxitem'); if (!item) return; hideCtx();
  switch (item.dataset.act) {
    case 'edit': toggleEdit(); break;
    case 'addpage': addPage(); break;
    case 'delpage': deletePage(); break;
    case 'saver': openSaverUI(); break;
    case 'saverplay': startSaver(); break;
    case 'settings': openSettings(); break;
    case 'min': window.deck.minimize(); break;
    case 'tray': window.deck.hide(); break;
    case 'quit': window.deck.quit(); break;
  }
});
document.addEventListener('click', (e) => { if (!e.target.closest('#ctxmenu') && !e.target.closest('#badge')) hideCtx(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { hideCtx(); modal.classList.add('hidden'); settings.classList.add('hidden'); saverUI.classList.add('hidden'); } });

// 阻止把文件拖到空白处导致导航
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

// ================= 启动 =================
async function persist() { await window.deck.saveConfig(cfg); }
(async function init() {
  cfg = await window.deck.getConfig();
  ensureSaverConfig();
  renderAll();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(redrawWidgets);
  resetIdle();
})();
