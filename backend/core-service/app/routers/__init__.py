# =============================================================================
# HERMES PLATFORM - Core Service Routers Package
# =============================================================================

from .customers import router as customers_router
from .work_types import router as work_types_router
from .projects import router as projects_router
from .work_logs import router as work_logs_router
from .activity_types import router as activity_types_router
from .platforms import router as platforms_router
from .work_lines import router as work_lines_router
from .issues import router as issues_router
from .project_memberships import router as project_memberships_router

from .timesheets import router as timesheets_router
from .dashboard import router as dashboard_router
from .reports import router as reports_router
from .plan_times import router as plan_times_router
from .tasks import router as tasks_router
from .task_admin import router as task_admin_router
from .user_group_admin import router as user_group_admin_router
from .meetings import router as meetings_router
from .meeting_admin import router as meeting_admin_router

__all__ = [
    "customers_router",
    "work_types_router",
    "projects_router",
    "work_logs_router",
    "activity_types_router",
    "platforms_router",
    "work_lines_router",
    "issues_router",
    "project_memberships_router",
    "timesheets_router",
    "dashboard_router",
    "reports_router",
    "plan_times_router",
    "tasks_router",
    "task_admin_router",
    "user_group_admin_router",
    "meetings_router",
    "meeting_admin_router",
]
