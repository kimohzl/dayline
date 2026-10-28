/* Dayline — Windows 앱 껍데기 (Electron)
 * 화면은 index.html 그대로 쓰고, 여기서는 창·트레이·알림·자동 실행·스티커 메모만 맡는다. */
const {
  app, BrowserWindow, Tray, Menu, ipcMain, Notification, globalShortcut, screen, nativeImage, dialog, shell, session, clipboard, net,
} = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { pathToFileURL } = require('url');

const APP_ID = 'com.dayline.app';
const PROTOCOL = 'dayline';
const ROOT = path.join(__dirname, '..');

app.setAppUserModelId(APP_ID);

if (!app.requestSingleInstanceLock()) {
  // 이미 실행 중: 인자(--quit, dayline://...)는 실행 중인 쪽이 second-instance로 받는다
  app.quit();
} else if (process.argv.includes('--quit')) {
  // 실행 중인 Dayline이 없는데 설치 프로그램이 종료를 요청한 경우: 아무것도 띄우지 않고 끝낸다
  app.quit();
} else {
  start();
}

function start() {
  let win = null;
  let tray = null;
  let quitting = false;
  let st = loadState();
  let mode = st.mode === 'mini' ? 'mini' : 'big';
  let pinned = st.pinned !== false;
  const bounds = st.bounds || {};
  const toasts = new Set(); // 알림이 사라지기 전에 정리되지 않도록 붙잡아 둔다

  /* ---------- 상태 파일 ---------- */
  function stateFile() {
    return path.join(app.getPath('userData'), 'window-state.json');
  }
  function loadState() {
    try {
      return JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'window-state.json'), 'utf8'));
    } catch (e) {
      return {};
    }
  }
  let saveTimer = null;
  function saveState() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        fs.mkdirSync(app.getPath('userData'), { recursive: true });
        fs.writeFileSync(stateFile(), JSON.stringify({ ...st, mode, pinned, bounds }));
      } catch (e) { /* 창 위치 저장 실패는 앱 사용에 지장 없음 */ }
    }, 300);
  }

  /* ---------- 창 크기·위치 ---------- */
  const MINI = { width: 450, height: 670 };
  function defaultBounds(m) {
    const wa = screen.getPrimaryDisplay().workArea;
    if (m === 'mini') {
      const w = Math.min(MINI.width, wa.width - 48);
      const h = Math.min(MINI.height, wa.height - 48);
      return { width: w, height: h, x: wa.x + wa.width - w - 24, y: wa.y + 24 };
    }
    const w = Math.min(1280, Math.round(wa.width * 0.88));
    const h = Math.min(820, Math.round(wa.height * 0.86));
    return { width: w, height: h, x: wa.x + Math.round((wa.width - w) / 2), y: wa.y + Math.round((wa.height - h) / 2) };
  }
  // 작업 영역을 거의 다 덮는 크기 = 최대화된 크기. 평소 크기로 저장하지 않는다
  function fillsScreen(b) {
    const wa = screen.getDisplayMatching(b).workArea;
    return b.width >= wa.width * 0.96 && b.height >= wa.height * 0.94;
  }
  // 창이 화면 밖으로 나가지 않게: 가장 가까운 모니터의 작업 영역 안으로 크기·위치를 맞춘다
  function fitToScreen(b) {
    const wa = screen.getDisplayMatching(b).workArea;
    const width = Math.min(b.width, wa.width);
    const height = Math.min(b.height, wa.height);
    const x = Math.min(Math.max(b.x, wa.x), wa.x + wa.width - width);
    const y = Math.min(Math.max(b.y, wa.y), wa.y + wa.height - height);
    return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
  }
  function plausible(m, b) {
    if (!b || !(b.width > 0) || !(b.height > 0)) return false;
    if (m === 'mini') {
      const wa = screen.getDisplayMatching(b).workArea;
      // 화면 높이를 꽉 채운 크기 = Windows가 가장자리에 맞춘(스냅) 크기 → 사용자가 고른 크기가 아님
      return b.width >= 300 && b.width <= 760 && b.height >= 400 && b.height < wa.height * 0.95 && !fillsScreen(b);
    }
    return b.width >= 800 && b.height >= 500 && !fillsScreen(b);
  }
  const boundsFor = (m) => fitToScreen(plausible(m, bounds[m]) ? bounds[m] : defaultBounds(m));
  // 모드를 바꾸는 동안 Windows가 보내는 크기 변경 신호는 저장하지 않는다(큰 앱 크기가 작은 창 크기로 저장되던 문제)
  let switchingUntil = 0;
  let maximizedFlag = false;
  function rememberBounds() {
    if (!win || win.isDestroyed() || win.isMinimized() || win.isMaximized() || win.isFullScreen() || maximizedFlag) return;
    if (Date.now() < switchingUntil) return;
    const b = win.getBounds();
    if (!plausible(mode, b)) return;
    bounds[mode] = b;
    saveState();
  }
  // 모드를 바꿀 때: 지금 창 자리를 기준으로 크기만 바꾼다.
  // 화면 오른쪽에 가까우면 오른쪽 끝을, 아니면 왼쪽 끝을 고정하고 위쪽은 그대로 둔다(줄였다 늘려도 같은 자리)
  function sizeFor(m) {
    const b = plausible(m, bounds[m]) ? bounds[m] : defaultBounds(m);
    return { width: b.width, height: b.height };
  }
  let lastSwitch = null; // { to, toBounds, back: 이전 모드의 정확한 자리, anchorRight }
  const sameBounds = (a, b) => a && b && Math.abs(a.x - b.x) <= 2 && Math.abs(a.y - b.y) <= 2 && Math.abs(a.width - b.width) <= 2 && Math.abs(a.height - b.height) <= 2;
  function anchoredBounds(m) {
    const cur = win.isMaximized() ? win.getNormalBounds() : win.getBounds();
    // 바꾼 뒤 창을 옮기거나 크기를 바꾸지 않았으면, 이전 자리 그대로 돌아간다
    if (lastSwitch && lastSwitch.backMode === m && sameBounds(cur, lastSwitch.toBounds)) return fitToScreen(lastSwitch.back);
    const size = sizeFor(m);
    const wa = screen.getDisplayMatching(cur).workArea;
    const anchorRight = cur.x + cur.width / 2 > wa.x + wa.width / 2;
    const x = anchorRight ? cur.x + cur.width - size.width : cur.x;
    return fitToScreen({ x, y: cur.y, width: size.width, height: size.height });
  }
  // 창이 뜬 뒤 실제 크기·위치가 의도와 다르면 바로잡는다(화면 배율이 다른 모니터에서 크기가 커지는 문제 대비)
  let ensureSeq = 0;
  function ensureBounds(target) {
    const forMode = mode;
    const seq = ++ensureSeq; // 새 확인이 시작되면 이전 확인은 멈춘다
    [80, 400, 1200].forEach((ms) =>
      setTimeout(() => {
        if (seq !== ensureSeq || mode !== forMode) return;
        if (!win || win.isDestroyed() || win.isMaximized() || win.isMinimized()) return;
        const cur = win.getBounds();
        const want = fitToScreen(target);
        const off = Math.abs(cur.width - want.width) > 3 || Math.abs(cur.height - want.height) > 3 || !sameBounds(fitToScreen(cur), cur);
        if (off) {
          switchingUntil = Date.now() + 800;
          win.setBounds(want);
        }
      }, ms),
    );
  }
  function placeFor(m) {
    if (!win || win.isDestroyed() || mode !== m) return;
    if (win.isMaximized()) return;
    const from = win.getBounds();
    const fromMode = m === 'mini' ? 'big' : 'mini';
    const to = anchoredBounds(m);
    win.setBounds(to);
    lastSwitch = { backMode: fromMode, back: from, toBounds: to };
    ensureBounds(to);
  }
  function applyMode(m) {
    if (!win) return;
    if (m !== 'mini' && m !== 'big') return;
    if (m !== mode) {
      rememberBounds();
      mode = m;
      switchingUntil = Date.now() + 1500;
      if (m === 'mini') {
        win.setMinimumSize(320, 420);
        win.setMaximizable(false);
      } else {
        win.setMinimumSize(900, 600);
        win.setMaximizable(true);
      }
      if (win.isMaximized()) {
        // 최대화 해제가 끝난 뒤에 크기를 맞춘다(먼저 바꾸면 해제하면서 원래 크기로 되돌아감)
        win.once('unmaximize', () => setTimeout(() => placeFor(m), 50));
        win.unmaximize();
      } else {
        placeFor(m);
      }
      // 한 번 더 확인: 그래도 크기가 다르면 다시 맞춘다
      setTimeout(() => {
        if (!win || win.isDestroyed() || mode !== m || win.isMaximized()) return;
        const cur = win.getBounds();
        const want = sizeFor(m);
        if (Math.abs(cur.width - want.width) > 2 || Math.abs(cur.height - want.height) > 2) {
          const keep = lastSwitch;
          win.setBounds(fitToScreen({ x: cur.x, y: cur.y, width: want.width, height: want.height }));
          if (keep) keep.toBounds = win.getBounds();
        }
      }, 400);
    }
    win.setAlwaysOnTop(mode === 'mini' && pinned, 'floating');
    saveState();
  }

  /* ---------- 창 ---------- */
  function createWindow(hidden) {
    switchingUntil = Date.now() + 1500;
    const b = boundsFor(mode);
    win = new BrowserWindow({
      ...b,
      minWidth: mode === 'mini' ? 320 : 900,
      minHeight: mode === 'mini' ? 420 : 600,
      maximizable: mode !== 'mini',
      frame: false,
      show: false,
      title: 'Dayline',
      backgroundColor: '#F2F4F6',
      icon: path.join(ROOT, 'assets', 'icon.png'),
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false, // 창을 숨겨도 알림 타이머가 정확하게 돌도록
        spellcheck: false,
      },
    });
    win.setAlwaysOnTop(mode === 'mini' && pinned, 'floating');
    win.loadFile(path.join(ROOT, 'index.html'), { query: { app: '1' } });
    win.once('ready-to-show', () => {
      // 그사이 화면 쪽 요청으로 모드가 바뀌었을 수 있으니, 지금 모드 기준으로 맞춘다
      if (!win.isMaximized()) {
        const cur = win.getBounds();
        const want = sizeFor(mode);
        const t = Math.abs(cur.width - want.width) > 3 || Math.abs(cur.height - want.height) > 3 ? boundsFor(mode) : fitToScreen(cur);
        win.setBounds(t);
        ensureBounds(t);
      }
      if (!hidden) win.show();
    });
    win.on('close', (e) => {
      if (quitting) return;
      e.preventDefault();
      // 창이 이미 숨어 있는데 닫으라는 요청이 오면 사용자가 아니라 설치 프로그램·시스템이 보낸 것 → 실제로 끈다
      if (!win.isVisible()) gracefulQuit();
      else hideToTray();
    });
    win.on('session-end', () => gracefulQuit());
    win.on('moved', rememberBounds);
    win.on('resized', rememberBounds);
    win.on('maximize', () => {
      maximizedFlag = true;
      send('win-state', { maximized: true });
    });
    win.on('unmaximize', () => {
      maximizedFlag = false;
      switchingUntil = Date.now() + 800;
      send('win-state', { maximized: false });
    });
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^(https?|mailto):/.test(url)) shell.openExternal(url); // 링크·메일은 기본 브라우저/메일 앱으로
      return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (e, url) => {
      if (!url.startsWith('file:')) e.preventDefault();
    });
  }
  function send(ch, data) {
    if (win && !win.isDestroyed()) win.webContents.send(ch, data);
  }
  function showWin() {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    if (!win.isMaximized()) ensureBounds(fitToScreen(win.getBounds()));
  }
  function hideToTray() {
    win.hide();
    if (!st.trayHintShown) {
      st.trayHintShown = true;
      saveState();
      toast({ title: 'Dayline이 트레이에서 실행 중이에요', body: '창을 닫아도 미리 알림은 계속 와요. 완전히 끄려면 트레이 아이콘 → 종료.', plain: true });
    }
  }
  // 저장을 디스크에 확실히 쓰고 끝낸다(설치 프로그램·Windows 종료 요청)
  async function gracefulQuit() {
    if (quitting) return;
    quitting = true;
    try {
      await session.defaultSession.flushStorageData();
    } catch (e) { /* 무시 */ }
    app.quit();
  }
  async function confirmQuit() {
    const r = await dialog.showMessageBox(win && win.isVisible() ? win : null, {
      type: 'question',
      buttons: ['종료', '취소'],
      defaultId: 1,
      cancelId: 1,
      title: 'Dayline 종료',
      message: 'Dayline을 종료할까요?',
      detail: '종료하면 미리 알림이 오지 않아요. 창만 닫으려면 X 버튼을 누르세요.',
    });
    if (r.response === 0) {
      quitting = true;
      app.quit();
    }
  }

  /* ---------- 트레이 ---------- */
  function createTray() {
    const img = nativeImage.createFromPath(path.join(ROOT, 'assets', 'tray.png'));
    tray = new Tray(img.isEmpty() ? nativeImage.createFromPath(path.join(ROOT, 'assets', 'icon.png')).resize({ width: 16, height: 16 }) : img);
    tray.setToolTip('Dayline');
    tray.on('click', showWin);
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Dayline 열기', click: showWin },
        { type: 'separator' },
        { label: '작은 메모창', click: () => { showWin(); send('set-mode', 'mini'); } },
        { label: '큰 앱', click: () => { showWin(); send('set-mode', 'big'); } },
        { type: 'separator' },
        { label: '종료', click: confirmQuit },
      ]),
    );
  }

  /* ---------- 알림 (Windows 토스트 + 완료/확인 버튼) ---------- */
  const xesc = (s) => String(s ?? '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
  function toast(p) {
    if (!Notification.isSupported()) {
      send('notif-failed', { id: p.id, error: 'unsupported' });
      return;
    }
    let n;
    if (p.plain || process.platform !== 'win32') {
      n = new Notification({ title: p.title, body: p.body, silent: false });
    } else {
      const arg = (a) => `${PROTOCOL}://${a}/${encodeURIComponent(p.id)}/${encodeURIComponent(p.taskId || '')}`;
      const xml =
        `<toast launch="${xesc(arg('open'))}" activationType="protocol">` +
        `<visual><binding template="ToastGeneric"><text>${xesc(p.title)}</text><text>${xesc(p.body)}</text></binding></visual>` +
        `<actions><action content="완료" arguments="${xesc(arg('done'))}" activationType="protocol"/>` +
        // '확인'은 앱을 거치지 않고 Windows가 알림만 닫는다(앱 창이 뜨거나 앞으로 나오지 않게)
        `<action content="확인" arguments="dismiss" activationType="system"/></actions>` +
        `<audio src="ms-winsoundevent:Notification.Reminder"/></toast>`;
      n = new Notification({ toastXml: xml });
    }
    toasts.add(n);
    const drop = () => setTimeout(() => toasts.delete(n), 60 * 60 * 1000);
    n.on('click', () => {
      showWin();
      if (p.id) send('notif-action', { action: 'open', notifId: p.id, taskId: p.taskId });
    });
    n.on('failed', (_e, err) => {
      send('notif-failed', { id: p.id, error: String(err) });
      // 버튼 있는 알림이 실패하면 기본 알림으로 한 번 더
      if (!p.plain) toast({ ...p, plain: true });
    });
    n.on('close', drop);
    n.show();
    drop();
  }
  function handleProtocol(url) {
    const m = /^dayline:\/\/(open|done|ok)\/([^/]*)\/?([^/?]*)/.exec(url || '');
    if (!m) return false;
    const action = m[1];
    const data = { action, notifId: decodeURIComponent(m[2]), taskId: decodeURIComponent(m[3] || '') };
    if (action === 'open') showWin();
    send('notif-action', data);
    return true;
  }

  /* ---------- 스티커 메모 읽기 ---------- */
  async function readStickyNotes() {
    try {
      const pk = path.join(process.env.LOCALAPPDATA || '', 'Packages');
      const dir = fs.existsSync(pk) ? fs.readdirSync(pk).find((d) => d.startsWith('Microsoft.MicrosoftStickyNotes_')) : null;
      const file = dir ? path.join(pk, dir, 'LocalState', 'plum.sqlite') : null;
      if (!file || !fs.existsSync(file)) return { ok: false, error: '이 PC에서 Windows 스티커 메모를 찾지 못했어요' };
      const initSqlJs = require('sql.js');
      const SQL = await initSqlJs();
      const db = new SQL.Database(fs.readFileSync(file));
      const res = db.exec('SELECT * FROM Note');
      db.close();
      if (!res.length) return { ok: true, notes: [] };
      const cols = res[0].columns;
      const notes = res[0].values
        .map((row) => Object.fromEntries(cols.map((c, i) => [c, row[i]])))
        .filter((r) => !r.DeletedAt)
        .map((r) => ({
          id: String(r.Id || ''),
          text: String(r.Text || '')
            .replace(/\\id=[0-9a-fA-F-]+ ?/g, '')
            .replace(/\r/g, '')
            .trim(),
        }))
        .filter((n) => n.text);
      return { ok: true, notes };
    } catch (e) {
      return { ok: false, error: '스티커 메모를 읽지 못했어요 (' + e.message + ')' };
    }
  }

  /* ---------- IPC ---------- */
  ipcMain.on('win:minimize', () => win && win.minimize());
  ipcMain.on('win:toggleMax', () => {
    if (!win || mode === 'mini') return;
    if (win.isMaximized() || maximizedFlag) {
      win.unmaximize();
      maximizedFlag = false;
      // 최대화가 풀렸는데도 화면을 꽉 채우고 있으면 평소 크기로 되돌린다
      setTimeout(() => {
        if (win && !win.isDestroyed() && fillsScreen(win.getBounds())) win.setBounds(boundsFor('big'));
      }, 150);
    } else if (fillsScreen(win.getBounds())) {
      win.setBounds(boundsFor('big'));
    } else {
      win.maximize();
    }
  });
  ipcMain.on('win:close', () => win && hideToTray());
  ipcMain.on('win:setMode', (_e, m) => applyMode(m));
  ipcMain.on('win:setPinned', (_e, v) => {
    pinned = !!v;
    applyMode(mode);
  });
  ipcMain.on('app:quit', () => confirmQuit());
  ipcMain.on('notify', (_e, p) => toast(p || {}));
  // "Windows 11 (26200)"처럼 사람이 읽는 이름. 빌드 22000부터 Windows 11
  function osName() {
    const rel = os.release();
    if (os.type() !== 'Windows_NT') return `${os.type()} ${rel}`;
    const build = Number(rel.split('.')[2]) || 0;
    return `${build >= 22000 ? 'Windows 11' : 'Windows 10'} (${build})`;
  }
  // 문제 알리기: 지금 창을 찍고, 이미지를 클립보드에 넣는다(메일 창에서 Ctrl+V로 붙이게)
  ipcMain.handle('win:capture', async () => {
    if (!win || win.isDestroyed()) return null;
    const img = await win.webContents.capturePage();
    return img.toDataURL();
  });
  // 문제 알리기: 만든 사람의 Google Apps Script 웹 앱으로 보낸다(그쪽에서 첨부와 함께 메일 발송)
  ipcMain.handle('feedback:send', async (_e, url, json) => {
    try {
      if (typeof url !== 'string' || !/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url)) throw new Error('보낼 주소가 올바르지 않아요');
      const res = await net.fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: String(json) });
      const text = await res.text();
      let ok = false;
      let error = '';
      try {
        const j = JSON.parse(text);
        ok = j.ok === true;
        error = j.error || '';
      } catch (e) {
        // JSON이 아니면 대개 구글 로그인 화면(웹 앱 액세스가 '모든 사용자'가 아님)
        error = /accounts\.google\.com|ServiceLogin/.test(text) ? '받는 곳이 로그인을 요구해요(웹 앱 액세스를 모든 사용자로)' : `응답이 이상해요 (${res.status})`;
      }
      return { ok, status: res.status, error };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle('clip:image', (_e, dataUrl) => {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return false;
    clipboard.writeImage(nativeImage.createFromDataURL(dataUrl));
    return true;
  });
  ipcMain.handle('app:getInfo', () => ({
    version: app.getVersion(),
    autostart: app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin,
    notificationsSupported: Notification.isSupported(),
    packaged: app.isPackaged,
    startShow: st.startHidden !== true,
    os: osName(),
    imgBase: pathToFileURL(imgDir()).href + '/',
  }));
  // 할 일 메모의 사진: 앱 데이터 폴더(images)에 파일로 두고 할 일에는 파일 이름만 적는다
  ipcMain.handle('img:save', (_e, dataUrl) => {
    try {
      const m = /^data:image\/(png|jpeg|jpg|gif|webp|bmp);base64,(.+)$/.exec(String(dataUrl || ''));
      if (!m) throw new Error('사진 형식이 아니에요');
      const buf = Buffer.from(m[2], 'base64');
      if (buf.length > 20 * 1024 * 1024) throw new Error('사진이 너무 커요(20MB까지)');
      fs.mkdirSync(imgDir(), { recursive: true });
      const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
      const file = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
      fs.writeFileSync(path.join(imgDir(), file), buf);
      return { ok: true, file };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  const imgName = (f) => typeof f === 'string' && /^[\w-]+\.(png|jpg|gif|webp|bmp)$/.test(f);
  ipcMain.handle('img:delete', (_e, file) => {
    if (!imgName(file)) return false;
    try {
      fs.unlinkSync(path.join(imgDir(), file));
    } catch (e) { /* 이미 없으면 그만 */ }
    return true;
  });
  ipcMain.handle('img:open', (_e, file) => (imgName(file) ? shell.openPath(path.join(imgDir(), file)) : 'bad name'));
  // 컴퓨터 켤 때 창을 띄울지(끄면 트레이에만)
  ipcMain.handle('app:setStartShow', (_e, v) => {
    st.startHidden = !v;
    saveState();
    return st.startHidden !== true;
  });
  ipcMain.handle('app:setAutostart', (_e, v) => {
    app.setLoginItemSettings({ openAtLogin: !!v, args: ['--hidden'] });
    st.autostartOff = !v;
    saveState();
    return app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin;
  });
  ipcMain.handle('sticky:read', () => readStickyNotes());

  /* ---------- 자동 백업: 문서\Dayline 백업, 최근 30일 ---------- */
  const backupDir = () => path.join(app.getPath('documents'), 'Dayline 백업');
  function imgDir() {
    return path.join(app.getPath('userData'), 'images');
  }
  // 파일 이름: 하루 백업 dayline-YYYYMMDD.json(30개), 되돌리기 직전 백업 dayline-before-YYYYMMDD-HHMMSS.json(5개)
  const BACKUP_RE = /^dayline-(\d{8}|before-\d{8}-\d{6})\.json$/;
  ipcMain.handle('backup:write', (_e, json, kind) => {
    try {
      if (typeof json !== 'string' || !json.startsWith('{')) throw new Error('백업 내용이 올바르지 않아요');
      const dir = backupDir();
      fs.mkdirSync(dir, { recursive: true });
      const d = new Date();
      const p2 = (n) => String(n).padStart(2, '0');
      const ymd = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}`;
      const before = kind === 'before';
      const name = before ? `dayline-before-${ymd}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}.json` : `dayline-${ymd}.json`;
      const tmp = path.join(dir, name + '.tmp');
      fs.writeFileSync(tmp, json, 'utf8');
      fs.renameSync(tmp, path.join(dir, name));
      const re = before ? /^dayline-before-\d{8}-\d{6}\.json$/ : /^dayline-\d{8}\.json$/;
      const files = fs.readdirSync(dir).filter((f) => re.test(f)).sort();
      while (files.length > (before ? 5 : 30)) fs.unlinkSync(path.join(dir, files.shift()));
      return { ok: true, dir, file: name };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle('backup:list', () => {
    try {
      const dir = backupDir();
      if (!fs.existsSync(dir)) return { ok: true, items: [] };
      const items = [];
      for (const f of fs.readdirSync(dir)) {
        if (!BACKUP_RE.test(f)) continue;
        const full = path.join(dir, f);
        const fst = fs.statSync(full);
        let tasks = null;
        let projects = null;
        let at = null;
        try {
          const j = JSON.parse(fs.readFileSync(full, 'utf8'));
          if (j && j.app === 'dayline' && Array.isArray(j.tasks)) {
            tasks = j.tasks.length;
            projects = (j.projects || []).length;
            at = j.exportedAt || null;
          }
        } catch (e) {}
        items.push({ file: f, before: f.includes('-before-'), at: at || fst.mtime.toISOString(), tasks, projects });
      }
      items.sort((a, b) => (a.at < b.at ? 1 : -1));
      return { ok: true, items };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle('backup:read', (_e, file) => {
    try {
      if (typeof file !== 'string' || !BACKUP_RE.test(file)) throw new Error('백업 파일 이름이 올바르지 않아요');
      return { ok: true, json: fs.readFileSync(path.join(backupDir(), file), 'utf8') };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle('backup:openDir', () => {
    fs.mkdirSync(backupDir(), { recursive: true });
    return shell.openPath(backupDir());
  });

  /* ---------- 시작 ---------- */
  app.on('second-instance', (_e, argv) => {
    if (argv.includes('--quit')) return gracefulQuit();
    const url = argv.find((a) => a.startsWith(PROTOCOL + '://'));
    if (!(url && handleProtocol(url))) showWin();
  });
  app.on('before-quit', () => {
    quitting = true;
  });
  app.on('window-all-closed', (e) => e.preventDefault());

  app.whenReady().then(() => {
    if (app.isPackaged) app.setAsDefaultProtocolClient(PROTOCOL);
    else app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1] || '.')]);
    st = loadState();
    mode = st.mode === 'mini' ? 'mini' : 'big';
    pinned = st.pinned !== false;
    Object.assign(bounds, st.bounds || {});
    // 예전 기본 크기(380×640, 420×620)가 저장돼 있으면 사용자가 고른 크기가 아니므로 새 기본 크기로
    // 예전 기본 크기나 잘못 저장된 크기(큰 앱 크기가 들어간 경우)는 버리고 새 기본 크기로
    const bm = bounds.mini;
    const oldDefaults = ['380x640', '420x620', '400x560'];
    if (bm && (oldDefaults.includes(`${bm.width}x${bm.height}`) || !plausible('mini', bm))) delete bounds.mini;
    if (bounds.big && !plausible('big', bounds.big)) delete bounds.big;
    if (app.isPackaged && !st.autostartSet) {
      // 처음 실행: 자동 실행은 켜지 않고 화면의 첫 안내에서 묻는다(켜면 setAutostart가 autostartOff를 푼다)
      st.autostartSet = true;
      st.autostartOff = true;
      saveState();
    } else if (app.isPackaged && !st.autostartOff && !app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin) {
      // 설치 위치가 바뀌었으면(예: 소스 폴더 → 기본 위치) 자동 실행 경로를 새 위치로 다시 등록
      app.setLoginItemSettings({ openAtLogin: true, args: ['--hidden'] });
    }
    // 로그인 자동 실행(--hidden)이어도 기본은 창을 띄운다. 설정에서 '켤 때 창 띄우기'를 끄면 트레이로만
    const hidden = process.argv.includes('--hidden') && st.startHidden === true;
    createWindow(hidden);
    createTray();
    const refit = () => {
      if (!win || win.isDestroyed() || win.isMaximized()) return;
      const cur = win.getBounds();
      const fit = fitToScreen(cur);
      if (!sameBounds(cur, fit)) win.setBounds(fit);
    };
    screen.on('display-removed', refit);
    screen.on('display-metrics-changed', refit);
    globalShortcut.register('Control+Shift+Space', () => {
      showWin();
      send('focus-quick');
    });
    const url = process.argv.find((a) => a.startsWith(PROTOCOL + '://'));
    if (url) win.webContents.once('did-finish-load', () => handleProtocol(url));
  });
  app.on('will-quit', () => globalShortcut.unregisterAll());
}
