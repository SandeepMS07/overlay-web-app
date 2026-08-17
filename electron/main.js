'use strict';

const electron = require('electron');

// When ELECTRON_RUN_AS_NODE is set (VS Code's terminal exports it), the Electron
// binary boots as plain Node and the whole API is missing. Fail loudly instead
// of throwing on `app.isPackaged`.
if (!electron.app) {
  console.error(
    'Electron API unavailable — the binary was started in Node mode.\n' +
      'Run `npm run dev` (or `npm start`), which strips ELECTRON_RUN_AS_NODE.'
  );
  process.exit(1);
}

const {
  app,
  BrowserWindow,
  ipcMain,
  globalShortcut,
  screen,
  shell,
  Tray,
  Menu,
  nativeImage,
} = electron;
const path = require('path');
const fs = require('fs');
const net = require('net');
const { fork } = require('child_process');

const isDev = !app.isPackaged;

/** @type {BrowserWindow | null} */
let win = null;
/** @type {Tray | null} */
let tray = null;
/** @type {import('child_process').ChildProcess | null} */
let serverProc = null;
let serverUrl = '';

// Click-through is tracked here so the tray menu and shortcuts stay in sync
// with what the renderer thinks the state is.
let clickThrough = false;
// Mirrors the user's pin preference so re-pinning does not override it.
let alwaysOnTop = true;
// Excluded from screen capture by default — see setHiddenFromCapture().
let hiddenFromCapture = true;

const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');

// Sized for the chat panel: tall enough to read an answer without scrolling.
const DEFAULT_BOUNDS = { width: 460, height: 560 };

// --------------------------------------------------------------------------
// Next.js server
// --------------------------------------------------------------------------

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function waitForPort(port, timeoutMs = 30000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect(port, '127.0.0.1');
      socket.once('connect', () => {
        socket.destroy();
        resolve();
      });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() - started > timeoutMs) {
          reject(new Error(`Server did not start on port ${port} within ${timeoutMs}ms`));
        } else {
          setTimeout(attempt, 200);
        }
      });
    };
    attempt();
  });
}

/**
 * In development we attach to `next dev` (started by npm run dev).
 * In production we boot the standalone Next server as a child process using
 * Electron's own bundled Node, so end users never need Node installed.
 */
async function startServer() {
  if (isDev) {
    const port = Number(process.env.PORT || 3000);
    await waitForPort(port, 60000);
    serverUrl = `http://127.0.0.1:${port}`;
    return;
  }

  const port = await findFreePort();
  const serverEntry = path.join(process.resourcesPath, 'server', 'server.js');

  if (!fs.existsSync(serverEntry)) {
    throw new Error(`Bundled server missing at ${serverEntry}`);
  }

  serverProc = fork(serverEntry, [], {
    execPath: process.execPath,
    cwd: path.dirname(serverEntry),
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      NODE_ENV: 'production',
      PORT: String(port),
      HOSTNAME: '127.0.0.1',
      APP_DATA_DIR: app.getPath('userData'),
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });

  serverProc.stdout?.on('data', (d) => process.stdout.write(`[next] ${d}`));
  serverProc.stderr?.on('data', (d) => process.stderr.write(`[next] ${d}`));

  await waitForPort(port);
  serverUrl = `http://127.0.0.1:${port}`;
}

function stopServer() {
  if (serverProc && !serverProc.killed) {
    serverProc.kill();
    serverProc = null;
  }
}

// --------------------------------------------------------------------------
// Window state
// --------------------------------------------------------------------------

function loadBounds() {
  try {
    const saved = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    // Drop saved bounds that land off-screen (e.g. an external display is gone).
    const visible = screen.getAllDisplays().some((d) => {
      const a = d.workArea;
      return (
        saved.x < a.x + a.width &&
        saved.x + saved.width > a.x &&
        saved.y < a.y + a.height &&
        saved.y + saved.height > a.y
      );
    });
    if (!visible) return null;
    return saved;
  } catch {
    return null;
  }
}

function saveBounds() {
  if (!win || win.isDestroyed()) return;
  try {
    fs.writeFileSync(stateFile(), JSON.stringify(win.getBounds()));
  } catch {
    /* non-fatal */
  }
}

// --------------------------------------------------------------------------
// Overlay window
// --------------------------------------------------------------------------

/**
 * Keeps the overlay floating above everything, on every Space and over
 * full-screen apps. 'screen-saver' is the highest practical window level.
 */
function pinToAllSpaces() {
  if (!win || win.isDestroyed()) return;
  win.setAlwaysOnTop(alwaysOnTop, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
    // Without this Electron flips the process activation type on every call,
    // which makes the overlay flicker and can steal focus from the app behind.
    skipTransformProcessType: true,
  });
}

/**
 * Asks the OS window server to leave this window out of screen captures, so it
 * does not appear in a shared screen, a recording, or a screenshot.
 *
 *   macOS   — NSWindowSharingNone. Honoured by ScreenCaptureKit and the older
 *             CGWindowList path, which is what Zoom, Meet, Teams, Slack,
 *             QuickTime and ⌘⇧5 all capture through.
 *   Windows — WDA_EXCLUDEFROMCAPTURE on Windows 10 2004+, where the window is
 *             simply absent from the capture. On older builds Windows can only
 *             black the region out instead of hiding it.
 *
 * This is a window-server flag, not magic: anything that captures outside that
 * path still sees the window — a phone camera pointed at the screen, a hardware
 * HDMI capture box, or a remote-control tool that mirrors the framebuffer at
 * driver level.
 */
function applyContentProtection() {
  if (!win || win.isDestroyed()) return;
  win.setContentProtection(hiddenFromCapture);
}

function setHiddenFromCapture(enabled) {
  hiddenFromCapture = Boolean(enabled);
  applyContentProtection();
  win?.webContents.send('overlay:hidden-from-capture-changed', hiddenFromCapture);
  rebuildTrayMenu();
  return hiddenFromCapture;
}

/**
 * Moves the overlay to whichever display the cursor is on. A window only ever
 * lives on one physical monitor, so "show it on my other screen" has to be an
 * explicit move rather than something the window does by itself.
 */
function moveToActiveDisplay() {
  if (!win || win.isDestroyed()) return;
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const { width, height } = win.getBounds();
  const w = Math.min(width, area.width);
  const h = Math.min(height, area.height);

  win.setBounds({
    x: Math.round(area.x + area.width - w - 32),
    y: Math.round(area.y + 32),
    width: w,
    height: h,
  });
  win.show();
}

function createWindow() {
  const saved = loadBounds();
  const area = screen.getPrimaryDisplay().workArea;

  win = new BrowserWindow({
    width: saved?.width ?? DEFAULT_BOUNDS.width,
    height: saved?.height ?? DEFAULT_BOUNDS.height,
    x: saved?.x ?? area.x + area.width - DEFAULT_BOUNDS.width - 32,
    y: saved?.y ?? area.y + 32,
    minWidth: 280,
    minHeight: 180,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    show: false,
    // On macOS a plain always-on-top window cannot float above another app's
    // full-screen Space. 'panel' backs it with an NSPanel, which can — this is
    // what lets the overlay sit over full-screen VS Code, Chrome, Safari, etc.
    ...(process.platform === 'darwin' ? { type: 'panel' } : {}),
    // Frameless windows have no OS title bar, so the renderer draws its own
    // drag region (see -webkit-app-region in the UI).
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // Chromium throttles timers in unfocused windows, which would stall a
      // reply still streaming in while you work in another app.
      backgroundThrottling: false,
    },
  });

  pinToAllSpaces();
  // Set before the first show, so the window is never captured even briefly.
  applyContentProtection();

  win.loadURL(serverUrl);

  win.once('ready-to-show', () => win?.show());

  // macOS drops the all-Spaces flag when a window is hidden and shown again,
  // and both a display change and another app entering full screen can knock
  // the window out of its always-on-top level. Re-assert it on each of those.
  win.on('show', () => {
    pinToAllSpaces();
    // Re-asserted for the same reason: the flag lives on the native window and
    // a hide/show cycle is exactly when macOS has been seen to drop it.
    applyContentProtection();
  });
  win.on('blur', pinToAllSpaces);
  screen.on('display-added', pinToAllSpaces);
  screen.on('display-removed', pinToAllSpaces);
  screen.on('display-metrics-changed', pinToAllSpaces);

  win.on('resize', saveBounds);
  win.on('move', saveBounds);
  win.on('closed', () => {
    win = null;
  });

  // Any target=_blank / external navigation opens in the real browser rather
  // than hijacking the overlay.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(serverUrl)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
}

function toggleVisibility() {
  if (!win) return;
  if (win.isVisible()) {
    win.hide();
  } else {
    win.show(); // the 'show' handler re-pins it across Spaces
  }
}

function setClickThrough(enabled) {
  if (!win) return;
  clickThrough = Boolean(enabled);
  // `forward: true` keeps delivering mousemove to the renderer while clicks
  // pass through, which is what lets the toolbar re-arm itself on hover.
  win.setIgnoreMouseEvents(clickThrough, { forward: true });
  win.webContents.send('overlay:click-through-changed', clickThrough);
  rebuildTrayMenu();
}

function nudge(dx, dy) {
  if (!win) return;
  const b = win.getBounds();
  win.setBounds({ ...b, x: b.x + dx, y: b.y + dy });
}

// --------------------------------------------------------------------------
// Tray
// --------------------------------------------------------------------------

function trayIcon() {
  const file = path.join(__dirname, '..', 'build', 'trayTemplate.png');
  if (fs.existsSync(file)) {
    const img = nativeImage.createFromPath(file);
    img.setTemplateImage(true);
    return img;
  }
  return nativeImage.createEmpty();
}

function rebuildTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show / Hide Overlay', accelerator: 'CmdOrCtrl+Shift+Y', click: toggleVisibility },
      {
        label: 'Click-through',
        type: 'checkbox',
        checked: clickThrough,
        accelerator: 'CmdOrCtrl+Shift+C',
        click: () => setClickThrough(!clickThrough),
      },
      {
        label: 'Move to Active Screen',
        accelerator: 'CmdOrCtrl+Shift+M',
        click: moveToActiveDisplay,
      },
      {
        label: 'Hide from screen sharing',
        type: 'checkbox',
        checked: hiddenFromCapture,
        accelerator: 'CmdOrCtrl+Alt+P',
        click: () => setHiddenFromCapture(!hiddenFromCapture),
      },
      { type: 'separator' },
      {
        label: 'Reset Position',
        click: () => {
          if (!win) return;
          const area = screen.getPrimaryDisplay().workArea;
          win.setBounds({
            x: area.x + area.width - DEFAULT_BOUNDS.width - 32,
            y: area.y + 32,
            ...DEFAULT_BOUNDS,
          });
          win.show();
        },
      },
      { type: 'separator' },
      { label: 'Quit', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() },
    ])
  );
}

function createTray() {
  tray = new Tray(trayIcon());
  tray.setToolTip('Overlay Player');
  tray.on('click', toggleVisibility);
  rebuildTrayMenu();
}

// --------------------------------------------------------------------------
// Shortcuts
// --------------------------------------------------------------------------

function registerShortcuts() {
  const bind = (accel, fn) => {
    if (!globalShortcut.register(accel, fn)) {
      console.warn(`Could not register global shortcut: ${accel}`);
    }
  };

  bind('CommandOrControl+Shift+Y', toggleVisibility);
  bind('CommandOrControl+Shift+C', () => setClickThrough(!clickThrough));
  bind('CommandOrControl+Shift+M', moveToActiveDisplay);
  // Deliberately Alt and not Shift: a global shortcut wins over every app, and
  // Cmd+Shift+P is VS Code's command palette.
  bind('CommandOrControl+Alt+P', () => setHiddenFromCapture(!hiddenFromCapture));

  // Ask-a-question from anywhere: reveal the overlay, take focus, and let the
  // renderer put the caret in the composer.
  bind('CommandOrControl+Shift+A', () => {
    if (!win) return;
    win.show();
    win.focus();
    win.webContents.send('overlay:shortcut', 'focus-chat');
  });

  bind('CommandOrControl+Shift+Up', () => win?.webContents.send('overlay:shortcut', 'opacity-up'));
  bind('CommandOrControl+Shift+Down', () => win?.webContents.send('overlay:shortcut', 'opacity-down'));
  bind('CommandOrControl+Shift+Left', () => nudge(-40, 0));
  bind('CommandOrControl+Shift+Right', () => nudge(40, 0));
}

// --------------------------------------------------------------------------
// IPC
// --------------------------------------------------------------------------

function registerIpc() {
  ipcMain.handle('overlay:get-state', () => ({
    clickThrough,
    alwaysOnTop: win?.isAlwaysOnTop() ?? true,
    hiddenFromCapture,
    bounds: win?.getBounds() ?? null,
    platform: process.platform,
  }));

  ipcMain.handle('overlay:set-hidden-from-capture', (_e, enabled) =>
    setHiddenFromCapture(enabled)
  );

  ipcMain.handle('overlay:set-click-through', (_e, enabled) => {
    setClickThrough(enabled);
    return clickThrough;
  });

  // Called on every mousemove while click-through is armed: the renderer tells
  // us whether the cursor is over a control, and we briefly take back input.
  ipcMain.on('overlay:set-interactive', (_e, interactive) => {
    if (!win || !clickThrough) return;
    win.setIgnoreMouseEvents(!interactive, { forward: true });
  });

  ipcMain.handle('overlay:set-always-on-top', (_e, enabled) => {
    if (!win) return false;
    alwaysOnTop = Boolean(enabled);
    pinToAllSpaces();
    return win.isAlwaysOnTop();
  });

  ipcMain.handle('overlay:set-opacity', (_e, value) => {
    const v = Math.min(1, Math.max(0.15, Number(value) || 1));
    win?.setOpacity(v);
    return v;
  });

  ipcMain.handle('overlay:set-bounds', (_e, bounds) => {
    if (!win) return null;
    const current = win.getBounds();
    const next = {
      x: Math.round(bounds.x ?? current.x),
      y: Math.round(bounds.y ?? current.y),
      width: Math.round(Math.max(280, bounds.width ?? current.width)),
      height: Math.round(Math.max(180, bounds.height ?? current.height)),
    };
    win.setBounds(next);
    return next;
  });

  ipcMain.handle('overlay:set-size', (_e, { width, height }) => {
    if (!win) return null;
    win.setSize(Math.round(Math.max(280, width)), Math.round(Math.max(180, height)));
    return win.getBounds();
  });

  // An NSPanel does not take key focus when clicked, so the renderer asks for
  // it explicitly before typing into the URL field.
  ipcMain.on('overlay:focus', () => {
    if (win && !win.isDestroyed() && !clickThrough) win.focus();
  });

  ipcMain.on('overlay:move-to-active-display', moveToActiveDisplay);

  ipcMain.on('overlay:hide', () => win?.hide());
  ipcMain.on('overlay:quit', () => app.quit());
  ipcMain.on('overlay:open-external', (_e, url) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
  });
}

// --------------------------------------------------------------------------
// Lifecycle
// --------------------------------------------------------------------------

// Single-user app: a second launch just reveals the existing overlay.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      win.show();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      await startServer();
    } catch (err) {
      console.error('Failed to start the app server:', err);
      app.quit();
      return;
    }
    registerIpc();
    createWindow();
    createTray();
    registerShortcuts();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else win?.show();
    });
  });

  // The overlay lives in the tray, so closing the window should not quit on
  // macOS; on Windows the tray keeps it alive too.
  app.on('window-all-closed', (e) => {
    e.preventDefault?.();
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    stopServer();
  });

  app.on('before-quit', saveBounds);
}
