from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, desc
from typing import Optional
from datetime import date
from uuid import UUID

from ..database import get_db
from ..models.work_log import WorkLog
from ..models.customer import Customer
from ..models.project import Project
from ..schemas.dashboard import DashboardStats, ChartItem
from shared.auth import require_admin, CurrentUser

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])

@router.get("", response_model=DashboardStats)
async def get_dashboard_stats(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    admin: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """
    Dashboard istatistiklerini getirir (Sadece Admin).
    """
    
    # Base query
    query = db.query(WorkLog)
    
    if start_date:
        query = query.filter(WorkLog.date_worked >= start_date)
    if end_date:
        query = query.filter(WorkLog.date_worked <= end_date)
        
    # 1. Toplam Saat
    total_hours = query.with_entities(func.sum(WorkLog.duration_hours)).scalar() or 0
    
    # 2. Müşterilere Göre
    by_customer_data = db.query(
        Customer.name,
        func.sum(WorkLog.duration_hours).label('hours')
    ).join(WorkLog, WorkLog.customer_id == Customer.id)\
     .filter(WorkLog.date_worked >= start_date if start_date else True)\
     .filter(WorkLog.date_worked <= end_date if end_date else True)\
     .group_by(Customer.name)\
     .order_by(desc('hours'))\
     .all()
     
    # 3. Projelere Göre
    by_project_data = db.query(
        Project.name,
        func.sum(WorkLog.duration_hours).label('hours')
    ).join(WorkLog, WorkLog.project_id == Project.id)\
     .filter(WorkLog.date_worked >= start_date if start_date else True)\
     .filter(WorkLog.date_worked <= end_date if end_date else True)\
     .group_by(Project.name)\
     .order_by(desc('hours'))\
     .all()

    # 4. Kullanıcılara Göre
    # Not: work_logs tablosunda user_id var ama user name yok.
    # Auth servisine gitmek pahalı olabilir. 
    # Şimdilik user_id ile dönelim veya basitçe user_id string olarak.
    # Daha gelişmiş çözüm: Shared User cache veya user_id -> name map endpoint'i.
    # Ancak frontend'de user listesi zaten varsa id ile eşleştirebiliriz.
    # Veya dashboard'da sadece ID gösteririz şimdilik.
    # Çözüm: WorkLogs tablosunda user_id tutuyoruz. Auth service'e sormadan isim alamayız.
    # Geçici Çözüm: User ID'yi name olarak dönüyoruz, frontend mapleyebilir mi?
    # Frontend'de users listesi varsa mapleyebilir.
    # Fakat elimizde users listesi her zaman olmayabilir.
    # Pratik çözüm: User ID'nin ilk 8 karakterini veya tamamını isim gibi dönelim.
    # Daha iyi çözüm: Auth servisiyle senkronize çalışan bir view veya benzeri bir şey yok.
    # En temiz çözüm: Client tarafında user listesi hook'u ile eşleştirmek. 
    # Burada direkt user_id dönelim.
    
    # Fark ettim ki WorkLog modelinde user ilişkisi yok (mikroservis).
    # Bu yüzden user_id'ye göre gruplayacağız.
    
    by_user_query = query.with_entities(
        WorkLog.user_id,
        func.sum(WorkLog.duration_hours).label('hours')
    ).group_by(WorkLog.user_id).order_by(desc('hours')).all()
    
    # User ID'leri string'e çevir
    by_user_data = []
    
    # User bilgilerini almak için auth service'e istek atmak yerine (ki senkronsuz zor),
    # frontend'in user listesini bildigini varsayip user_id dönüyoruz.
    # Veya "User {id}" formatında.
    
    for uid, hours in by_user_query:
        # Frontend, user_id ile ismi eşleştirecek
        # Şimdilik DB'den gelen UUID'yi name olarak veriyoruz
        by_user_data.append(ChartItem(name=str(uid), hours=hours))

    return DashboardStats(
        total_hours=total_hours,
        by_customer=[ChartItem(name=r[0], hours=r[1]) for r in by_customer_data],
        by_project=[ChartItem(name=r[0], hours=r[1]) for r in by_project_data],
        by_user=by_user_data
    )
