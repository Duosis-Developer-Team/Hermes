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
import App from './App'
import { useThemeStore } from './stores/themeStore'
import { buildAntdTheme } from './theme/antdTheme'

export default function Root() {
    const mode = useThemeStore((s) => s.theme)
    // Tema nesnesi mode'a bagli: ayni modda YENI nesne uretilmez, AntD
    // stil katmanini bosuna yeniden hesaplamaz.
    const antdTheme = useMemo(() => buildAntdTheme(mode), [mode])
    return (
        <ConfigProvider locale={enUS} theme={antdTheme}>
            <BrowserRouter>
                <App />
            </BrowserRouter>
        </ConfigProvider>
    )
}
