/**
 * =============================================================================
 * HERMES PLATFORM - React Application Entry Point
 * =============================================================================
 * Ana giriş noktası. React, Ant Design, React Query ve Router yapılandırması.
 * =============================================================================
 */

import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ConfigProvider } from 'antd'
import enUS from 'antd/locale/en_US'
import dayjs from 'dayjs'
import 'dayjs/locale/en'

import App from './App'
import AppErrorBoundary from './components/common/AppErrorBoundary'
import './index.css'

dayjs.locale('en')

// React Query client
const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 5 * 60 * 1000, // 5 dakika
            retry: 1,
            refetchOnWindowFocus: false,
        },
    },
})

// Ant Design tema
const theme = {
    token: {
        colorPrimary: '#6366f1',  // Indigo
        colorSuccess: '#22c55e',  // Green
        colorWarning: '#f59e0b',  // Amber
        colorError: '#ef4444',    // Red
        colorInfo: '#3b82f6',     // Blue
        borderRadius: 8,
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    },
    components: {
        Layout: {
            headerBg: '#1e1b4b',
            siderBg: '#1e1b4b',
        },
        Menu: {
            darkItemBg: '#1e1b4b',
            darkItemSelectedBg: '#4338ca',
        },
    },
}

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <AppErrorBoundary>
            <QueryClientProvider client={queryClient}>
                <ConfigProvider locale={enUS} theme={theme}>
                    <BrowserRouter>
                        <App />
                    </BrowserRouter>
                </ConfigProvider>
            </QueryClientProvider>
        </AppErrorBoundary>
    </React.StrictMode>,
)
