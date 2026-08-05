/**
 * =============================================================================
 * HERMES - Active | Archive gecisi
 * =============================================================================
 * KULLANICI KARARI (2026-08-06): ikon dugme YETERSIZDI — hangi havuzda
 * oldugumuz bakinca anlasilmiyordu. Yerine, uygulamada zaten var olan
 * All/Weekly seceginin BIREBIR AYNI tasarimi ve gecisi kullanilir
 * (`tasks-views` + `tasks-views-pill`), ayni yerde: baslik satirinda.
 *
 * Ikinci bir gorsel dil URETILMEZ; kullanici tanidik bir kontrol gorur.
 * =============================================================================
 */
import { ARCHIVE_STATES } from '../model/taskLifecycle'

function TaskLifecycleSwitcher({ value, onChange }) {
    return (
        <div className="tasks-views" role="tablist" aria-label="Work item pool">
            {ARCHIVE_STATES.map((s) => (
                <button
                    key={s.value}
                    type="button"
                    role="tab"
                    aria-selected={value === s.value}
                    className={`tasks-views-pill${
                        value === s.value ? ' tasks-views-pill-active' : ''
                    }`}
                    onClick={() => onChange(s.value)}
                >
                    {s.label}
                </button>
            ))}
        </div>
    )
}

export default TaskLifecycleSwitcher
