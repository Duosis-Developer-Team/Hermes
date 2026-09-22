/**
 * =============================================================================
 * HERMES - Tasks ust basligi (Sprint 5C → PM rework P3.5)
 * =============================================================================
 * Kimlik (admin ise kullanici secici) + arama + arsiv anahtari. Eksenler
 * burada DEGIL: gorunum sol kolonda, gruplama/yerlesim kontrol cubugunda.
 *
 * SUNUM KATMANI: hicbir sorgu/mutasyon calistirmaz, izin KARARI VERMEZ —
 * kararlar prop olarak gelir (features/tasks/model/permissions tek kaynak).
 * =============================================================================
 */
import { Avatar, Select } from 'antd'
import { UserOutlined } from '@ant-design/icons'

import TasksSearchBar from '../../../components/tasks/TasksSearchBar'
import TaskLifecycleSwitcher from './TaskLifecycleSwitcher'
import { useT } from '../../../i18n'

function TasksHeader({
    user,
    isTaskAdmin,
    selectedUserId,
    onSelectUser,
    userSelectorOptions,
    archiveState,
    onArchiveStateChange,
    usersLoaded,
    taskType,
    userMap,
    onOpenReview,
}) {
    const t = useT()

    return (
        <div className="tasks-user-header">
            <div className="tasks-user-header-left">
                <Avatar size={40} icon={<UserOutlined />} className="tasks-user-avatar" />
                {isTaskAdmin ? (
                    <Select
                        value={selectedUserId || user?.id}
                        onChange={onSelectUser}
                        /* Etiketsiz kontrol: erisilebilir ad acikca
                           verilir (§8). */
                        aria-label={t('explorer.viewedUser')}
                        style={{ width: 220, fontSize: '1.2rem', fontWeight: 600 }}
                        /* AntD 5.x: bordered deprecated → variant. */
                        variant="borderless"
                        loading={!usersLoaded}
                        options={userSelectorOptions}
                        showSearch
                        filterOption={(input, option) =>
                            (option?.label ?? '')
                                .toLowerCase()
                                .includes(input.toLowerCase())
                        }
                    />
                ) : (
                    <h1 className="tasks-user-name">{user?.full_name || 'User'}</h1>
                )}
            </div>

            <div className="tasks-user-header-right">
                {/* Free-text task search — visibility enforced server-side */}
                <TasksSearchBar
                    userMap={userMap}
                    onSelect={onOpenReview}
                    taskType={taskType}
                />
                <div className="tasks-tabs-divider" />
                {/* Arsiv anahtari: baslik satirinin saginda tek dugme. */}
                <TaskLifecycleSwitcher
                    value={archiveState}
                    onChange={onArchiveStateChange}
                />
                {/* P3.5 / E1: tip sekmeleri, kapsam pilleri, yerlesim sekmeleri
                    ve kulvar anahtari KALKTI — hepsi GORUNUMUN kendisi (sol
                    kolon) ya da kontrol cubugundaki iki eksendir. */}
            </div>
        </div>
    )
}

export default TasksHeader
