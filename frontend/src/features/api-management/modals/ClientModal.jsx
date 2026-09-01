/**
 * =============================================================================
 * HERMES - API client olusturma/duzenleme modali (Sprint 6A/6C)
 * =============================================================================
 * Iki BAGIMSIZ yetki katmani ayni formda toplanir ama AYRI sunulur:
 *   - scopes                → istemci NE YAPABILIR
 *   - data-access bindings  → istemci NEYI GORUR
 * Bu ayrim Public API v1 sozlesmesinin temelidir; birlestirilmedi.
 * Client-type kurali korundu: yazma scope'lari yalnizca user-bound
 * istemciler icindir.
 * =============================================================================
 */
import { useMemo } from 'react'
import { Button, Form, Input, InputNumber, Modal, Select } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { BINDING_LABEL, SCOPE_HELP } from '../model/format'
import { useT } from '../../../i18n'

export default function ClientModal({ open, editing, scopes, pickers, onClose, onSubmit, saving }) {
    const t = useT()
    const [form] = Form.useForm()
    const clientType = Form.useWatch('client_type', form) || 'service'
    const bindings = Form.useWatch('access', form) || []
    const hasGlobal = bindings.some((b) => b?.access_type === 'global')

    const scopeOptions = useMemo(
        () =>
            scopes.map((s) => ({
                value: s,
                label: `${s} — ${SCOPE_HELP[s] || ''}`,
            })),
        [scopes]
    )

    const bindingTypeOptions = useMemo(() => {
        const opts = [
            { value: 'user', label: t('entity.user') },
            { value: 'group', label: t('api.group') },
            { value: 'customer', label: t('entity.customer') },
            { value: 'project', label: t('entity.project') },
        ]
        // Kural: global yalniz basina; user-bound client global alamaz.
        if (clientType !== 'user' && bindings.length <= 1) {
            opts.unshift({ value: 'global', label: BINDING_LABEL.global })
        }
        return opts
    }, [clientType, bindings.length, t])

    const targetOptions = (type) => pickers[type] || []

    const handleFinish = (values) => {
        const access = (values.access || []).filter(Boolean).map((b) => ({
            access_type: b.access_type,
            target_id: b.access_type === 'global' ? null : b.target_id,
        }))
        onSubmit({
            name: values.name?.trim(),
            description: values.description || null,
            client_type: values.client_type,
            bound_user_id:
                values.client_type === 'user' ? values.bound_user_id : null,
            environment: values.environment,
            scopes: values.scopes || [],
            rate_limit_per_min: values.rate_limit_per_min || null,
            access,
        })
    }

    return (
        <Modal
            open={open}
            title={editing ? 'Edit API Client' : 'Create API Client'}
            okText={editing ? 'Save Changes' : 'Create Client'}
            onOk={() => form.submit()}
            onCancel={onClose}
            confirmLoading={saving}
            width={680}
            destroyOnHidden
        >
            <Form
                form={form}
                layout="vertical"
                onFinish={handleFinish}
                initialValues={
                    editing
                        ? {
                              name: editing.name,
                              description: editing.description,
                              client_type: editing.client_type,
                              bound_user_id: editing.bound_user_id,
                              environment: editing.environment,
                              scopes: editing.scopes,
                              rate_limit_per_min: editing.rate_limit_per_min,
                              access: editing.access?.map((b) => ({
                                  access_type: b.access_type,
                                  target_id: b.target_id,
                              })),
                          }
                        : {
                              client_type: 'service',
                              environment: 'dev',
                              scopes: [],
                              access: [],
                          }
                }
            >
                <Form.Item
                    label={t('api.clientName')}
                    name="name"
                    rules={[
                        { required: true, message: t('api.nameRequired') },
                        { min: 2, max: 100 },
                    ]}
                >
                    <Input placeholder={t('api.clientNameExample')} maxLength={100} />
                </Form.Item>
                <Form.Item label={t('common.description')} name="description">
                    <Input.TextArea
                        rows={2}
                        maxLength={2000}
                        placeholder={t('api.whatIntegrates')}
                    />
                </Form.Item>
                <div className="am-form-row">
                    <Form.Item
                        label={t('api.clientType')}
                        name="client_type"
                        tooltip={t('api.typeHint')}
                    >
                        <Select
                            disabled={!!editing}
                            options={[
                                { value: 'service', label: t('api.service') },
                                { value: 'user', label: t('api.userBound') },
                            ]}
                        />
                    </Form.Item>
                    <Form.Item
                        label={t('api.environment')}
                        name="environment"
                        tooltip={t('api.envHint')}
                    >
                        <Select
                            disabled={!!editing}
                            options={[
                                { value: 'dev', label: t('api.development') },
                                { value: 'live', label: t('api.live') },
                            ]}
                        />
                    </Form.Item>
                    <Form.Item
                        label={t('api.rateLimitField')}
                        name="rate_limit_per_min"
                        tooltip={t('api.rateLimitHint')}
                    >
                        <InputNumber
                            min={1}
                            max={10000}
                            style={{ width: '100%' }}
                            placeholder="60"
                        />
                    </Form.Item>
                </div>
                {clientType === 'user' && (
                    <Form.Item
                        label={t('api.boundUser')}
                        name="bound_user_id"
                        rules={[
                            {
                                required: true,
                                message: t('api.boundUserRequired'),
                            },
                        ]}
                    >
                        <Select
                            showSearch
                            optionFilterProp="label"
                            options={targetOptions('user')}
                            placeholder={t('api.boundUserHint')}
                            disabled={!!editing}
                        />
                    </Form.Item>
                )}
                <Form.Item
                    label={t('api.scopes')}
                    name="scopes"
                    tooltip={t('api.scopesHint')}
                >
                    <Select
                        mode="multiple"
                        options={scopeOptions}
                        placeholder={t('api.selectScopes')}
                        maxTagCount="responsive"
                    />
                </Form.Item>

                <div className="am-bindings-label">{t('api.accessBindings')}<span className="am-bindings-hint">
                        Which data the client can see. No bindings = no
                        business data. Global cannot be combined with
                        narrower bindings.
                    </span>
                </div>
                <Form.List name="access">
                    {(fields, { add, remove }) => (
                        <>
                            {fields.map((field) => {
                                const row = bindings[field.name] || {}
                                return (
                                    <div
                                        key={field.key}
                                        className="am-binding-row"
                                    >
                                        <Form.Item
                                            name={[field.name, 'access_type']}
                                            rules={[{ required: true }]}
                                            style={{ marginBottom: 0 }}
                                        >
                                            <Select
                                                placeholder={t('api.type')}
                                                options={bindingTypeOptions}
                                                style={{ minWidth: 150 }}
                                            />
                                        </Form.Item>
                                        {row.access_type !== 'global' && (
                                            <Form.Item
                                                name={[
                                                    field.name,
                                                    'target_id',
                                                ]}
                                                rules={[
                                                    {
                                                        required: true,
                                                        message: t('api.targetRequired'),
                                                    },
                                                ]}
                                                style={{
                                                    marginBottom: 0,
                                                    flex: 1,
                                                }}
                                            >
                                                <Select
                                                    showSearch
                                                    optionFilterProp="label"
                                                    placeholder={t('api.selectTarget')}
                                                    options={targetOptions(
                                                        row.access_type
                                                    )}
                                                />
                                            </Form.Item>
                                        )}
                                        <Button
                                            danger
                                            size="small"
                                            onClick={() =>
                                                remove(field.name)
                                            }
                                        >{t('api.remove')}</Button>
                                    </div>
                                )
                            })}
                            <Button
                                icon={<PlusOutlined />}
                                size="small"
                                disabled={hasGlobal}
                                onClick={() => add({ access_type: undefined })}
                                style={{ marginTop: 4 }}
                            >{t('api.addBinding')}</Button>
                            {hasGlobal && (
                                <span className="am-bindings-hint">
                                    {' '}
                                    Global grants everything — remove it to
                                    add narrower bindings.
                                </span>
                            )}
                        </>
                    )}
                </Form.List>
            </Form>
        </Modal>
    )
}
