/**
 * =============================================================================
 * HERMES - Yeni kiraci sihirbazi (super-admin, Faz 2)
 * =============================================================================
 * Bilgiler → Moduller → Yonetici → Ozet. SEMA YARATILMAZ: izolasyon FORCE
 * RLS ile, kiraci saniyeler icinde hazir olur.
 *
 * Basari ekrani HER ZAMAN calisma alani adresini gosterir (workspace_hint);
 * tek seferlik parola YALNIZ yeni kullanici yaratildiysa ve YALNIZ burada,
 * bir kez gorunur — hicbir yere yazilmaz.
 * =============================================================================
 */
import { useState } from 'react'
import { Button, Form, Input, Modal, Steps, Typography, message } from 'antd'
import { ApartmentOutlined, CheckCircleOutlined } from '@ant-design/icons'

import { platformService } from '../../api/platformApi'
import { ModalHead } from '../../components/liquid'
import { MODULE_CODES } from '../../features/modules/catalog'
import { foldSearch } from '../../utils/searchText'
import { useT } from '../../i18n'
import ModulePicker, { ModuleBadges } from './ModulePicker'
import './platform.css'

const { Text } = Typography

export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

/** "Acme Endüstri A.Ş." → "acme-endustri-a-s" */
export function slugify(name) {
    return foldSearch(name || '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 63)
        .replace(/-+$/g, '')
}

function CreatedScreen({ created, onClose }) {
    const t = useT()
    const workspaceUrl = window.location.origin + created.workspace_hint
    return (
        <Modal
            open
            title={<ModalHead icon={<CheckCircleOutlined />} tone="green" title={t('platform.tenantCreated')} />}
            onCancel={onClose}
            onOk={onClose}
            okText={created.one_time_password ? t('platform.savedPassword') : undefined}
            cancelButtonProps={{ style: { display: 'none' } }}
            closable={false}
            maskClosable={false}
        >
            <div className="pc-review">
                <Text><strong>{created.tenant.display_name}</strong> is ready.</Text>
                <dl className="pc-dl">
                    <dt>{t('platform.workspaceLink')}</dt>
                    <dd><Text code copyable>{workspaceUrl}</Text></dd>
                    <dt>{t('platform.owner')}</dt>
                    <dd>{created.owner.email}</dd>
                    <dt>{t('platform.modulesTitle')}</dt>
                    <dd><ModuleBadges modules={created.tenant.modules || []} /></dd>
                    {created.one_time_password && (
                        <>
                            <dt>{t('platform.oneTimePassword')}</dt>
                            <dd><Text code copyable>{created.one_time_password}</Text></dd>
                        </>
                    )}
                </dl>
                <Text type="secondary">{t('platform.workspaceLinkShare')}</Text>
                {created.one_time_password && (
                    <Text type="warning">
                        This password is shown once and is not stored anywhere.
                        Share it securely; the owner should change it at first sign-in.
                    </Text>
                )}
            </div>
        </Modal>
    )
}

/** Eski adiyla da disa acilir (createTenantLink testi, cagiranlar). */
export function CreateTenantModal({ open, onClose, onDone }) {
    const t = useT()
    const [form] = Form.useForm()
    const [step, setStep] = useState(0)
    const [modules, setModules] = useState(MODULE_CODES)
    const [slugTouched, setSlugTouched] = useState(false)
    const [busy, setBusy] = useState(false)
    const [created, setCreated] = useState(null)
    const values = Form.useWatch([], form) || {}

    const reset = () => {
        form.resetFields()
        setStep(0)
        setModules(MODULE_CODES)
        setSlugTouched(false)
    }
    const close = () => { reset(); onClose?.() }

    const STEP_FIELDS = [['display_name', 'slug'], [], ['owner_email', 'owner_full_name', 'email_domains'], []]
    const next = async () => {
        await form.validateFields(STEP_FIELDS[step])
        setStep((s) => s + 1)
    }

    const submit = async () => {
        const all = { ...form.getFieldsValue(true) }
        setBusy(true)
        try {
            const result = await platformService.createTenant({ ...all, modules })
            setCreated(result)
        } catch (err) {
            const d = err?.response?.data?.detail
            message.error(d?.message || d || 'Could not create tenant.')
        } finally {
            setBusy(false)
        }
    }

    if (created) {
        return (
            <CreatedScreen
                created={created}
                onClose={() => { setCreated(null); reset(); onDone?.() }}
            />
        )
    }

    const steps = [
        { key: 'info', title: t('platform.wizard.stepInfo') },
        { key: 'modules', title: t('platform.wizard.stepModules') },
        { key: 'admin', title: t('platform.wizard.stepAdmin') },
        { key: 'review', title: t('platform.wizard.stepReview') },
    ]

    return (
        <Modal
            open={open}
            title={<ModalHead icon={<ApartmentOutlined />} tone="violet" title={t('platform.newTenant')} />}
            onCancel={close}
            footer={null}
            width={step === 1 ? 760 : 560}
            destroyOnHidden
        >
            <Steps className="pc-wizard__steps" size="small" current={step} items={steps.map((s) => ({ title: s.title }))} />
            <Form form={form} layout="vertical" preserve>
                <div style={{ display: step === 0 ? undefined : 'none' }}>
                    <Form.Item name="display_name" label={t('platform.organizationName')}
                               rules={[{ required: true, message: t('logTime.required') }]}>
                        <Input
                            placeholder="Acme Industries"
                            onChange={(e) => { if (!slugTouched) form.setFieldValue('slug', slugify(e.target.value)) }}
                        />
                    </Form.Item>
                    <Form.Item name="slug" label={t('platform.workspaceAddress')} extra={t('platform.workspaceHint')}
                               rules={[{ required: true, message: t('logTime.required') },
                                       { pattern: SLUG_PATTERN, message: t('platform.slugRule') }]}>
                        <Input placeholder="acme" onChange={() => setSlugTouched(true)} />
                    </Form.Item>
                </div>
                {step === 1 && (
                    <>
                        <p className="pc-muted" style={{ marginTop: 0 }}>{t('platform.modulesHint')}</p>
                        <ModulePicker value={modules} onChange={setModules} />
                    </>
                )}
                <div style={{ display: step === 2 ? undefined : 'none' }}>
                    <Form.Item name="owner_email" label={t('platform.ownerEmail')} extra={t('platform.ownerBecomesTenant')}
                               rules={[{ required: true, message: t('logTime.required') },
                                       { type: 'email', message: t('platform.emailInvalid') }]}>
                        <Input placeholder="admin@acme.com" />
                    </Form.Item>
                    <Form.Item name="owner_full_name" label={t('platform.ownerName')}>
                        <Input placeholder="Ada Lovelace" />
                    </Form.Item>
                    <Form.Item name="email_domains" label={t('platform.emailDomainsOptional')} extra={t('platform.autoJoinHint')}>
                        <Input placeholder={t('platform.emailDomainsExample')} />
                    </Form.Item>
                </div>
                {step === 3 && (
                    <div className="pc-review">
                        <dl className="pc-dl">
                            <dt>{t('platform.organizationName')}</dt><dd>{values.display_name}</dd>
                            <dt>{t('platform.workspaceAddress')}</dt>
                            <dd><code>{`${window.location.origin}/?workspace=${values.slug || ''}`}</code></dd>
                            <dt>{t('platform.modulesTitle')}</dt><dd><ModuleBadges modules={modules} /></dd>
                            <dt>{t('platform.ownerEmail')}</dt><dd>{values.owner_email}</dd>
                            {values.email_domains && (<><dt>{t('platform.emailDomains')}</dt><dd>{values.email_domains}</dd></>)}
                        </dl>
                        <Text type="secondary">{t('platform.wizard.reviewHint')}</Text>
                    </div>
                )}
            </Form>
            <div className="pc-wizard__foot">
                <Button onClick={step === 0 ? close : () => setStep((s) => s - 1)}>
                    {step === 0 ? t('common.cancel') : t('platform.wizard.back')}
                </Button>
                {step < 3 ? (
                    <Button type="primary" onClick={next}>{t('platform.wizard.next')}</Button>
                ) : (
                    <Button type="primary" loading={busy} onClick={submit}>{t('platform.wizard.create')}</Button>
                )}
            </div>
        </Modal>
    )
}

export default CreateTenantModal
