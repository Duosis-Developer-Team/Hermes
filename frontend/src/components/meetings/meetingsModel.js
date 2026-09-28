/**
 * HERMES - Toplanti takvimi saf yardimcilari (React/DOM yok; testli).
 */

/** Cakisan toplantilari seritlere ayirir: [{ m, lane, lanes }]. */
export function layoutLanes(items) {
    const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end)
    const out = []
    let cluster = []
    let clusterEnd = -1
    const flush = () => {
        const laneEnds = []
        for (const it of cluster) {
            let lane = laneEnds.findIndex((end) => end <= it.start)
            if (lane === -1) { lane = laneEnds.length; laneEnds.push(it.end) } else laneEnds[lane] = it.end
            it.lane = lane
        }
        for (const it of cluster) out.push({ ...it, lanes: laneEnds.length })
        cluster = []
    }
    for (const it of sorted) {
        if (cluster.length && it.start >= clusterEnd) { flush(); clusterEnd = -1 }
        cluster.push(it)
        clusterEnd = Math.max(clusterEnd, it.end)
    }
    if (cluster.length) flush()
    return out
}

export const MEETING_FILTERS = ['online', 'offline', 'logged', 'cancelled']

/** Filtre anahtarina gore toplantinin gorunup gorunmeyecegi. */
export function passesMeetingFilters(m, logged, filters) {
    if (m.is_cancelled) return filters.cancelled
    if (logged && !filters.logged) return false
    return m.join_url ? filters.online : filters.offline
}

