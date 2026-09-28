/**
 * =============================================================================
 * HERMES - Meeting Review Modal (read-only)
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

import { Button, Modal } from 'antd'
import {
    CheckCircleOutlined,
    FieldTimeOutlined,
    LinkOutlined,
    LockOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import './MeetingReviewModal.css'
import { useT } from '../../i18n'
import { Avatar } from '../liquid'

/*
 * Hermes Liquid (prototip "toplanti" penceresi): koyu mavi kahraman seridi
 * (kaynak · duzenleyen, konu, tarih/saat/sure/katilimci cipleri), altinda
 * iki kolon — aciklama | katilimcilar — ve cam alt cubuk. Davranis ayni:
 * gizli toplantida ayrinti yok, iptal/kaydedildi durumlari gorunur,
 * "Efor gir" yalniz kaydedilmemisse.
 */
function MeetingReviewModal({
    open,
    meeting,
    onClose,
    onLogTime,
    isLogged = false,
}) {
    const t = useT()
    if (!meeting) return null

    const start = meeting.start_datetime ? dayjs(meeting.start_datetime) : null
    const end = meeting.end_datetime ? dayjs(meeting.end_datetime) : null
    const isPrivate =
        meeting.sensitivity === 'private' ||
        meeting.sensitivity === 'confidential'
    const isCancelled = !!meeting.is_cancelled
    const subject = meeting.subject || t('meetingsPage.untitled')

    const durationMin = meeting.duration_minutes || 0
    const h = Math.floor(durationMin / 60)
    const m = durationMin % 60
    const durationLabel = durationMin <= 0
        ? null
        : h && m ? `${t('logTime.hourShort', { n: h })} ${t('logTime.minShort', { n: m })}`
            : h ? t('logTime.hourShort', { n: h }) : t('logTime.minShort', { n: m })

    const attendees = meeting.attendees || []
    const organizer = meeting.organizer_name || meeting.organizer_email

    const handleOpenTeams = () => {
        if (meeting.join_url) {
            window.open(meeting.join_url, '_blank', 'noopener,noreferrer')
        }
    }

    const chips = [
        start && start.format('dddd, D MMMM'),
        start && end && `${start.format('HH:mm')} – ${end.format('HH:mm')}`,
        durationLabel,
        attendees.length > 0 && t('meeting.attendeeCount', { count: attendees.length }),
    ].filter(Boolean)

    return (
        <Modal
            /* Diyalog ADI konu; gorunur baslik kahraman seridinde. */
            title={<span className="h-sr-only">{subject}</span>}
            classNames={{ header: 'h-sr-only' }}
            open={open}
            onCancel={onClose}
            footer={null}
            width={720}
            destroyOnHidden
            className="meeting-review-modal"
        >
            <header className="mr-hero">
                <small>
                    {meeting.is_online_meeting || meeting.join_url ? t('meeting.teams') : t('meetingsPage.filter.offline')}
                    {organizer ? ` · ${t('meeting.organizes', { name: organizer })}` : ''}
                </small>
                <h2>
                    {isPrivate && <LockOutlined aria-hidden="true" />} {subject}
                </h2>
                <div className="mr-hero__chips">
                    {chips.map((c) => <span key={c}>{c}</span>)}
                    {isCancelled && <span className="is-bad">{t('meetingCard.cancelled')}</span>}
                </div>
            </header>

            {isLogged && (
                <p className="lq-note lq-note--ok" role="status">
                    <CheckCircleOutlined aria-hidden="true" /> {t('meeting.timeLogged')}
                </p>
            )}
            {isPrivate && (
                <p className="lq-note" role="note">
                    <LockOutlined aria-hidden="true" /> {t('meeting.privateMeeting')}
                </p>
            )}

            <div className="mr-cols">
                <section>
                    <h3 className="lq-grp">{t('common.description')}</h3>
                    {meeting.body_preview && !isPrivate ? (
                        <p className="mr-body">{meeting.body_preview}</p>
                    ) : (
                        <p className="mr-muted">—</p>
                    )}
                    {meeting.organizer_email && meeting.organizer_name && (
                        <p className="mr-muted">{t('meeting.organizer')}: {meeting.organizer_email}</p>
                    )}
                </section>
                <section>
                    <h3 className="lq-grp">{t('meeting.attendees')}</h3>
                    {attendees.length === 0 ? (
                        <p className="mr-muted">—</p>
                    ) : (
                        <ul className="mr-att">
                            {attendees.map((a) => {
                                const name = a.display_name || a.email
                                return (
                                    <li key={a.id}>
                                        <Avatar id={a.hermes_user_id || a.email} name={name} size={28} />
                                        <span className="mr-att__name">{name}</span>
                                        <span className={`lq-tag ${a.hermes_user_id ? 'lq-tag--info' : ''}`}>
                                            {a.hermes_user_id ? t('meeting.hermesUser') : t('meeting.external')}
                                        </span>
                                    </li>
                                )
                            })}
                        </ul>
                    )}
                </section>
            </div>

            <div className="lq-mf">
                {meeting.join_url && (
                    <Button icon={<LinkOutlined />} onClick={handleOpenTeams}>{t('meeting.openInTeams')}</Button>
                )}
                {onLogTime && !isLogged ? (
                    <Button type="primary" icon={<FieldTimeOutlined />} onClick={() => onLogTime(meeting)}>
                        {t('meeting.logTime')}
                    </Button>
                ) : (
                    <Button onClick={onClose}>{t('common.close')}</Button>
                )}
            </div>
        </Modal>
    )
}

export default MeetingReviewModal
