# =============================================================================
# HERMES PLATFORM - Core Service Models Package
# =============================================================================
# Bu paket, core-service veritabanı modellerini içerir.
# =============================================================================

from .customer import Customer
from .work_type import WorkType
from .project import Project
from .work_log import WorkLog
from .activity_type import ActivityType
from .platform import Platform
from .work_line import WorkLine
from .issue import Issue
from .issue import Issue
from .project_membership import ProjectMembership
from .timesheet import TimesheetSubmission, TimesheetStatus
from .plan_time import PlanTime, PlanTimeAssignment
from .task import (
    TaskUserPermission,
    TaskAssignmentRelation,
    TaskAssignmentGroupRelation,
    TaskSubProject,
    Task,
    TaskNotificationSetting,
)
from .api_client import (
    ApiIdempotencyKey,
    ApiClient,
    ApiToken,
    ApiClientAccess,
    ApiRequestLog,
)
from .task_activity import TaskActivityEvent
from .task_comment import TaskComment
from .tenancy import TenantCounter, TenantRegistry
from .meeting import Meeting, MeetingAttendee
from .user_group import (
    UserGroup,
    UserGroupMember,
    TaskGroupPermission,
    TaskGroupMemberOverride,
)
# Ortak urun ticket platformu (Ticket Hub). Tum tablolar tenant-owned;
# RLS kapsami `TenantOwnedMixin` uzerinden OTOMATIK turetilir.
from .ticketing import (
    SupportApplication,
    SupportAuditEvent,
    SupportIntegrationClient,
    SupportIntegrationToken,
    SupportSourceTenant,
    SupportTicketRoute,
    Ticket,
    TicketAttachment,
    TicketDeliveryAttempt,
    TicketEvent,
    TicketIdempotencyRecord,
    TicketMessage,
    TicketOutboxEvent,
    TicketResolution,
    TICKETING_TABLES,
)

# NOTE: The legacy TaskGroup / TaskGroupMember classes have been removed
# from import. Their physical tables (task_groups, task_group_members)
# remain in the database for rollback safety but the application no
# longer reads or writes to them. A separate explicit cleanup migration
# may drop them later, after user approval.

__all__ = [
    "Customer",
    "WorkType",
    "Project",
    "WorkLog",
    "ActivityType",
    "Platform",
    "WorkLine",
    "Issue",
    "ProjectMembership",
    "TimesheetSubmission",
    "TimesheetStatus",
    "PlanTime",
    "PlanTimeAssignment",
    "TaskUserPermission",
    "TaskAssignmentRelation",
    "TaskAssignmentGroupRelation",
    "TaskSubProject",
    "Task",
    "TaskNotificationSetting",
    "ApiClient",
    "ApiToken",
    "ApiClientAccess",
    "ApiRequestLog",
    "ApiIdempotencyKey",
    "TaskActivityEvent",
    "TaskComment",
    "Meeting",
    "MeetingAttendee",
    "UserGroup",
    "UserGroupMember",
    "TaskGroupPermission",
    "TaskGroupMemberOverride",
    # Tenant projeksiyonu + sayaclar (WS2) — tenant OTORITESI auth_db'dir.
    "TenantRegistry",
    "TenantCounter",
    # Ticket Hub
    "SupportApplication",
    "SupportAuditEvent",
    "SupportIntegrationClient",
    "SupportIntegrationToken",
    "SupportSourceTenant",
    "SupportTicketRoute",
    "Ticket",
    "TicketAttachment",
    "TicketDeliveryAttempt",
    "TicketEvent",
    "TicketIdempotencyRecord",
    "TicketMessage",
    "TicketOutboxEvent",
    "TicketResolution",
    "TICKETING_TABLES",
]
