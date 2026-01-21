# =============================================================================
# HERMES PLATFORM - Report Service
# =============================================================================
# Bu servis, dashboard ve Excel raporlama işlemlerinden sorumludur.
# Verileri core-service ve auth-service'den API ile çeker, işler ve sunar.
#
# TAD Referansı (6.0):
# Tüm servisler arası iletişim senkron API çağrıları ile yapılır.
# =============================================================================

from typing import Dict, List, Any, Optional
from datetime import date, timedelta
from decimal import Decimal
import httpx

from ..config import get_settings


class ReportService:
    """
    Raporlama servisi.
    
    Dashboard (FR 5.x) ve Excel raporlama (FR 4.x) verilerini hazırlar.
    Verileri diğer servislerden API ile çeker ve işler.
    
    İş Akışı (TAD 6.0):
    1. Frontend -> reporting-service isteği
    2. reporting-service -> auth-service (kullanıcı isimleri)
    3. reporting-service -> core-service (zaman girişleri)
    4. reporting-service -> verileri birleştir, grupla, hesapla
    5. reporting-service -> Frontend'e sonuç dön
    """
    
    def __init__(self, token: str):
        """
        Args:
            token: Yetkilendirme için JWT token
        """
        self.settings = get_settings()
        self.token = token
        self.headers = {"Authorization": f"Bearer {token}"}
    
    # =========================================================================
    # Data Fetching (Servislerden Veri Çekme)
    # =========================================================================
    
    async def _fetch_work_logs(
        self,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None
    ) -> List[Dict[str, Any]]:
        """
        Core-service'den zaman girişlerini çeker.
        
        Args:
            start_date: Başlangıç tarihi
            end_date: Bitiş tarihi
        
        Returns:
            Zaman girişleri listesi
        """
        params = {}
        if start_date:
            params["start_date"] = start_date.isoformat()
        if end_date:
            params["end_date"] = end_date.isoformat()
        params["limit"] = 10000  # Tüm kayıtları çek
        
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.settings.CORE_SERVICE_URL}/api/v1/core/work-logs/all",
                headers=self.headers,
                params=params,
                timeout=30.0
            )
            response.raise_for_status()
            data = response.json()
            return data.get("data", [])
    
    async def _fetch_users(self) -> Dict[str, str]:
        """
        Auth-service'den kullanıcı ID -> İsim eşleştirmesi çeker.
        
        Returns:
            {user_id: full_name} dict
        """
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.settings.AUTH_SERVICE_URL}/api/v1/auth/users",
                headers=self.headers,
                timeout=30.0
            )
            response.raise_for_status()
            data = response.json()
            
            users = {}
            for user in data.get("data", []):
                users[str(user["id"])] = user.get("full_name") or user.get("email")
            return users
    
    # =========================================================================
    # Dashboard Data (FR 5.x)
    # =========================================================================
    
    async def get_dashboard_data(
        self,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None
    ) -> Dict[str, Any]:
        """
        Dashboard için özet verileri hazırlar (FR 5.2).
        
        Widget'lar:
        - Toplam Harcanan Süre (KPI Sayacı)
        - Müşterilere Göre Süre Dağılımı
        - Projelere Göre Süre Dağılımı
        - Kullanıcılara Göre Süre Dağılımı
        
        Args:
            start_date: Başlangıç tarihi (default: 30 gün önce)
            end_date: Bitiş tarihi (default: bugün)
        
        Returns:
            Dashboard verileri (JSON)
        """
        # Default tarih aralığı: Son 30 gün
        if not end_date:
            end_date = date.today()
        if not start_date:
            start_date = end_date - timedelta(days=30)
        
        # Verileri çek
        work_logs = await self._fetch_work_logs(start_date, end_date)
        users = await self._fetch_users()
        
        # Hesaplamalar
        total_hours = Decimal("0")
        by_customer: Dict[str, Decimal] = {}
        by_project: Dict[str, Decimal] = {}
        by_user: Dict[str, Decimal] = {}
        
        for log in work_logs:
            hours = Decimal(str(log.get("duration_hours", 0)))
            total_hours += hours
            
            # Müşteri bazlı
            customer_name = log.get("customer_name", "Bilinmeyen")
            by_customer[customer_name] = by_customer.get(customer_name, Decimal("0")) + hours
            
            # Proje bazlı
            project_name = log.get("project_name", "Bilinmeyen")
            by_project[project_name] = by_project.get(project_name, Decimal("0")) + hours
            
            # Kullanıcı bazlı
            user_id = str(log.get("user_id", ""))
            user_name = users.get(user_id, "Bilinmeyen")
            by_user[user_name] = by_user.get(user_name, Decimal("0")) + hours
        
        return {
            "period": {
                "start_date": start_date.isoformat(),
                "end_date": end_date.isoformat()
            },
            "total_hours": float(total_hours),
            "by_customer": [
                {"name": k, "hours": float(v)}
                for k, v in sorted(by_customer.items(), key=lambda x: x[1], reverse=True)
            ],
            "by_project": [
                {"name": k, "hours": float(v)}
                for k, v in sorted(by_project.items(), key=lambda x: x[1], reverse=True)
            ],
            "by_user": [
                {"name": k, "hours": float(v)}
                for k, v in sorted(by_user.items(), key=lambda x: x[1], reverse=True)
            ]
        }
    
    # =========================================================================
    # Excel Export Data (FR 4.x)
    # =========================================================================
    
    async def get_excel_data(
        self,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None
    ) -> List[Dict[str, Any]]:
        """
        Excel export için detaylı veri hazırlar (FR 4.3).
        
        Çıktı formatı (FR 2.2'deki tüm alanlar):
        - Müşteri
        - İş Tipi
        - Tarih
        - Süre
        - Açıklama
        - Kişi
        - Proje
        
        Args:
            start_date: Başlangıç tarihi (default: 30 gün önce)
            end_date: Bitiş tarihi (default: bugün)
        
        Returns:
            Excel satırları için veri listesi
        """
        # Default: Son 30 gün
        if not end_date:
            end_date = date.today()
        if not start_date:
            start_date = end_date - timedelta(days=30)
        
        work_logs = await self._fetch_work_logs(start_date, end_date)
        users = await self._fetch_users()
        
        excel_rows = []
        for log in work_logs:
            user_id = str(log.get("user_id", ""))
            excel_rows.append({
                "Tarih": log.get("date_worked"),
                "Müşteri": log.get("customer_name", ""),
                "Proje": log.get("project_name", ""),
                "İş Tipi": log.get("work_type_name", ""),
                "Süre (Saat)": float(log.get("duration_hours", 0)),
                "Kişi": users.get(user_id, ""),
                "Açıklama": log.get("description", "")
            })
        
        # Tarihe göre sırala (en yeniden eskiye)
        excel_rows.sort(key=lambda x: x["Tarih"], reverse=True)
        
        return excel_rows
