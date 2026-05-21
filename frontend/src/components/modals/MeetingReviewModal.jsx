/**
 * =============================================================================
 * HERMES - Meeting Review Modal (Stage 4 — read-only)
 * =============================================================================
 * Detail view for a synced meeting: title, time, organizer, attendees,
 * Teams join link, optional preview body. Stage 5 will add the Log
 * Time button + Log Time prefill flow; this file is structured so
 * those changes land as additions rather than a rewrite.
 *
 * Privacy: private/confidential meetings have their subject masked
 * to "Private Meeting" and body_preview nulled at sync time — this
 * modal just renders whatever the backend gives us.
 * =============================================================================
 */

import { Alert, Button, Modal, Space, Tag, Typography } from 'antd'
import {
    CalendarOutlined,
    CheckCircleOutlined,
    FieldTimeOutlined,
    LinkOutlined,
    LockOutlined,
    TeamOutlined,
    UsergroupAddOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import './MeetingReviewModal.css'

const { Text, Paragraph } = Typography

function Row({ label, children }) {
    return (
        <div style={{ display: 'flex', gap: 12, padding: '6px 0' }}>
            <Text style={{ width: 110, color: 'var(--c-text-muted)' }}>{label}</Text>
            <div style={{ flex: 1, color: 'var(--c-text-strong)' }}>{children}</div>
        </div>
    )
}

function MeetingReviewModal({
    open,
    meeting,
    onClose,
    onLogTime,
    isLogged = false,
}) {
    if (!meeting) return null

    const start = meeting.start_datetime
        ? dayjs(meeting.start_datetime)
        : null
    const end = meeting.end_datetime ? dayjs(meeting.end_datetime) : null
    const isPrivate =
        meeting.sensitivity === 'private' ||
        meeting.sensitivity === 'confidential'
    const isCancelled = !!meeting.is_cancelled

    const dateStr = start ? start.format('YYYY-MM-DD') : '—'
    const timeRange =
        start && end
            ? `${start.format('HH:mm')} – ${end.format('HH:mm')}`
            : '—'
    const durationMin = meeting.duration_minutes || 0
    const durationLabel =
        durationMin >= 60
            ? `${Math.floor(durationMin / 60)}h ${durationMin % 60}m`.replace(
                  / 0m$/,
                  ''
              )
            : durationMin > 0
            ? `${durationMin}m`
            : '—'

    const attendees = meeting.attendees || []
    const organizer =
        meeting.organizer_name || meeting.organizer_email || '—'

    const handleOpenTeams = () => {
        if (meeting.join_url) {
            window.open(meeting.join_url, '_blank', 'noopener,noreferrer')
        }
    }

    return (
        <Modal
            title={
                <span>
                    {isPrivate ? (
                        <LockOutlined style={{ marginRight: 8, color: 'var(--c-text-muted)' }} />
                    ) : (
                        <CalendarOutlined
                            style={{ marginRight: 8, color: '#22d3ee' }}
                        />
                    )}
                    {meeting.subject || '(Untitled meeting)'}
                </span>
            }
            open={open}
            onCancel={onClose}
            footer={null}
            width={560}
            destroyOnClose
            className="meeting-review-modal"
        >
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                {isCancelled && (
                    <Alert
                        type="error"
                        showIcon
                        message={
                            <Tag color="red" style={{ marginRight: 8 }}>
                                CANCELLED
                            </Tag>
                        }
                    />
                )}
                {isLogged && (
                    <Alert
                        type="success"
                        showIcon
                        icon={<CheckCircleOutlined />}
                        message="Time logged for this meeting."
                    />
                )}
                {isPrivate && (
                    <Alert
                        type="info"
                        showIcon
                        icon={<LockOutlined />}
                        message="Private meeting — full details are intentionally not stored."
                    />
                )}

                <div>
                    <Row label="Date">{dateStr}</Row>
                    <Row label="Time">{timeRange}</Row>
                    <Row label="Duration">{durationLabel}</Row>
                    <Row label="Organizer">
                        {organizer}
                        {meeting.organizer_email &&
                        meeting.organizer_name ? (
                            <span style={{ color: 'var(--c-text-muted)', marginLeft: 8 }}>
                                {meeting.organizer_email}
                            </span>
                        ) : null}
                    </Row>
                    <Row label="Attendees">
                        <span>
                            <UsergroupAddOutlined
                                style={{ marginRight: 6, color: 'var(--c-text-muted)' }}
                            />
                            {attendees.length}
                        </span>
                    </Row>
                    {meeting.is_online_meeting && (
                        <Row label="Type">
                            <Tag color="cyan">
                                <TeamOutlined /> Microsoft Teams
                            </Tag>
                        </Row>
                    )}
                </div>

                {meeting.body_preview && !isPrivate && (
                    <div>
                        <Text style={{ color: 'var(--c-text-muted)' }}>Description</Text>
                        <Paragraph
                            style={{
                                color: 'var(--c-text-strong)',
                                background: 'var(--c-surface-raised)',
                                border: '1px solid var(--c-border)',
                                borderRadius: 6,
                                padding: 10,
                                marginTop: 4,
                                whiteSpace: 'pre-wrap',
                                maxHeight: 160,
                                overflowY: 'auto',
                            }}
                        >
                            {meeting.body_preview}
                        </Paragraph>
                    </div>
                )}

                {attendees.length > 0 && (
                    <div>
                        <Text style={{ color: 'var(--c-text-muted)' }}>Invited</Text>
                        <div
                            style={{
                                marginTop: 6,
                                background: 'var(--c-surface-raised)',
                                border: '1px solid var(--c-border)',
                                borderRadius: 6,
                                padding: 8,
                                maxHeight: 140,
                                overflowY: 'auto',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 2,
                            }}
                        >
                            {attendees.map((a) => (
                                <div
                                    key={a.id}
                                    style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        fontSize: 12,
                                        gap: 8,
                                    }}
                                >
                                    <span style={{ color: 'var(--c-text)' }}>
                                        {a.display_name || a.email}
                                    </span>
                                    <span
                                        style={{
                                            color: a.hermes_user_id
                                                ? '#22d3ee'
                                                : 'var(--c-text-faint)',
                                            fontSize: 10,
                                            fontWeight: 600,
                                            textTransform: 'uppercase',
                                            letterSpacing: 0.04,
                                        }}
                                    >
                                        {a.hermes_user_id
                                            ? 'Hermes user'
                                            : 'External'}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                <div
                    style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: 8,
                        paddingTop: 4,
                        flexWrap: 'wrap',
                    }}
                >
                    {/* Log Time is the primary post-meeting action.
                        It opens the existing Time Entry modal pre-
                        filled with the meeting's date/duration/
                        description; customer + project stay user-
                        selected. Cancelled meetings can still be
                        logged (the user may have done prep work). */}
                    {onLogTime && !isLogged && (
                        <Button
                            type="primary"
                            icon={<FieldTimeOutlined />}
                            onClick={() => onLogTime(meeting)}
                        >
                            Log Time
                        </Button>
                    )}
                    {/* Right-aligned cluster: Teams + Close. The
                        spacer <span/> keeps Close pinned right when
                        Log Time isn't shown. */}
                    {(!onLogTime || isLogged) && <span />}
                    <Space>
                        {meeting.join_url && (
                            <Button
                                icon={<LinkOutlined />}
                                onClick={handleOpenTeams}
                            >
                                Open in Teams
                            </Button>
                        )}
                        <Button onClick={onClose}>Close</Button>
                    </Space>
                </div>
            </Space>
        </Modal>
    )
}

export default MeetingReviewModal
