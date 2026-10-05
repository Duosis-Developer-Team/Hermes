/**
 * =============================================================================
 * HERMES - Surum rozeti (kabugun sag ust kosesi)
 * =============================================================================
 * Cam hap: "Hermes v1.0". Uzerine gelince altinda kucuk "Surum notlarini
 * gor" ipucu belirir; tiklama /patch-notes'a gider (SPA rotasi — web'de
 * adres degisir, masaustu uygulamasinda ayni pencerede sayfa acilir).
 * Surum features/releases'ten (tek kaynak).
 * =============================================================================
 */
import { Link } from 'react-router-dom'
import { ArrowRightOutlined } from '@ant-design/icons'

import { APP_VERSION, PATCH_NOTES_PATH, formatVersion } from '../../features/releases/releases'
import { useT } from '../../i18n'

function VersionBadge() {
    const t = useT()
    const version = formatVersion(APP_VERSION)
    return (
        <Link
            to={PATCH_NOTES_PATH}
            className="version-badge"
            aria-label={t('patchNotes.badgeAria', { version })}
        >
            <span className="version-badge__pill">
                <span className="version-badge__dot" aria-hidden="true" />
                Hermes <b>{version}</b>
            </span>
            <span className="version-badge__hint" aria-hidden="true">
                {t('patchNotes.badgeHint')} <ArrowRightOutlined />
            </span>
        </Link>
    )
}

export default VersionBadge
