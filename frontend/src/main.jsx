/**
 * =============================================================================
 * HERMES PLATFORM - React Application Entry Point
 * =============================================================================
 * Ana giriş noktası. React, Ant Design, React Query ve Router yapılandırması.
 * =============================================================================
 */

import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import dayjs from 'dayjs'
import 'dayjs/locale/en'

import Root from './Root'
import AppErrorBoundary from './components/common/AppErrorBoundary'
// Side-effect import: applies the saved data-theme to <html> before the
// first paint so there's no dark→light flash on light-mode reloads.
// Side-effect: ilk paint oncesi data-theme attribute'u yazilir.
import './stores/themeStore'
import './styles/tokens.css'
import './index.css'

dayjs.locale('en')

// React Query client — merkezi fabrika (Sprint 1): src/query/queryClient.js
import { queryClient } from './query/queryClient'
// DS V2 (Sprint 2): AntD temasi artik token koprusunden ve TEPKILI —
// tema degisince ConfigProvider algorithm+token seti birlikte doner.


ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <AppErrorBoundary>
            <QueryClientProvider client={queryClient}>
                <Root />
            </QueryClientProvider>
        </AppErrorBoundary>
    </React.StrictMode>,
)
