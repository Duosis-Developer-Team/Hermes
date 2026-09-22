/**
 * =============================================================================
 * HERMES - "Ekibim" + "Dikkat gerektirenler" bloklari (PM rework P3 / D5)
 * =============================================================================
 * Ekip = is yonlendirebildigim kisiler ∪ lideri oldugum projelerin uyeleri;
 * uygunluk SUNUCUDA (liderlik istemcide bilinmez): `eligible=false` gelirse
 * blok hic cizilmez. Ton (04-roller §5): karne degil KUYRUK — sira bekleyen
 * is sayisina gore; kirmizi yalniz gecikmede. Dikkat: sahipsiz isler
 * (notr sayac), termini gecmisler, bu hafta hic efor girmemisler.
 * =============================================================================
 */
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'

import { authService, homeService } from '../../../services/api'
import { queryKeys } from '../../../query/queryKeys'
import { useT } from '../../../i18n'
import { PM_BASE } from '../../tasks/model/constants'
import { formatHours, groupLabel } from '../model/home'

function useUserNames() {
    const { data } = useQuery({
        queryKey: queryKeys.users.lookup,
        queryFn: () => authService.lookupUsers(),
    })
    return useMemo(() => {
        const list = Array.isArray(data) ? data : (data?.data || [])
        const byId = new Map(list.map((u) => [u.id, u.full_name || u.email]))
        return (id) => byId.get(id) || '—'
    }, [data])
}

function MemberRow({ member, nameOf, noEffort }) {
    const t = useT()
    return (
        <li className="home-team__member" data-user-id={member.user_id} data-no-effort={noEffort ? 'true' : undefined}>
            <span className="home-team__name">{nameOf(member.user_id)}</span>
            <span className="home-team__stat" title={t('home.team.open')}>
                <span className="home-team__value">{member.open_count}</span>
                <span className="home-team__label">{t('home.team.open')}</span>
            </span>
            <span className={`home-team__stat ${member.overdue_count > 0 ? 'home-team__stat--danger' : ''}`} title={t('home.team.overdue')}>
                <span className="home-team__value">{member.overdue_count}</span>
                <span className="home-team__label">{t('home.team.overdue')}</span>
            </span>
            <span className={`home-team__stat ${noEffort ? 'home-team__stat--warning' : ''}`} title={t('home.team.effort')}>
                <span className="home-team__value">
                    {formatHours(member.logged_hours)}<span className="home-team__of"> / {formatHours(member.expected_hours)}h</span>
                </span>
                <span className="home-team__label">{t('home.team.effort')}</span>
            </span>
        </li>
    )
}

function AttentionItem({ item, nameOf, showOwner }) {
    const t = useT()
    return (
        <li className="home-attention__item">
            <Link to={`/work/${item.item_key}`} className="home-attention__link">
                <span className="home-item__key">{item.item_key}</span>
                <span className="home-attention__title">{item.title}</span>
                <span className="home-attention__meta">
                    {groupLabel(item)}
                    {showOwner && item.owner_user_id ? ` · ${nameOf(item.owner_user_id)}` : ''}
                    {item.days_overdue > 0 ? ` · ${t('home.team.daysOverdue', { count: item.days_overdue })}` : ''}
                </span>
            </Link>
        </li>
    )
}

function TeamBlock() {
    const t = useT()
    const nameOf = useUserNames()
    const { data, isLoading, isError } = useQuery({
        queryKey: queryKeys.home.team,
        queryFn: () => homeService.team(),
    })

    if (isError) {
        return (
            <section className="home-block home-team" data-testid="home-team">
                <div className="home-block__head"><h2 className="home-block__title">{t('home.team.title')}</h2></div>
                <div className="h-inline-error">{t('home.loadFailed')}</div>
            </section>
        )
    }
    if (!data || data.eligible === false) return null

    const att = data.attention
    const noEffort = new Set(att.no_effort_user_ids || [])
    const hasAttention = att.unassigned_count > 0 || att.overdue_count > 0 || noEffort.size > 0

    return (
        <>
            <section className="home-block home-team" aria-labelledby="home-team-title" aria-busy={isLoading} data-testid="home-team">
                <div className="home-block__head">
                    <h2 id="home-team-title" className="home-block__title">{t('home.team.title')}</h2>
                    <span className="home-block__meta">{t('home.team.members', { count: data.members.length })}</span>
                    <span className="home-block__spacer" />
                    <Link to={PM_BASE} className="home-block__link">{t('home.team.openAssigned')}</Link>
                </div>
                {data.members.length === 0 ? (
                    <p className="home-bucket__empty">{t('home.team.empty')}</p>
                ) : (
                    <ol className="home-team__members">
                        {data.members.map((m) => (
                            <MemberRow key={m.user_id} member={m} nameOf={nameOf} noEffort={noEffort.has(m.user_id)} />
                        ))}
                    </ol>
                )}
            </section>

            {hasAttention && (
                <section className="home-block home-attention" aria-labelledby="home-attention-title" data-testid="home-attention">
                    <div className="home-block__head">
                        <h2 id="home-attention-title" className="home-block__title">{t('home.team.attention')}</h2>
                    </div>
                    <div className="home-attention__grid">
                        {att.unassigned_count > 0 && (
                            <div className="home-attention__group" data-attention="unassigned">
                                <div className="home-bucket__head">
                                    <span className="home-bucket__title">{t('home.team.unassigned')}</span>
                                    <span className="h-badge h-badge--neutral">{att.unassigned_count}</span>
                                </div>
                                <ul className="home-attention__list">
                                    {att.unassigned.map((i) => <AttentionItem key={i.id} item={i} nameOf={nameOf} />)}
                                </ul>
                            </div>
                        )}
                        {att.overdue_count > 0 && (
                            <div className="home-attention__group" data-attention="overdue">
                                <div className="home-bucket__head">
                                    <span className="home-bucket__title">{t('home.team.overdueItems')}</span>
                                    <span className="h-badge h-badge--danger">{att.overdue_count}</span>
                                </div>
                                <ul className="home-attention__list">
                                    {att.overdue.map((i) => <AttentionItem key={i.id} item={i} nameOf={nameOf} showOwner />)}
                                </ul>
                            </div>
                        )}
                        {noEffort.size > 0 && (
                            <div className="home-attention__group" data-attention="no-effort">
                                <div className="home-bucket__head">
                                    <span className="home-bucket__title">{t('home.team.noEffort')}</span>
                                    <span className="h-badge h-badge--warning">{noEffort.size}</span>
                                </div>
                                <ul className="home-attention__list home-attention__list--names">
                                    {[...noEffort].map((id) => <li key={id}>{nameOf(id)}</li>)}
                                </ul>
                            </div>
                        )}
                    </div>
                </section>
            )}
        </>
    )
}

export default TeamBlock
