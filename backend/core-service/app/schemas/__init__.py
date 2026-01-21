# =============================================================================
# HERMES PLATFORM - Core Service Schemas Package
# =============================================================================

from .customer import CustomerCreate, CustomerUpdate, CustomerResponse
from .work_type import WorkTypeCreate, WorkTypeUpdate, WorkTypeResponse
from .project import ProjectCreate, ProjectUpdate, ProjectResponse
from .work_log import WorkLogCreate, WorkLogUpdate, WorkLogResponse, WorkLogListResponse
from .activity_type import ActivityTypeCreate, ActivityTypeUpdate, ActivityTypeResponse
from .platform import PlatformCreate, PlatformUpdate, PlatformResponse
from .work_line import WorkLineCreate, WorkLineUpdate, WorkLineResponse

__all__ = [
    # Customer
    "CustomerCreate", "CustomerUpdate", "CustomerResponse",
    # WorkType
    "WorkTypeCreate", "WorkTypeUpdate", "WorkTypeResponse",
    # Project
    "ProjectCreate", "ProjectUpdate", "ProjectResponse",
    # WorkLog
    "WorkLogCreate", "WorkLogUpdate", "WorkLogResponse", "WorkLogListResponse",
    # ActivityType
    "ActivityTypeCreate", "ActivityTypeUpdate", "ActivityTypeResponse",
    # Platform
    "PlatformCreate", "PlatformUpdate", "PlatformResponse",
    # WorkLine
    "WorkLineCreate", "WorkLineUpdate", "WorkLineResponse",
]
