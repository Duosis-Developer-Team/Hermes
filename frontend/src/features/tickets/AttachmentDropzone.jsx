/**
 * =============================================================================
 * HERMES - Ek yükleme alanı (sürükle-bırak + yapıştır + dosya seçici)
 * =============================================================================
 * Üç giriş yolu da desteklenir; klavyeyle de erişilebilir (dropzone bir
 * `button`dur, Enter/Space dosya seçiciyi açar).
 *
 * İki adımlı akış sunucunun sözleşmesidir:
 *   1) oturum aç  → metadata satırı + karantina anahtarı
 *   2) içerik yükle → sniff + allowlist + malware taraması
 * Tarama bitene kadar dosya "Taranıyor" görünür ve ticket'a BAĞLANAMAZ.
 * Reddedilen dosya listede REDDEDİLDİ olarak kalır — sessizce kaybolmaz,
 * kullanıcı neden eklenmediğini görür.
 */
import { useRef, useState } from 'react'
import { DeleteOutlined, InboxOutlined, ReloadOutlined } from '@ant-design/icons'
import { Progress, Typography } from 'antd'

import { Button, Inline, Stack, StatusBadge } from '../../components/ui'
import './tickets.css'

const { Text } = Typography

const ACCEPT = '.png,.jpg,.jpeg,.webp,.pdf,.txt,.log'
const MAX_FILES = 5
const MAX_BYTES = 15 * 1024 * 1024
const TOTAL_MAX_BYTES = 50 * 1024 * 1024

const STATUS_VIEW = {
    uploading: { tone: 'info', label: 'Uploading' },
    pending_scan: { tone: 'warning', label: 'Scanning' },
    clean: { tone: 'success', label: 'Ready' },
    rejected: { tone: 'danger', label: 'Rejected' },
    scan_failed: { tone: 'danger', label: 'Scan failed' },
    failed: { tone: 'danger', label: 'Upload failed' },
}

const REJECT_REASONS = {
    mime_not_allowed: 'This file type is not allowed.',
    mime_mismatch: 'File content does not match its extension.',
    extension_mismatch: 'File content does not match its extension.',
    forbidden_executable: 'Executable files are not allowed.',
    forbidden_archive: 'Archive files are not allowed.',
    forbidden_markup: 'HTML and SVG files are not allowed.',
    malware_detected: 'Malicious content was detected in this file.',
    scanner_unavailable: 'The scanning service is unavailable right now.',
    empty_file: 'The file is empty.',
}

export default function AttachmentDropzone({
    enabled, onOpenSession, onUploadContent, value = [], onChange,
}) {
    const inputRef = useRef(null)
    const [dragging, setDragging] = useState(false)
    const [error, setError] = useState(null)

    if (!enabled) return null

    const patch = (localId, changes) => {
        onChange(value.map((item) => (
            item.localId === localId ? { ...item, ...changes } : item
        )))
    }

    const upload = async (entry, file) => {
        try {
            patch(entry.localId, { status: 'uploading', progress: 20 })
            const session = await onOpenSession({
                file_name: file.name,
                size_bytes: file.size,
                declared_mime_type: file.type || undefined,
            })
            patch(entry.localId, { id: session.id, progress: 60 })
            const stored = await onUploadContent(session.id, file)
            patch(entry.localId, {
                id: stored.id,
                status: stored.scan_status,
                reason: stored.scan_error_code,
                progress: 100,
            })
        } catch (err) {
            patch(entry.localId, {
                status: 'failed',
                reason: err?.normalized?.message || null,
                progress: 100,
            })
        }
    }

    const accept = (files) => {
        setError(null)
        const incoming = Array.from(files || [])
        if (!incoming.length) return
        if (value.length + incoming.length > MAX_FILES) {
            setError(`You can attach at most ${MAX_FILES} files.`)
            return
        }
        const totalBytes = value.reduce((sum, i) => sum + (i.size || 0), 0)
            + incoming.reduce((sum, f) => sum + f.size, 0)
        if (totalBytes > TOTAL_MAX_BYTES) {
            setError('Total attachment size exceeds the 50 MB limit.')
            return
        }
        const oversized = incoming.find((file) => file.size > MAX_BYTES)
        if (oversized) {
            setError(`"${oversized.name}" exceeds the 15 MB limit.`)
            return
        }
        const entries = incoming.map((file) => ({
            localId: `${file.name}-${file.size}-${Math.random()}`,
            name: file.name,
            size: file.size,
            status: 'uploading',
            progress: 0,
            file,
        }))
        onChange([...value, ...entries])
        entries.forEach((entry) => upload(entry, entry.file))
    }

    return (
        <Stack gap={2}>
            <button
                type="button"
                className={['h-ticket-dropzone',
                    dragging && 'h-ticket-dropzone--active']
                    .filter(Boolean).join(' ')}
                onClick={() => inputRef.current?.click()}
                onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                    event.preventDefault()
                    setDragging(false)
                    accept(event.dataTransfer?.files)
                }}
                onPaste={(event) => accept(event.clipboardData?.files)}
                aria-label="Add files: drag and drop, paste, or browse"
            >
                <InboxOutlined aria-hidden="true" />
                <span>
                    Drag and drop a file, paste a screenshot, or click to
                    browse
                </span>
                <Text type="secondary">
                    PNG, JPEG, WEBP, PDF, TXT, LOG · 15 MB per file ·
                    up to {MAX_FILES} files
                </Text>
            </button>
            <input
                ref={inputRef}
                type="file"
                multiple
                accept={ACCEPT}
                style={{ display: 'none' }}
                onChange={(event) => {
                    accept(event.target.files)
                    event.target.value = ''
                }}
            />

            {error && <Text type="danger">{error}</Text>}

            <Text type="secondary">
                Please make sure screenshots and logs contain no
                confidential information.
            </Text>

            {value.map((item) => {
                const view = STATUS_VIEW[item.status] ?? STATUS_VIEW.uploading
                return (
                    <Inline key={item.localId} gap={2}>
                        <Text>{item.name}</Text>
                        <Text type="secondary">
                            {Math.max(1, Math.round((item.size || 0) / 1024))} KB
                        </Text>
                        <StatusBadge tone={view.tone}>{view.label}</StatusBadge>
                        {item.status === 'uploading' && (
                            <Progress
                                percent={item.progress}
                                size="small"
                                style={{ width: 120 }}
                            />
                        )}
                        {item.reason && (
                            <Text type="secondary">
                                {REJECT_REASONS[item.reason] ?? item.reason}
                            </Text>
                        )}
                        {(item.status === 'failed'
                            || item.status === 'scan_failed') && (
                            <Button
                                size="small"
                                icon={<ReloadOutlined />}
                                onClick={() => upload(item, item.file)}
                            >
                                Retry
                            </Button>
                        )}
                        <Button
                            size="small"
                            icon={<DeleteOutlined />}
                            aria-label={`Remove ${item.name}`}
                            onClick={() => onChange(
                                value.filter((i) => i.localId !== item.localId),
                            )}
                        />
                    </Inline>
                )
            })}
        </Stack>
    )
}
