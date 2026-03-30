"""
HERMES - Weekly Backup to OneDrive
====================================
Runs every Monday. Performs two tasks:

1. CSV Export  → /HermesBackup/csv/hermes_weekly_YYYY-MM-DD_YYYY-MM-DD.csv
   Retention: current month + previous month are kept.
   When a new month begins, files from 2+ months ago are deleted automatically.

2. DB Dump     → /HermesBackup/db-dumps/hermes_db_YYYY-MM-DD.sql.gz
   Rolling 4-week window: after uploading, any dumps older than 4 weeks
   are deleted from OneDrive automatically.

Required environment variables (injected via K8s Secret):
  AZURE_CLIENT_ID      - Hermes-Backup-Rclone app client ID
  AZURE_CLIENT_SECRET  - client secret value
  AZURE_TENANT_ID      - Azure AD tenant ID
  ONEDRIVE_DRIVE_ID    - target OneDrive drive ID
  DB_HOST              - PostgreSQL host (core-db)
  DB_PORT              - PostgreSQL port (5432)
  DB_NAME              - database name (core_db)
  DB_USER              - database user
  DB_PASSWORD          - database password
"""

import os
import csv
import gzip
import io
import subprocess
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

DB_HOST     = os.environ.get("DB_HOST", "core-db")
DB_PORT     = os.environ.get("DB_PORT", "5432")
DB_NAME     = os.environ.get("DB_NAME", "core_db")
DB_USER     = os.environ.get("DB_USER", "hermes")
DB_PASSWORD = os.environ["DB_PASSWORD"]

AUTHORITY  = f"https://login.microsoftonline.com/{TENANT_ID}"
GRAPH_URL  = "https://graph.microsoft.com/v1.0"

ONEDRIVE_ROOT = "/HermesBackup"
CSV_FOLDER    = f"{ONEDRIVE_ROOT}/csv"
DUMP_FOLDER   = f"{ONEDRIVE_ROOT}/db-dumps"


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


# ── OneDrive helpers ──────────────────────────────────────────────────────────

def _auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def upload_to_onedrive(token: str, folder: str, filename: str, content: bytes, content_type: str = "application/octet-stream") -> str:
    """Upload file. Returns webUrl."""
    folder = folder.rstrip("/")
    url = f"{GRAPH_URL}/drives/{DRIVE_ID}/root:{folder}/{filename}:/content"
    headers = {**_auth_headers(token), "Content-Type": content_type}

    if len(content) < 4 * 1024 * 1024:
        resp = requests.put(url, headers=headers, data=content, timeout=60)
        resp.raise_for_status()
        web_url = resp.json().get("webUrl", "")
        log.info(f"Uploaded '{filename}' → {web_url}")
        return web_url

    # Large file — upload session
    session_url = f"{GRAPH_URL}/drives/{DRIVE_ID}/root:{folder}/{filename}:/createUploadSession"
    session = requests.post(
        session_url,
        headers={**_auth_headers(token), "Content-Type": "application/json"},
        json={"item": {"@microsoft.graph.conflictBehavior": "replace"}},
        timeout=30
    )
    session.raise_for_status()
    upload_url = session.json()["uploadUrl"]

    chunk_size = 5 * 1024 * 1024
    total = len(content)
    offset = 0
    while offset < total:
        chunk = content[offset:offset + chunk_size]
        end = offset + len(chunk) - 1
        resp = requests.put(
            upload_url,
            headers={"Content-Length": str(len(chunk)), "Content-Range": f"bytes {offset}-{end}/{total}"},
            data=chunk, timeout=120
        )
        log.info(f"  chunk {offset}-{end}: {resp.status_code}")
        offset += len(chunk)

    log.info(f"Uploaded large file '{filename}'.")
    return ""


def list_files_in_folder(token: str, folder: str) -> list[dict]:
    """Returns list of {name, id, lastModifiedDateTime} for files in folder."""
    url = f"{GRAPH_URL}/drives/{DRIVE_ID}/root:{folder}:/children"
    resp = requests.get(url, headers=_auth_headers(token), timeout=30)
    if resp.status_code == 404:
        return []
    resp.raise_for_status()
    return resp.json().get("value", [])


def delete_file(token: str, item_id: str, name: str):
    url = f"{GRAPH_URL}/drives/{DRIVE_ID}/items/{item_id}"
    resp = requests.delete(url, headers=_auth_headers(token), timeout=30)
    resp.raise_for_status()
    log.info(f"Deleted old dump: {name}")


# ── DB Query ─────────────────────────────────────────────────────────────────

def fetch_weekly_logs(week_start: date, week_end: date) -> list[dict]:
    query = """
        SELECT
            wl.date_worked                          AS "Date",
            wl.user_id                              AS "User",
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
        JOIN customers c   ON c.id  = wl.customer_id
        JOIN projects p    ON p.id  = wl.project_id
        JOIN work_types wt ON wt.id = wl.work_type_id
        LEFT JOIN activity_types at ON at.id = wl.activity_type_id
        LEFT JOIN platforms pl      ON pl.id = wl.platform_id
        WHERE wl.date_worked BETWEEN %s AND %s
        ORDER BY wl.date_worked, wl.user_id
    """
    conn = psycopg2.connect(
        host=DB_HOST, port=int(DB_PORT),
        dbname=DB_NAME, user=DB_USER, password=DB_PASSWORD
    )
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(query, (week_start, week_end))
            rows = cur.fetchall()
        log.info(f"Fetched {len(rows)} rows for CSV ({week_start} – {week_end}).")
        return [dict(r) for r in rows]
    finally:
        conn.close()


def format_duration(decimal_hours) -> str:
    if decimal_hours is None:
        return "0h"
    val = float(decimal_hours)
    h = int(val)
    m = round((val - h) * 60)
    return f"{h}h {m}m" if m > 0 else f"{h}h"


# ── CSV ───────────────────────────────────────────────────────────────────────

def build_csv(rows: list[dict]) -> bytes:
    fieldnames = [
        "Date", "User ID", "Customer", "Project",
        "Work Type", "Activity Type", "Platform",
        "Duration", "Billable", "Description", "Created At"
    ]
    buf = io.StringIO()
    buf.write("\ufeff")  # UTF-8 BOM for Excel
    writer = csv.DictWriter(buf, fieldnames=fieldnames, delimiter=";")
    writer.writeheader()
    for r in rows:
        writer.writerow({
            "Date":          str(r["Date"]),
            "User ID":       str(r["User"]) if r["User"] else "",
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


# ── DB Dump ───────────────────────────────────────────────────────────────────

def create_db_dump() -> bytes:
    """Run pg_dump and return gzipped SQL bytes."""
    log.info("Running pg_dump...")
    env = os.environ.copy()
    env["PGPASSWORD"] = DB_PASSWORD

    result = subprocess.run(
        [
            "pg_dump",
            "-h", DB_HOST,
            "-p", DB_PORT,
            "-U", DB_USER,
            "-d", DB_NAME,
            "--no-password",
            "-F", "p",   # plain SQL
        ],
        capture_output=True,
        env=env,
        timeout=300
    )

    if result.returncode != 0:
        raise RuntimeError(f"pg_dump failed: {result.stderr.decode()}")

    compressed = gzip.compress(result.stdout, compresslevel=9)
    log.info(f"DB dump: {len(result.stdout) / 1024:.1f} KB → {len(compressed) / 1024:.1f} KB compressed.")
    return compressed


def cleanup_old_dumps(token: str, today: date):
    """
    Keep only DB dumps from the current month. When the first dump of a new
    month is uploaded, all dumps from the previous month are deleted.

    Filename format: hermes_db_YYYY-MM-DD.sql.gz
    """
    files = list_files_in_folder(token, DUMP_FOLDER)
    dumps = [f for f in files if f["name"].endswith(".sql.gz")]

    to_delete = []
    for f in dumps:
        try:
            # hermes_db_YYYY-MM-DD.sql.gz → extract date part
            date_str = f["name"].replace("hermes_db_", "").replace(".sql.gz", "")
            file_date = date.fromisoformat(date_str)
            if (file_date.year, file_date.month) < (today.year, today.month):
                to_delete.append(f)
        except ValueError:
            log.warning(f"Could not parse date from filename: {f['name']}, skipping.")

    if not to_delete:
        log.info("Dump cleanup: nothing to delete.")
        return

    for f in to_delete:
        delete_file(token, f["id"], f["name"])
    log.info(f"Dump cleanup: deleted {len(to_delete)} old file(s).")


def cleanup_old_csvs(token: str, today: date):
    """
    Keep only CSVs from the current month. When the first CSV of a new month
    is uploaded, all CSVs from the previous month are deleted.

    Example: May week-1 is uploaded → all April CSVs are deleted.

    Filename format: hermes_weekly_YYYY-MM-DD_YYYY-MM-DD.csv
    Month is determined from the week_start date (first date in filename).
    """
    files = list_files_in_folder(token, CSV_FOLDER)
    csvs = [f for f in files if f["name"].endswith(".csv")]

    to_delete = []
    for f in csvs:
        # Parse week_start from filename: hermes_weekly_YYYY-MM-DD_YYYY-MM-DD.csv
        try:
            parts = f["name"].replace(".csv", "").split("_")
            # parts: ['hermes', 'weekly', 'YYYY-MM-DD', 'YYYY-MM-DD']
            week_start_str = parts[2]
            file_date = date.fromisoformat(week_start_str)
            # Delete if the file belongs to any month before the current month
            if (file_date.year, file_date.month) < (today.year, today.month):
                to_delete.append(f)
        except (IndexError, ValueError):
            log.warning(f"Could not parse date from filename: {f['name']}, skipping.")

    if not to_delete:
        log.info("CSV cleanup: nothing to delete.")
        return

    for f in to_delete:
        delete_file(token, f["id"], f["name"])
    log.info(f"CSV cleanup: deleted {len(to_delete)} old file(s).")


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    today = date.today()
    days_since_monday = today.weekday()
    week_end   = today - timedelta(days=days_since_monday + 1)   # last Sunday
    week_start = week_end - timedelta(days=6)                     # last Monday

    log.info(f"Backup period: {week_start} – {week_end}")

    token = get_access_token()

    # ── 1. CSV Export ─────────────────────────────────────────────────────────
    rows = fetch_weekly_logs(week_start, week_end)
    if rows:
        csv_bytes = build_csv(rows)
        csv_filename = f"hermes_weekly_{week_start}_{week_end}.csv"
        upload_to_onedrive(token, CSV_FOLDER, csv_filename, csv_bytes, "text/csv; charset=utf-8")
    else:
        log.warning("No entries for this week — skipping CSV upload.")

    # Delete CSVs older than previous month
    cleanup_old_csvs(token, today)

    # ── 2. DB Dump ────────────────────────────────────────────────────────────
    dump_bytes = create_db_dump()
    dump_filename = f"hermes_db_{week_end}.sql.gz"
    upload_to_onedrive(token, DUMP_FOLDER, dump_filename, dump_bytes)

    # Delete dumps from previous month
    cleanup_old_dumps(token, today)

    log.info("All backup tasks completed successfully.")


if __name__ == "__main__":
    main()
