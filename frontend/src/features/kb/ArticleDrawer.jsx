/**
 * HERMES - Makale gorunumu (bilgi bankasi / yardim merkezi, Dalga D3).
 *
 * Musteri tarafinda "yardimci oldu mu?" oyu ve "hala yardima mi ihtiyaciniz
 * var" cagrisi gosterilir; ajan tarafinda yalniz okuma (duzenleme ayri).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Drawer, Skeleton } from 'antd'
import { DislikeOutlined, LikeOutlined, ReadOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'

import { helpCenterService, kbService } from '../../api/ticketsApi'
import { Button } from '../../components/ui'
import { ModalHead } from '../../components/liquid'
import { useT } from '../../i18n'
import MiniMarkdown from './MiniMarkdown'
import './kb.css'

export default function ArticleDrawer({ articleId, provider, customer = true, onClose, onNeedHelp }) {
    const t = useT()
    const queryClient = useQueryClient()
    const key = ['kb', customer ? 'customer' : 'agent', provider ?? 'single', articleId]
    const article = useQuery({
        queryKey: key,
        queryFn: () => (customer ? helpCenterService.article(articleId, provider) : kbService.article(articleId)),
        enabled: Boolean(articleId),
    })
    const vote = useMutation({
        mutationFn: (helpful) => helpCenterService.vote(articleId, helpful, provider),
        onSuccess: (data) => queryClient.setQueryData(key, data),
    })
    const a = article.data
    return (
        <Drawer
            open={Boolean(articleId)}
            onClose={onClose}
            width="min(760px, 96vw)"
            rootClassName="lq-sheet"
            destroyOnHidden
            title={<ModalHead icon={<ReadOutlined />} tone="blue" title={a?.title ?? t('kb.article')}
                              subtitle={a?.updated_at ? t('kb.updated', { date: dayjs(a.updated_at).format('D MMM YYYY') }) : undefined} />}
        >
            {article.isLoading && <Skeleton active paragraph={{ rows: 6 }} />}
            {article.isError && <p className="lq-note">{t('kb.notFound')}</p>}
            {a && (
                <article className="kb-article">
                    {a.summary && <p className="kb-article__summary">{a.summary}</p>}
                    <MiniMarkdown source={a.body} />
                    {customer && (
                        <footer className="kb-article__foot">
                            <span>{t('kb.helpful')}</span>
                            <Button size="small" icon={<LikeOutlined />} aria-pressed={a.my_vote === true}
                                    loading={vote.isPending && vote.variables === true}
                                    onClick={() => vote.mutate(true)}>{t('kb.yes')}</Button>
                            <Button size="small" icon={<DislikeOutlined />} aria-pressed={a.my_vote === false}
                                    loading={vote.isPending && vote.variables === false}
                                    onClick={() => vote.mutate(false)}>{t('kb.no')}</Button>
                            {a.my_vote === false && onNeedHelp && (
                                <Button size="small" variant="primary" onClick={onNeedHelp}>{t('kb.openTicket')}</Button>
                            )}
                        </footer>
                    )}
                </article>
            )}
        </Drawer>
    )
}
