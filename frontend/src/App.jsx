/**
 * =============================================================================
 * HERMES PLATFORM - Main App Component
 * =============================================================================
 * Ana uygulama bileşeni. Routing ve layout yapılandırması.
 * =============================================================================
 */

import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './stores/authStore'

// Layouts
import MainLayout from './components/layout/MainLayout'

// Pages
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import TimeEntryPage from './pages/TimeEntryPage'
import CustomersPage from './pages/admin/CustomersPage'
import ProjectsPage from './pages/admin/ProjectsPage'
import WorkTypesPage from './pages/admin/WorkTypesPage'
import UsersPage from './pages/admin/UsersPage'
import ActivityTypesPage from './pages/ActivityTypesPage'
import PlatformsPage from './pages/PlatformsPage'
import WorkLinesPage from './pages/WorkLinesPage'

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
 * Main App Component
 */
function App() {
    const { isAuthenticated } = useAuthStore()

    return (
        <Routes>
            {/* Public Routes */}
            <Route
                path="/login"
                element={
                    isAuthenticated ? <Navigate to="/" replace /> : <LoginPage />
                }
            />

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
