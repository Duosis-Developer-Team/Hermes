/**
 * =============================================================================
 * Hermes masaustu (macOS) — ana surec
 * =============================================================================
 * Uygulama bir KABUKTUR: secili sunucudaki Hermes'i (varsayilan
 * hermes.duosis.com) kendi penceresinde acar. Siteden yapilabilen her
 * sey buradan da yapilir; siteye cikan her yenilik uygulamaya da gelir.
 * Yerel katman:
 *   - macOS menusu (Duzen kisayollari, Git ⌘1–⌘4, Sunucu secimi)
 *   - Dock rozeti (okunmamis bildirim — web uygulamasi bildirir)
 *   - hermes:// derin linkleri (hermes://work/TASK-56)
 *   - pencere boyutu/konumu hatirlanir; baglanti yoksa yerel hata sayfasi
 * Guvenlik: contextIsolation + sandbox, Node sayfaya acik degil; pencere
 * yalniz sunucu + Microsoft giris sayfalarinda gezinir, digerleri
 * varsayilan tarayicida acilir; sertifika istisnasi YALNIZ dev host'u.
 * =============================================================================
 */
const path = require('node:path')
const { app, BrowserWindow, Menu, ipcMain, shell, session } = require('electron')

const { SERVERS, serverById, readSettings, writeSettings } = require('./servers')
const { classify, deepLinkToUrl } = require('./navigation')
const { TRAFFIC_LIGHTS, DRAG_CSS } = require('./windowChrome')

const PARTITION = 'persist:hermes'
let mainWindow = null
let pendingDeepLink = null

const settingsDir = () => app.getPath('userData')
const currentServer = () => serverById(readSettings(settingsDir()).serverId)

// --- Tek kopya + derin linkler ------------------------------------------------
if (!app.requestSingleInstanceLock()) {
    app.quit()
}
app.setAsDefaultProtocolClient('hermes')

function handleDeepLink(link) {
    const target = deepLinkToUrl(link, currentServer().url)
    if (!target) return
    if (!mainWindow) {
        pendingDeepLink = target
        return
    }
    mainWindow.loadURL(target)
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
}
app.on('open-url', (event, url) => {
    event.preventDefault()
    handleDeepLink(url)
})
app.on('second-instance', (_e, argv) => {
    const link = argv.find((a) => a.startsWith('hermes://'))
    if (link) handleDeepLink(link)
    else if (mainWindow) mainWindow.focus()
})

// --- Sertifika: yalniz dev sunucusunun sahte sertifikasi ----------------------
app.on('certificate-error', (event, _wc, url, _error, _cert, callback) => {
    const u = (() => { try { return new URL(url) } catch { return null } })()
    const trusted = SERVERS.find((s) => s.allowSelfSigned && u && new URL(s.url).origin === u.origin)
    if (trusted) {
        event.preventDefault()
        callback(true)
        return
    }
    callback(false)
})

// --- Pencere ---------------------------------------------------------------------
function attachNavigationPolicy(win) {
    const wc = win.webContents
    wc.on('will-navigate', (event, url) => {
        const kind = classify(url, currentServer().url)
        if (kind === 'internal' || kind === 'auth') return
        event.preventDefault()
        if (kind === 'external') shell.openExternal(url)
    })
    wc.setWindowOpenHandler(({ url }) => {
        const kind = classify(url, currentServer().url)
        if (kind === 'internal') {
            // Sunucunun kendi sayfasi yeni sekmede istenirse ayni pencerede ac.
            wc.loadURL(url)
        } else if (kind === 'external' || kind === 'auth') {
            shell.openExternal(url)
        }
        return { action: 'deny' }
    })
    wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
        // -3 = ABORTED (normal yonlendirmelerde olur), yerel sayfa zaten acik.
        if (!isMainFrame || code === -3 || url.startsWith('file:')) return
        win.loadFile(path.join(__dirname, 'offline.html'), {
            query: { target: url || currentServer().url, error: desc },
        })
    })
}

function createWindow() {
    const saved = readSettings(settingsDir()).bounds || {}
    mainWindow = new BrowserWindow({
        width: saved.width || 1440,
        height: saved.height || 900,
        x: saved.x,
        y: saved.y,
        minWidth: 1024,
        minHeight: 680,
        title: 'Hermes',
        show: false,
        backgroundColor: '#101114',
        // Hermes Liquid (R6): basliksiz pencere, trafik isiklari sivi
        // zeminin ustunde; surukleme bolgesi windowChrome.DRAG_CSS'te.
        titleBarStyle: 'hiddenInset',
        trafficLightPosition: TRAFFIC_LIGHTS,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            partition: PARTITION,
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
            spellcheck: true,
        },
    })
    attachNavigationPolicy(mainWindow)
    mainWindow.webContents.on('did-finish-load', () => {
        mainWindow?.webContents.insertCSS(DRAG_CSS).catch(() => {})
    })
    mainWindow.once('ready-to-show', () => mainWindow.show())
    mainWindow.on('close', () => {
        if (!mainWindow.isMaximized() && !mainWindow.isFullScreen()) {
            writeSettings(settingsDir(), { bounds: mainWindow.getBounds() })
        }
    })
    mainWindow.on('closed', () => { mainWindow = null })

    const start = pendingDeepLink || currentServer().url
    pendingDeepLink = null
    mainWindow.loadURL(start)
}

// --- Sunucu degistir --------------------------------------------------------------
function switchServer(id) {
    const server = serverById(id)
    writeSettings(settingsDir(), { serverId: server.id })
    if (mainWindow) mainWindow.loadURL(server.url)
    buildMenu()
}

function go(pathname) {
    if (!mainWindow) createWindow()
    const base = currentServer().url
    mainWindow.loadURL(new URL(pathname, base).toString())
}

// --- Menu --------------------------------------------------------------------------
function buildMenu() {
    const active = currentServer().id
    const template = [
        { role: 'appMenu' },
        { role: 'editMenu' },
        {
            label: 'Git',
            submenu: [
                { label: 'Ana sayfa', accelerator: 'CmdOrCtrl+1', click: () => go('/') },
                { label: 'İşler', accelerator: 'CmdOrCtrl+2', click: () => go('/project-management') },
                { label: 'Zaman girişi', accelerator: 'CmdOrCtrl+3', click: () => go('/time-entry') },
                { label: 'Toplantılar', accelerator: 'CmdOrCtrl+4', click: () => go('/meetings') },
                { type: 'separator' },
                { label: 'Geri', accelerator: 'CmdOrCtrl+[', click: () => mainWindow?.webContents.navigationHistory.goBack() },
                { label: 'İleri', accelerator: 'CmdOrCtrl+]', click: () => mainWindow?.webContents.navigationHistory.goForward() },
            ],
        },
        { role: 'viewMenu' },
        {
            label: 'Sunucu',
            submenu: SERVERS.map((s) => ({
                label: s.label,
                type: 'radio',
                checked: s.id === active,
                click: () => switchServer(s.id),
            })),
        },
        { role: 'windowMenu' },
        {
            role: 'help',
            submenu: [
                { label: 'Hermes\'i tarayıcıda aç', click: () => shell.openExternal(currentServer().url) },
            ],
        },
    ]
    Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// --- Web → yerel kopru --------------------------------------------------------------
ipcMain.on('hermes:set-badge', (event, count) => {
    const origin = (() => { try { return new URL(event.senderFrame.url).origin } catch { return null } })()
    if (origin !== new URL(currentServer().url).origin) return
    const n = Number.isInteger(count) && count > 0 ? count : 0
    app.setBadgeCount(n)
})

// --- Yasam dongusu ----------------------------------------------------------------
app.whenReady().then(() => {
    const ses = session.fromPartition(PARTITION)
    ses.setUserAgent(`${ses.getUserAgent()} HermesDesktop/${app.getVersion()}`)
    // Kamera/mikrofon/konum vb. izinler istenmez; bildirim ve pano serbest.
    ses.setPermissionRequestHandler((_wc, permission, callback) => {
        callback(['notifications', 'clipboard-sanitized-write', 'fullscreen'].includes(permission))
    })
    buildMenu()
    createWindow()
})

app.on('activate', () => {
    if (!mainWindow) createWindow()
})

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
})
