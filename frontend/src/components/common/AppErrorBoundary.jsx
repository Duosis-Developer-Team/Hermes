/**
 * =============================================================================
 * HERMES - App Error Boundary
 * =============================================================================
 * Top-level catch-all so a render-time error anywhere in the tree
 * doesn't unmount the whole document and leave the user staring at
 * an empty gray <div id="root">. We render a small Hermes-styled
 * error card with a Reload button and surface the message to the
 * console for debugging.
 * =============================================================================
 */

import React from 'react'

export default class AppErrorBoundary extends React.Component {
    constructor(props) {
        super(props)
        this.state = { error: null }
    }

    static getDerivedStateFromError(error) {
        return { error }
    }

    componentDidCatch(error, info) {
        // eslint-disable-next-line no-console
        console.error('[Hermes] Render error caught by boundary:', error, info)
    }

    handleReload = () => {
        window.location.reload()
    }

    render() {
        if (!this.state.error) return this.props.children

        return (
            <div
                style={{
                    minHeight: '100vh',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '24px',
                    background: '#0f0f0f',
                    color: '#e5e5e5',
                    fontFamily:
                        "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
                }}
            >
                <div
                    style={{
                        maxWidth: 520,
                        width: '100%',
                        background: 'var(--c-surface)',
                        border: '1px solid var(--c-border)',
                        borderRadius: 10,
                        padding: '24px 28px',
                        boxShadow: '0 10px 30px rgba(0,0,0,0.45)',
                    }}
                >
                    <div
                        style={{
                            fontSize: 18,
                            fontWeight: 600,
                            color: 'var(--c-text-strong)',
                            marginBottom: 8,
                        }}
                    >
                        Something went wrong.
                    </div>
                    <div
                        style={{
                            color: 'var(--c-text-muted)',
                            fontSize: 13,
                            marginBottom: 16,
                            lineHeight: 1.5,
                        }}
                    >
                        Hermes ran into an unexpected error while rendering
                        this page. Reloading usually fixes it. The
                        underlying error is logged in the browser console.
                    </div>
                    <pre
                        style={{
                            background: 'var(--c-surface-2)',
                            border: '1px solid var(--c-border)',
                            borderRadius: 6,
                            padding: 10,
                            color: '#fca5a5',
                            fontSize: 12,
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                            maxHeight: 140,
                            overflow: 'auto',
                            marginBottom: 16,
                        }}
                    >
                        {String(this.state.error?.message || this.state.error)}
                    </pre>
                    <button
                        type="button"
                        onClick={this.handleReload}
                        style={{
                            appearance: 'none',
                            border: 'none',
                            background: '#6366f1',
                            color: 'var(--c-text-strong)',
                            fontWeight: 600,
                            fontSize: 14,
                            padding: '8px 18px',
                            borderRadius: 6,
                            cursor: 'pointer',
                        }}
                    >
                        Reload
                    </button>
                </div>
            </div>
        )
    }
}
