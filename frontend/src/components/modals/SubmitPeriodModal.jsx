/**
 * =============================================================================
 * HERMES - Submit Period Modal Component (Jira Tempo Style)
 * =============================================================================
 * Period onay modal'ı - Reviewer seçimi ve not ekleme
 * =============================================================================
 */

import { useState } from 'react'
import { Modal, Select, Input, Button, Tag } from 'antd'
import { useQuery } from '@tanstack/react-query'
import { authService } from '../../services/api'
import './SubmitPeriodModal.css'

const { TextArea } = Input

function SubmitPeriodModal({
    open,
    onClose,
    period,
    onSubmit,
    loading = false
}) {
    const [reviewerId, setReviewerId] = useState(null)
    const [note, setNote] = useState('')

    // Get users for reviewer selection
    const { data: users = [] } = useQuery({
        queryKey: ['users', 'options', 'REVIEWER'],
        queryFn: () => authService.getUserOptions({ role: 'REVIEWER' }),
    })

    if (!period) return null

    const handleSubmit = () => {
        onSubmit?.({
            period_id: period.id,
            reviewer_id: reviewerId,
            note: note,
        })
    }

    const handleClose = () => {
        setReviewerId(null)
        setNote('')
        onClose?.()
    }

    const hoursLogged = period.hoursLogged || 0
    const hoursRequired = period.hoursRequired || 0
    const hoursMissing = Math.max(0, hoursRequired - hoursLogged)

    return (
        <Modal
            open={open}
            onCancel={handleClose}
            footer={null}
            width={560}
            className="submit-period-modal"
            title={null}
            closable={true}
        >
            <div className="submit-modal-content">
                {/* Title */}
                <h2 className="submit-modal-title">
                    Submit Timesheet for Review - {period.userName || 'User'}
                </h2>

                <div className="submit-modal-divider" />

                {/* Period Info */}
                <div className="period-info-row">
                    <div className="period-info-left">
                        <span className="period-label">
                            Period {period.startDate?.format?.('DD/MMM/YY') || period.name}
                        </span>
                        <span className="period-date-range">
                            {period.startDate?.format?.('DD/MMM/YY')} - {period.endDate?.format?.('DD/MMM/YY')}
                        </span>
                    </div>
                    <Tag color="orange" className="period-status-tag">
                        {period.status || 'READY TO SUBMIT'}
                    </Tag>
                </div>

                {/* Hours Info */}
                <div className="hours-info">
                    <div className="hours-row">
                        <span className="hours-label">hours logged</span>
                        <span className="hours-value">{hoursLogged}</span>
                    </div>
                    <div className="hours-row">
                        <span className="hours-label">hours required</span>
                        <span className="hours-value">{hoursRequired}</span>
                        {hoursMissing > 0 && (
                            <span className="hours-missing">{hoursMissing} missing</span>
                        )}
                    </div>
                </div>

                {/* Reviewer Select */}
                <div className="reviewer-section">
                    <label className="reviewer-label">Reviewer</label>
                    <Select
                        placeholder="Pick reviewer"
                        className="reviewer-select"
                        value={reviewerId}
                        onChange={setReviewerId}
                        options={users?.map?.(u => ({
                            value: u.id,
                            label: u.full_name || u.email
                        })) || []}
                        allowClear
                    />
                </div>

                {/* Note */}
                <TextArea
                    placeholder="Leave a note for the reviewer..."
                    className="reviewer-note"
                    rows={4}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                />

                {/* Actions */}
                <div className="submit-modal-actions">
                    <Button type="link" className="view-timesheet-link">
                        View Timesheet
                    </Button>
                    <div className="action-buttons">
                        <Button
                            type="primary"
                            onClick={handleSubmit}
                            loading={loading}
                        >
                            Submit
                        </Button>
                        <Button onClick={handleClose}>Cancel</Button>
                    </div>
                </div>
            </div>
        </Modal>
    )
}

export default SubmitPeriodModal
