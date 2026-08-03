/**
 * =============================================================================
 * HERMES - Error boundary katmanlari (Sprint 1 §5.4)
 * =============================================================================
 *  - AppErrorBoundary: en dis fatal katman (shell dahil her sey coktu).
 *  - RouteErrorBoundary: route icerigi icin KURTARILABILIR katman —
 *    shell ayakta kalir, kullanici retry edebilir; route degisince
 *    otomatik sifirlanir.
 * Hata UI'si teknik dump/secret/API yaniti ICERMEZ; yalniz kullanici
 * mesaji + retry + (varsa) korelasyon kimligi gosterir.
 */
import React from 'react'
import { Button, Result } from 'antd'

class BaseBoundary extends React.Component {
    constructor(props) {
        super(props)
        this.state = { error: null }
    }

    static getDerivedStateFromError(error) {
        return { error }
    }

    componentDidCatch(error) {
        // Yalniz sinif adi/mesaj loglanir; response/stack dump YOK.
        console.error('[hermes-boundary]', this.props.level, error?.name)
    }

    componentDidUpdate(prev) {
        // Route degisti → kurtarilabilir katman kendini sifirlar.
        if (this.props.resetKey !== prev.resetKey && this.state.error) {
            this.setState({ error: null })
        }
    }

    render() {
        if (!this.state.error) return this.props.children
        return (
            <Result
                status="error"
                title={this.props.title}
                subTitle={this.props.subtitle}
                extra={
                    <Button
                        type="primary"
                        onClick={() => this.setState({ error: null })}
                    >
                        Tekrar dene
                    </Button>
                }
            />
        )
    }
}

export function AppErrorBoundary({ children }) {
    return (
        <BaseBoundary
            level="app"
            title="Hermes ran into an unexpected error"
            subtitle="Refreshing the page usually fixes this. If it persists, contact your administrator."
        >
            {children}
        </BaseBoundary>
    )
}

export function RouteErrorBoundary({ resetKey, children }) {
    return (
        <BaseBoundary
            level="route"
            resetKey={resetKey}
            title="Something went wrong while loading this page"
            subtitle="Other pages keep working. You can try again."
        >
            {children}
        </BaseBoundary>
    )
}
