/**
 * HERMES - Tema-tepkili uygulama koku (Sprint 2).
 * ConfigProvider AntD temasini buildAntdTheme'den alir; tema degisince
 * algorithm + token seti birlikte yeniden hesaplanir. CSS katmani zaten
 * data-theme attribute'undan besleniyor (ilk paint oncesi yazilir).
 */
import { BrowserRouter } from 'react-router-dom'
import { ConfigProvider } from 'antd'
import enUS from 'antd/locale/en_US'
import App from './App'
import { useThemeStore } from './stores/themeStore'
import { buildAntdTheme } from './theme/antdTheme'

export default function Root() {
    const mode = useThemeStore((s) => s.theme)
    return (
        <ConfigProvider locale={enUS} theme={buildAntdTheme(mode)}>
            <BrowserRouter>
                <App />
            </BrowserRouter>
        </ConfigProvider>
    )
}
