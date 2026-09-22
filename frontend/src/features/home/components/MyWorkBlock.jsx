/**
 * =============================================================================
 * HERMES - "Islerim" blogu (ana sayfa, PM rework P3 / D3)
 * =============================================================================
 * Liste degil uc kova: gecikmis · bugun · bu hafta; her kova projeye gore
 * gruplu (Musteri · Proje + sayi). Bos kova sessizce kaybolur; yalnizca
 * "bugun" bos satiriyla durur (04-roller §4.2). Durtme kurali (§7):
 * gecikmis = kirmizi SAYAC, bugun = amber kenar; banner/modal yok.
 *
 * Satir gorsel dili (E4): tek renkli sinyal termindir; oncelik notr
 * ince cubuk; tip metin. Satir `/work/<KEY>` derin baglantisina gider.
 * =============================================================================
 */
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import dayjs from 'dayjs'

import { homeService } from '../../../services/api'
import { queryKeys } from '../../../query/queryKeys'
import { useT } from '../../../i18n'
import { PM_BASE } from '../../tasks/model/constants'
import { dueTone, groupLabel, visibleBuckets } from '../model/home'

const BUCKET_LABEL_KEY = {
    overdue: 'home.myWork.overdue',
    due_today: 'home.myWork.dueToday',
    this_week: 'home.myWork.thisWeek',
}

function WorkRow({ item, today }) {
    const t = useT()
    const tone = dueTone(item.due_date, today)
    return (
        <li className={`home-item home-item--${tone}`} data-due-tone={tone}>
            <Link to={`/work/${item.item_key}`} className="home-item__link">
                <span
                    className={`home-item__priority home-item__priority--${item.priority}`}
                    title={t(`home.priority.${item.priority}`)}
                    aria-hidden="true"
                />
                <span className="home-item__key">{item.item_key}</span>
                <span className="home-item__title">{item.title}</span>
                <span className="home-item__due">{dayjs(item.due_date).format('DD MMM')}</span>
            </Link>
        </li>
    )
}

function Bucket({ kind, bucket, today }) {
    const t = useT()
    return (
        <div className={`home-bucket home-bucket--${kind}`} data-bucket={kind}>
            <div className="home-bucket__head">
                <span className="home-bucket__title">{t(BUCKET_LABEL_KEY[kind])}</span>
                <span
                    className={`h-badge ${kind === 'overdue' ? 'h-badge--danger' : 'h-badge--neutral'}`}
                    data-testid={`home-bucket-count-${kind}`}
                >
                    {bucket.count}
                </span>
            </div>
            {bucket.count === 0 ? (
                <p className="home-bucket__empty">{t('home.myWork.noneToday')}</p>
            ) : bucket.groups.map((group) => (
                <div className="home-group" key={group.project_id}>
                    <div className="home-group__head">
                        <span className="home-group__name">{groupLabel(group)}</span>
                        <span className="home-group__count">{group.count}</span>
                    </div>
                    <ul className="home-items">
                        {group.items.map((item) => (
                            <WorkRow key={item.id} item={item} today={today} />
                        ))}
                    </ul>
                </div>
            ))}
        </div>
    )
}

function MyWorkBlock() {
    const t = useT()
    const { data, isLoading, isError } = useQuery({
        queryKey: queryKeys.home.myWork,
        queryFn: () => homeService.myWork(),
    })
    const buckets = visibleBuckets(data)

    return (
        <section className="home-block home-work" aria-labelledby="home-work-title" aria-busy={isLoading} data-testid="home-work">
            <div className="home-block__head">
                <h2 id="home-work-title" className="home-block__title">{t('home.myWork.title')}</h2>
                <span className="home-block__spacer" />
                <Link to={PM_BASE} className="home-block__link">{t('home.myWork.openAll')}</Link>
            </div>
            {isError && <div className="h-inline-error">{t('home.loadFailed')}</div>}
            {buckets.map(({ key, bucket }) => (
                <Bucket key={key} kind={key} bucket={bucket} today={data?.today} />
            ))}
        </section>
    )
}

export default MyWorkBlock
