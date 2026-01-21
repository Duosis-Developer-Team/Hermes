from pydantic import BaseModel
from typing import List, Optional
from decimal import Decimal

class ChartItem(BaseModel):
    name: str
    hours: float

class DashboardStats(BaseModel):
    total_hours: float
    by_customer: List[ChartItem]
    by_project: List[ChartItem]
    by_user: List[ChartItem]
