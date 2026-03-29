from datetime import date, timedelta
from typing import Optional, Dict, List
from uuid import UUID
from fastapi import APIRouter, Depends, Query, Response, HTTPException, Request
from sqlalchemy.orm import Session
from sqlalchemy import desc, func
import pandas as pd
import io
import httpx
import os

from ..database import get_db
from ..models.work_log import WorkLog
from ..models.customer import Customer
from ..models.project import Project
from ..models.work_type import WorkType
from ..models.activity_type import ActivityType
from ..models.platform import Platform
from shared.auth import require_admin, CurrentUser, get_current_user

router = APIRouter(
    prefix="/reports",
    tags=["Reports"]
)

def format_duration(decimal_hours) -> str:
    """Convert decimal hours to 'Xh Ym' string. E.g. 3.25 → '3h 15m', 0.75 → '0h 45m'"""
    if decimal_hours is None:
        return '0h'
    h = int(float(decimal_hours))
    m = round((float(decimal_hours) - h) * 60)
    if m > 0:
        return f"{h}h {m}m"
    return f"{h}h"

# Auth Service URL (internal docker network)
AUTH_SERVICE_URL = os.getenv("AUTH_SERVICE_URL", "http://auth-service:8000")

async def get_all_users_map(token: str) -> Dict[str, str]:
    """
    Fetches all users from auth-service and returns a map of {user_id: full_name}.
    Requires Admin token.
    """
    print(f"DEBUG: get_all_users_map called with URL={AUTH_SERVICE_URL}", flush=True)
    
    try:
        if not token:
            print("WARNING: get_all_users_map called with empty token", flush=True)
            return {}

        headers = {"Authorization": f"Bearer {token}"}
        # print(f"DEBUG: Headers: {headers}", flush=True) # Don't log full token

        async with httpx.AsyncClient(timeout=10.0) as client:
            print("DEBUG: Sending request to auth-service (options endpoint)...", flush=True)
            
            # Fix: Handle double /api/v1 if present in env var
            base_url = AUTH_SERVICE_URL.rstrip("/")
            if base_url.endswith("/api/v1"):
                base_url = base_url[:-7] # Remove /api/v1
            
            # Use /options endpoint which is lighter and potentially less restrictive
            response = await client.get(
                f"{base_url}/api/v1/auth/users/options",
                headers=headers
            )
            print(f"DEBUG: Auth Service Response Code: {response.status_code}", flush=True)
            
            if response.status_code == 200:
                data = response.json()
                # Options endpoint returns a list directly: [{"id":..., "full_name":...}, ...]
                users = data if isinstance(data, list) else data.get("data", [])
                
                if not isinstance(users, list):
                     print(f"ERROR: Unexpected auth-service response format: {type(data)}", flush=True)
                     return {}

                mapping = {}
                for u in users:
                    uid = str(u.get("id", ""))
                    name = u.get("full_name", "")
                    if name:
                        mapping[uid] = name
                    else:
                        mapping[uid] = u.get("email", uid) 
                
                print(f"DEBUG: Sample Users: {list(mapping.values())[:3]}", flush=True)
                print(f"INFO: Fetched {len(mapping)} users from auth-service", flush=True)
                return mapping
            else:
                print(f"ERROR: Failed to fetch users: {response.status_code} {response.text}", flush=True)
                return {}
    except Exception as e:
        print(f"ERROR: Exception fetching users: {e}", flush=True)
        import traceback
        traceback.print_exc()
        return {}

@router.get("/export/excel/v1")
async def export_excel(
    request: Request,
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    # Legacy single-value params kept for backward compatibility
    user_id: Optional[UUID] = Query(None),      # [YÜKSEK-9] str → UUID
    customer_id: Optional[UUID] = Query(None),  # [YÜKSEK-9] str → UUID
    # [YÜKSEK-9] List[str] → List[UUID] — Pydantic geçersiz UUID'i 422 ile reddeder
    user_ids: Optional[List[UUID]] = Query(None),
    customer_ids: Optional[List[UUID]] = Query(None),
    project_ids: Optional[List[UUID]] = Query(None),
    work_type_ids: Optional[List[UUID]] = Query(None),
    platform_ids: Optional[List[UUID]] = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    import traceback
    try:
        print("DEBUG: export_excel endpoint hit", flush=True)
        auth_header = request.headers.get("Authorization") or request.headers.get("authorization")
        token = request.cookies.get("access_token") or (auth_header.replace("Bearer ", "") if auth_header else "")

        users_map = {}
        if current_user.is_admin:
            users_map = await get_all_users_map(token)
        else:
            users_map = {str(current_user.id): current_user.email}

        # Base query
        query = db.query(
            WorkLog.date_worked,
            Customer.name.label('customer_name'),
            Project.name.label('project_name'),
            WorkType.name.label('work_type_name'),
            ActivityType.name.label('activity_type_name'),
            Platform.name.label('platform_name'),
            WorkLog.duration_hours,
            WorkLog.user_id,
            WorkLog.description
        ).join(
            Customer, WorkLog.customer_id == Customer.id
        ).join(
            Project, WorkLog.project_id == Project.id
        ).join(
            WorkType, WorkLog.work_type_id == WorkType.id
        ).outerjoin(
            ActivityType, WorkLog.activity_type_id == ActivityType.id
        ).outerjoin(
            Platform, WorkLog.platform_id == Platform.id
        )

        # Access control
        if not current_user.is_admin:
            query = query.filter(WorkLog.user_id == current_user.id)
        else:
            # [YÜKSEK-9] cast(…, String) kaldırıldı — UUID tipi doğrudan kullanılır
            if user_ids:
                query = query.filter(WorkLog.user_id.in_(user_ids))
            elif user_id:
                query = query.filter(WorkLog.user_id == user_id)

        # [YÜKSEK-9] Multi-select filtreler — cast() olmadan UUID ile doğrudan karşılaştırma
        if customer_ids:
            query = query.filter(WorkLog.customer_id.in_(customer_ids))
        elif customer_id:
            query = query.filter(WorkLog.customer_id == customer_id)

        if project_ids:
            query = query.filter(WorkLog.project_id.in_(project_ids))

        if work_type_ids:
            query = query.filter(WorkLog.work_type_id.in_(work_type_ids))

        if platform_ids:
            query = query.filter(WorkLog.platform_id.in_(platform_ids))

        # Date range
        if start_date:
            query = query.filter(WorkLog.date_worked >= start_date)
        if end_date:
            query = query.filter(WorkLog.date_worked <= end_date)

        results = query.order_by(desc(WorkLog.date_worked)).all()

        # Build CSV data
        data = []
        for r in results:
            uid_str = str(r.user_id)
            user_name = users_map.get(uid_str, f"Unknown ({uid_str[:8]})")
            if user_name.startswith("Unknown") and uid_str == str(current_user.id):
                user_name = current_user.email
            data.append({
                "Tarih": r.date_worked,
                "Kullanıcı": user_name,
                "Müşteri": r.customer_name,
                "Proje": r.project_name,
                "İş Tipi": r.work_type_name,
                "Aktivite Tipi": r.activity_type_name if r.activity_type_name else "-",
                "Platform": r.platform_name if r.platform_name else "-",
                "Süre": format_duration(r.duration_hours),
                "Açıklama": r.description or ""
            })

        df = pd.DataFrame(data)
        output = io.BytesIO()
        output.write(b'\xef\xbb\xbf')
        df.to_csv(output, index=False, sep=';', encoding='utf-8')
        output.seek(0)

        # Dynamic filename
        filename = f"hermes_rapor_{start_date or 'All'}_{end_date or 'All'}.csv"
        import unicodedata
        filename_ascii = unicodedata.normalize('NFKD', filename).encode('ascii', 'ignore').decode('ascii')

        return Response(
            content=output.getvalue(),
            media_type="text/csv",
            headers={
                "Content-Disposition": f'attachment; filename="{filename_ascii}"',
                "Access-Control-Expose-Headers": "Content-Disposition"
            }
        )
    except Exception as e:
        print("====== EXPORT ERROR ======")
        traceback.print_exc()
        print("==========================")
        raise e

@router.get("/export/global/detailed")
async def export_global_detailed(
    month: str = Query(..., description="YYYY-MM fortmatında ay"),
    current_user: CurrentUser = Depends(require_admin), # Admin Only
    db: Session = Depends(get_db),
):
    """
    Rapor 2: Aylık Detaylı Global Rapor (.csv)
    Tüm kullanıcıların logları.
    """
    # Deprecated/Unused -> Redirect to V2 Logic or Pass
    pass

@router.get("/export/global/detailed_v2")
async def export_global_detailed_v2(
    request: Request,
    month: str = Query(..., description="YYYY-MM"),
    current_user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db)
):
    # Extract token from header or cookie
    auth_header = request.headers.get("Authorization") or request.headers.get("authorization")
    token = request.cookies.get("access_token") or (auth_header.replace("Bearer ", "") if auth_header else "")
    
    # Fetch Users
    users_map = await get_all_users_map(token)
    
    date_start = date.fromisoformat(f"{month}-01")
    # End date logic
    import calendar
    last_day = calendar.monthrange(date_start.year, date_start.month)[1]
    date_end = date(date_start.year, date_start.month, last_day)

    query = db.query(
        WorkLog.date_worked,
        Customer.name.label('customer_name'),
        Project.name.label('project_name'),
        WorkType.name.label('work_type_name'),
        ActivityType.name.label('activity_type_name'),
        Platform.name.label('platform_name'),
        WorkLog.duration_hours,
        WorkLog.user_id,
        WorkLog.description
    ).join(
        Customer, WorkLog.customer_id == Customer.id
    ).join(
        Project, WorkLog.project_id == Project.id
    ).join(
        WorkType, WorkLog.work_type_id == WorkType.id
    ).outerjoin(
        ActivityType, WorkLog.activity_type_id == ActivityType.id
    ).outerjoin(
        Platform, WorkLog.platform_id == Platform.id
    ).filter(
        WorkLog.date_worked >= date_start,
        WorkLog.date_worked <= date_end
    ).order_by(WorkLog.date_worked)

    results = query.all()

    data = []
    for r in results:
        # Debug unknown users just once
        if str(r.user_id) not in users_map and len(data) < 1:
             print(f"DEBUG: User ID {r.user_id} not found in map. Map keys sample: {list(users_map.keys())[:5]}", flush=True)
             
        user_name = users_map.get(str(r.user_id), f"Unknown ({str(r.user_id)[:8]})")
        data.append({
            "Tarih": r.date_worked,
            "Kullanıcı": user_name,
            "Müşteri": r.customer_name,
            "Proje": r.project_name,
            "Açıklama": r.description or "",
            "Platform": r.platform_name or "-",
            "İş Tipi": r.work_type_name,
            "Aktivite Tipi": r.activity_type_name or "-",
            "Süre (Saat)": float(r.duration_hours)
        })

    df = pd.DataFrame(data)
    
    output = io.BytesIO()
    output.write(b'\xef\xbb\xbf')
    df.to_csv(output, index=False, sep=';', encoding='utf-8')
    output.seek(0)
    
    filename = f"global_detayli_rapor_{month}.csv"
    
    return Response(content=output.getvalue(), media_type="text/csv", headers={
        "Content-Disposition": f'attachment; filename="{filename}"',
        "Access-Control-Expose-Headers": "Content-Disposition"
    })

@router.get("/export/global/matrix")
async def export_global_matrix(
    request: Request,
    start_date: date = Query(...),
    end_date: date = Query(...),
    current_user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """
    Rapor 3: Customer x User Matrix (.csv)
    rows: Customer
    cols: User
    values: Sum Hours
    """
    print("DEBUG: matrix endpoint hit", flush=True)
    auth_header = request.headers.get("Authorization") or request.headers.get("authorization")
    token = request.cookies.get("access_token") or (auth_header.replace("Bearer ", "") if auth_header else "")
    
    users_map = await get_all_users_map(token)

    # Query: Group by Customer and User
    query = db.query(
        WorkLog.customer_id,
        Customer.name.label('customer_name'),
        WorkLog.user_id,
        func.sum(WorkLog.duration_hours).label('total_hours')
    ).join(
        Customer, WorkLog.customer_id == Customer.id
    ).filter(
        WorkLog.date_worked >= start_date,
        WorkLog.date_worked <= end_date
    ).group_by(
        WorkLog.customer_id,
        Customer.name,
        WorkLog.user_id
    )
    
    results = query.all()
    
    data = []
    for r in results:
        user_name = users_map.get(str(r.user_id), users_map.get(str(r.user_id), f"User {str(r.user_id)[:8]}"))
        data.append({
            "Customer": r.customer_name,
            "User": user_name,
            "Hours": float(r.total_hours)
        })
    
    if not data:
        # Return empty CSV
        df = pd.DataFrame(columns=["Customer"])
    else:
        df = pd.DataFrame(data)
        # Pivot: Index=Customer, Columns=User, Values=Hours
        df = df.pivot_table(index="Customer", columns="User", values="Hours", aggfunc="sum", fill_value=0)
        # Reset index to make Customer a column again
        df.reset_index(inplace=True)
    
    output = io.BytesIO()
    output.write(b'\xef\xbb\xbf')
    df.to_csv(output, index=False, sep=';', encoding='utf-8')
    output.seek(0)
    
    filename = f"musteri_kullanici_matrisi_{start_date}_{end_date}.csv"
    
    return Response(content=output.getvalue(), media_type="text/csv", headers={
        "Content-Disposition": f'attachment; filename="{filename}"',
        "Access-Control-Expose-Headers": "Content-Disposition"
    })
# ... existing code ...

@router.get("/json/user-logs")
async def get_user_logs_json(
    request: Request,
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    # [YÜKSEK-9] List[str] → List[UUID] — geçersiz UUID Pydantic tarafından 422 ile reddedilir
    user_ids: Optional[List[UUID]] = Query(None),
    customer_ids: Optional[List[UUID]] = Query(None),
    project_ids: Optional[List[UUID]] = Query(None),
    work_type_ids: Optional[List[UUID]] = Query(None),
    platform_ids: Optional[List[UUID]] = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Returns User Work Logs as JSON for the Tempo-style dashboard.
    Supports multi-select filtering on users, customers, projects, work types and platforms.
    Empty list = no filter applied; non-empty = IN() filter.
    """
    auth_header = request.headers.get("Authorization") or request.headers.get("authorization")
    token = request.cookies.get("access_token") or (auth_header.replace("Bearer ", "") if auth_header else "")

    users_map = {}
    if current_user.is_admin:
        users_map = await get_all_users_map(token)
    else:
        users_map = {str(current_user.id): current_user.email}

    # Base query
    query = db.query(
        WorkLog.date_worked,
        Customer.name.label('customer_name'),
        Project.name.label('project_name'),
        WorkType.name.label('work_type_name'),
        ActivityType.name.label('activity_type_name'),
        Platform.name.label('platform_name'),
        WorkLog.duration_hours,
        WorkLog.user_id,
        WorkLog.description
    ).join(
        Customer, WorkLog.customer_id == Customer.id
    ).join(
        Project, WorkLog.project_id == Project.id
    ).join(
        WorkType, WorkLog.work_type_id == WorkType.id
    ).outerjoin(
        ActivityType, WorkLog.activity_type_id == ActivityType.id
    ).outerjoin(
        Platform, WorkLog.platform_id == Platform.id
    )

    # Access control + user filter
    if not current_user.is_admin:
        # Standart kullanıcı: yalnızca kendi verilerini görür, ek filtreler yok
        query = query.filter(WorkLog.user_id == current_user.id)
    else:
        # [YÜKSEK-9] cast(…, String) kaldırıldı — UUID tipi doğrudan kullanılır
        if user_ids:
            query = query.filter(WorkLog.user_id.in_(user_ids))

        # [YÜKSEK-9] Multi-select filtreler — cast() olmadan UUID ile doğrudan karşılaştırma
        if customer_ids:
            query = query.filter(WorkLog.customer_id.in_(customer_ids))
        if project_ids:
            query = query.filter(WorkLog.project_id.in_(project_ids))
        if work_type_ids:
            query = query.filter(WorkLog.work_type_id.in_(work_type_ids))
        if platform_ids:
            query = query.filter(WorkLog.platform_id.in_(platform_ids))

    # Date range
    if start_date:
        query = query.filter(WorkLog.date_worked >= start_date)
    if end_date:
        query = query.filter(WorkLog.date_worked <= end_date)

    results = query.order_by(WorkLog.date_worked.asc()).limit(5000).all()

    data = []
    for r in results:
        uid_str = str(r.user_id)
        user_name = users_map.get(uid_str, f"Unknown ({uid_str[:8]})")
        if user_name.startswith("Unknown") and uid_str == str(current_user.id):
            user_name = current_user.email
        data.append({
            "date": r.date_worked,
            "user_name": user_name,
            "customer_name": r.customer_name,
            "project_name": r.project_name,
            "work_type": r.work_type_name,
            "activity_type": r.activity_type_name if r.activity_type_name else "-",
            "platform_name": r.platform_name or "-",
            "duration": float(r.duration_hours) if r.duration_hours is not None else 0.0,
            "description": r.description or ""
        })

    return {"data": data}

@router.get("/json/global-detailed")
async def get_global_detailed_json(
    request: Request,
    month: str = Query(..., description="YYYY-MM"),
    current_user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """
    Returns Global Detailed Logs as JSON.
    """
    auth_header = request.headers.get("Authorization") or request.headers.get("authorization")
    token = request.cookies.get("access_token") or (auth_header.replace("Bearer ", "") if auth_header else "")
    users_map = await get_all_users_map(token)
    
    date_start = date.fromisoformat(f"{month}-01")
    import calendar
    last_day = calendar.monthrange(date_start.year, date_start.month)[1]
    date_end = date(date_start.year, date_start.month, last_day)

    query = db.query(
        WorkLog.date_worked,
        Customer.name.label('customer_name'),
        Project.name.label('project_name'),
        WorkType.name.label('work_type_name'),
        ActivityType.name.label('activity_type_name'),
        Platform.name.label('platform_name'),
        WorkLog.duration_hours,
        WorkLog.user_id,
        WorkLog.description
    ).join(
        Customer, WorkLog.customer_id == Customer.id
    ).join(
        Project, WorkLog.project_id == Project.id
    ).join(
        WorkType, WorkLog.work_type_id == WorkType.id
    ).outerjoin(
        ActivityType, WorkLog.activity_type_id == ActivityType.id
    ).outerjoin(
        Platform, WorkLog.platform_id == Platform.id
    ).filter(
        WorkLog.date_worked >= date_start,
        WorkLog.date_worked <= date_end
    ).order_by(WorkLog.date_worked)

    results = query.limit(3000).all()

    data = []
    for r in results:
        user_name = users_map.get(str(r.user_id), f"Unknown ({str(r.user_id)[:8]})")
        data.append({
            "date": r.date_worked,
            "user_name": user_name,
            "customer_name": r.customer_name,
            "project_name": r.project_name,
            "description": r.description or "",
            "platform": r.platform_name or "-",
            "work_type": r.work_type_name,
            "activity_type": r.activity_type_name or "-",
            "duration": float(r.duration_hours)
        })
    return {"data": data}

@router.get("/json/matrix")
async def get_matrix_json(
    request: Request,
    start_date: date = Query(...),
    end_date: date = Query(...),
    current_user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """
    Returns Matrix Data as Pivot-Ready JSON.
    """
    auth_header = request.headers.get("Authorization") or request.headers.get("authorization")
    token = request.cookies.get("access_token") or (auth_header.replace("Bearer ", "") if auth_header else "")
    users_map = await get_all_users_map(token)

    query = db.query(
        WorkLog.customer_id,
        Customer.name.label('customer_name'),
        WorkLog.user_id,
        func.sum(WorkLog.duration_hours).label('total_hours')
    ).join(
        Customer, WorkLog.customer_id == Customer.id
    ).filter(
        WorkLog.date_worked >= start_date,
        WorkLog.date_worked <= end_date
    ).group_by(
        WorkLog.customer_id,
        Customer.name,
        WorkLog.user_id
    )
    
    results = query.all()
    
    # Return flat list, frontend can pivot
    data = []
    for r in results:
        user_name = users_map.get(str(r.user_id), f"User {str(r.user_id)[:8]}")
        data.append({
            "customer_name": r.customer_name,
            "user_name": user_name,
            "total_hours": float(r.total_hours)
        })
        
    return {"data": data}
