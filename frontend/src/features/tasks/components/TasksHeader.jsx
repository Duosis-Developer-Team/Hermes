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
import { Button, Dropdown, Select } from 'antd'
import { DownOutlined, PlusOutlined, TeamOutlined } from '@ant-design/icons'

import TasksSearchBar from '../../../components/tasks/TasksSearchBar'
import TaskLifecycleSwitcher from './TaskLifecycleSwitcher'
import { PageHero } from '../../../components/liquid'
import { useT } from '../../../i18n'

/*
 * Hermes Liquid (28.09): prototipteki sayfa basligi — "Isler" + aktif
 * gorunum · is sayisi; sagda (admin) kisi secici, arama, Aktif/Arsiv ve
 * birincil "Yeni is". "Yeni is" eskiden yalniz PANO yerlesiminde vardi;
 * baslikta oldugu icin Liste ve Takvim'de de erisilebilir (ayni izin:
 * canCreate, ayni akis: onCreate(tip)).
 */
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
    view,
    itemCount,
    canCreate,
    onCreate,
}) {
    const t = useT()
    const viewName = view ? (view.saved ? view.name : t(view.labelKey)) : null
    const subtitle = [viewName, itemCount != null ? t('tasksPage.count', { count: itemCount }) : null]
        .filter(Boolean).join(' \u00b7 ')

    return (
        <PageHero
            className="tasks-user-header"
            title={t('tasksPage.title')}
            subtitle={subtitle}
            actions={(
                <>
                    {isTaskAdmin && (
                        <Select
                            className="tasks-user-select"
                            value={selectedUserId || user?.id}
                            onChange={onSelectUser}
                            aria-label={t('explorer.viewedUser')}
                            loading={!usersLoaded}
                            options={userSelectorOptions}
                            suffixIcon={<TeamOutlined />}
                            showSearch
                            filterOption={(input, option) =>
                                (option?.label ?? '')
                                    .toLowerCase()
                                    .includes(input.toLowerCase())
                            }
                        />
                    )}
                    {/* Serbest metin arama — gorunurluk sunucuda uygulanir */}
                    <TasksSearchBar
                        userMap={userMap}
                        onSelect={onOpenReview}
                        taskType={taskType}
                    />
                    <TaskLifecycleSwitcher
                        value={archiveState}
                        onChange={onArchiveStateChange}
                    />
                    {canCreate && (
                        <Dropdown
                            trigger={['click']}
                            menu={{
                                items: [
                                    { key: 'task', label: t('board.newTask') },
                                    { key: 'issue', label: t('board.newIssue') },
                                    { key: 'suggestion', label: t('board.newSuggestion') },
                                ],
                                onClick: ({ key }) => onCreate?.(key),
                            }}
                        >
                            <Button
                                type="primary"
                                icon={<PlusOutlined />}
                                className="tasks-new-btn"
                                aria-label={t('board.newWorkItem')}
                            >
                                {t('board.new')}<DownOutlined />
                            </Button>
                        </Dropdown>
                    )}
                </>
            )}
        />
    )
}

export default TasksHeader
