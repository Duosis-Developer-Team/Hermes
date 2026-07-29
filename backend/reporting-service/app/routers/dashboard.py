# =============================================================================
# HERMES PLATFORM - Dashboard Router
# =============================================================================
# Dashboard API endpoint'leri (FR 5.x). Sadece Admin erişebilir.
# =============================================================================

from typing import Optional
from datetime import date
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from typing import List

from shared.auth import CurrentUser
# RBAC R3: guard izin-tabanli; token cikarimi guard'da (G10 duzeltmesi).
from ..rbac import ReportsAccess, require_reports_view
from ..services.report_service import ReportService


router = APIRouter(prefix="/dashboard", tags=["Dashboard"])


# =============================================================================
# Response Models
# =============================================================================

class ChartDataItem(BaseModel):
    """Grafik veri noktası."""
    name: str
    hours: float


class DashboardResponse(BaseModel):
    """Dashboard yanıt modeli (FR 5.2)."""
    period: dict
    total_hours: float
    by_customer: List[ChartDataItem]
    by_project: List[ChartDataItem]
    by_user: List[ChartDataItem]


# =============================================================================
# Dashboard Endpoint
# =============================================================================

@router.get(
    "/v1",
    response_model=DashboardResponse,
    summary="Dashboard Verileri (v1)",
    description="""
    Dashboard için özet verileri döner (FR 5.x).
    
    Widget'lar:
    - Toplam Harcanan Süre (KPI)
    - Müşterilere Göre Dağılım
    - Projelere Göre Dağılım
    - Kullanıcılara Göre Dağılım
    """
)
async def get_dashboard_v1(
    request: Request,
    start_date: Optional[date] = Query(None, description="Başlangıç tarihi"),
    end_date: Optional[date] = Query(None, description="Bitiş tarihi"),
    access: ReportsAccess = Depends(require_reports_view())
):
    """
    Dashboard verileri endpoint'i.
    
    Varsayılan tarih aralığı: Son 30 gün.
    """
    token = access.token  # guard'in dogruladigi token (G10 fix)
    
    try:
        service = ReportService(token)
        data = await service.get_dashboard_data(start_date, end_date)
        return data
    except Exception as e:
        import logging
        logging.getLogger(__name__).error("Dashboard veri alma hatası", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="Dashboard verisi alınamadı. Lütfen tekrar deneyin."
        )
