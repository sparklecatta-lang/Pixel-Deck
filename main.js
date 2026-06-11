const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell, dialog, net } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const COLS = 5;
const ROWS = 3;
const CELLS = COLS * ROWS;

const USER_DATA_DIR = app.getPath('userData');
const CONFIG_PATH = path.join(USER_DATA_DIR, 'config.json');
const SAVER_DIR = path.join(USER_DATA_DIR, 'savers');
const LEGACY_USER_DATA_DIRS = [
  path.join(app.getPath('appData'), 'pixel-streamdeck')
];
const VIDEO_EXT = ['.mp4', '.webm', '.mov', '.m4v', '.ogg'];
const BUILTIN_SAVERS = ['matrix', 'starfield', 'life', 'plasma', 'fireworks', 'pong', 'equalizer', 'city', 'tunnel'];

let win = null;
let tray = null;

// ---------- config ----------
function emptyPage() { return Array.from({ length: CELLS }, () => null); }

function defaultConfig() {
  return {
    pages: [emptyPage()],
    autoLaunch: false,
    pixelSize: 22,
    saver: {
      enabled: true,
      idleSec: 90,
      rotateSec: 15,
      pixelSize: 80,
      activeIds: ['matrix', 'starfield', 'life'],
      videos: []
    }
  };
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return null; }
}

function countUsedButtons(cfg) {
  if (!cfg || !Array.isArray(cfg.pages)) return 0;
  return cfg.pages.reduce((sum, page) => sum + (Array.isArray(page) ? page.filter(Boolean).length : 0), 0);
}

function hasCustomSavers(cfg) {
  return !!(cfg && cfg.saver && Array.isArray(cfg.saver.videos) && cfg.saver.videos.length);
}

function shouldPreferLegacyConfig(current, legacy) {
  if (!legacy) return false;
  const currentUsed = countUsedButtons(current);
  const legacyUsed = countUsedButtons(legacy);
  if (!current) return true;
  if (currentUsed === 0 && legacyUsed > 0) return true;
  if (!hasCustomSavers(current) && hasCustomSavers(legacy)) return true;
  return false;
}

function uniqueDestPath(dir, base) {
  const ext = path.extname(base);
  const stem = path.basename(base, ext);
  let dest = path.join(dir, base);
  let i = 1;
  while (fs.existsSync(dest)) {
    dest = path.join(dir, `${stem}-${i}${ext}`);
    i += 1;
  }
  return dest;
}

function migrateSaverFiles(cfg) {
  if (!cfg || !cfg.saver || !Array.isArray(cfg.saver.videos)) return cfg;
  try { fs.mkdirSync(SAVER_DIR, { recursive: true }); } catch {}
  for (const v of cfg.saver.videos) {
    if (!v || !v.file) continue;
    try {
      const src = path.resolve(v.file);
      if (!fs.existsSync(src)) continue;
      const insideSaverDir = path.dirname(src).toLowerCase() === SAVER_DIR.toLowerCase();
      if (insideSaverDir) continue;
      const dest = uniqueDestPath(SAVER_DIR, path.basename(src));
      fs.copyFileSync(src, dest);
      v.file = dest;
    } catch {}
  }
  return cfg;
}

function copyLegacySaverDir(legacyDir) {
  const srcDir = path.join(legacyDir, 'savers');
  try {
    if (!fs.existsSync(srcDir)) return;
    fs.mkdirSync(SAVER_DIR, { recursive: true });
    for (const ent of fs.readdirSync(srcDir, { withFileTypes: true })) {
      if (!ent.isFile()) continue;
      if (!VIDEO_EXT.includes(path.extname(ent.name).toLowerCase())) continue;
      const src = path.join(srcDir, ent.name);
      const dest = path.join(SAVER_DIR, ent.name);
      if (!fs.existsSync(dest)) fs.copyFileSync(src, dest);
    }
  } catch {}
}

function migrateLegacyConfigIfNeeded() {
  const current = readJson(CONFIG_PATH);
  for (const dir of LEGACY_USER_DATA_DIRS) {
    const legacyPath = path.join(dir, 'config.json');
    const legacy = readJson(legacyPath);
    if (!shouldPreferLegacyConfig(current, legacy)) continue;
    try {
      fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
      if (fs.existsSync(CONFIG_PATH)) {
        const stamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
        fs.copyFileSync(CONFIG_PATH, `${CONFIG_PATH}.bak-before-legacy-migration-${stamp}`);
      }
      copyLegacySaverDir(dir);
      const migrated = migrateSaverFiles(legacy);
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(migrated, null, 2), 'utf8');
      return migrated;
    } catch {}
  }
  return current;
}

function loadConfig() {
  let cfg = migrateLegacyConfigIfNeeded();
  if (!cfg) return defaultConfig();
  const def = defaultConfig();
  // 旧版迁移：扁平 buttons -> pages[0]
  if (Array.isArray(cfg.buttons) && !Array.isArray(cfg.pages)) cfg.pages = [cfg.buttons];
  if (!Array.isArray(cfg.pages) || !cfg.pages.length) cfg.pages = def.pages;
  cfg.pages = cfg.pages.map(p => {
    p = Array.isArray(p) ? p.slice(0, CELLS) : [];
    while (p.length < CELLS) p.push(null);
    return p;
  });
  if (typeof cfg.pixelSize !== 'number') cfg.pixelSize = def.pixelSize;
  if (typeof cfg.autoLaunch !== 'boolean') cfg.autoLaunch = def.autoLaunch;
  cfg.saver = Object.assign(def.saver, cfg.saver || {});
  if (typeof cfg.saver.pixelSize !== 'number') cfg.saver.pixelSize = def.saver.pixelSize;
  if (!Array.isArray(cfg.saver.videos)) cfg.saver.videos = [];
  if (!Array.isArray(cfg.saver.activeIds)) cfg.saver.activeIds = def.saver.activeIds.slice();
  syncSaverVideos(cfg);
  delete cfg.buttons;
  return cfg;
}

// 扫描用户数据目录里的自定义屏保视频；内置屏保只存在于代码里，不随仓库携带视频文件。
function syncSaverVideos(cfg) {
  let files = [];
  try { files = fs.readdirSync(SAVER_DIR).filter(f => VIDEO_EXT.includes(path.extname(f).toLowerCase())); } catch {}
  const known = new Set(cfg.saver.videos.map(v => path.basename(v.file)));
  for (const f of files) {
    if (known.has(f)) continue;
    const id = 'vid_' + Buffer.from(f).toString('hex').slice(0, 18);
    cfg.saver.videos.push({ id, type: 'video', name: path.basename(f, path.extname(f)).slice(0, 24), file: path.join(SAVER_DIR, f) });
    if (!cfg.saver.activeIds.includes(id)) cfg.saver.activeIds.push(id); // 新加入的默认勾选
  }
  cfg.saver.videos = cfg.saver.videos.filter(v => { try { return fs.existsSync(v.file); } catch { return false; } });
  const valid = new Set([...BUILTIN_SAVERS, ...cfg.saver.videos.map(v => v.id)]);
  cfg.saver.activeIds = cfg.saver.activeIds.filter(id => valid.has(id));
}

function saveConfig(cfg) {
  try {
    const incomingUsed = Array.isArray(cfg && cfg.pages)
      ? cfg.pages.reduce((sum, page) => sum + (Array.isArray(page) ? page.filter(Boolean).length : 0), 0)
      : 0;
    if (incomingUsed === 0 && fs.existsSync(CONFIG_PATH)) {
      try {
        const existing = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        const existingUsed = Array.isArray(existing.pages)
          ? existing.pages.reduce((sum, page) => sum + (Array.isArray(page) ? page.filter(Boolean).length : 0), 0)
          : 0;
        if (existingUsed > 0) return false;
      } catch {}
    }
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
    return true;
  } catch (e) {
    return false;
  }
}

async function hydrateMissingIcons(cfg) {
  if (!cfg || !Array.isArray(cfg.pages)) return cfg;
  let changed = false;
  for (const page of cfg.pages) {
    if (!Array.isArray(page)) continue;
    for (const btn of page) {
      if (!btn || !btn.target) continue;
      if (btn.type !== 'app' && btn.type !== 'file') continue;
      if (btn.icon && !isWeakIconData(btn.icon)) continue;
      try {
        const icon = await resolvePathIcon(btn.target);
        if (icon) { btn.icon = icon; changed = true; }
      } catch {}
    }
  }
  if (changed) saveConfig(cfg);
  return cfg;
}

function isWeakIconData(dataUrl) {
  const s = String(dataUrl || '');
  return !s || s.length < 1600;
}

// ---------- auto launch ----------
function applyAutoLaunch(enabled) {
  const opts = {
    openAtLogin: !!enabled,
    path: process.execPath
  };
  // 开发模式下 execPath 是 electron.exe，需要把入口脚本作为参数传进去
  if (!app.isPackaged) {
    opts.args = [path.resolve(process.argv[1] || __dirname)];
  }
  try {
    app.setLoginItemSettings(opts);
  } catch (e) {
    // ignore
  }
}

// ---------- window ----------
function createWindow() {
  win = new BrowserWindow({
    width: 720,
    height: 480,
    frame: false,
    resizable: false,
    transparent: true,
    hasShadow: false,
    show: false,
    title: 'Pixel Deck',
    icon: makeAppIcon(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());

  win.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });
}

// 生成一个简单的像素风托盘/程序图标（BGRA 位图，避免依赖外部图标文件）
function makeAppIcon() {
  try {
    const img = nativeImage.createFromPath(path.join(__dirname, 'assets', 'pixel-deck-logo.png'));
    if (img && !img.isEmpty()) return img.resize({ width: 32, height: 32, quality: 'best' });
  } catch {}

  const w = 16, h = 16;
  const buf = Buffer.alloc(w * h * 4);
  // 画一个 5x3 的小网格，呼应面板造型
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const border = x === 0 || y === 0 || x === w - 1 || y === h - 1;
      // 单元格：每 ~3px 一格的亮点
      const cell = (x % 3 !== 0) && (y % 4 !== 0) && !border;
      let r = 10, g = 14, b = 20; // 暗底
      if (cell) { r = 0x5c; g = 0xff; b = 0x8f; } // 霓虹绿
      else if (border) { r = 0x1f; g = 0x7a; b = 0x3f; }
      buf[i] = b; buf[i + 1] = g; buf[i + 2] = r; buf[i + 3] = 0xff; // BGRA
    }
  }
  return nativeImage.createFromBitmap(buf, { width: w, height: h });
}

// ---------- tray ----------
function createTray() {
  tray = new Tray(makeAppIcon());
  const menu = Menu.buildFromTemplate([
    { label: '显示面板', click: () => { win.show(); win.focus(); } },
    { label: '隐藏面板', click: () => win.hide() },
    { type: 'separator' },
    { label: '退出', click: () => { app.isQuitting = true; app.quit(); } }
  ]);
  tray.setToolTip('Pixel Deck');
  tray.setContextMenu(menu);
  tray.on('click', () => {
    if (win.isVisible()) win.hide();
    else { win.show(); win.focus(); }
  });
}

// ---------- IPC ----------
ipcMain.handle('config:get', async () => hydrateMissingIcons(loadConfig()));

ipcMain.handle('config:save', (_e, cfg) => {
  const ok = saveConfig(cfg);
  applyAutoLaunch(cfg.autoLaunch);
  return ok;
});

function imageDataUrlFromPath(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    const img = nativeImage.createFromPath(filePath);
    if (img && !img.isEmpty()) return img.toDataURL();
  } catch {}
  return null;
}

function expandEnvPath(p) {
  return String(p || '').replace(/%([^%]+)%/g, (_m, name) => process.env[name] || '');
}

function shortcutIconPath(raw, cwd, target) {
  let p = expandEnvPath(raw || '').trim().replace(/^"|"$/g, '');
  if (!p) return null;
  p = p.replace(/,\s*-?\d+\s*$/, '');
  if (!p) return null;
  if (!path.isAbsolute(p)) p = path.resolve(cwd || path.dirname(target || ''), p);
  return fs.existsSync(p) ? p : null;
}

function scoreIconCandidate(filePath) {
  const name = path.basename(filePath, path.extname(filePath)).toLowerCase();
  let score = 0;
  if (name === 'icon') score += 1000;
  else if (name === 'app_icon') score += 960;
  else if (name === 'logo_icon_large') score += 930;
  else if (name === 'logo_icon') score += 900;
  else if (name === 'desktop_icon') score += 860;
  else if (name === 'logo') score += 820;
  else if (name.includes('icon')) score += 500;
  else if (name.includes('logo')) score += 430;
  else return 0;

  const lower = filePath.toLowerCase();
  if (/\.(ico)$/i.test(filePath)) score += 80;
  if (/\\resources\\/i.test(filePath)) score += 60;
  if (/\\assets\\/i.test(filePath)) score += 50;
  if (/mac|install|auto_launch|tray_notice|redpoint|badge|background|poster|splash|lockscreen/i.test(lower)) score -= 300;
  try {
    const len = fs.statSync(filePath).size;
    score += Math.min(80, Math.floor(len / 2048));
  } catch {}
  return score;
}

function addIconSearchDirs(dirs, base) {
  if (!base || !fs.existsSync(base)) return;
  dirs.add(base);
  for (const rel of ['resources', 'assets', path.join('app', 'resources'), path.join('app', 'assets'), path.join('tray', 'resources')]) {
    const d = path.join(base, rel);
    if (fs.existsSync(d)) dirs.add(d);
  }
  try {
    for (const ent of fs.readdirSync(base, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      const child = path.join(base, ent.name);
      for (const rel of ['resources', 'assets', path.join('tray', 'resources')]) {
        const d = path.join(child, rel);
        if (fs.existsSync(d)) dirs.add(d);
      }
    }
  } catch {}
}

function findAssociatedIconFile(filePath, shortcut) {
  const target = shortcut && shortcut.target && fs.existsSync(shortcut.target) ? shortcut.target : filePath;
  const dirs = new Set();
  addIconSearchDirs(dirs, path.dirname(filePath));
  if (target) addIconSearchDirs(dirs, path.dirname(target));
  if (shortcut && shortcut.cwd) addIconSearchDirs(dirs, shortcut.cwd);

  const candidates = [];
  for (const dir of dirs) {
    try {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!ent.isFile()) continue;
        const ext = path.extname(ent.name).toLowerCase();
        if (!['.ico', '.png', '.jpg', '.jpeg', '.webp', '.bmp'].includes(ext)) continue;
        const full = path.join(dir, ent.name);
        const score = scoreIconCandidate(full);
        if (score > 0) candidates.push({ file: full, score });
      }
    } catch {}
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates.length ? candidates[0].file : null;
}

async function resolvePathIcon(filePath) {
  if (!filePath) return null;
  try {
    let target = filePath;
    let shortcut = null;
    // 快捷方式：解析到真实目标，并优先用其自带图标
    if (path.extname(filePath).toLowerCase() === '.lnk') {
      try {
        shortcut = shell.readShortcutLink(filePath);
        if (shortcut) {
          const explicitIcon = shortcutIconPath(shortcut.icon, shortcut.cwd, shortcut.target);
          const explicitData = imageDataUrlFromPath(explicitIcon);
          if (explicitData) return explicitData;
          if (shortcut.target && fs.existsSync(shortcut.target)) target = shortcut.target;
          const associated = findAssociatedIconFile(filePath, shortcut);
          const associatedData = imageDataUrlFromPath(associated);
          if (associatedData) return associatedData;
        }
      } catch {}
    } else {
      const associated = findAssociatedIconFile(filePath, null);
      const associatedData = imageDataUrlFromPath(associated);
      if (associatedData) return associatedData;
    }
    let img = await app.getFileIcon(target, { size: 'large' });
    if (!img || img.isEmpty()) {
      try {
        img = await app.getFileIcon(filePath, { size: 'normal' });
      } catch {}
    }
    if (img && !img.isEmpty()) {
      const data = img.toDataURL();
      if (data && !isWeakIconData(data)) return data;
    }
    if (shortcut && shortcut.target && shortcut.target !== filePath) {
      const associated = findAssociatedIconFile(shortcut.target, shortcut);
      const associatedData = imageDataUrlFromPath(associated);
      if (associatedData) return associatedData;
    }
    if (shortcut) {
      try {
        const linkIcon = await app.getFileIcon(filePath, { size: 'large' });
        const data = linkIcon && !linkIcon.isEmpty() ? linkIcon.toDataURL() : null;
        if (data && !isWeakIconData(data)) return data;
      } catch {}
    }
    return null;
  } catch {
    return null;
  }
}

// 提取本地文件/exe 的图标，返回 PNG dataURL
ipcMain.handle('icon:forPath', async (_e, filePath) => resolvePathIcon(filePath));

// 用 Electron net 抓取（走 Chromium 网络栈，自动使用系统/VPN 代理，自动跟随重定向）
function fetchUrl(rawUrl, { timeout = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    let request;
    try {
      request = net.request({ url: rawUrl, redirect: 'follow' });
    } catch (e) { return reject(e); }
    request.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Pixel Deck/1.0');
    request.setHeader('Accept', '*/*');

    let done = false;
    const finish = (fn, arg) => { if (done) return; done = true; clearTimeout(timer); fn(arg); };
    const timer = setTimeout(() => { try { request.abort(); } catch {} finish(reject, new Error('timeout')); }, timeout);

    request.on('response', (response) => {
      const status = response.statusCode;
      if (status >= 400) { try { request.abort(); } catch {} return finish(reject, new Error('HTTP ' + status)); }
      const ct = response.headers['content-type'];
      const contentType = String(Array.isArray(ct) ? ct[0] : (ct || '')).toLowerCase();
      const chunks = [];
      let total = 0;
      response.on('data', (d) => {
        total += d.length;
        if (total > 3 * 1024 * 1024) { try { request.abort(); } catch {} return; }
        chunks.push(d);
      });
      response.on('end', () => finish(resolve, { buf: Buffer.concat(chunks), contentType, finalUrl: rawUrl }));
      response.on('error', (e) => finish(reject, e));
    });
    request.on('error', (e) => finish(reject, e));
    request.end();
  });
}

// 自动获取网站图标（favicon）→ 返回 PNG/原图 dataURL
ipcMain.handle('icon:forUrl', async (_e, rawUrl) => {
  try {
    let target = (rawUrl || '').trim();
    if (!target) return null;
    if (!/^https?:\/\//i.test(target)) target = 'https://' + target;
    const origin = new URL(target).origin;

    const candidates = [];
    // 1) 解析主页 <link rel="...icon...">
    try {
      const page = await fetchUrl(target);
      const html = page.buf.toString('utf8');
      const base = page.finalUrl;
      const re = /<link\b[^>]*rel=["'][^"']*icon[^"']*["'][^>]*>/gi;
      let m;
      while ((m = re.exec(html))) {
        const tag = m[0];
        const href = (tag.match(/href=["']([^"']+)["']/i) || [])[1];
        if (!href) continue;
        const sizes = (tag.match(/sizes=["']([^"']+)["']/i) || [])[1] || '';
        const px = parseInt((sizes.match(/(\d+)/) || [])[1] || '0', 10);
        const isApple = /apple-touch-icon/i.test(tag);
        const score = px || (isApple ? 120 : 32);
        try { candidates.push({ url: new URL(href, base).toString(), score }); } catch {}
      }
    } catch {}
    // 2) 常见兜底路径
    candidates.push({ url: origin + '/apple-touch-icon.png', score: 100 });
    candidates.push({ url: origin + '/favicon.ico', score: 16 });

    candidates.sort((a, b) => b.score - a.score);

    const seen = new Set();
    for (const c of candidates) {
      if (seen.has(c.url)) continue;
      seen.add(c.url);
      try {
        const r = await fetchUrl(c.url);
        if (!r.buf.length) continue;
        let mime = (r.contentType.split(';')[0] || '').trim();
        if (!/^image\//.test(mime)) {
          if (/\.png(\?|$)/i.test(c.url)) mime = 'image/png';
          else if (/\.ico(\?|$)/i.test(c.url)) mime = 'image/x-icon';
          else if (/\.svg(\?|$)/i.test(c.url)) mime = 'image/svg+xml';
          else if (/\.jpe?g(\?|$)/i.test(c.url)) mime = 'image/jpeg';
          else if (/\.gif(\?|$)/i.test(c.url)) mime = 'image/gif';
          else continue;
        }
        // .ico 先尝试用 nativeImage 解成 PNG（更稳）
        if (mime === 'image/x-icon' || mime === 'image/vnd.microsoft.icon') {
          try {
            const img = nativeImage.createFromBuffer(r.buf);
            if (!img.isEmpty()) return img.toDataURL();
          } catch {}
        }
        return `data:${mime};base64,` + r.buf.toString('base64');
      } catch {}
    }
    return null;
  } catch {
    return null;
  }
});

// 选择 exe / lnk / 文件
ipcMain.handle('dialog:pickApp', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: '选择程序或快捷方式',
    properties: ['openFile'],
    filters: [
      { name: '程序/快捷方式', extensions: ['exe', 'lnk', 'bat', 'cmd', 'com'] },
      { name: '所有文件', extensions: ['*'] }
    ]
  });
  if (r.canceled || !r.filePaths.length) return null;
  return r.filePaths[0];
});

// 选择任意文件/文件夹
ipcMain.handle('dialog:pickAny', async (_e, dir) => {
  const r = await dialog.showOpenDialog(win, {
    title: dir ? '选择文件夹' : '选择文件',
    properties: [dir ? 'openDirectory' : 'openFile']
  });
  if (r.canceled || !r.filePaths.length) return null;
  return r.filePaths[0];
});

// 选择自定义图标图片
ipcMain.handle('dialog:pickIcon', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: '选择图标图片',
    properties: ['openFile'],
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'webp'] }]
  });
  if (r.canceled || !r.filePaths.length) return null;
  try {
    const img = nativeImage.createFromPath(r.filePaths[0]);
    if (img.isEmpty()) return null;
    return img.toDataURL();
  } catch {
    return null;
  }
});

// 解析拖拽进来的文件/快捷方式/链接 → 按钮配置
ipcMain.handle('drop:resolve', (_e, p) => {
  try {
    if (!p) return null;
    const base = path.basename(p);
    const ext = path.extname(p).toLowerCase();
    let stat = null;
    try { stat = fs.statSync(p); } catch {}
    if (stat && stat.isDirectory()) return { type: 'file', target: p, label: base };
    if (ext === '.url') {
      let url = '';
      try {
        const txt = fs.readFileSync(p, 'utf8');
        const m = txt.match(/^\s*URL\s*=\s*(.+?)\s*$/im);
        if (m) url = m[1].trim();
      } catch {}
      return url ? { type: 'url', target: url, label: base.replace(/\.url$/i, '') } : null;
    }
    if (['.exe', '.lnk', '.bat', '.cmd', '.com'].includes(ext)) {
      return { type: 'app', target: p, label: base.replace(/\.[^.]+$/, '') };
    }
    return { type: 'file', target: p, label: base };
  } catch {
    return null;
  }
});

// 触发按钮：启动 app / 打开 url / 打开文件
ipcMain.handle('action:launch', async (_e, btn) => {
  if (!btn || !btn.target) return { ok: false, error: '未绑定' };
  try {
    if (btn.type === 'url') {
      let url = btn.target.trim();
      if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
      await shell.openExternal(url);
    } else {
      // app / file / folder
      const r = await shell.openPath(btn.target);
      if (r) return { ok: false, error: r };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

// ===== 组件数据：系统状态 =====
let lastCpu = null;
let lastNet = null;
let cachedNet = { rx: 0, tx: 0, t: 0 };
function readCpu() {
  const cpus = os.cpus();
  let idle = 0, total = 0;
  for (const c of cpus) { for (const k in c.times) total += c.times[k]; idle += c.times.idle; }
  return { idle, total };
}
function readNetBytes() {
  if (Date.now() - cachedNet.t < 900) return cachedNet;
  let rx = 0, tx = 0;
  try {
    const { execFileSync } = require('child_process');
    const script = [
      '$n = Get-NetAdapterStatistics | Where-Object { $_.ReceivedBytes -ne $null -and $_.SentBytes -ne $null };',
      '$rx = [double](($n | Measure-Object -Property ReceivedBytes -Sum).Sum);',
      '$tx = [double](($n | Measure-Object -Property SentBytes -Sum).Sum);',
      '[pscustomobject]@{rx=$rx;tx=$tx} | ConvertTo-Json -Compress'
    ].join(' ');
    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { timeout: 2500, windowsHide: true }).toString().trim();
    const data = JSON.parse(out);
    rx = Number(data.rx) || 0;
    tx = Number(data.tx) || 0;
  } catch {}
  cachedNet = { rx, tx, t: Date.now() };
  return cachedNet;
}
function fmtSpeed(bytesPerSec) {
  const n = Math.max(0, bytesPerSec || 0);
  if (n >= 1048576) return (n / 1048576).toFixed(n >= 10485760 ? 0 : 1) + 'M/s';
  if (n >= 1024) return (n / 1024).toFixed(n >= 10240 ? 0 : 1) + 'K/s';
  return Math.round(n) + 'B/s';
}
ipcMain.handle('sys:stats', () => {
  const cur = readCpu();
  let cpu = 0;
  if (lastCpu) {
    const di = cur.idle - lastCpu.idle, dt = cur.total - lastCpu.total;
    cpu = dt > 0 ? Math.max(0, Math.min(100, Math.round(100 * (1 - di / dt)))) : 0;
  }
  lastCpu = cur;
  const netNow = readNetBytes();
  let netDown = 0, netUp = 0;
  if (lastNet && netNow.t > lastNet.t && netNow.rx >= lastNet.rx && netNow.tx >= lastNet.tx) {
    const dt = (netNow.t - lastNet.t) / 1000;
    netDown = (netNow.rx - lastNet.rx) / dt;
    netUp = (netNow.tx - lastNet.tx) / dt;
  }
  lastNet = netNow;
  const total = os.totalmem(), free = os.freemem();
  return {
    cpu,
    mem: Math.round(100 * (1 - free / total)),
    memUsedGB: +((total - free) / 1073741824).toFixed(1),
    memTotalGB: +(total / 1073741824).toFixed(1),
    netDown,
    netUp,
    netDownText: fmtSpeed(netDown),
    netUpText: fmtSpeed(netUp)
  };
});

// ===== 组件数据：天气（wttr.in，自动按 IP 定位）=====
let wxCache = { t: 0, data: null };
function zhWeatherText(text, code) {
  const raw = String(text || '').trim();
  const key = raw.toLowerCase();
  const map = {
    'sunny': '晴',
    'clear': '晴',
    'partly cloudy': '局部多云',
    'cloudy': '多云',
    'overcast': '阴',
    'mist': '薄雾',
    'fog': '雾',
    'freezing fog': '冻雾',
    'patchy rain possible': '局部有雨',
    'patchy light drizzle': '局部小毛毛雨',
    'light drizzle': '小毛毛雨',
    'drizzle': '毛毛雨',
    'light rain': '小雨',
    'moderate rain': '中雨',
    'heavy rain': '大雨',
    'light rain shower': '小阵雨',
    'moderate or heavy rain shower': '阵雨',
    'torrential rain shower': '暴雨',
    'patchy snow possible': '局部有雪',
    'light snow': '小雪',
    'moderate snow': '中雪',
    'heavy snow': '大雪',
    'patchy sleet possible': '局部雨夹雪',
    'light sleet': '小雨夹雪',
    'moderate or heavy sleet': '雨夹雪',
    'thundery outbreaks possible': '可能有雷雨',
    'patchy light rain with thunder': '局部雷阵雨',
    'moderate or heavy rain with thunder': '雷雨',
    'blowing snow': '风雪',
    'blizzard': '暴风雪'
  };
  if (/[\u4e00-\u9fff]/.test(raw)) return raw;
  if (map[key]) return map[key];
  if (code === 113) return '晴';
  if ([116, 119, 122].includes(code)) return '多云';
  if ([143, 248, 260].includes(code)) return '雾';
  if ([200, 386, 389, 392, 395].includes(code)) return '雷雨';
  if ([179, 227, 230, 320, 323, 326, 329, 332, 335, 338, 350, 368, 371, 374, 377].includes(code)) return '雪';
  return '有雨';
}
function zhAreaName(area) {
  const raw = String(area || '').trim();
  if (!raw) return '当前位置';
  if (/[\u4e00-\u9fff]/.test(raw)) return raw;
  const map = {
    'bavans hills est': '当前位置',
    'bavans hills': '当前位置',
    'beijing': '北京',
    'shanghai': '上海',
    'guangzhou': '广州',
    'shenzhen': '深圳',
    'hangzhou': '杭州',
    'chengdu': '成都',
    'wuhan': '武汉',
    'nanjing': '南京',
    'suzhou': '苏州',
    'chongqing': '重庆',
    'xian': '西安',
    "xi'an": '西安'
  };
  return map[raw.toLowerCase()] || '当前位置';
}
ipcMain.handle('weather:get', async () => {
  if (wxCache.data && Date.now() - wxCache.t < 6e5) return wxCache.data;
  try {
    const r = await fetchUrl('https://wttr.in/?format=j1&lang=zh', { timeout: 9000 });
    const j = JSON.parse(r.buf.toString('utf8'));
    const c = j.current_condition[0];
    const code = parseInt(c.weatherCode, 10);
    const zh = c.lang_zh && c.lang_zh[0] && c.lang_zh[0].value;
    const area = j.nearest_area && j.nearest_area[0];
    const areaZh = area && area.lang_zh && area.lang_zh[0] && area.lang_zh[0].value;
    const areaName = area && area.areaName && area.areaName[0] && area.areaName[0].value;
    const data = {
      tempC: parseInt(c.temp_C, 10),
      desc: zhWeatherText(zh || (c.weatherDesc && c.weatherDesc[0] && c.weatherDesc[0].value), code),
      code,
      humidity: parseInt(c.humidity, 10),
      city: zhAreaName(areaZh || areaName)
    };
    wxCache = { t: Date.now(), data };
    return data;
  } catch {
    return wxCache.data;
  }
});

// ===== 屏保：视频导入/删除/模板导出 =====
function importVideoFile(srcPath) {
  if (!srcPath) return null;
  const ext = path.extname(srcPath).toLowerCase();
  if (!VIDEO_EXT.includes(ext)) return null;
  fs.mkdirSync(SAVER_DIR, { recursive: true });
  const id = 'vid_' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
  const dest = path.join(SAVER_DIR, id + ext);
  fs.copyFileSync(srcPath, dest);
  return { id, type: 'video', name: path.basename(srcPath, ext).slice(0, 24), file: dest };
}
ipcMain.handle('saver:addVideo', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: '选择屏保视频',
    properties: ['openFile'],
    filters: [{ name: '视频', extensions: ['mp4', 'webm', 'mov', 'm4v', 'ogg'] }]
  });
  if (r.canceled || !r.filePaths.length) return null;
  try { return importVideoFile(r.filePaths[0]); } catch { return null; }
});
ipcMain.handle('saver:importVideo', (_e, p) => { try { return importVideoFile(p); } catch { return null; } });
ipcMain.handle('saver:removeVideo', (_e, item) => {
  try { if (item && item.file && fs.existsSync(item.file)) fs.unlinkSync(item.file); } catch {}
  return true;
});
ipcMain.handle('saver:saveTemplate', async (_e, dataUrl) => {
  try {
    const b64 = String(dataUrl).replace(/^data:image\/png;base64,/, '');
    const out = path.join(app.getPath('downloads'), 'pixeling-saver-template.png');
    fs.writeFileSync(out, Buffer.from(b64, 'base64'));
    shell.openPath(out);
    return out;
  } catch { return null; }
});

// 窗口控制
ipcMain.on('win:minimize', () => win && win.minimize());
ipcMain.on('win:hide', () => win && win.hide());
ipcMain.on('win:quit', () => { app.isQuitting = true; app.quit(); });

// ---------- lifecycle ----------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    createWindow();
    createTray();
    const cfg = loadConfig();
    applyAutoLaunch(cfg.autoLaunch);
  });
}

app.on('window-all-closed', (e) => {
  // 保持托盘常驻，不退出
});
