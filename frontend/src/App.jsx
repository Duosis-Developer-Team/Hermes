/**
 * =============================================================================
 * HERMES PLATFORM - Main App Component
 * =============================================================================
 * Ana uygulama bileşeni. Routing ve layout yapılandırması.
 * =============================================================================
 */

import { useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { Spin } from 'antd'
import { useAuthStore } from './stores/authStore'
import { authService } from './services/api'

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

// Pages
import LoginPage from './pages/LoginPage'
import AuthCallbackPage from './pages/AuthCallbackPage'
import DashboardPage from './pages/DashboardPage'
import TimeEntryPage from './pages/TimeEntryPage'
import CustomersPage from './pages/admin/CustomersPage'
import ProjectsPage from './pages/admin/ProjectsPage'
import WorkTypesPage from './pages/admin/WorkTypesPage'
import UsersPage from './pages/admin/UsersPage'
import ActivityTypesPage from './pages/ActivityTypesPage'
import PlatformsPage from './pages/PlatformsPage'
import WorkLinesPage from './pages/WorkLinesPage'
import BillableHoursPage from './pages/BillableHoursPage'
import ReportsPage from './pages/ReportsPage'
import ContractStatusPage from './pages/admin/ContractStatusPage'
import TasksPage from './pages/TasksPage'
import TaskManagementPage from './pages/admin/TaskManagementPage'
import ApiManagementPage from './pages/admin/ApiManagementPage'
import MeetingsPage from './pages/MeetingsPage'
import { useTaskPermissions } from './hooks/useTaskPermissions'

/**
 * Protected Route Component
 * Kimlik doğrulaması gerektiğinde kullanılır.
 */
const ProtectedRoute = ({ children, adminOnly = false }) => {
    const { isAuthenticated, user } = useAuthStore()

    if (!isAuthenticated) {
        return <Navigate to="/login" replace />
    }

    if (adminOnly && !user?.is_admin) {
        return <Navigate to="/time-entry" replace />
    }

    return children
}

/**
 * Task-Protected Route — admin OR can_access_tasks.
 * Backend remains the source of truth; this is UX only.
 */
const TaskProtectedRoute = ({ children }) => {
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
    const { isAuthenticated, login } = useAuthStore()
    const [sessionChecked, setSessionChecked] = useState(false)

    useEffect(() => {
        // [KRİTİK-6]: Temizlik — Eski mimariden kalan güvensiz localStorage token'ını sil
        const legacyToken = localStorage.getItem('hermes-auth')
        if (legacyToken) {
            localStorage.removeItem('hermes-auth')
            console.log('Legacy hermes-auth token removed from localStorage for security')
        }

        // Sayfa yenilemesinde mevcut HttpOnly cookie üzerinden oturumu geri yükle
        authService.getMe()
            .then(user => {
                if (user) login(user)
            })
            .catch(() => {
                // Cookie yok veya süresi dolmuş — login sayfasında kalınır
            })
            .finally(() => {
                setSessionChecked(true)
            })
    }, [])

    // /me kontrolü bitmeden route'ları render etme — aksi halde cookie hâlâ geçerliyken
    // isAuthenticated=false olduğu için login'e yönlendirme yapılır.
    // Render a visible loader rather than `null` so a slow /me call
    // doesn't look like a "stuck gray screen" to the user (especially
    // on cold hard-refresh of a protected route like /tasks).
    if (!sessionChecked) return <CenteredLoader />

    return (
        <Routes>
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
                        <ProtectedRoute adminOnly>
                            <TaskManagementPage />
                        </ProtectedRoute>
                    }
                />

                {/* API Management — Public API clients/tokens/logs/docs */}
                <Route
                    path="api-management"
                    element={
                        <ProtectedRoute adminOnly>
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

                {/* Admin Pages */}
                <Route
                    path="dashboard"
                    element={
                        <ProtectedRoute adminOnly>
                            <DashboardPage />
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="/management/billable-hours"
                    element={
                        <ProtectedRoute adminOnly>
                            <BillableHoursPage />
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="/management/reports"
                    element={
                        <ProtectedRoute adminOnly>
                            <ReportsPage />
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="/management/contracts"
                    element={
                        <ProtectedRoute adminOnly>
                            <ContractStatusPage />
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="customers"
                    element={
                        <ProtectedRoute adminOnly>
                            <CustomersPage />
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="projects"
                    element={
                        <ProtectedRoute adminOnly>
                            <ProjectsPage />
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="work-types"
                    element={
                        <ProtectedRoute adminOnly>
                            <WorkTypesPage />
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="users"
                    element={
                        <ProtectedRoute adminOnly>
                            <UsersPage />
                        </ProtectedRoute>
                    }
                />

                <Route
                    path="activity-types"
                    element={
                        <ProtectedRoute adminOnly>
                            <ActivityTypesPage />
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="platforms"
                    element={
                        <ProtectedRoute adminOnly>
                            <PlatformsPage />
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="work-lines"
                    element={
                        <ProtectedRoute adminOnly>
                            <WorkLinesPage />
                        </ProtectedRoute>
                    }
                />
            </Route>

            {/* 404 - Redirect to home */}
            <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
    )
}

export default App
