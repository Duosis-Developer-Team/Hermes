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
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Zaman girişlerini Excel olarak dışa aktarır (Admin).
    """
    
    import traceback
    import sys

    try:
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
                "Kişi ID": str(r.user_id),
                "Açıklama": r.description or ""
            })
            
        df = pd.DataFrame(data)
        
        # Create Excel file in memory
        output = io.BytesIO()
        with pd.ExcelWriter(output, engine='openpyxl') as writer:
            df.to_excel(writer, index=False, sheet_name='Work Logs')
            
            # Auto-adjust column width
            worksheet = writer.sheets['Work Logs']
            for idx, col in enumerate(df.columns):
                # Calculate max length safely
                max_len = 10
                try:
                    series_max = df[col].astype(str).map(len).max()
                    if not pd.isna(series_max):
                        max_len = max(series_max, len(str(col))) + 2
                except:
                    pass
                worksheet.column_dimensions[chr(65 + idx)].width = min(max_len, 50)
                
        output.seek(0)
        
        filename = f"hermes_report_{date.today()}.xlsx"
        
        return Response(
            content=output.getvalue(),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
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
