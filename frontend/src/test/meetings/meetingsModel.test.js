/**
 * Hermes Liquid — toplanti takvimi saf kurallari: cakisan toplantilar
 * yan yana seritlere bolunur; takvim filtreleri toplantiyi turune gore
 * gizler (iptal edilenler varsayilan kapali).
 */
import { describe, expect, it } from 'vitest'
import { layoutLanes, passesMeetingFilters } from '../../components/meetings/meetingsModel'

const it2 = (id, start, end) => ({ m: { id }, start, end })

describe('layoutLanes', () => {
    it('cakismayanlar tek seritte kalir', () => {
        const r = layoutLanes([it2('a', 540, 600), it2('b', 600, 660)])
        expect(r.map((x) => [x.m.id, x.lane, x.lanes])).toEqual([['a', 0, 1], ['b', 0, 1]])
    })
    it('cakisanlar ayni kume icinde serit sayisini paylasir', () => {
        const r = layoutLanes([it2('a', 540, 660), it2('b', 570, 600), it2('c', 610, 640), it2('d', 700, 720)])
        const byId = Object.fromEntries(r.map((x) => [x.m.id, x]))
        expect(byId.a).toMatchObject({ lane: 0, lanes: 2 })
        expect(byId.b).toMatchObject({ lane: 1, lanes: 2 })
        expect(byId.c).toMatchObject({ lane: 1, lanes: 2 })
        expect(byId.d).toMatchObject({ lane: 0, lanes: 1 })
    })
})

describe('passesMeetingFilters', () => {
    const all = { online: true, offline: true, logged: true, cancelled: false }
    it('iptal edilen yalniz iptal filtresi aciksa gorunur', () => {
        expect(passesMeetingFilters({ is_cancelled: true }, false, all)).toBe(false)
        expect(passesMeetingFilters({ is_cancelled: true }, false, { ...all, cancelled: true })).toBe(true)
    })
    it('Teams / yuz yuze ayrimi join_url ile', () => {
        expect(passesMeetingFilters({ join_url: 'x' }, false, { ...all, online: false })).toBe(false)
        expect(passesMeetingFilters({ join_url: null }, false, { ...all, offline: false })).toBe(false)
    })
    it('efor kaydedilmisler kapatilinca gizlenir', () => {
        expect(passesMeetingFilters({ join_url: 'x' }, true, { ...all, logged: false })).toBe(false)
    })
})
