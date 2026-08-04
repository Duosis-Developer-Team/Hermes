/**
 * =============================================================================
 * HERMES DS V2 - Ant Design token koprusu (Sprint 2, CTO paketi §9)
 * =============================================================================
 * Tek merkezi ConfigProvider temasi BURADAN uretilir. Degerler
 * tokens.css'teki semantic katmanla AYNI kaynaktan (asagidaki sabitler
 * o dosyayla testle esitlenir — drift CI'da kirmizi).
 *
 * Onceki durum: main.jsx'te statik, indigo (#6366f1) tabanli ve tema
 * degisimine TEPKISIZ bir tema vardi; light mod tamamen CSS override
 * savasiyla ayakta duruyordu. Simdi: mode parametresi ile algorithm +
 * token seti birlikte doner; marka rengi paket §4 karari geregi Hermes
 * mavi ailesine baglanir (dark #579DFF / light #0C66E4).
 */
import { theme as antdTheme } from 'antd'

// tokens.css semantic katmaninin JS aynasi (test: theme bridge sync).
export const SEMANTIC = {
    dark: {
        canvas: '#0B0F14', surface: '#111720', elevated: '#161D27',
        hover: '#1B2532', textPrimary: '#F4F7FB', textSecondary: '#A8B3C2',
        borderSubtle: '#202B38', borderDefault: '#2A3747',
        brand: '#579DFF', brandHover: '#85B8FF',
        success: '#4BCE97', warning: '#F5CD47', danger: '#F87168',
        info: '#85B8FF',
    },
    light: {
        canvas: '#FAFBFD', surface: '#FFFFFF', elevated: '#FFFFFF',
        hover: '#F0F3F7', textPrimary: '#17202D', textSecondary: '#526174',
        borderSubtle: '#E8EDF3', borderDefault: '#D9E1EA',
        brand: '#0C66E4', brandHover: '#388BFF',
        success: '#1F845A', warning: '#946F00', danger: '#C9372C',
        info: '#0C66E4',
    },
}

const FONT_FAMILY =
    "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, " +
    "'Helvetica Neue', Arial, sans-serif"

export function buildAntdTheme(mode = 'dark') {
    const s = SEMANTIC[mode] ?? SEMANTIC.dark
    return {
        algorithm: mode === 'light'
            ? antdTheme.defaultAlgorithm
            : antdTheme.darkAlgorithm,
        token: {
            colorPrimary: s.brand,
            colorInfo: s.info,
            colorSuccess: s.success,
            colorWarning: s.warning,
            colorError: s.danger,
            colorBgBase: s.canvas,
            colorBgContainer: s.surface,
            colorBgElevated: s.elevated,
            colorText: s.textPrimary,
            colorTextSecondary: s.textSecondary,
            colorBorder: s.borderDefault,
            colorBorderSecondary: s.borderSubtle,
            borderRadius: 8,          /* --h-radius-standard */
            borderRadiusSM: 6,        /* --h-radius-control */
            borderRadiusLG: 10,       /* --h-radius-card */
            controlHeight: 32,
            fontFamily: FONT_FAMILY,
            fontSize: 14,             /* --h-font-body */
            motionDurationFast: '0.1s',   /* instant */
            motionDurationMid: '0.16s',   /* fast */
            motionDurationSlow: '0.22s',  /* base */
        },
        components: {
            Layout: {
                headerBg: s.surface,
                siderBg: s.surface,
                bodyBg: s.canvas,
            },
            Menu: {
                darkItemBg: s.surface,
                darkItemSelectedBg:
                    mode === 'light'
                        ? 'rgba(12, 102, 228, 0.10)'
                        : 'rgba(87, 157, 255, 0.16)', /* --h-bg-selected */
                itemBorderRadius: 6,
            },
            Modal: { borderRadiusLG: 14 /* --h-radius-modal */ },
            /* Premium UI (2026-08-04): buyuk gri tablo blogu kalkti —
               baslik tonal/subtle, hover wash premium.css'te accent'li.
               (headerBg burada da dusuk alfa: sticky header'da zemin
               kaybolmasin diye canvas ustune binen deger premium.css'te.) */
            Table: {
                /* Premium redesign: gri baslik SERIDI yok — kolon etiketi
                   kucuk/muted, ayrim ince divider. */
                headerBg: 'transparent',
                rowHoverBg: mode === 'light'
                    ? 'rgba(12, 102, 228, 0.05)'
                    : 'rgba(87, 157, 255, 0.05)',
                headerSplitColor: 'transparent',
                colorBgContainer: 'transparent',
            },
            /* Ghost secondary: buyuk gri dolgu yerine seffaf taban. */
            Button: {
                defaultBg: 'transparent',
                defaultHoverBg: s.hover,
            },
            /* Kartlar: koyu/gri levha degil — canvas'la butunlesen
               subtle yuzey (Dashboard bolumleri dahil). */
            Card: {
                /* Card artik gorsel bir KUTU degil: icerik tuvalde yasar. */
                colorBgContainer: 'transparent',
                headerBg: 'transparent',
                colorBorderSecondary: 'transparent',
                paddingLG: 0,
            },
        },
    }
}
