/**
 * HERMES - Bilgi bankasi Markdown alt kumesi: GUVENLI cizim.
 * Ham HTML calismaz (metin olarak gorunur), yalniz http/https/mailto
 * baglantilari <a> olur; javascript: duz metne doner.
 */
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import MiniMarkdown, { markdownToText, parseBlocks } from '../../features/kb/MiniMarkdown'

describe('MiniMarkdown', () => {
    it('baslik, liste, kalin, kod ve guvenli baglanti cizer', () => {
        const { container } = render(<MiniMarkdown source={[
            '# Şifre sıfırlama',
            'Önce **Şifremi unuttum** bağlantısına tıklayın.',
            '',
            '1. E-postanızı yazın',
            '2. `Gönder`e basın',
            '- [Yardım](https://example.com/help)',
            '- [Kötü](javascript:alert(1))',
            '<script>alert(1)</script>',
        ].join('\n')} />)
        expect(screen.getByRole('heading', { name: 'Şifre sıfırlama' })).toBeInTheDocument()
        expect(container.querySelector('strong').textContent).toBe('Şifremi unuttum')
        expect(container.querySelectorAll('ol li')).toHaveLength(2)
        expect(container.querySelector('code').textContent).toBe('Gönder')
        const links = container.querySelectorAll('a')
        expect(links).toHaveLength(1)
        expect(links[0]).toHaveAttribute('href', 'https://example.com/help')
        expect(links[0]).toHaveAttribute('rel', 'noopener noreferrer')
        expect(container.querySelector('script')).toBeNull()
        expect(container.textContent).toContain('<script>alert(1)</script>')
        expect(container.textContent).toContain('Kötü')
    })

    it('kod blogu ve alinti; duz metne cevirme', () => {
        const source = '```\nnpm run build\n```\n> Not: önce yedek alın'
        expect(parseBlocks(source).map((b) => b.type)).toEqual(['code', 'quote'])
        expect(markdownToText('**Adım** 1\n\n- [Panel](https://x.io)')).toBe('Adım 1\n\n• Panel (https://x.io)')
    })
})
