/**
 * =============================================================================
 * HERMES - Kapasite ayarlari (PM rework P0 / D1)
 * =============================================================================
 * Efor seridinin (D2) "beklenen" tarafi: kurulus varsayilani (gunluk saat,
 * calisma gunleri), tatil takvimi ve kisi bazli override. Kapasite yoksa
 * serit yine calisir — yalniz yerlesik 8h/Pzt-Cum ile.
 *
 * B1 (tek /settings catisi) gelince bu sayfa oradaki "Organizasyon"
 * bolumune tasinir; izin ayni: users.manage.
 * =============================================================================
 */
import { useEffect, useMemo, useState } from 'react'
import {
    Button, Card, Checkbox, DatePicker, Form, Input, InputNumber, Popconfirm,
    Select, Space, Table, Tag, Typography, message,
} from 'antd'
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'

import { authService, capacityService } from '../../services/api'
import { queryKeys } from '../../query/queryKeys'
import { normalizeApiError } from '../../features/admin/shared/normalizeApiError'
import { useT } from '../../i18n'

const { Text } = Typography

const WEEKDAYS = [
    [1, 'mon'], [2, 'tue'], [3, 'wed'], [4, 'thu'], [5, 'fri'], [6, 'sat'], [7, 'sun'],
]

const asList = (value) => (Array.isArray(value) ? value : (value?.data || []))

function WeekdayPicker({ value, onChange, t }) {
    return (
        <Checkbox.Group
            value={value}
            onChange={(v) => onChange([...v].sort((a, b) => a - b))}
            options={WEEKDAYS.map(([n, key]) => ({ value: n, label: t(`capacity.${key}`) }))}
        />
    )
}

function CapacitySettingsPage() {
    const t = useT()
    const queryClient = useQueryClient()
    const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.capacity.all })
    const fail = (err) => message.error(normalizeApiError(err).message)

    // ---------------------------------------------------------------------
    // Kurulus varsayilanlari
    // ---------------------------------------------------------------------
    const { data: settings } = useQuery({
        queryKey: queryKeys.capacity.settings,
        queryFn: capacityService.getSettings,
    })
    const [defaultsForm] = Form.useForm()
    useEffect(() => {
        if (!settings) return
        defaultsForm.setFieldsValue({
            daily_expected_hours: Number(settings.daily_expected_hours),
            working_days: settings.working_days || [1, 2, 3, 4, 5],
        })
    }, [settings, defaultsForm])

    const saveSettings = useMutation({
        mutationFn: (values) => capacityService.updateSettings(values),
        onSuccess: () => { message.success(t('capacity.saved')); invalidate() },
        onError: fail,
    })

    // ---------------------------------------------------------------------
    // Tatiller
    // ---------------------------------------------------------------------
    const { data: holidaysRaw } = useQuery({
        queryKey: queryKeys.capacity.holidays({}),
        queryFn: () => capacityService.listHolidays(),
    })
    const holidays = asList(holidaysRaw)
    const [holidayForm] = Form.useForm()
    const addHoliday = useMutation({
        mutationFn: (values) => capacityService.addHoliday({
            holiday_date: dayjs(values.holiday_date).format('YYYY-MM-DD'),
            name: values.name.trim(),
        }),
        onSuccess: () => { message.success(t('capacity.holidayAdded')); holidayForm.resetFields(); invalidate() },
        onError: fail,
    })
    const deleteHoliday = useMutation({
        mutationFn: (id) => capacityService.deleteHoliday(id),
        onSuccess: () => { message.success(t('capacity.holidayDeleted')); invalidate() },
        onError: fail,
    })

    // ---------------------------------------------------------------------
    // Kisi bazli override
    // ---------------------------------------------------------------------
    const { data: usersRaw } = useQuery({
        queryKey: ['users-list'],
        queryFn: () => authService.lookupUsers(),
    })
    const users = asList(usersRaw)
    const userName = useMemo(() => {
        const map = {}
        for (const u of users) map[u.id] = u.full_name || u.email
        return map
    }, [users])

    const { data: overridesRaw } = useQuery({
        queryKey: queryKeys.capacity.overrides,
        queryFn: capacityService.listOverrides,
    })
    const overrides = asList(overridesRaw)
    const [overrideForm] = Form.useForm()
    const [overrideDays, setOverrideDays] = useState(false)
    const saveOverride = useMutation({
        mutationFn: ({ user_id, daily_expected_hours, working_days }) =>
            capacityService.upsertOverride(user_id, {
                daily_expected_hours: daily_expected_hours ?? null,
                working_days: overrideDays ? working_days : null,
            }),
        onSuccess: () => {
            message.success(t('capacity.overrideSaved'))
            overrideForm.resetFields(); setOverrideDays(false); invalidate()
        },
        onError: fail,
    })
    const deleteOverride = useMutation({
        mutationFn: (userId) => capacityService.deleteOverride(userId),
        onSuccess: () => { message.success(t('capacity.overrideDeleted')); invalidate() },
        onError: fail,
    })

    const dayLabels = (days) => (days || []).map((n) => t(`capacity.${WEEKDAYS[n - 1][1]}`)).join(', ')

    return (
        <div className="page-container">
            <div className="page-header">
                <h1 className="page-title">{t('capacity.title')}</h1>
                <p className="page-subtitle">{t('capacity.subtitle')}</p>
            </div>

            {/* 1) Kurulus varsayilanlari */}
            <Card title={t('capacity.defaults')} style={{ marginBottom: 16 }}>
                {settings?.is_default && (
                    <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
                        {t('capacity.usingDefault')}
                    </Text>
                )}
                <Form
                    form={defaultsForm}
                    layout="vertical"
                    initialValues={{ daily_expected_hours: 8, working_days: [1, 2, 3, 4, 5] }}
                    onFinish={(values) => saveSettings.mutate(values)}
                >
                    <Form.Item
                        name="daily_expected_hours" label={t('capacity.dailyHours')}
                        rules={[{ required: true, message: t('logTime.required') }]}
                    >
                        <InputNumber min={0.25} max={24} step={0.25} style={{ width: 160 }} />
                    </Form.Item>
                    <Form.Item
                        name="working_days" label={t('capacity.workingDays')}
                        rules={[{ required: true, message: t('logTime.required') }]}
                    >
                        <WeekdayPicker t={t} />
                    </Form.Item>
                    <Button type="primary" htmlType="submit" loading={saveSettings.isPending}>
                        {t('common.save')}
                    </Button>
                </Form>
            </Card>

            {/* 2) Tatiller */}
            <Card title={t('capacity.holidays')} style={{ marginBottom: 16 }}>
                <Form
                    form={holidayForm} layout="inline" style={{ marginBottom: 12 }}
                    onFinish={(values) => addHoliday.mutate(values)}
                >
                    <Form.Item name="holiday_date" rules={[{ required: true, message: t('logTime.required') }]}>
                        <DatePicker placeholder={t('capacity.date')} />
                    </Form.Item>
                    <Form.Item name="name" rules={[{ required: true, message: t('logTime.required') }]}>
                        <Input placeholder={t('capacity.holidayName')} maxLength={120} style={{ width: 240 }} />
                    </Form.Item>
                    <Button htmlType="submit" icon={<PlusOutlined />} loading={addHoliday.isPending}>
                        {t('capacity.addHoliday')}
                    </Button>
                </Form>
                <Table
                    size="small" rowKey="id" pagination={false}
                    dataSource={holidays}
                    locale={{ emptyText: t('capacity.noHolidays') }}
                    columns={[
                        { title: t('capacity.date'), dataIndex: 'holiday_date', width: 160 },
                        { title: t('capacity.holidayName'), dataIndex: 'name' },
                        {
                            title: '', width: 60, render: (_, row) => (
                                <Popconfirm title={t('common.delete')} onConfirm={() => deleteHoliday.mutate(row.id)}>
                                    <Button type="text" size="small" icon={<DeleteOutlined />} aria-label={t('common.delete')} />
                                </Popconfirm>
                            ),
                        },
                    ]}
                />
            </Card>

            {/* 3) Kisi bazli override */}
            <Card title={t('capacity.overrides')}>
                <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
                    {t('capacity.overridesHint')}
                </Text>
                <Form
                    form={overrideForm} layout="vertical" style={{ marginBottom: 12 }}
                    onFinish={(values) => saveOverride.mutate(values)}
                >
                    <Space align="start" wrap>
                        <Form.Item name="user_id" label={t('capacity.user')} rules={[{ required: true, message: t('logTime.required') }]}>
                            <Select
                                showSearch optionFilterProp="label" style={{ width: 240 }}
                                options={users.map((u) => ({ value: u.id, label: u.full_name || u.email }))}
                            />
                        </Form.Item>
                        <Form.Item name="daily_expected_hours" label={t('capacity.dailyHours')}>
                            <InputNumber min={0.25} max={24} step={0.25} style={{ width: 140 }} placeholder={t('capacity.inherit')} />
                        </Form.Item>
                        <Form.Item label={t('capacity.workingDays')}>
                            <Space direction="vertical">
                                <Checkbox checked={overrideDays} onChange={(e) => setOverrideDays(e.target.checked)}>
                                    {t('capacity.workingDays')}
                                </Checkbox>
                                {overrideDays && (
                                    <Form.Item name="working_days" noStyle initialValue={[1, 2, 3, 4, 5]}>
                                        <WeekdayPicker t={t} />
                                    </Form.Item>
                                )}
                            </Space>
                        </Form.Item>
                    </Space>
                    <div>
                        <Button htmlType="submit" loading={saveOverride.isPending}>{t('capacity.saveOverride')}</Button>
                    </div>
                </Form>
                <Table
                    size="small" rowKey="user_id" pagination={false}
                    dataSource={overrides}
                    locale={{ emptyText: t('capacity.noOverrides') }}
                    columns={[
                        { title: t('capacity.user'), dataIndex: 'user_id', render: (id) => userName[id] || id },
                        {
                            title: t('capacity.dailyHours'), dataIndex: 'daily_expected_hours',
                            render: (v) => (v === null || v === undefined ? <Tag>{t('capacity.inherit')}</Tag> : `${Number(v)}h`),
                        },
                        {
                            title: t('capacity.workingDays'), dataIndex: 'working_days',
                            render: (v) => (v && v.length ? dayLabels(v) : <Tag>{t('capacity.inherit')}</Tag>),
                        },
                        {
                            title: '', width: 60, render: (_, row) => (
                                <Popconfirm title={t('common.delete')} onConfirm={() => deleteOverride.mutate(row.user_id)}>
                                    <Button type="text" size="small" icon={<DeleteOutlined />} aria-label={t('common.delete')} />
                                </Popconfirm>
                            ),
                        },
                    ]}
                />
            </Card>
        </div>
    )
}

export default CapacitySettingsPage
