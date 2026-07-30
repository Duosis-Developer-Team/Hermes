/**
 * Developer Portal — kopyalanabilir kod blogu.
 *
 * Kopyalama yalnizca panoya yazar; icerik hicbir yerde SAKLANMAZ
 * (state'te yalnizca "copied" bayragi tutulur). Ornekler her zaman
 * kurgusal veridir — gercek token/musteri/kullanici degeri iceremez.
 */
import { useState } from 'react'
import { Button, Tooltip, message } from 'antd'
import { CheckOutlined, CopyOutlined } from '@ant-design/icons'

function CodeBlock({ title, lang = 'bash', code }) {
    const [copied, setCopied] = useState(false)

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(code)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
        } catch {
            /*
             * Pano engellenmis olabilir (izin yok ya da guvensiz baglam).
             * Eskiden SESSIZCE yutuluyordu: kullanici butona basiyor,
             * hicbir sey olmuyor ve kopyalandigini saniyordu. Artik ne
             * yapacagi soyleniyor — icerik zaten secilebilir durumda.
             */
            message.warning('Copy is blocked here — select the code and copy manually.')
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
                        /*
                         * Bir sayfada onlarca kod blogu var; hepsinin adi
                         * "Copy code" olsaydi ekran okuyucu kullanicisi
                         * hangisini kopyaladigini bilemezdi.
                         */
                        aria-label={`Copy ${title || lang} example`}
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
