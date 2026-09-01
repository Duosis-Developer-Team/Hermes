/**
 * HERMES - Tema-tepkili uygulama koku (Sprint 2).
 * ConfigProvider AntD temasini buildAntdTheme'den alir; tema degisince
 * algorithm + token seti birlikte yeniden hesaplanir. CSS katmani zaten
 * data-theme attribute'undan besleniyor (ilk paint oncesi yazilir).
 */
import { useMemo } from 'react'
import { BrowserRouter } from 'react-router-dom'
import { ConfigProvider } from 'antd'
import enUS from 'antd/locale/en_US'
import trTR from 'antd/locale/tr_TR'
import App from './App'
import { useThemeStore } from './stores/themeStore'
import { useLocaleStore } from './stores/localeStore'
import { buildAntdTheme } from './theme/antdTheme'

// AntD'nin KENDI metinleri (sayfalama, "No data", tarih secici ay
// adlari, tablo filtre dugmeleri) sozlugumuzden gelmez — ConfigProvider
// bunlari kendi locale paketinden alir. Dil dugmesi ikisini BIRDEN
// cevirmezse arayuzun yarisi Ingilizce kalirdi.
const ANTD_LOCALES = { en: enUS, tr: trTR }

export default function Root() {
    const mode = useThemeStore((s) => s.theme)
    const locale = useLocaleStore((s) => s.locale)
    // Tema nesnesi mode'a bagli: ayni modda YENI nesne uretilmez, AntD
    // stil katmanini bosuna yeniden hesaplamaz.
    const antdTheme = useMemo(() => buildAntdTheme(mode), [mode])
    return (
        <ConfigProvider locale={ANTD_LOCALES[locale] ?? enUS} theme={antdTheme}>
            <BrowserRouter>
                <App />
            </BrowserRouter>
        </ConfigProvider>
    )
}
