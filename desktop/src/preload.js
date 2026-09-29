/**
 * Hermes masaustu — web uygulamasina acilan DAR kopru.
 *
 * Yalnizca `window.hermesDesktop` acilir; Node/Electron API'si sayfaya
 * sizmaz (contextIsolation + sandbox). Ana surec, mesajin SECILI SUNUCU
 * origin'inden geldigini ayrica dogrular (Microsoft giris sayfasi bu
 * nesneyi gorse bile hicbir sey yapamaz).
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('hermesDesktop', Object.freeze({
    isDesktop: true,
    platform: process.platform,
    /** Dock rozeti: okunmamis bildirim sayisi (0 → rozet kalkar). */
    /** Sunucu katalogu: { current, servers:[{id,label}] } ya da null. */
    getServers: () => {
        try { return ipcRenderer.sendSync('hermes:get-servers') } catch { return null }
    },
    /** Tek tikla sunucu gecisi (Test ⇄ Dev); pencere yeni sunucuyu yukler. */
    switchServer: (id) => ipcRenderer.send('hermes:switch-server', String(id)),
    setBadgeCount: (count) => {
        const n = Number(count)
        ipcRenderer.send('hermes:set-badge', Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 999) : 0)
    },
}))
