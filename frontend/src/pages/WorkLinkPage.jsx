/**
 * =============================================================================
 * HERMES - `/work/:key` derin baglanti (PM rework P3 / E6)
 * =============================================================================
 * Bir ise link verilebilir: `/work/TASK-56`. Kod (veya birlesmede kaybolan
 * eski kod — A9 alias) sunucuda cozulur, ardindan is yuzeyi `?item=` ile
 * acilir (mevcut Review derin baglantisi). Gorunmeyen kayit = yok (404):
 * sessiz bir "bulunamadi" ekrani, is yuzeyine donus baglantisi.
 * =============================================================================
 */
import { useEffect } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Spin } from 'antd'

import { taskService } from '../services/api'
import { queryKeys } from '../query/queryKeys'
import { PM_BASE } from '../features/tasks/model/constants'
import { workItemPath } from '../features/home/model/home'
import { useT } from '../i18n'

function WorkLinkPage() {
    const t = useT()
    const { key } = useParams()
    const navigate = useNavigate()
    const { data, isError } = useQuery({
        queryKey: queryKeys.tasks.byKey(key),
        queryFn: () => taskService.getByKey(key),
        retry: false,
    })

    useEffect(() => {
        if (data?.id) navigate(workItemPath(data), { replace: true })
    }, [data, navigate])

    if (isError) {
        return (
            <div className="h-empty" data-testid="work-link-missing">
                <div className="h-empty__title">{t('home.workLink.notFound')}</div>
                <p>{t('home.workLink.notFoundHint', { key })}</p>
                <Link to={PM_BASE}>{t('home.workLink.backToWork')}</Link>
            </div>
        )
    }
    return (
        <div className="h-empty" aria-busy="true">
            <Spin />
            <span>{t('home.workLink.resolving', { key })}</span>
        </div>
    )
}

export default WorkLinkPage
