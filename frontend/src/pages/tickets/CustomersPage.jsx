/**
 * =============================================================================
 * HERMES - Musterilerim (saglayici hub)
 * =============================================================================
 * Ekiplerime YONLENEN her musteri — hic talep acmamis olsa bile (ornegin
 * yeni tanimlanan Defacto sirket hesabi) — ve kapsamimda talebi olanlar.
 * Yonetici tumunu gorur. Kart: tur (sirket hesabi / calisma alani /
 * entegrasyon), uygulama, destek ekibi, acik/toplam talep, son hareket.
 * Karta tiklayinca talep listesi o musteriye suzulur.
 * =============================================================================
 */
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Input, Skeleton } from 'antd'
import { SearchOutlined, ShopOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'

import { ticketHelpdeskService } from '../../api/ticketsApi'
import { EmptyState, Page, StatusBadge } from '../../components/ui'
import { BackLink, PageHero } from '../../components/liquid'
import useTicketContext from '../../features/tickets/useTicketContext'
import { queryKeys } from '../../query/queryKeys'
import { useT } from '../../i18n'
import { matchesAny } from '../../utils/searchText'
import '../../features/tickets/tickets.css'

dayjs.extend(relativeTime)

const KIND_TONE = { company: 'brand', workspace: 'info', integration: 'neutral' }

export default function CustomersPage() {
    const t = useT()
    const navigate = useNavigate()
    const context = useTicketContext()
    const [search, setSearch] = useState('')
    const customers = useQuery({
        queryKey: queryKeys.tickets.myCustomers,
        queryFn: ticketHelpdeskService.myCustomers,
        enabled: context.isHub,
    })
    const rows = useMemo(
        () => (customers.data ?? []).filter((c) => matchesAny([c.display_name, c.team?.name, c.application], search)),
        [customers.data, search],
    )

    if (context.isLoading) return <Page className="tickets-page"><Skeleton active /></Page>
    if (!context.isHub) {
        return <Page className="tickets-page"><EmptyState title={t('customersHub.title')} description={t('helpdesk.providerOnly')} /></Page>
    }
    return (
        <Page className="tickets-page customers-hub">
            <BackLink onClick={() => navigate('/tickets')}>{t('hub.tickets')}</BackLink>
            <PageHero title={t('customersHub.title')} subtitle={t('customersHub.subtitle')} />
            <Input
                allowClear className="customers-hub__search" prefix={<SearchOutlined aria-hidden="true" />}
                placeholder={t('customersHub.search')} aria-label={t('customersHub.search')}
                value={search} onChange={(e) => setSearch(e.target.value)}
            />
            {customers.isLoading && <Skeleton active paragraph={{ rows: 4 }} />}
            {!customers.isLoading && rows.length === 0 && (
                <EmptyState title={t('customersHub.empty')} description={t('customersHub.emptyHint')} />
            )}
            <div className="customers-hub__grid">
                {rows.map((c) => (
                    <button
                        key={c.id} type="button" className="customers-hub__card"
                        onClick={() => navigate(`/tickets?queue=all&customer=${c.id}`)}
                        aria-label={t('customersHub.open', { name: c.display_name })}
                    >
                        <span className="customers-hub__head">
                            <ShopOutlined aria-hidden="true" />
                            <b>{c.display_name}</b>
                            <StatusBadge tone={KIND_TONE[c.kind]}>{t(`customersHub.kind.${c.kind}`)}</StatusBadge>
                        </span>
                        <span className="customers-hub__meta">
                            {[c.application, c.team ? t('customersHub.team', { team: c.team.name }) : t('customersHub.noTeam')]
                                .filter(Boolean).join(' · ')}
                        </span>
                        <span className="customers-hub__stats">
                            <span><b>{c.open_count}</b> {t('customersHub.open_count')}</span>
                            <span><b>{c.total_count}</b> {t('customersHub.total_count')}</span>
                            <span>{c.last_activity_at ? dayjs(c.last_activity_at).fromNow() : t('customersHub.noRequests')}</span>
                        </span>
                    </button>
                ))}
            </div>
        </Page>
    )
}
