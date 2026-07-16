/**
 * Developer Portal — kopyalanabilir kod blogu.
 *
 * Kopyalama yalnizca panoya yazar; icerik hicbir yerde SAKLANMAZ
 * (state'te yalnizca "copied" bayragi tutulur). Ornekler her zaman
 * kurgusal veridir — gercek token/musteri/kullanici degeri iceremez.
 */
import { useState } from 'react'
import { Button, Tooltip } from 'antd'
import { CheckOutlined, CopyOutlined } from '@ant-design/icons'

function CodeBlock({ title, lang = 'bash', code }) {
    const [copied, setCopied] = useState(false)

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(code)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
        } catch {
            /* clipboard engellendiyse sessiz kal — icerik secilebilir */
        }
    }

    return (
        <div className="dp-code">
            <div className="dp-code-head">
                <span className="dp-code-title">{title || lang}</span>
                <Tooltip title={copied ? 'Copied' : 'Copy'}>
                    <Button
                        type="text"
                        size="small"
                        aria-label="Copy code"
                        icon={copied ? <CheckOutlined /> : <CopyOutlined />}
                        onClick={copy}
                    />
                </Tooltip>
            </div>
            <pre className="dp-code-body">
                <code>{code}</code>
            </pre>
        </div>
    )
}

export default CodeBlock
