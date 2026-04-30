/**
 * =============================================================================
 * HERMES PLATFORM - Main App Component
 * =============================================================================
 * Ana uygulama bileşeni. Routing ve layout yapılandırması.
 * =============================================================================
 */

import { useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './stores/authStore'
import { authService } from './services/api'

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
    const { isLoading, canAccessTasks, isTaskAdmin } = useTaskPermissions()

    if (!isAuthenticated) {
        return <Navigate to="/login" replace />
    }
    if (user?.is_admin) {
        return children
    }
    if (isLoading) {
        return null
    }
    if (!canAccessTasks && !isTaskAdmin) {
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
    // isAuthenticated=false olduğu için login'e yönlendirme yapılır
    if (!sessionChecked) return null

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

                {/* Tasks — admin or users with can_access_tasks */}
                <Route
                    path="tasks"
                    element={
                        <TaskProtectedRoute>
                            <TasksPage />
                        </TaskProtectedRoute>
                    }
                />
                <Route
                    path="task-management"
                    element={
                        <ProtectedRoute adminOnly>
                            <TaskManagementPage />
                        </ProtectedRoute>
                    }
                />

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
