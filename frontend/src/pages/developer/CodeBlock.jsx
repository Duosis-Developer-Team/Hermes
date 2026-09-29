/**
 * Developer Portal — kopyalanabilir kod blogu + dil sekmeli varyanti.
 *
 * Kopyalama yalnizca panoya yazar; icerik hicbir yerde SAKLANMAZ
 * (state'te yalnizca "copied" bayragi tutulur). Ornekler her zaman
 * kurgusal veridir — gercek token/musteri/kullanici degeri iceremez.
 *
 * Kod penceresi IKI temada da koyudur (kod okunurlugu icin bilinen
 * desen); renkleri yalnizca bu dosyanin CSS'indeki sozdizimi temasindan.
 */
import { useState } from 'react'
import { message } from 'antd'
import { CheckOutlined, CopyOutlined } from '@ant-design/icons'

import { LiquidSegmented } from '../../components/liquid'
import { useT } from '../../i18n'

function CodeBlock({ title, lang = 'bash', code, toolbar }) {
    const t = useT()
    const [copied, setCopied] = useState(false)

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(code)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
        } catch {
            /*
             * Pano engellenmis olabilir (izin yok ya da guvensiz baglam).
             * Sessizce yutmak kullaniciyi "kopyalandi" sanmaya iter;
             * ne yapacagini soyle — icerik zaten secilebilir durumda.
             */
            message.warning(t('devPortal.common.copyBlocked'))
        }
    }

    const name = title || lang
    return (
        <div className="dp-code">
            <div className="dp-code__head">
                <span className="dp-code__dots" aria-hidden="true"><i /><i /><i /></span>
                {toolbar || <span className="dp-code__title">{name}</span>}
                <button
                    type="button"
                    className={`dp-code__copy${copied ? ' is-done' : ''}`}
                    /*
                     * Bir sayfada onlarca kod blogu var; hepsinin adi ayni
                     * olsaydi ekran okuyucu hangisini kopyaladigini bilemezdi.
                     */
                    aria-label={t('devPortal.common.copyNamed', { name })}
                    onClick={copy}
                >
                    {copied ? <CheckOutlined /> : <CopyOutlined />}
                    <span>{copied ? t('devPortal.common.copied') : t('devPortal.common.copy')}</span>
                </button>
            </div>
            <pre className="dp-code__body">
                <code>{code}</code>
            </pre>
        </div>
    )
}

/**
 * Ayni ornegin dil varyantlari (curl / JavaScript / Python). Secim
 * bilesen icinde tutulur; sekme adlari urun/dil adidir, cevrilmez.
 * samples: [{ key, label, lang, code }]
 */
export function CodeTabs({ samples, ariaLabel }) {
    const [active, setActive] = useState(samples[0]?.key)
    const current = samples.find((s) => s.key === active) || samples[0]
    return (
        <CodeBlock
            title={current.label}
            lang={current.lang}
            code={current.code}
            toolbar={(
                <LiquidSegmented
                    className="dp-code__tabs"
                    ariaLabel={ariaLabel}
                    value={current.key}
                    onChange={setActive}
                    options={samples.map((s) => ({ value: s.key, label: s.label }))}
                />
            )}
        />
    )
}

export default CodeBlock
