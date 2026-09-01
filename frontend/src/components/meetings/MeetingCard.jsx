/**
 * =============================================================================
 * HERMES - Meeting Card
 * =============================================================================
 * Compact calendar card for a Microsoft Teams / Outlook meeting.
 *
 * Visual hierarchy (prioritised top → bottom):
 *   1. Time range — most prominent, big monospace, blue/cyan accent.
 *   2. Subject.
 *   3. Organizer (name) + Teams badge if join_url exists.
 *   4. Attendee count + private/cancelled flags.
 *
 * Cards differ from TaskCard with a subtle blue/cyan left accent so
 * Meetings read as their own entity but still feel native Hermes.
 *
 * The "Logged" badge is wired in Stage 5 once Log Time integration
 * lands — for now the prop is accepted but inert by default.
 * =============================================================================
 */

import { Tooltip } from 'antd'
import {
    LockOutlined,
    TeamOutlined,
    UsergroupAddOutlined,
    CheckCircleOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import './MeetingCard.css'
import { useT } from '../../i18n'

function MeetingCard({
    meeting,
    onClick,
    isLogged = false,
}) {
    const t = useT()
    const start = meeting.start_datetime
        ? dayjs(meeting.start_datetime)
        : null
    const end = meeting.end_datetime ? dayjs(meeting.end_datetime) : null
    const timeRange =
        start && end
            ? `${start.format('HH:mm')} – ${end.format('HH:mm')}`
            : ''
    const isPrivate =
        meeting.sensitivity === 'private' ||
        meeting.sensitivity === 'confidential'
    const isCancelled = !!meeting.is_cancelled
    const hasTeams = !!meeting.join_url
    const attendeeCount = (meeting.attendees || []).length
    const organizer =
        meeting.organizer_name || meeting.organizer_email || null

    const handleClick = (e) => {
        e.stopPropagation()
        onClick?.(meeting)
    }

    const className =
        'meeting-card' +
        (isCancelled ? ' meeting-card-cancelled' : '') +
        (isLogged ? ' meeting-card-logged' : '')

    return (
        <div
            className={className}
            role="button"
            tabIndex={0}
            onClick={handleClick}
            onKeyDown={(e) => {
                if (e.key === 'Enter') onClick?.(meeting)
            }}
        >
            <div className="meeting-card-accent" aria-hidden="true" />

            <div className="meeting-card-body">
                <div className="meeting-card-time">{timeRange}</div>
                <div className="meeting-card-title">
                    {isPrivate ? (
                        <Tooltip title={t('meetingCard.privateMeeting')}>
                            <LockOutlined
                                style={{ marginRight: 6, color: 'var(--c-text-muted)' }}
                            />
                        </Tooltip>
                    ) : null}
                    {meeting.subject || '(Untitled meeting)'}
                </div>

                <div className="meeting-card-meta">
                    {organizer && (
                        <span className="meeting-card-organizer">
                            {organizer}
                        </span>
                    )}
                </div>

                <div className="meeting-card-badges">
                    {attendeeCount > 0 && (
                        <span
                            className="meeting-card-badge meeting-card-attendees"
                            title={`${attendeeCount} attendee${
                                attendeeCount === 1 ? '' : 's'
                            }`}
                        >
                            <UsergroupAddOutlined />
                            {attendeeCount}
                        </span>
                    )}
                    {hasTeams && (
                        <span
                            className="meeting-card-badge meeting-card-teams"
                            title={t('meetingCard.teamsMeeting')}
                        >
                            <TeamOutlined />{t('meetingCard.teams')}</span>
                    )}
                    {isCancelled && (
                        <span className="meeting-card-badge meeting-card-cancelled-pill">{t('meetingCard.cancelled')}</span>
                    )}
                    {isLogged && (
                        <span
                            className="meeting-card-badge meeting-card-logged-pill"
                            title={t('meetingCard.timeLogged')}
                        >
                            <CheckCircleOutlined />{t('meetingCard.logged')}</span>
                    )}
                </div>
            </div>
        </div>
    )
}

export default MeetingCard
