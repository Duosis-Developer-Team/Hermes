/**
 * =============================================================================
 * HERMES PLATFORM - Main App Component
 * =============================================================================
 * Ana uygulama bileşeni. Routing ve layout yapılandırması.
 * =============================================================================
 */

import { lazy, Suspense, useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { Spin } from 'antd'
import { useAuthStore } from './stores/authStore'
import { usePlatformAuthStore } from './stores/platformAuthStore'
import { authService, rbacService } from './services/api'
import { AppErrorBoundary } from './components/common/ErrorBoundaries'

/**
 * Centered loader used in place of `return null` while auth + task
 * permissions are in flight. A literal `null` here is what produces
 * the dreaded "stuck on a gray screen" effect on a cold hard refresh
 * of /tasks (or any protected route).
 */
function CenteredLoader() {
    return (
        <div
            style={{
                minHeight: '100vh',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: '#0f0f0f',
            }}
        >
            <Spin size="large" />
        </div>
    )
}

// Layouts
import MainLayout from './components/layout/MainLayout'

// Pages — Sprint 1: route-based code splitting. Statik import YOK;
// her sayfa kendi chunk'inda, loader'lar src/routes/loaders.js'te
// (ayni loader ileride prefetch icin yeniden kullanilir).
import { routeLoaders } from './routes/loaders'

const LoginPage = lazy(routeLoaders.login)
const AuthCallbackPage = lazy(routeLoaders.authCallback)
const PlatformLoginPage = lazy(routeLoaders.platformLogin)
const PlatformConsole = lazy(routeLoaders.platformConsole)
const DashboardPage = lazy(routeLoaders.dashboard)
const TimeEntryPage = lazy(routeLoaders.timeEntry)
const CustomersPage = lazy(routeLoaders.customers)
const ProjectsPage = lazy(routeLoaders.projects)
const WorkTypesPage = lazy(routeLoaders.workTypes)
const UsersPage = lazy(routeLoaders.users)
const ActivityTypesPage = lazy(routeLoaders.activityTypes)
const PlatformsPage = lazy(routeLoaders.platforms)
const WorkLinesPage = lazy(routeLoaders.workLines)
const BillableHoursPage = lazy(routeLoaders.billableHours)
const ReportsPage = lazy(routeLoaders.reports)
const ContractStatusPage = lazy(routeLoaders.contracts)
const TasksPage = lazy(routeLoaders.tasks)
const TaskManagementPage = lazy(routeLoaders.taskManagement)
const ApiManagementPage = lazy(routeLoaders.apiManagement)
const DeveloperPortalPage = lazy(routeLoaders.developerPortal)
const MeetingsPage = lazy(routeLoaders.meetings)
import { useTaskPermissions } from './hooks/useTaskPermissions'

/**
 * Protected Route Component
 * Kimlik doğrulaması gerektiğinde kullanılır.
 */
export const ProtectedRoute = ({ children, permission = null }) => {
    // RBAC R3: rota koruması izin-tabanlı. `permission` string veya
    // dizi (dizi = herhangi biri yeterli). Backend her koşulda gerçek
    // otorite — bu yalnızca UX katmanı. İzinler henüz yüklenmediyse
    // (null) loader gösterilir; yanlış yere yönlendirme yapılmaz.
    const { isAuthenticated } = useAuthStore()
    const permissions = useAuthStore((s) => s.permissions)
    const canAny = useAuthStore((s) => s.canAny)

    if (!isAuthenticated) {
        return <Navigate to="/login" replace />
    }

    if (permission) {
        if (permissions === null) return <CenteredLoader />
        const wanted = Array.isArray(permission) ? permission : [permission]
        if (!canAny(...wanted)) {
            return <Navigate to="/time-entry" replace />
        }
    }

    return children
}

/**
 * Task-Protected Route — admin OR can_access_tasks.
 * Backend remains the source of truth; this is UX only.
 */
export const TaskProtectedRoute = ({ children }) => {
    const { isAuthenticated, user } = useAuthStore()
    const { isLoading, canAccessAny, isTaskAdmin } = useTaskPermissions()

    if (!isAuthenticated) {
        return <Navigate to="/login" replace />
    }
    if (user?.is_admin) {
        return children
    }
    if (isLoading) {
        // Show a visible loader instead of `null` so a slow permission
        // fetch doesn't read as a "stuck on gray" failure to the user.
        return <CenteredLoader />
    }
    if (!canAccessAny && !isTaskAdmin) {
        return <Navigate to="/time-entry" replace />
    }
    return children
}

/**
 * Main App Component
 */
function App() {
    const { isAuthenticated, login, setPermissions } = useAuthStore()
    const [sessionChecked, setSessionChecked] = useState(false)

    useEffect(() => {
        // [KRİTİK-6]: Temizlik — Eski mimariden kalan güvensiz localStorage token'ını sil
        const legacyToken = localStorage.getItem('hermes-auth')
        if (legacyToken) {
            // Sessizce temizlenir: kullaniciya gosterilecek bir sey yok ve
            // konsola guvenlik islemi yazmak (Sprint 7) gereksiz gurultu.
            localStorage.removeItem('hermes-auth')
        }

        // Sayfa yenilemesinde mevcut HttpOnly cookie üzerinden oturumu geri yükle.
        // RBAC R3: kimlikle birlikte efektif izinler de yüklenir — can()
        // fail-closed olduğu için izinler gelene dek yönetim yüzeyleri
        // görünmez; hata halinde boş liste (yine fail-closed).
        authService.getMe()
            .then(user => {
                // WS8: oturum geri yuklenirken tenant da geri yuklenir —
                // query anahtar uzayi ilk istekten ONCE dogru tenant'a
                // sabitlensin (aksi halde ilk sayfa anonim kapsamda
                // cache'lenir ve tenant gelince ikinci kez cekilir).
                if (user) login(user, user?.tenant || null)
            })
            .catch(() => {
                // Cookie yok veya süresi dolmuş — login sayfasında kalınır
            })
            .finally(() => {
                setSessionChecked(true)
            })
        /*
         * `login` Zustand store'unda `create((set) => ({...}))` icinde BIR
         * KEZ tanimlanir; referansi store'un omru boyunca STABILDIR. Bu
         * yuzden bagimlilik listesine eklemek dogru sonucu verir ve efekti
         * yeniden tetiklemez — uyariyi susturmak icin yanlis bagimlilik
         * eklenmedi, gercek bagimlilik yazildi.
         */
    }, [login])

    // RBAC R3: oturum AÇIK olduğu her an (boot VEYA login sonrası)
    // efektif izinleri yükle. can() fail-closed: izinler gelene dek
    // yönetim yüzeyleri görünmez; hata → boş liste (yine kapalı).
    // WS9: platform oturumu TENANT oturumundan bagimsizdir; ayri store,
    // ayri cerez, ayri audience. Tenant kullanicisi olmak konsola
    // erisim VERMEZ.
    const platformAuthenticated = usePlatformAuthStore(
        (s) => s.isAuthenticated,
    )

    const permissions = useAuthStore((s) => s.permissions)
    useEffect(() => {
        if (isAuthenticated && permissions === null) {
            rbacService.getMyPermissions()
                .then(r => setPermissions(r.permissions))
                .catch(() => setPermissions([]))
        }
        // `setPermissions` de ayni sekilde stabil bir store aksiyonu.
    }, [isAuthenticated, permissions, setPermissions])

    // /me kontrolü bitmeden route'ları render etme — aksi halde cookie hâlâ geçerliyken
    // isAuthenticated=false olduğu için login'e yönlendirme yapılır.
    // Render a visible loader rather than `null` so a slow /me call
    // doesn't look like a "stuck gray screen" to the user (especially
    // on cold hard-refresh of a protected route like /tasks).
    if (!sessionChecked) return <CenteredLoader />

    return (
        <AppErrorBoundary>
        <Suspense fallback={<CenteredLoader />}>
        <Routes>
            {/* =================================================================
                WS9 — Platform Admin Console (AYRI GUVENLIK DUZLEMI)
                =================================================================
                Tenant rota agacinin DISINDA yasar:
                  - tenant oturumu (`isAuthenticated`) burada hicbir sey
                    ifade etmez; kapi `usePlatformAuthStore`dur;
                  - MainLayout/sidebar KULLANILMAZ — tenant menusu bu
                    konsolda gorunmez, konsol da tenant menusune sizmaz;
                  - lazy chunk: normal kullanici bu kodu indirmez.
               ================================================================= */}
            <Route path="/platform-admin/login" element={<PlatformLoginPage />} />
            <Route
                path="/platform-admin/*"
                element={
                    platformAuthenticated
                        ? <PlatformConsole />
                        : <Navigate to="/platform-admin/login" replace />
                }
            />

            {/* Public Routes */}
            <Route
                path="/login"
                element={
                    isAuthenticated ? <Navigate to="/" replace /> : <LoginPage />
                }
            />

            <Route path="/auth/callback" element={<AuthCallbackPage />} />

            {/* Protected Routes - Main Layout */}
            <Route
                path="/"
                element={
                    <ProtectedRoute>
                        <MainLayout />
                    </ProtectedRoute>
                }
            >
                {/* Default redirect */}
                <Route index element={<Navigate to="/time-entry" replace />} />

                {/* Standard User Pages */}
                <Route path="time-entry" element={<TimeEntryPage />} />

                {/* Project Management — Tasks / Issues / Suggestions (admin
                    or users with access). The optional :type segment
                    (tasks | issues | suggestions) reflects the active tab in
                    the URL. */}
                <Route
                    path="project-management"
                    element={
                        <TaskProtectedRoute>
                            <TasksPage />
                        </TaskProtectedRoute>
                    }
                />
                <Route
                    path="project-management/:type"
                    element={
                        <TaskProtectedRoute>
                            <TasksPage />
                        </TaskProtectedRoute>
                    }
                />
                {/* Back-compat: old /tasks links (e.g. earlier e-mails). */}
                <Route
                    path="tasks"
                    element={<Navigate to="/project-management" replace />}
                />
                <Route
                    path="tasks/:type"
                    element={<Navigate to="/project-management" replace />}
                />

                {/* PM Configurations (was Task Management) */}
                <Route
                    path="pm-configurations"
                    element={
                        <ProtectedRoute permission={'tasks.permissions.manage'}>
                            <TaskManagementPage />
                        </ProtectedRoute>
                    }
                />

                {/* API Management — Public API clients/tokens/logs/docs */}
                <Route
                    path="api-management"
                    element={
                        <ProtectedRoute permission={'api.manage'}>
                            <ApiManagementPage />
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="task-management"
                    element={<Navigate to="/pm-configurations" replace />}
                />

                {/* Meetings — every authenticated user; backend
                    visibility narrows to their own attended events. */}
                <Route path="meetings" element={<MeetingsPage />} />

                {/* Developer Portal — Public API dokumantasyonu (D1:
                    TUM oturum acmis kullanicilar; token yonetimi
                    API Management'ta admin-only kalir). */}
                <Route path="developer" element={<DeveloperPortalPage />} />

                {/* Admin Pages */}
                <Route
                    path="dashboard"
                    element={
                        <ProtectedRoute permission={'reports.view'}>
                            <DashboardPage />
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="/management/billable-hours"
                    element={
                        <ProtectedRoute permission={'reports.view'}>
                            <BillableHoursPage />
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="/management/reports"
                    element={
                        <ProtectedRoute permission={'reports.view'}>
                            <ReportsPage />
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="/management/contracts"
                    element={
                        <ProtectedRoute permission={'reports.view'}>
                            <ContractStatusPage />
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="customers"
                    element={
                        <ProtectedRoute permission={'customers.manage'}>
                            <CustomersPage />
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="projects"
                    element={
                        <ProtectedRoute permission={'projects.manage'}>
                            <ProjectsPage />
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="work-types"
                    element={
                        <ProtectedRoute permission={'reference.manage'}>
                            <WorkTypesPage />
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="users"
                    element={
                        <ProtectedRoute permission={'users.manage'}>
                            <UsersPage />
                        </ProtectedRoute>
                    }
                />

                <Route
                    path="activity-types"
                    element={
                        <ProtectedRoute permission={'reference.manage'}>
                            <ActivityTypesPage />
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="platforms"
                    element={
                        <ProtectedRoute permission={'reference.manage'}>
                            <PlatformsPage />
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="work-lines"
                    element={
                        <ProtectedRoute permission={'reference.manage'}>
                            <WorkLinesPage />
                        </ProtectedRoute>
                    }
                />
            </Route>

            {/* 404 - Redirect to home */}
            <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
        </AppErrorBoundary>
    )
}

export default App
