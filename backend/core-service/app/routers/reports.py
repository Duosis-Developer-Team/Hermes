from datetime import date
from typing import Optional
from fastapi import APIRouter, Depends, Query
from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session
from sqlalchemy import desc
import pandas as pd
import io

from ..database import get_db
from ..models.work_log import WorkLog
from ..models.customer import Customer
from ..models.project import Project
from ..models.work_type import WorkType
from ..models.activity_type import ActivityType
from shared.auth import require_admin, CurrentUser, get_current_user

router = APIRouter(
    prefix="/reports",
    tags=["Reports"]
)

@router.get("/export/excel/v1")
async def export_excel(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    user_id: Optional[str] = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Zaman girişlerini CSV olarak dışa aktarır (Admin/User).
    User: Sadece kendi verisini alır.
    Admin: user_id belirtirse o kişinin, belirtmezse kendisinin (veya tümü? İsteğe göre)
           User request says: "admin hangi time entrydeyse ... o user'a ait"
    """
    
    import traceback
    
    try:
        # Determine target user
        target_user_id = current_user.id
        
        # If user is Admin and requested a specific user
        if current_user.is_admin and user_id:
            target_user_id = user_id
            
        # Query building
        query = db.query(
            WorkLog.date_worked,
            Customer.name.label('customer_name'),
            Project.name.label('project_name'),
            WorkType.name.label('work_type_name'),
            ActivityType.name.label('activity_type_name'),
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
        )

        # Filter by Target User
        query = query.filter(WorkLog.user_id == target_user_id)

        if start_date:
            query = query.filter(WorkLog.date_worked >= start_date)
        if end_date:
            query = query.filter(WorkLog.date_worked <= end_date)
            
        results = query.order_by(desc(WorkLog.date_worked)).all()
        
        # Create DataFrame
        data = []
        for r in results:
            data.append({
                "Tarih": r.date_worked,
                "Müşteri": r.customer_name,
                "Proje": r.project_name,
                "İş Tipi": r.work_type_name,
                "Aktivite Tipi": r.activity_type_name if r.activity_type_name else "-",
                "Süre (Saat)": float(r.duration_hours) if r.duration_hours is not None else 0.0,
                "Açıklama": r.description or ""
            })
            
        df = pd.DataFrame(data)
        
        # Create CSV file in memory
        output = io.BytesIO()
        # BOM for Excel compatibility with UTF-8
        output.write(b'\xef\xbb\xbf')
        df.to_csv(output, index=False, sep=';', encoding='utf-8')
        
        output.seek(0)
        
        filename = f"hermes_rapor_{date.today()}.csv"
        
        return Response(
            content=output.getvalue(),
            media_type="text/csv",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
                "Access-Control-Expose-Headers": "Content-Disposition"
            }
        )
    except Exception as e:
        print("====== EXPORT ERROR ======")
        traceback.print_exc()
        print("==========================")
        raise e
