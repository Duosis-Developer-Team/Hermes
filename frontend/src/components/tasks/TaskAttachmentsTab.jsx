/**
 * =============================================================================
 * HERMES - Is kalemi ekleri sekmesi (PM rework P2.3 / F1)
 * =============================================================================
 * Detay panelinin "Ekler" sekmesi: liste + yukleme + indirme + kaldirma.
 * Ticket dropzone'u AYNEN kullanilir (iki adimli yukleme, sunucu tarar);
 * temiz dosya sunucuda aninda baglanir, liste tazelenir. Ozellik ortamda
 * kapaliysa (503) yalniz aciklama gosterilir.
 *
 * Yalniz sekme AKTIFKEN mount edilir (antd Tabs tembel) — panelin
 * provider'siz render sinirini bozmaz.
 * =============================================================================
 */
import { useState } from 'react'
import { Button, Empty, Spin, Typography, message } from 'antd'
import { DeleteOutlined, DownloadOutlined, PaperClipOutlined } from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { taskService } from '../../services/api'
import { queryKeys } from '../../query/queryKeys'
import AttachmentDropzone from '../../features/tickets/AttachmentDropzone'
import { useT } from '../../i18n'

const { Text } = Typography

const fmtSize = (bytes) => {
    const n = Number(bytes) || 0
    if (n < 1024) return `${n} B`
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
    return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function TaskAttachmentsTab({ taskId, canEdit = true }) {
    const t = useT()
    const queryClient = useQueryClient()
    const [pending, setPending] = useState([])

    const list = useQuery({
        queryKey: queryKeys.tasks.attachments(taskId),
        queryFn: () => taskService.listAttachments(taskId),
        enabled: Boolean(taskId),
        retry: false,
    })
    const disabled = list.error?.response?.status === 503
    const refresh = () =>
        queryClient.invalidateQueries({ queryKey: queryKeys.tasks.attachments(taskId) })

    const remove = useMutation({
        mutationFn: (attachmentId) => taskService.removeAttachment(taskId, attachmentId),
        onSuccess: () => { message.success(t('task.attachmentRemoved')); refresh() },
        onError: (err) => message.error(err?.response?.data?.detail || err?.message || 'Failed.'),
    })

    const onChange = (entries) => {
        setPending(entries)
        // Temiz olan ANINDA baglandi → listeyi tazele, gecici satiri dusur.
        if (entries.some((e) => e.status === 'clean')) {
            refresh()
            setPending(entries.filter((e) => e.status !== 'clean'))
        }
    }

    const items = list.data ?? []

    return (
        <div className="tdp-tab-body">
            {disabled ? (
                <Text type="secondary">{t('task.attachmentsDisabled')}</Text>
            ) : (
                <>
                    {canEdit && (
                        <AttachmentDropzone
                            enabled
                            value={pending}
                            onChange={onChange}
                            onOpenSession={(params) => taskService.openAttachmentSession(taskId, params)}
                            onUploadContent={(attachmentId, file) =>
                                taskService.uploadAttachmentContent(taskId, attachmentId, file)}
                        />
                    )}
                    <Text type="secondary" style={{ display: 'block', margin: '8px 0 12px' }}>
                        {t('task.attachmentsHint')}
                    </Text>
                    {list.isLoading ? (
                        <Spin size="small" />
                    ) : items.length === 0 ? (
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('task.attachmentsEmpty')} />
                    ) : (
                        <ul className="tdp-attachments" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                            {items.map((a) => (
                                <li
                                    key={a.id}
                                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}
                                >
                                    <PaperClipOutlined aria-hidden="true" />
                                    <span style={{ flex: 1 }}>{a.file_name}</span>
                                    <Text type="secondary">{fmtSize(a.size_bytes)}</Text>
                                    <Button
                                        type="text"
                                        size="small"
                                        icon={<DownloadOutlined />}
                                        href={taskService.attachmentDownloadUrl(taskId, a.id)}
                                        target="_blank"
                                        rel="noopener"
                                        aria-label={`${t('task.download')} — ${a.file_name}`}
                                    />
                                    {canEdit && (
                                        <Button
                                            type="text"
                                            size="small"
                                            danger
                                            icon={<DeleteOutlined />}
                                            disabled={remove.isPending}
                                            aria-label={`${t('task.removeAttachment')} — ${a.file_name}`}
                                            onClick={() => remove.mutate(a.id)}
                                        />
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}
                </>
            )}
        </div>
    )
}

export default TaskAttachmentsTab
