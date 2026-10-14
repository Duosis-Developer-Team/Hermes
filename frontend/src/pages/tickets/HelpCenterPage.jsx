/**
 * =============================================================================
 * HERMES - Yardim merkezi (talep eden, Dalga D3)
 * =============================================================================
 * Saglayicinin YAYINDA ve MUSTERIYE ACIK makaleleri: arama (TR karakter
 * duyarsiz, kok eslesmeli), kategoriler, makale gorunumu + "yardimci oldu
 * mu?". Birden fazla saglayici varsa hangisinin merkezine bakildigi secilir.
 * Cozum bulunamazsa talep olusturmaya tek tikla gecilir.
 * =============================================================================
 */
import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Input, Skeleton } from 'antd'
import { ArrowLeftOutlined, PlusOutlined, ReadOutlined, SearchOutlined } from '@ant-design/icons'

import { helpCenterService } from '../../api/ticketsApi'
import { Button, EmptyState, Page } from '../../components/ui'
import { GlassCard, LiquidSegmented, PageHero } from '../../components/liquid'
import ArticleDrawer from '../../features/kb/ArticleDrawer'
import '../../features/kb/kb.css'
import useTicketContext from '../../features/tickets/useTicketContext'
import { useT } from '../../i18n'

export default function HelpCenterPage() {
    const t = useT()
    const navigate = useNavigate()
    const { articleId } = useParams()
    const [params, setParams] = useSearchParams()
    const context = useTicketContext()
    const providers = context.providers.filter((p) => p.tenant_id)
    const [search, setSearch] = useState('')
    const [query, setQuery] = useState('')
    const [category, setCategory] = useState(null)
    const provider = params.get('provider') || providers[0]?.tenant_id || undefined

    useEffect(() => {
        const id = setTimeout(() => setQuery(search.trim()), 300)
        return () => clearTimeout(id)
    }, [search])

    const categories = useQuery({
        queryKey: ['kb', 'customer', provider ?? 'single', 'categories'],
        queryFn: () => helpCenterService.categories(provider),
        enabled: context.isPortal,
    })
    const articles = useQuery({
        queryKey: ['kb', 'customer', provider ?? 'single', 'articles', query, category],
        queryFn: () => helpCenterService.articles({ q: query || undefined, category_id: category || undefined }, provider),
        enabled: context.isPortal,
        keepPreviousData: true,
    })

    if (context.isLoading) return <Page className="tickets-page"><Skeleton active /></Page>
    if (!context.isPortal) {
        return <Page className="tickets-page"><EmptyState title={t('kb.unavailable')} description={t('portal.notConnected')} /></Page>
    }

    const openArticle = (id) => navigate(`/support/help/${id}${provider ? `?provider=${provider}` : ''}`)
    const rows = articles.data ?? []
    const cats = categories.data ?? []

    return (
        <Page className="tickets-page help-center">
            <button type="button" className="pc-back kb-back" onClick={() => navigate('/support')}>
                <ArrowLeftOutlined aria-hidden="true" /> {t('tickets.outgoing')}
            </button>
            <PageHero
                title={t('kb.helpCenter')}
                subtitle={t('kb.helpCenterHint')}
                actions={(
                    <Button variant="primary" icon={<PlusOutlined />} onClick={() => navigate('/support?new=1')}>
                        {t('portal.newRequest')}
                    </Button>
                )}
            />
            {providers.length > 1 && (
                <div className="kb-providers">
                    <LiquidSegmented
                        ariaLabel={t('ticket.sendTo')}
                        value={provider}
                        onChange={(next) => { setCategory(null); setParams({ provider: next }) }}
                        options={providers.map((p) => ({ value: p.tenant_id, label: p.display_name }))}
                    />
                </div>
            )}
            <Input
                size="large"
                allowClear
                className="kb-search"
                prefix={<SearchOutlined aria-hidden="true" />}
                placeholder={t('kb.searchPlaceholder')}
                aria-label={t('kb.searchPlaceholder')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
            />
            {cats.length > 0 && (
                <div className="kb-categories" role="group" aria-label={t('kb.categories')}>
                    {cats.map((c) => (
                        <button key={c.id} type="button" className={`kb-category${category === c.id ? ' is-on' : ''}`}
                                aria-pressed={category === c.id} onClick={() => setCategory(category === c.id ? null : c.id)}>
                            <b>{c.name}</b>
                            {c.description && <span>{c.description}</span>}
                            <small>{t('kb.articleCount', { count: c.article_count })}</small>
                        </button>
                    ))}
                </div>
            )}
            <GlassCard className="kb-list">
                {articles.isLoading && <Skeleton active paragraph={{ rows: 4 }} />}
                {!articles.isLoading && rows.length === 0 && (
                    <EmptyState title={query ? t('kb.noResults') : t('kb.empty')} description={t('kb.stillNeedHelp')} />
                )}
                <ul>
                    {rows.map((a) => (
                        <li key={a.id}>
                            <button type="button" onClick={() => openArticle(a.id)}>
                                <ReadOutlined aria-hidden="true" />
                                <span className="kb-list__text">
                                    <b>{a.title}</b>
                                    {a.summary && <span>{a.summary}</span>}
                                </span>
                            </button>
                        </li>
                    ))}
                </ul>
            </GlassCard>
            <ArticleDrawer
                articleId={articleId}
                provider={provider}
                onClose={() => navigate(`/support/help${provider ? `?provider=${provider}` : ''}`)}
                onNeedHelp={() => navigate('/support?new=1')}
            />
        </Page>
    )
}
