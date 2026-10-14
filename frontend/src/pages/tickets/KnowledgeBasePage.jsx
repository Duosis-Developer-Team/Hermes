/**
 * =============================================================================
 * HERMES - Bilgi bankasi yonetimi (saglayici, Dalga D3)
 * =============================================================================
 * Ajanlar tum makaleleri okur (taslak + ekip ici dahil); yazmak/yayinlamak
 * yapilandirma yetkisi (`tickets.config.manage` / `tickets.admin`) ister.
 * "Musteriye acik + yayinda" makaleler talep edenlerin yardim merkezinde
 * gorunur; "ekip ici" makaleler yalniz burada.
 * =============================================================================
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Drawer, Input, Select, Skeleton, message } from 'antd'
import {
    EditOutlined, PlusOutlined, ReadOutlined, SearchOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'

import { kbService } from '../../api/ticketsApi'
import { Button, EmptyState, Page, StatusBadge } from '../../components/ui'
import { BackLink, GlassCard, LiquidSegmented, ModalHead, PageHero } from '../../components/liquid'
import ArticleDrawer from '../../features/kb/ArticleDrawer'
import MiniMarkdown from '../../features/kb/MiniMarkdown'
import '../../features/kb/kb.css'
import useTicketContext from '../../features/tickets/useTicketContext'
import { useT } from '../../i18n'

const EMPTY = { title: '', summary: '', body: '', status: 'draft', audience: 'public', category_id: null, keywords: [] }

const errText = (error, fallback) => {
    const d = error?.response?.data?.detail
    return (typeof d === 'string' ? d : d?.message) || error?.normalized?.message || fallback
}

function ArticleEditor({ article, categories, onClose, onSaved }) {
    const t = useT()
    const [draft, setDraft] = useState(EMPTY)
    const [mode, setMode] = useState('write')
    const isNew = !article?.id
    useEffect(() => {
        if (!article) return
        if (isNew) { setDraft(EMPTY); return }
        kbService.article(article.id).then((full) => setDraft({
            title: full.title, summary: full.summary || '', body: full.body, status: full.status,
            audience: full.audience, category_id: full.category_id, keywords: full.keywords || [],
        }))
    }, [article, isNew])
    const save = useMutation({
        mutationFn: () => (isNew ? kbService.createArticle(draft) : kbService.updateArticle(article.id, draft)),
        onSuccess: () => { message.success(t('kb.saved')); onSaved(); onClose() },
        onError: (error) => message.error(errText(error, t('kb.saveFailed'))),
    })
    const patch = (p) => setDraft((d) => ({ ...d, ...p }))
    return (
        <Drawer
            open={Boolean(article)}
            onClose={onClose}
            width="min(860px, 96vw)"
            rootClassName="lq-sheet"
            destroyOnHidden
            title={<ModalHead icon={<EditOutlined />} tone="blue" title={isNew ? t('kb.newArticle') : t('kb.editArticle')} />}
            footer={(
                <div className="kb-editor__foot">
                    <Button onClick={onClose}>{t('common.cancel')}</Button>
                    <Button variant="primary" loading={save.isPending} disabled={!draft.title.trim()} onClick={() => save.mutate()}>
                        {t('common.save')}
                    </Button>
                </div>
            )}
        >
            <div className="pc-form">
                <label className="sla-field"><span>{t('kb.title')}</span>
                    <Input value={draft.title} maxLength={200} onChange={(e) => patch({ title: e.target.value })} aria-label={t('kb.title')} />
                </label>
                <div className="kb-editor__grid">
                    <label className="sla-field"><span>{t('kb.category')}</span>
                        <Select allowClear value={draft.category_id} onChange={(v) => patch({ category_id: v || null })}
                                aria-label={t('kb.category')} placeholder={t('kb.noCategory')}
                                options={categories.map((c) => ({ value: c.id, label: c.name }))} />
                    </label>
                    <div className="sla-field"><span>{t('kb.audience')}</span>
                        <LiquidSegmented ariaLabel={t('kb.audience')} value={draft.audience} onChange={(v) => patch({ audience: v })}
                                         options={[{ value: 'public', label: t('kb.public') }, { value: 'internal', label: t('kb.internal') }]} />
                    </div>
                    <div className="sla-field"><span>{t('kb.status')}</span>
                        <LiquidSegmented ariaLabel={t('kb.status')} value={draft.status} onChange={(v) => patch({ status: v })}
                                         options={[{ value: 'draft', label: t('kb.draft') }, { value: 'published', label: t('kb.published') }]} />
                    </div>
                </div>
                <label className="sla-field"><span>{t('kb.summary')}</span>
                    <Input value={draft.summary} maxLength={500} onChange={(e) => patch({ summary: e.target.value })} aria-label={t('kb.summary')} />
                </label>
                <label className="sla-field"><span>{t('kb.keywords')}</span>
                    <Select mode="tags" open={false} value={draft.keywords} onChange={(v) => patch({ keywords: v })}
                            aria-label={t('kb.keywords')} placeholder={t('automation.keywordsHint')} tokenSeparators={[',']} />
                </label>
                <div className="sla-field">
                    <span>{t('kb.body')}</span>
                    <LiquidSegmented ariaLabel={t('kb.body')} value={mode} onChange={setMode}
                                     options={[{ value: 'write', label: t('kb.write') }, { value: 'preview', label: t('kb.preview') }]} />
                    {mode === 'write' ? (
                        <Input.TextArea rows={14} value={draft.body} maxLength={50000} aria-label={t('kb.body')}
                                        onChange={(e) => patch({ body: e.target.value })} className="kb-editor__body" />
                    ) : (
                        <div className="kb-editor__preview"><MiniMarkdown source={draft.body || t('kb.emptyBody')} /></div>
                    )}
                    <p className="lq-note">{t('kb.formatHint')}</p>
                </div>
            </div>
        </Drawer>
    )
}

export default function KnowledgeBasePage() {
    const t = useT()
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const context = useTicketContext()
    const canEdit = context.can('tickets.config.manage') || context.can('tickets.admin')
    const [search, setSearch] = useState('')
    const [query, setQuery] = useState('')
    const [category, setCategory] = useState(null)
    const [status, setStatus] = useState('all')
    const [editing, setEditing] = useState(null)
    const [reading, setReading] = useState(null)
    const [newCategory, setNewCategory] = useState('')

    useEffect(() => {
        const id = setTimeout(() => setQuery(search.trim()), 300)
        return () => clearTimeout(id)
    }, [search])

    const categories = useQuery({ queryKey: ['kb', 'agent', 'categories'], queryFn: kbService.categories, enabled: context.isHub })
    const articles = useQuery({
        queryKey: ['kb', 'agent', 'articles', query, category, status],
        queryFn: () => kbService.articles({ q: query || undefined, category_id: category || undefined, status: status === 'all' ? undefined : status }),
        enabled: context.isHub,
        keepPreviousData: true,
    })
    const addCategory = useMutation({
        mutationFn: () => kbService.createCategory({ name: newCategory.trim() }),
        onSuccess: () => { setNewCategory(''); queryClient.invalidateQueries({ queryKey: ['kb', 'agent', 'categories'] }) },
        onError: (error) => message.error(errText(error, t('kb.saveFailed'))),
    })
    const refresh = () => queryClient.invalidateQueries({ queryKey: ['kb', 'agent'] })

    if (context.isLoading) return <Page className="tickets-page"><Skeleton active /></Page>
    if (!context.isHub) return <Page className="tickets-page"><EmptyState title={t('kb.unavailable')} description={t('helpdesk.providerOnly')} /></Page>
    const cats = categories.data ?? []
    const rows = articles.data ?? []
    const catName = Object.fromEntries(cats.map((c) => [c.id, c.name]))

    return (
        <Page className="tickets-page knowledge-base">
            <BackLink onClick={() => navigate('/tickets')}>{t('hub.tickets')}</BackLink>
            <PageHero
                title={t('kb.title_page')}
                subtitle={t('kb.agentHint')}
                actions={canEdit && (
                    <Button variant="primary" icon={<PlusOutlined />} onClick={() => setEditing({})}>{t('kb.newArticle')}</Button>
                )}
            />
            <div className="kb-toolbar">
                <Input allowClear prefix={<SearchOutlined aria-hidden="true" />} placeholder={t('kb.searchPlaceholder')}
                       aria-label={t('kb.searchPlaceholder')} value={search} onChange={(e) => setSearch(e.target.value)} />
                <Select allowClear value={category} onChange={(v) => setCategory(v || null)} placeholder={t('kb.allCategories')}
                        aria-label={t('kb.category')} options={cats.map((c) => ({ value: c.id, label: `${c.name} (${c.article_count})` }))} />
                <LiquidSegmented ariaLabel={t('kb.status')} value={status} onChange={setStatus}
                                 options={['all', 'published', 'draft'].map((v) => ({ value: v, label: t(`kb.statusFilter.${v}`) }))} />
            </div>
            {canEdit && (
                <form className="kb-new-category" onSubmit={(e) => { e.preventDefault(); if (newCategory.trim()) addCategory.mutate() }}>
                    <Input value={newCategory} maxLength={120} placeholder={t('kb.newCategory')} aria-label={t('kb.newCategory')}
                           onChange={(e) => setNewCategory(e.target.value)} />
                    <Button icon={<PlusOutlined />} disabled={!newCategory.trim()} loading={addCategory.isPending}
                            onClick={() => addCategory.mutate()}>{t('common.add')}</Button>
                </form>
            )}
            <GlassCard className="kb-list">
                {articles.isLoading && <Skeleton active paragraph={{ rows: 4 }} />}
                {!articles.isLoading && rows.length === 0 && <EmptyState title={t('kb.empty')} description={canEdit ? t('kb.emptyEditor') : ''} />}
                <ul>
                    {rows.map((a) => (
                        <li key={a.id}>
                            <button type="button" onClick={() => (canEdit ? setEditing(a) : setReading(a.id))}>
                                <ReadOutlined aria-hidden="true" />
                                <span className="kb-list__text">
                                    <b>{a.title}</b>
                                    {a.summary && <span>{a.summary}</span>}
                                    <small>
                                        {[catName[a.category_id], t('kb.views', { count: a.view_count }),
                                            a.helpful_yes + a.helpful_no > 0
                                                ? t('kb.helpfulRate', { rate: Math.round((a.helpful_yes / (a.helpful_yes + a.helpful_no)) * 100) })
                                                : null,
                                            a.updated_at ? dayjs(a.updated_at).format('D MMM YYYY') : null].filter(Boolean).join(' · ')}
                                    </small>
                                </span>
                                <span className="kb-list__badges">
                                    <StatusBadge tone={a.status === 'published' ? 'success' : 'neutral'}>{t(`kb.${a.status}`)}</StatusBadge>
                                    <StatusBadge tone={a.audience === 'public' ? 'info' : 'warning'}>{t(`kb.${a.audience}`)}</StatusBadge>
                                </span>
                            </button>
                        </li>
                    ))}
                </ul>
            </GlassCard>
            <ArticleEditor article={editing} categories={cats} onClose={() => setEditing(null)} onSaved={refresh} />
            <ArticleDrawer articleId={reading} customer={false} onClose={() => setReading(null)} />
        </Page>
    )
}
