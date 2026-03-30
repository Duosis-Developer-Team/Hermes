"""
HERMES - Weekly CSV Backup to OneDrive
=======================================
Queries core PostgreSQL DB directly, generates a weekly CSV,
and uploads it to OneDrive via Microsoft Graph API.

Required environment variables (injected via K8s Secret):
  AZURE_CLIENT_ID      - Hermes-Backup-Rclone app client ID
  AZURE_CLIENT_SECRET  - client secret value
  AZURE_TENANT_ID      - Azure AD tenant ID
  ONEDRIVE_DRIVE_ID    - target OneDrive drive ID
  ONEDRIVE_FOLDER      - destination folder path in OneDrive (e.g. /Hermes/Backups)
  DB_HOST              - PostgreSQL host (core-db)
  DB_PORT              - PostgreSQL port (5432)
  DB_NAME              - database name (core_db)
  DB_USER              - database user
  DB_PASSWORD          - database password
"""

import os
import csv
import io
import sys
import logging
from datetime import date, timedelta

import msal
import requests
import psycopg2
import psycopg2.extras

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s"
)
log = logging.getLogger(__name__)


# ── Config ────────────────────────────────────────────────────────────────────

CLIENT_ID     = os.environ["AZURE_CLIENT_ID"]
CLIENT_SECRET = os.environ["AZURE_CLIENT_SECRET"]
TENANT_ID     = os.environ["AZURE_TENANT_ID"]
DRIVE_ID      = os.environ["ONEDRIVE_DRIVE_ID"]
ONEDRIVE_FOLDER = os.environ.get("ONEDRIVE_FOLDER", "/Hermes/Backups")

DB_HOST     = os.environ.get("DB_HOST", "core-db")
DB_PORT     = int(os.environ.get("DB_PORT", 5432))
DB_NAME     = os.environ.get("DB_NAME", "core_db")
DB_USER     = os.environ.get("DB_USER", "hermes")
DB_PASSWORD = os.environ["DB_PASSWORD"]

AUTHORITY = f"https://login.microsoftonline.com/{TENANT_ID}"
GRAPH_URL = "https://graph.microsoft.com/v1.0"


# ── Auth ─────────────────────────────────────────────────────────────────────

def get_access_token() -> str:
    app = msal.ConfidentialClientApplication(
        CLIENT_ID,
        authority=AUTHORITY,
        client_credential=CLIENT_SECRET,
    )
    result = app.acquire_token_for_client(scopes=["https://graph.microsoft.com/.default"])
    if "access_token" not in result:
        raise RuntimeError(f"Token error: {result.get('error_description')}")
    log.info("Access token acquired.")
    return result["access_token"]


# ── DB Query ─────────────────────────────────────────────────────────────────

def fetch_weekly_logs(week_start: date, week_end: date) -> list[dict]:
    query = """
        SELECT
            wl.date_worked                          AS "Date",
            u.full_name                             AS "User",
            u.email                                 AS "Email",
            c.name                                  AS "Customer",
            p.name                                  AS "Project",
            wt.name                                 AS "Work Type",
            COALESCE(at.name, '-')                  AS "Activity Type",
            COALESCE(pl.name, '-')                  AS "Platform",
            wl.duration_hours                       AS "Duration (h)",
            wl.billable_duration_hours              AS "Billable (h)",
            wl.description                          AS "Description",
            wl.created_at                           AS "Created At"
        FROM work_logs wl
        JOIN customers c  ON c.id  = wl.customer_id
        JOIN projects p   ON p.id  = wl.project_id
        JOIN work_types wt ON wt.id = wl.work_type_id
        LEFT JOIN activity_types at ON at.id = wl.activity_type_id
        LEFT JOIN platforms pl      ON pl.id = wl.platform_id
        LEFT JOIN users u           ON u.id  = wl.user_id
        WHERE wl.date_worked BETWEEN %s AND %s
        ORDER BY wl.date_worked, u.full_name
    """
    conn = psycopg2.connect(
        host=DB_HOST, port=DB_PORT,
        dbname=DB_NAME, user=DB_USER, password=DB_PASSWORD
    )
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(query, (week_start, week_end))
            rows = cur.fetchall()
        log.info(f"Fetched {len(rows)} rows for {week_start} – {week_end}.")
        return [dict(r) for r in rows]
    finally:
        conn.close()


def format_duration(decimal_hours) -> str:
    """3.25 → '3h 15m', 0.75 → '0h 45m'"""
    if decimal_hours is None:
        return "0h"
    val = float(decimal_hours)
    h = int(val)
    m = round((val - h) * 60)
    if m > 0:
        return f"{h}h {m}m"
    return f"{h}h"


# ── CSV Generation ────────────────────────────────────────────────────────────

def build_csv(rows: list[dict]) -> bytes:
    fieldnames = [
        "Date", "User", "Email", "Customer", "Project",
        "Work Type", "Activity Type", "Platform",
        "Duration", "Billable", "Description", "Created At"
    ]
    buf = io.StringIO()
    # UTF-8 BOM for Excel compatibility
    buf.write("\ufeff")
    writer = csv.DictWriter(buf, fieldnames=fieldnames, delimiter=";")
    writer.writeheader()
    for r in rows:
        writer.writerow({
            "Date":          str(r["Date"]),
            "User":          r["User"] or "",
            "Email":         r["Email"] or "",
            "Customer":      r["Customer"] or "",
            "Project":       r["Project"] or "",
            "Work Type":     r["Work Type"] or "",
            "Activity Type": r["Activity Type"] or "-",
            "Platform":      r["Platform"] or "-",
            "Duration":      format_duration(r["Duration (h)"]),
            "Billable":      format_duration(r["Billable (h)"]),
            "Description":   r["Description"] or "",
            "Created At":    str(r["Created At"]),
        })
    return buf.getvalue().encode("utf-8")


# ── OneDrive Upload ───────────────────────────────────────────────────────────

def upload_to_onedrive(token: str, filename: str, content: bytes) -> str:
    """Upload file to OneDrive. Returns webUrl."""
    folder = ONEDRIVE_FOLDER.rstrip("/")
    url = f"{GRAPH_URL}/drives/{DRIVE_ID}/root:{folder}/{filename}:/content"

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "text/csv; charset=utf-8",
    }

    if len(content) < 4 * 1024 * 1024:
        # Small file — single PUT
        resp = requests.put(url, headers=headers, data=content, timeout=60)
        resp.raise_for_status()
        web_url = resp.json().get("webUrl", "")
        log.info(f"Uploaded: {web_url}")
        return web_url
    else:
        # Large file — upload session
        session_url = f"{GRAPH_URL}/drives/{DRIVE_ID}/root:{folder}/{filename}:/createUploadSession"
        session_headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
        session_body = {"item": {"@microsoft.graph.conflictBehavior": "replace"}}
        session = requests.post(session_url, headers=session_headers, json=session_body, timeout=30)
        session.raise_for_status()
        upload_url = session.json()["uploadUrl"]

        chunk_size = 5 * 1024 * 1024
        total = len(content)
        offset = 0
        while offset < total:
            chunk = content[offset:offset + chunk_size]
            end = offset + len(chunk) - 1
            chunk_headers = {
                "Content-Length": str(len(chunk)),
                "Content-Range": f"bytes {offset}-{end}/{total}",
            }
            resp = requests.put(upload_url, headers=chunk_headers, data=chunk, timeout=120)
            log.info(f"Chunk {offset}-{end}: {resp.status_code}")
            offset += len(chunk)

        log.info("Large file upload complete.")
        return ""


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    today = date.today()
    # Previous full week: Mon–Sun
    days_since_monday = today.weekday()
    week_end   = today - timedelta(days=days_since_monday + 1)   # last Sunday
    week_start = week_end - timedelta(days=6)                     # last Monday

    log.info(f"Backup period: {week_start} – {week_end}")

    rows = fetch_weekly_logs(week_start, week_end)

    if not rows:
        log.warning("No entries found for this week. Skipping upload.")
        sys.exit(0)

    csv_bytes = build_csv(rows)
    filename  = f"hermes_weekly_{week_start}_{week_end}.csv"

    token = get_access_token()
    web_url = upload_to_onedrive(token, filename, csv_bytes)

    log.info(f"Backup complete. File: {filename} | Rows: {len(rows)} | URL: {web_url}")


if __name__ == "__main__":
    main()
