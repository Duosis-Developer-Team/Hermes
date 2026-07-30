/**
 * =============================================================================
 * HERMES - Token'in duz metin olarak gorundugu TEK yer (Sprint 6A/6C)
 * =============================================================================
 * GUVENLIK SOZLESMESI (davranis DEGISMEDI, yalnizca sorumluluk siniri
 * netlestirildi):
 *   - Plaintext token sunucudan YALNIZCA uretim aninda doner; bu modal onu
 *     BIR KEZ gosterir. Yeniden sorgulanamaz, sonradan tekrar gosterilemez.
 *   - Kullanici "kaydettim" onayini vermeden modal kapanmaz.
 *   - Deger localStorage/URL/log/hata mesajina TASINMAZ.
 * =============================================================================
 */
import { useState } from 'react'
import { Alert, Button, Checkbox, Modal, Space, Tooltip, message } from 'antd'
import { CopyOutlined, EyeInvisibleOutlined, EyeOutlined } from '@ant-design/icons'

export default function TokenOnceModal({ issued, onDone }) {
    const [copied, setCopied] = useState(false)
    const [confirmed, setConfirmed] = useState(false)
    const [masked, setMasked] = useState(false)

    if (!issued) return null
    const token = issued.token

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(token)
            setCopied(true)
            message.success('Token copied to clipboard.')
        } catch {
            message.error('Copy failed — select and copy manually.')
        }
    }

    return (
        <Modal
            open
            title="API token created"
            closable={false}
            maskClosable={false}
            keyboard={false}
            footer={
                <Button
                    type="primary"
                    disabled={!confirmed}
                    onClick={onDone}
                >
                    Done — token stored securely
                </Button>
            }
            width={640}
            destroyOnHidden
        >
            <Alert
                type="warning"
                showIcon
                message="This token will not be shown again. Store it securely now."
                style={{ marginBottom: 16 }}
            />
            <div className="am-token-box">
                <code className="am-token-value">
                    {masked
                        ? `${token.slice(0, 12)}${'•'.repeat(24)}`
                        : token}
                </code>
                <Space>
                    <Tooltip title={masked ? 'Show' : 'Hide'}>
                        <Button
                            size="small"
                            icon={
                                masked ? (
                                    <EyeOutlined />
                                ) : (
                                    <EyeInvisibleOutlined />
                                )
                            }
                            onClick={() => setMasked((m) => !m)}
                        />
                    </Tooltip>
                    <Button
                        size="small"
                        type="primary"
                        icon={<CopyOutlined />}
                        onClick={copy}
                    >
                        Copy
                    </Button>
                </Space>
            </div>
            <Checkbox
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                style={{ marginTop: 16 }}
            >
                I have copied and securely stored this token.
            </Checkbox>
            {!copied && confirmed && (
                <div className="am-token-hint">
                    Tip: use the Copy button to avoid typos.
                </div>
            )}
        </Modal>
    )
}
