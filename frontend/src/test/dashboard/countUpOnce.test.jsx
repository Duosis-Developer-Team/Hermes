/**
 * Dashboard sayaci (CTO 05.10): sayarak dolma yalniz ILK gosterimde;
 * tarih araligi degisince yeni deger animasyonsuz yerine oturur.
 */
import { describe, expect, it } from 'vitest'
import { act, render, screen } from '@testing-library/react'

import { CountUp } from '../../components/liquid'

describe('CountUp', () => {
    it('ilk deger sayarak, sonraki degisim dogrudan', async () => {
        const { rerender } = render(<span data-testid="n"><CountUp value={100} duration={40} /></span>)
        expect(screen.getByTestId('n').textContent).toBe('0')
        await act(() => new Promise((r) => setTimeout(r, 120)))
        expect(screen.getByTestId('n').textContent).toBe('100')
        rerender(<span data-testid="n"><CountUp value={250} duration={40} /></span>)
        expect(screen.getByTestId('n').textContent).toBe('250')
    })
})
