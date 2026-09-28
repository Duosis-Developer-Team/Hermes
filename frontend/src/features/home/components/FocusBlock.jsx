/**
 * =============================================================================
 * HERMES - "Dikkat" karti (ana sayfa, Hermes Liquid prototipi)
 * =============================================================================
 * Ana sayfanin sag ustu: dikkat isteyen konular SAYI olarak, her biri ilgili
 * gorunume giden bir satir. Yeni uc YOK — kaynaklar ana sayfanin mevcut
 * sorgulari (ayni onbellek anahtarlari):
 *   - Termini gecmis / bugun terminli isler  → home.myWork (is erisimi olana)
 *   - Sahipsiz isler / efor girmeyenler       → home.team (yalniz ekip lideri;
 *     sunucu eligible=false derse bu satirlar cizilmez)
 * Sifir olan konu cizilmez; hic konu yoksa sakin bir "her sey yolunda".
 * =============================================================================
 */
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import dayjs from 'dayjs'

import { authService, homeService } from '../../../services/api'
import { queryKeys } from '../../../query/queryKeys'
import { useT } from '../../../i18n'
import { Avatar } from '../../../components/liquid'

function oldestOverdueDays(bucket, today = dayjs()) {
    let max = 0
    for (const g of bucket?.groups || []) {
        for (const it of g.items || []) {
            if (!it.due_date) continue
            const d = today.startOf('day').diff(dayjs(it.due_date), 'day')
            if (d > max) max = d
        }
    }
    return max
}

function FocusBlock({ showMyWork }) {
    const t = useT()
    const myWork = useQuery({
        queryKey: queryKeys.home.myWork,
        queryFn: () => homeService.myWork(),
        enabled: showMyWork,
    })
    const team = useQuery({
        queryKey: queryKeys.home.team,
        queryFn: () => homeService.team(),
    })
    const eligible = team.data?.eligible === true
    const noEffortIds = eligible ? (team.data?.attention?.no_effort_user_ids || []) : []
    const users = useQuery({
        queryKey: queryKeys.users.lookup,
        queryFn: () => authService.lookupUsers(),
        enabled: noEffortIds.length > 0,
    })
    const nameOf = (id) => (users.data || []).find((u) => u.id === id)?.full_name || ''

    const rows = []
    const overdue = myWork.data?.overdue?.count || 0
    if (overdue > 0) {
        rows.push({
            key: 'overdue', tone: 'bad', count: overdue, to: '/project-management?view=overdue',
            title: t('home.focus.overdue'),
            sub: t('home.focus.overdueSub', { days: oldestOverdueDays(myWork.data.overdue) }),
            viz: 'bars',
        })
    }
    const dueToday = myWork.data?.due_today?.count || 0
    if (dueToday > 0) {
        rows.push({
            key: 'today', tone: 'warn', count: dueToday, to: '/project-management?view=due-this-week',
            title: t('home.focus.dueToday'), sub: t('home.focus.dueTodaySub'),
        })
    }
    const unassigned = eligible ? (team.data?.attention?.unassigned_count || 0) : 0
    if (unassigned > 0) {
        rows.push({
            key: 'unassigned', tone: 'warn', count: unassigned, to: '/project-management?view=triage',
            title: t('home.focus.unassigned'), sub: t('home.focus.unassignedSub'), viz: 'ghosts',
        })
    }
    if (noEffortIds.length > 0) {
        rows.push({
            key: 'noEffort', tone: 'info', count: noEffortIds.length, to: '/time-entry',
            title: t('home.focus.noEffort'),
            sub: noEffortIds.map(nameOf).filter(Boolean).join(', ') || t('home.focus.noEffortSub'),
            people: noEffortIds,
        })
    }

    return (
        <section className="home-block home-focus" aria-labelledby="home-focus-title" data-testid="home-focus">
            <div className="home-block__head">
                <h2 id="home-focus-title" className="home-block__title">{t('home.focus.title')}</h2>
                <span className="home-block__spacer" />
                {rows.length > 0 && (
                    <span className="lq-tag lq-tag--bad">{t('home.focus.count', { count: rows.length })}</span>
                )}
            </div>
            {rows.length === 0 ? (
                <p className="home-focus__calm">{t('home.focus.calm')}</p>
            ) : (
                <ul className="home-focus__list">
                    {rows.map((r, i) => (
                        <li key={r.key} style={{ animationDelay: `${i * 70}ms` }}>
                            <Link to={r.to} className={`home-focus__row home-focus__row--${r.tone}`} data-focus={r.key}>
                                <span className="home-focus__count">{r.count}</span>
                                <span className="home-focus__text">
                                    <b>{r.title}</b>
                                    <small>{r.sub}</small>
                                </span>
                                {r.viz === 'bars' && (
                                    <span className="home-focus__bars" aria-hidden="true">
                                        {[5, 8, 11, 14, 17].map((h) => <i key={h} style={{ height: h }} />)}
                                    </span>
                                )}
                                {r.viz === 'ghosts' && (
                                    <span className="home-focus__ghosts" aria-hidden="true"><i>?</i><i>?</i></span>
                                )}
                                {r.people && (
                                    <span className="lq-avs" aria-hidden="true">
                                        {r.people.slice(0, 3).map((id) => <Avatar key={id} id={id} name={nameOf(id)} size={26} />)}
                                    </span>
                                )}
                            </Link>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    )
}

export default FocusBlock
