/**
 * Route-degisimi skeleton'u (Sprint 1 §5.3): shell GORUNUR kalir, yalniz
 * icerik alani degisir. Geometri gercek sayfalarin ortak duzenini
 * (baslik + toolbar + icerik blogu) yaklasik korur — layout shift'i
 * kucultur. Reduced-motion'da AntD skeleton animasyonu global CSS
 * kuralinca durur.
 */
import { Skeleton } from 'antd'

function PageSkeleton() {
    return (
        <div style={{ padding: 24 }} aria-busy="true" aria-live="polite">
            <Skeleton.Input active style={{ width: 240, height: 32 }} />
            <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
                <Skeleton.Button active />
                <Skeleton.Button active />
                <Skeleton.Button active />
            </div>
            <div style={{ marginTop: 24 }}>
                <Skeleton active paragraph={{ rows: 8 }} />
            </div>
        </div>
    )
}

export default PageSkeleton
