/**
 * =============================================================================
 * HERMES - "Ekibim" + "Dikkat gerektirenler" bloklari (PM rework P3 / D5)
 * =============================================================================
 * Ekip = is yonlendirebildigim kisiler ∪ lideri oldugum projelerin uyeleri;
 * uygunluk SUNUCUDA (liderlik istemcide bilinmez): `eligible=false` gelirse
 * blok hic cizilmez. Ton (04-roller §5): karne degil KUYRUK — sira bekleyen
 * is sayisina gore; kirmizi yalniz gecikmede. Dikkat: sahipsiz isler
 * (notr sayac), termini gecmisler, bu hafta hic efor girmemisler.
 *
 * Hermes Liquid (CTO 29.09): Ekip ve Dikkat TEK kartta iki sekme (ayri
 * yigilmis iki kart sayfayi uzatiyordu). Kisi satiri prototip dilinde:
 * avatar + ad (acik · gecikmis), is yuku cubugu (acik / gecikmis),
 * haftalik efor olcer + saat. Liste kartin kalan yuksekligini doldurur,
 * tasarsa kendi icinde kayar (komsu Organizasyon karti ile ayni boy).
 * =============================================================================
 */
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'

import { authService, homeService } from '../../../services/api'
import { queryKeys } from '../../../query/queryKeys'
import { useT } from '../../../i18n'
import { PM_BASE } from '../../tasks/model/constants'
import { formatHours, groupLabel } from '../model/home'
import { Avatar, LiquidSegmented } from '../../../components/liquid'

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

function MemberRow({ member, nameOf, noEffort, maxOpen }) {
    const t = useT()
    const open = Number(member.open_count) || 0
    const late = Number(member.overdue_count) || 0
    const logged = Number(member.logged_hours) || 0
    const expected = Number(member.expected_hours) || 0
    const fill = expected > 0 ? Math.min(100, Math.round((logged / expected) * 100)) : 0
    return (
        <li className="home-team__member" data-user-id={member.user_id} data-no-effort={noEffort ? 'true' : undefined}>
            <Avatar id={member.user_id} name={nameOf(member.user_id)} size={32} />
            <span className="home-team__who">
                <span className="home-team__name-text">{nameOf(member.user_id)}</span>
                <small className="home-team__sub">
                    <span className="home-team__stat">{`${open} ${t('home.team.open')}`}</span>
                    {late > 0 && (
                        <span className="home-team__stat home-team__stat--danger">{` · ${late} ${t('home.team.overdue')}`}</span>
                    )}
                </small>
            </span>
            <span className="home-team__load" title={`${open} ${t('home.team.open')} · ${late} ${t('home.team.overdue')}`} aria-hidden="true">
                <i style={{ width: `${((open - late) / maxOpen) * 100}%` }} />
                <i className="home-team__load-late" style={{ width: `${(late / maxOpen) * 100}%` }} />
            </span>
            <span className={`home-team__effort${noEffort ? ' home-team__stat--warning' : ''}`} title={t('home.team.effort')}>
                <span className="home-team__meter" aria-hidden="true"><i style={{ width: `${fill}%` }} /></span>
                <span className="home-team__value">
                    {formatHours(member.logged_hours)}<span className="home-team__of"> / {formatHours(member.expected_hours)}h</span>
                </span>
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
    const [tab, setTab] = useState('members')
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
    const attentionCount = (att.unassigned_count || 0) + (att.overdue_count || 0) + noEffort.size
    const hasAttention = attentionCount > 0
    const view = hasAttention ? tab : 'members'
    const maxOpen = Math.max(1, ...data.members.map((m) => Number(m.open_count) || 0))
    // Ekip ozeti (prototip basligi "4 kisi · kapasite %56"): uyelerden turetilir.
    const sum = (k) => data.members.reduce((a, m) => a + (Number(m[k]) || 0), 0)
    const teamLogged = sum('logged_hours')
    const teamExpected = sum('expected_hours')
    const teamFill = teamExpected > 0 ? Math.round((teamLogged / teamExpected) * 100) : null

    return (
        <section className="home-block home-team" aria-labelledby="home-team-title" aria-busy={isLoading} data-testid="home-team">
            <div className="home-block__head">
                <h2 id="home-team-title" className="home-block__title">{t('home.team.title')}</h2>
                <span className="home-block__meta">{t('home.team.members', { count: data.members.length })}</span>
                <span className="home-block__spacer" />
                {hasAttention && (
                    <LiquidSegmented
                        className="home-team__tabs"
                        ariaLabel={t('home.team.title')}
                        value={view}
                        onChange={setTab}
                        options={[
                            { value: 'members', label: t('home.team.tabMembers') },
                            { value: 'attention', label: <>{t('home.team.tabAttention')} <span className="home-team__tab-count">{attentionCount}</span></> },
                        ]}
                    />
                )}
                <Link to={PM_BASE} className="home-block__link">{t('home.team.openAssigned')}</Link>
            </div>

            {data.members.length > 0 && (
                <dl className="home-team__kpis">
                    <div><dd>{sum('open_count')}</dd><dt>{t('home.team.kpiOpen')}</dt></div>
                    <div className={sum('overdue_count') > 0 ? 'is-bad' : undefined}><dd>{sum('overdue_count')}</dd><dt>{t('home.team.kpiOverdue')}</dt></div>
                    <div><dd>{formatHours(teamLogged)}<small> / {formatHours(teamExpected)}h</small></dd><dt>{t('home.team.kpiEffort')}</dt></div>
                    <div><dd>{teamFill === null ? '—' : `${teamFill}%`}</dd><dt>{t('home.team.kpiFill')}</dt></div>
                </dl>
            )}

            {view === 'members' ? (
                <div className="home-fill home-team__list">
                    {data.members.length === 0 ? (
                        <p className="home-bucket__empty">{t('home.team.empty')}</p>
                    ) : (
                        <ol className="home-team__members">
                            {data.members.map((m) => (
                                <MemberRow key={m.user_id} member={m} nameOf={nameOf} noEffort={noEffort.has(m.user_id)} maxOpen={maxOpen} />
                            ))}
                        </ol>
                    )}
                </div>
            ) : (
                <div className="home-fill home-attention" aria-label={t('home.team.attention')} data-testid="home-attention">
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
                                {[...noEffort].map((id) => (
                                    <li key={id}><Avatar id={id} name={nameOf(id)} size={24} />{nameOf(id)}</li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            )}
            {view === 'members' && data.members.length > 0 && (
                <div className="home-team__legend" aria-hidden="true">
                    <span><i className="home-team__legend-load" />{t('home.team.legendLoad')}</span>
                    <span><i className="home-team__legend-late" />{t('home.team.kpiOverdue')}</span>
                    <span><i className="home-team__legend-effort" />{t('home.team.legendEffort')}</span>
                </div>
            )}
        </section>
    )
}

export default TeamBlock
