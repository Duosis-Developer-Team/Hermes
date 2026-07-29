/**
 * HERMES - Time Entry kullanici basligi + ust aksiyonlar (Sprint 5).
 * TimeEntryPage'den cikarildi; markup ve handler sozlesmesi AYNI.
 *
 * Sprint 5 duzeltmesi (ayrıştırma sirasinda bulundu): export butonunun
 * inline stilinde `background: '#16a34a !important'` vardi — React
 * inline style'da !important'i ZATEN yok sayar (olu kod) ve ham hex
 * tasarim sistemini deliyordu. Artik semantic success token'ini kullanan
 * bir sinif (.te-export-btn, TimeEntryPage.css) uygulaniyor; gorunum
 * ayni yesil, kaynak tek.
 */
import { Avatar, Button, Select, Tooltip } from 'antd'
import { FileExcelOutlined, UserOutlined } from '@ant-design/icons'
import SubmitPeriodDropdown from '../../../components/time-entry/SubmitPeriodDropdown'

function TimeEntryHeader({
    canSelectUser, targetUserId, usersList, onSelectUser, displayName,
    exportLoading, onExport,
    periods, onOpenSubmitModal,
    viewMode, onViewModeChange,
}) {
    return (
        <div className="user-header">
            <div className="user-header-left">
                <Avatar size={40} icon={<UserOutlined />} className="user-avatar-large" />
                {canSelectUser ? (
                    <div className="admin-user-selector">
                        <Select
                            className="user-select-dropdown"
                            value={targetUserId}
                            onChange={onSelectUser}
                            options={usersList.map((u) => ({
                                value: u.id,
                                label: u.full_name || u.email,
                            }))}
                            showSearch
                            optionFilterProp="label"
                            aria-label="Kullanıcı seç"
                        />
                    </div>
                ) : (
                    <span className="user-header-name">{displayName}</span>
                )}
            </div>

            <div className="user-header-right">
                <Tooltip title="Export CSV">
                    <Button
                        type="primary"
                        shape="circle"
                        className="te-export-btn"
                        icon={<FileExcelOutlined />}
                        loading={exportLoading}
                        onClick={onExport}
                        aria-label="CSV olarak dışa aktar"
                    />
                </Tooltip>

                <SubmitPeriodDropdown
                    periods={periods}
                    onOpenSubmitModal={onOpenSubmitModal}
                />

                <div className="view-switchers" role="tablist" aria-label="Görünüm">
                    {['list', 'timesheet'].map((v) => (
                        <button
                            key={v}
                            type="button"
                            role="tab"
                            aria-selected={viewMode === v}
                            className={`view-link ${viewMode === v ? 'active' : ''}`}
                            onClick={() => onViewModeChange(v)}
                        >
                            {v === 'list' ? 'List' : 'Timesheet'}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    )
}

export default TimeEntryHeader
