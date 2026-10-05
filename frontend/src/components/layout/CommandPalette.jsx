/**
 * =============================================================================
 * HERMES LIQUID — ⌘K komut paleti (R2)
 * =============================================================================
 * Spotlight tarzi hizli gecis. Kaynak YALNIZCA kabuga verilen menu
 * ogeleridir — yani izin filtresinden GECMIS rotalar; palet yeni bir
 * gezinme yuzeyi ACMAZ (izinsiz rota burada da yapisal olarak yok).
 * Klavye: ↑/↓ secer, Enter gider, Esc kapatir.
 * =============================================================================
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Modal } from 'antd'
import { SearchOutlined, EnterOutlined } from '@ant-design/icons'

import { useT } from '../../i18n'
import { matchesSearch } from '../../utils/searchText'

export default function CommandPalette({ open, items, onClose, onSelect }) {
    const t = useT()
    const [query, setQuery] = useState('')
    const [active, setActive] = useState(0)
    const inputRef = useRef(null)

    useEffect(() => {
        if (!open) return undefined
        setQuery('')
        setActive(0)
        const id = setTimeout(() => inputRef.current?.focus(), 30)
        return () => clearTimeout(id)
    }, [open])

    const results = useMemo(() => {
        if (!query.trim()) return items
        return items.filter((it) => matchesSearch(`${it.text} ${it.group || ''}`, query))
    }, [items, query])

    const choose = (it) => {
        if (!it) return
        onSelect(it.key)
        onClose()
    }

    const onKeyDown = (e) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActive((i) => Math.min(i + 1, results.length - 1))
        } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((i) => Math.max(i - 1, 0))
        } else if (e.key === 'Enter') {
            e.preventDefault()
            choose(results[active])
        }
    }

    return (
        <Modal
            open={open}
            onCancel={onClose}
            footer={null}
            closable={false}
            width={560}
            className="command-palette"
            rootClassName="island-drop-root"
            style={{ top: 78 }}
            title={null}
            destroyOnHidden
            styles={{ body: { padding: 0 } }}
        >
            <div className="command-palette__search">
                <SearchOutlined aria-hidden="true" />
                <input
                    ref={inputRef}
                    value={query}
                    onChange={(e) => { setQuery(e.target.value); setActive(0) }}
                    onKeyDown={onKeyDown}
                    placeholder={t('shellExtra.commandPlaceholder')}
                    aria-label={t('shellExtra.search')}
                    role="combobox"
                    aria-expanded="true"
                    aria-controls="command-palette-list"
                    aria-activedescendant={results[active] ? `cmd-${active}` : undefined}
                />
                <kbd>esc</kbd>
            </div>
            <ul className="command-palette__list" id="command-palette-list" role="listbox">
                {results.map((it, i) => (
                    <li
                        key={it.key}
                        id={`cmd-${i}`}
                        role="option"
                        aria-selected={i === active}
                        className={i === active ? 'is-active' : undefined}
                        onMouseEnter={() => setActive(i)}
                        onClick={() => choose(it)}
                    >
                        <span className="command-palette__icon">{it.icon}</span>
                        <span className="command-palette__text">{it.text}</span>
                        {it.group && <span className="command-palette__group">{it.group}</span>}
                        {i === active && <EnterOutlined className="command-palette__enter" aria-hidden="true" />}
                    </li>
                ))}
                {!results.length && (
                    <li className="command-palette__empty" role="presentation">
                        {t('shellExtra.noResults')}
                    </li>
                )}
            </ul>
        </Modal>
    )
}
