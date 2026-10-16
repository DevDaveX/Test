from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import sqlite3
from contextlib import asynccontextmanager
from datetime import date, datetime
from pathlib import Path
from typing import Literal, Optional

from apscheduler.schedulers.background import BackgroundScheduler
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from jinja2 import Environment, FileSystemLoader, select_autoescape
from pydantic import BaseModel, Field, field_validator
from pywebpush import WebPushException, webpush

from .date_rules import (
    BERLIN,
    calculate_hu_due,
    calculate_sp_due,
    calculate_tacho_due,
    due_status,
    today_berlin,
)


BASE_DIR = Path(__file__).resolve().parent
DEFAULT_DATA_DIR = Path("/app/data") if Path("/app/data").exists() else BASE_DIR.parent / "data"
DATA_DIR = Path(os.getenv("DATA_DIR", str(DEFAULT_DATA_DIR)))
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / "fleet.db"
VAPID_KEY_FILE = DATA_DIR / "vapid_private.pem"
APP_TITLE = os.getenv("APP_TITLE", "Betriebshof Fahrzeugverwaltung")
VAPID_SUBJECT = os.getenv("VAPID_SUBJECT", "mailto:admin@example.com")
NOTIFICATION_THRESHOLDS = (30, 14, 7, 3, 2, 1, 0)
DEFAULT_REMINDER_THRESHOLDS_JSON = json.dumps(NOTIFICATION_THRESHOLDS)
PLATE_PATTERN = re.compile(r"^[A-ZÄÖÜ]{1,3}(?:-[A-ZÄÖÜ]{1,3})?-[A-Z0-9]{1,8}$")

jinja_env = Environment(
    loader=FileSystemLoader(BASE_DIR / "templates"),
    autoescape=select_autoescape(["html", "xml"]),
)


def now_iso() -> str:
    return datetime.now(BERLIN).isoformat(timespec="seconds")


def db() -> sqlite3.Connection:
    con = sqlite3.connect(DB_PATH, timeout=20)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA foreign_keys=ON")
    con.execute("PRAGMA busy_timeout=20000")
    return con


def _columns(con: sqlite3.Connection, table: str) -> set[str]:
    return {row[1] for row in con.execute(f"PRAGMA table_info({table})")}


def _add_column(con: sqlite3.Connection, table: str, definition: str) -> None:
    name = definition.split()[0]
    if name not in _columns(con, table):
        con.execute(f"ALTER TABLE {table} ADD COLUMN {definition}")


def init_db() -> None:
    """Create and additively migrate the database without replacing user data."""
    with db() as con:
        con.executescript(
            """
            CREATE TABLE IF NOT EXISTS vehicles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                plate TEXT NOT NULL UNIQUE,
                first_registration TEXT,
                calculation_mode TEXT NOT NULL DEFAULT 'auto',
                tacho_last TEXT NOT NULL,
                tacho_due TEXT NOT NULL,
                hu_last TEXT NOT NULL,
                hu_due TEXT NOT NULL,
                sp_last TEXT,
                sp_due TEXT,
                first_aid_due TEXT,
                fire_extinguisher_due TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS inspection_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                vehicle_id INTEGER NOT NULL,
                action TEXT NOT NULL,
                performed_on TEXT NOT NULL,
                details TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY(vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS push_subscriptions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                endpoint TEXT NOT NULL UNIQUE,
                subscription_json TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS notification_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                vehicle_id INTEGER NOT NULL,
                category TEXT NOT NULL,
                due_date TEXT NOT NULL,
                threshold INTEGER NOT NULL,
                sent_at TEXT NOT NULL,
                UNIQUE(vehicle_id, category, due_date, threshold),
                FOREIGN KEY(vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS notification_deliveries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                notification_id INTEGER NOT NULL,
                subscription_id INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                attempt_count INTEGER NOT NULL DEFAULT 0,
                last_attempt_at TEXT,
                sent_at TEXT,
                error TEXT,
                UNIQUE(notification_id, subscription_id),
                FOREIGN KEY(notification_id) REFERENCES notification_log(id) ON DELETE CASCADE,
                FOREIGN KEY(subscription_id) REFERENCES push_subscriptions(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                applied_at TEXT NOT NULL
            );
            """
        )

        _add_column(con, "vehicles", "tacho_due_manual INTEGER NOT NULL DEFAULT 0")
        _add_column(con, "vehicles", "hu_due_manual INTEGER NOT NULL DEFAULT 0")
        _add_column(con, "vehicles", "sp_due_manual INTEGER NOT NULL DEFAULT 0")
        _add_column(con, "vehicles", "first_aid_due TEXT")
        _add_column(con, "vehicles", "fire_extinguisher_due TEXT")
        _add_column(con, "vehicles", "updated_at TEXT")
        _add_column(con, "inspection_history", "inspection_type TEXT")
        _add_column(con, "inspection_history", "old_due_date TEXT")
        _add_column(con, "inspection_history", "next_due_date TEXT")
        _add_column(con, "push_subscriptions", "p256dh TEXT")
        _add_column(con, "push_subscriptions", "auth TEXT")
        _add_column(con, "push_subscriptions", "device_name TEXT")
        _add_column(con, "push_subscriptions", "user_agent TEXT")
        _add_column(con, "push_subscriptions", "last_success_at TEXT")
        _add_column(
            con,
            "push_subscriptions",
            "reminder_thresholds TEXT NOT NULL DEFAULT '[30,14,7,3,2,1,0]'",
        )
        _add_column(con, "push_subscriptions", "overdue_daily INTEGER NOT NULL DEFAULT 0")

        con.execute(
            """UPDATE vehicles SET hu_due_manual=1, sp_due_manual=1
               WHERE calculation_mode='manual' AND hu_due_manual=0 AND sp_due_manual=0"""
        )
        for row in con.execute(
            "SELECT id, subscription_json FROM push_subscriptions WHERE p256dh IS NULL OR auth IS NULL"
        ).fetchall():
            try:
                raw = json.loads(row["subscription_json"])
                con.execute(
                    "UPDATE push_subscriptions SET p256dh=?, auth=? WHERE id=?",
                    (raw.get("keys", {}).get("p256dh"), raw.get("keys", {}).get("auth"), row["id"]),
                )
            except (TypeError, ValueError):
                continue
        con.execute(
            "INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(2, ?)",
            (now_iso(),),
        )
        con.execute(
            "INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(3, ?)",
            (now_iso(),),
        )


def iso(value: Optional[date]) -> Optional[str]:
    return value.isoformat() if value else None


def parse_date(value: Optional[str]) -> Optional[date]:
    return date.fromisoformat(value) if value else None


def normalize_plate(value: str) -> str:
    plate = re.sub(r"\s+", "", value.strip().upper())
    if not PLATE_PATTERN.fullmatch(plate):
        raise ValueError("Bitte ein gültiges Kennzeichen wie HAM-KV-48 eingeben.")
    return plate


def vehicle_to_dict(row: sqlite3.Row) -> dict:
    vehicle = dict(row)
    statuses = {}
    for category in (
        "tacho",
        "hu",
        "sp",
        "first_aid",
        "fire_extinguisher",
    ):
        statuses[category] = due_status(parse_date(vehicle.get(f"{category}_due")))
    vehicle["status"] = statuses
    appointments = [
        {"category": category, "due": vehicle.get(f"{category}_due"), "status": statuses[category]}
        for category in ("hu", "sp", "tacho", "first_aid", "fire_extinguisher")
        if vehicle.get(f"{category}_due")
    ]
    vehicle["next_appointment"] = min(appointments, key=lambda item: item["due"], default=None)
    return vehicle


def ensure_vapid_key() -> None:
    if os.getenv("VAPID_PRIVATE_KEY") or VAPID_KEY_FILE.exists():
        return
    private_key = ec.generate_private_key(ec.SECP256R1())
    VAPID_KEY_FILE.write_bytes(
        private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        )
    )


def vapid_private_key() -> str:
    configured = os.getenv("VAPID_PRIVATE_KEY", "").strip()
    if configured:
        return configured.replace("\\n", "\n")
    ensure_vapid_key()
    return str(VAPID_KEY_FILE)


def vapid_public_key_b64() -> str:
    configured = os.getenv("VAPID_PUBLIC_KEY", "").strip()
    if configured:
        return configured
    ensure_vapid_key()
    private_key = serialization.load_pem_private_key(VAPID_KEY_FILE.read_bytes(), password=None)
    raw = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.X962,
        format=serialization.PublicFormat.UncompressedPoint,
    )
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def notification_text(plate: str, category: str, due: date, days: int) -> tuple[str, str]:
    labels = {
        "tacho": "Tachoprüfung",
        "hu": "TÜV / HU",
        "sp": "SP",
        "first_aid": "Erste-Hilfe-Kasten",
        "fire_extinguisher": "Feuerlöscher",
    }
    label = labels[category]
    due_text = due.strftime("%d.%m.%Y")
    if days < 0:
        count = abs(days)
        return (
            f"{label} ÜBERFÄLLIG – {plate}",
            f"Die {label} für {plate} ist seit {count} Tag{'en' if count != 1 else ''} überfällig.",
        )
    if days == 0:
        return f"{label} JETZT FÄLLIG – {plate}", f"Die {label} für {plate} ist heute fällig."
    return (
        f"{label} bald fällig – {plate}",
        f"Die {label} von {plate} ist am {due_text} fällig. Noch {days} Tage.",
    )


def _send_webpush(subscription: dict, payload: str) -> None:
    webpush(
        subscription_info=subscription,
        data=payload,
        vapid_private_key=vapid_private_key(),
        vapid_claims={"sub": VAPID_SUBJECT},
    )


def _subscription_thresholds(subscription: sqlite3.Row) -> set[int]:
    """Return a safe reminder selection for old and newly migrated devices."""
    try:
        values = json.loads(subscription["reminder_thresholds"] or DEFAULT_REMINDER_THRESHOLDS_JSON)
        return {int(value) for value in values if int(value) in NOTIFICATION_THRESHOLDS}
    except (KeyError, TypeError, ValueError, json.JSONDecodeError):
        return set(NOTIFICATION_THRESHOLDS)


def _subscription_settings(subscription: sqlite3.Row) -> dict:
    selected = _subscription_thresholds(subscription)
    return {
        "reminder_thresholds": [value for value in NOTIFICATION_THRESHOLDS if value in selected],
        "overdue_daily": bool(subscription["overdue_daily"]),
    }


def send_due_notifications(*, target_date: Optional[date] = None, push_sender=_send_webpush) -> dict:
    """Send threshold reminders and deduplicate delivery per device."""
    today = target_date or today_berlin()
    result = {"events": 0, "sent": 0, "failed": 0, "removed": 0}
    with db() as con:
        vehicles = con.execute("SELECT * FROM vehicles").fetchall()
        subscriptions = con.execute("SELECT * FROM push_subscriptions").fetchall()
        if not subscriptions:
            return result

        for vehicle in vehicles:
            for category in ("hu", "sp", "tacho", "first_aid", "fire_extinguisher"):
                due_raw = vehicle[f"{category}_due"]
                if not due_raw:
                    continue
                due = date.fromisoformat(due_raw)
                days = (due - today).days
                eligible_subscriptions = [
                    subscription
                    for subscription in subscriptions
                    if days in _subscription_thresholds(subscription)
                    or (days < 0 and bool(subscription["overdue_daily"]))
                ]
                if not eligible_subscriptions:
                    continue

                con.execute(
                    """INSERT OR IGNORE INTO notification_log
                       (vehicle_id, category, due_date, threshold, sent_at) VALUES(?,?,?,?,?)""",
                    (vehicle["id"], category, due_raw, days, now_iso()),
                )
                notification_id = con.execute(
                    """SELECT id FROM notification_log
                       WHERE vehicle_id=? AND category=? AND due_date=? AND threshold=?""",
                    (vehicle["id"], category, due_raw, days),
                ).fetchone()["id"]
                result["events"] += 1
                title, body = notification_text(vehicle["plate"], category, due, days)
                payload = json.dumps(
                    {
                        "title": title,
                        "body": body,
                        "url": f"/?vehicle={vehicle['id']}",
                        "tag": f"fleet-{vehicle['id']}-{category}-{due_raw}-{days}",
                    },
                    ensure_ascii=False,
                )

                for sub in eligible_subscriptions:
                    delivered = con.execute(
                        """SELECT status FROM notification_deliveries
                           WHERE notification_id=? AND subscription_id=?""",
                        (notification_id, sub["id"]),
                    ).fetchone()
                    if delivered and delivered["status"] == "sent":
                        continue
                    attempt_at = now_iso()
                    try:
                        push_sender(json.loads(sub["subscription_json"]), payload)
                        con.execute(
                            """INSERT INTO notification_deliveries
                               (notification_id, subscription_id, status, attempt_count, last_attempt_at, sent_at)
                               VALUES(?,?, 'sent', 1, ?, ?)
                               ON CONFLICT(notification_id, subscription_id) DO UPDATE SET
                                 status='sent', attempt_count=attempt_count+1,
                                 last_attempt_at=excluded.last_attempt_at,
                                 sent_at=excluded.sent_at, error=NULL""",
                            (notification_id, sub["id"], attempt_at, attempt_at),
                        )
                        con.execute(
                            "UPDATE push_subscriptions SET last_success_at=? WHERE id=?",
                            (attempt_at, sub["id"]),
                        )
                        result["sent"] += 1
                    except WebPushException as exc:
                        status_code = getattr(getattr(exc, "response", None), "status_code", None)
                        if status_code in (404, 410):
                            con.execute("DELETE FROM push_subscriptions WHERE id=?", (sub["id"],))
                            result["removed"] += 1
                        else:
                            _record_failed_delivery(con, notification_id, sub["id"], attempt_at, exc)
                            result["failed"] += 1
                    except Exception as exc:  # keep the scheduler alive on provider/network errors
                        _record_failed_delivery(con, notification_id, sub["id"], attempt_at, exc)
                        result["failed"] += 1
        con.commit()
    return result


def _record_failed_delivery(con, notification_id: int, subscription_id: int, attempted: str, exc: Exception) -> None:
    con.execute(
        """INSERT INTO notification_deliveries
           (notification_id, subscription_id, status, attempt_count, last_attempt_at, error)
           VALUES(?,?, 'failed', 1, ?, ?)
           ON CONFLICT(notification_id, subscription_id) DO UPDATE SET
             status='failed', attempt_count=attempt_count+1,
             last_attempt_at=excluded.last_attempt_at, error=excluded.error""",
        (notification_id, subscription_id, attempted, str(exc)[:500]),
    )


class VehiclePayload(BaseModel):
    plate: str = Field(min_length=3, max_length=20)
    first_registration: Optional[date] = None
    tacho_last: date
    tacho_due: Optional[date] = None
    tacho_due_manual: bool = False
    hu_last: date
    hu_due: Optional[date] = None
    hu_due_manual: bool = False
    sp_last: Optional[date] = None
    sp_due: Optional[date] = None
    sp_due_manual: bool = False
    first_aid_due: Optional[date] = None
    fire_extinguisher_due: Optional[date] = None

    @field_validator("plate")
    @classmethod
    def validate_plate(cls, value: str) -> str:
        try:
            return normalize_plate(value)
        except ValueError as exc:
            raise ValueError(str(exc)) from exc


class RenewalRequest(BaseModel):
    action: Literal["hu", "sp", "hu_sp", "tacho"]
    performed_on: date
    next_hu_due_manual: Optional[date] = None
    next_sp_due_manual: Optional[date] = None


class PushKeys(BaseModel):
    p256dh: str = Field(min_length=10, max_length=500)
    auth: str = Field(min_length=5, max_length=500)


class PushSubscriptionPayload(BaseModel):
    endpoint: str = Field(min_length=10, max_length=4096)
    expirationTime: Optional[int] = None
    keys: PushKeys
    device_name: str = Field(default="Dieses Gerät", min_length=1, max_length=100)
    reminder_thresholds: list[int] = Field(default_factory=lambda: list(NOTIFICATION_THRESHOLDS))
    overdue_daily: bool = False

    @field_validator("endpoint")
    @classmethod
    def validate_endpoint(cls, value: str) -> str:
        if not value.startswith("https://"):
            raise ValueError("Ungültiger Push-Endpunkt.")
        return value

    @field_validator("device_name")
    @classmethod
    def validate_device_name(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Bitte einen Gerätenamen eingeben.")
        return value.strip()

    @field_validator("reminder_thresholds")
    @classmethod
    def validate_reminder_thresholds(cls, values: list[int]) -> list[int]:
        invalid = set(values) - set(NOTIFICATION_THRESHOLDS)
        if invalid:
            raise ValueError("Ungültige Reminder-Stufe.")
        if not values:
            raise ValueError("Bitte mindestens eine Reminder-Stufe auswählen.")
        selected = set(values)
        return [value for value in NOTIFICATION_THRESHOLDS if value in selected]


class PushEndpoint(BaseModel):
    endpoint: str = Field(min_length=10, max_length=4096)


class CalculationPreview(BaseModel):
    first_registration: Optional[date] = None
    tacho_last: Optional[date] = None
    hu_last: Optional[date] = None
    sp_last: Optional[date] = None


def _calculated_values(payload: VehiclePayload) -> tuple[date, date, Optional[date]]:
    if not payload.first_registration and not payload.sp_due_manual:
        raise HTTPException(400, "Für die automatische SP-Berechnung ist die Erstzulassung erforderlich.")
    if payload.tacho_due_manual and not payload.tacho_due:
        raise HTTPException(400, "Bitte das manuelle Datum der nächsten Tachoprüfung eintragen.")
    if payload.hu_due_manual and not payload.hu_due:
        raise HTTPException(400, "Bitte das manuelle nächste TÜV/HU-Datum eintragen.")

    tacho_due = payload.tacho_due if payload.tacho_due_manual else calculate_tacho_due(payload.tacho_last)
    hu_due = payload.hu_due if payload.hu_due_manual else calculate_hu_due(payload.hu_last)
    sp_due = (
        payload.sp_due
        if payload.sp_due_manual
        else calculate_sp_due(payload.first_registration, payload.hu_last, payload.sp_last)
    )
    return tacho_due, hu_due, sp_due


scheduler = BackgroundScheduler(timezone="Europe/Berlin")


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    ensure_vapid_key()
    if not scheduler.running:
        scheduler.add_job(
            send_due_notifications,
            "interval",
            hours=1,
            id="due_notifications",
            replace_existing=True,
            max_instances=1,
            coalesce=True,
        )
        scheduler.start()
    send_due_notifications()
    yield
    if scheduler.running:
        scheduler.shutdown(wait=False)


app = FastAPI(title=APP_TITLE, lifespan=lifespan)
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")


@app.get("/", response_class=HTMLResponse)
def index(request: Request):
    # Kiosk-Terminals sollen nach einem Update keine veraltete HTML-Seite laden.
    return HTMLResponse(
        jinja_env.get_template("index.html").render(title=APP_TITLE, request=request),
        headers={"Cache-Control": "no-cache"},
    )


@app.get("/manifest.webmanifest")
def manifest():
    return FileResponse(BASE_DIR / "static" / "manifest.webmanifest", media_type="application/manifest+json")


@app.get("/sw.js")
def service_worker():
    return FileResponse(
        BASE_DIR / "static" / "sw.js",
        media_type="application/javascript",
        headers={"Cache-Control": "no-cache, no-store, must-revalidate", "Service-Worker-Allowed": "/"},
    )


@app.get("/offline")
def offline():
    return FileResponse(BASE_DIR / "static" / "offline.html", media_type="text/html")


@app.get("/api/health")
def health():
    return {"ok": True, "timezone": "Europe/Berlin"}


@app.post("/api/calculations/preview")
def calculation_preview(payload: CalculationPreview):
    sp_due = None
    sp_note = "Erstzulassung und letzte HU eintragen."
    if payload.first_registration and payload.hu_last:
        sp_due = calculate_sp_due(payload.first_registration, payload.hu_last, payload.sp_last)
        if sp_due:
            sp_note = "Automatisch nach der hinterlegten Bus-SP-Regelung."
        elif (payload.hu_last - payload.first_registration).days < 365:
            sp_note = "Im ersten Jahr ist noch keine SP vorgesehen."
        else:
            sp_note = "SP-Zyklus abgeschlossen; nächste SP nach der nächsten HU."
    return {
        "tacho_due": iso(calculate_tacho_due(payload.tacho_last)) if payload.tacho_last else None,
        "hu_due": iso(calculate_hu_due(payload.hu_last)) if payload.hu_last else None,
        "sp_due": iso(sp_due),
        "sp_note": sp_note,
    }


@app.get("/api/vehicles")
def list_vehicles():
    with db() as con:
        rows = con.execute("SELECT * FROM vehicles ORDER BY plate COLLATE NOCASE").fetchall()
    return [vehicle_to_dict(row) for row in rows]


@app.get("/api/vehicles/{vehicle_id}")
def get_vehicle(vehicle_id: int):
    with db() as con:
        row = con.execute("SELECT * FROM vehicles WHERE id=?", (vehicle_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Fahrzeug nicht gefunden.")
    return vehicle_to_dict(row)


@app.post("/api/vehicles", status_code=201)
def create_vehicle(payload: VehiclePayload):
    tacho_due, hu_due, sp_due = _calculated_values(payload)
    timestamp = now_iso()
    try:
        with db() as con:
            cur = con.execute(
                """INSERT INTO vehicles(
                    plate, first_registration, calculation_mode,
                    tacho_last, tacho_due, hu_last, hu_due, sp_last, sp_due, first_aid_due, fire_extinguisher_due,
                    created_at, updated_at, tacho_due_manual, hu_due_manual, sp_due_manual
                ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    payload.plate, iso(payload.first_registration),
                    "manual" if any((payload.tacho_due_manual, payload.hu_due_manual, payload.sp_due_manual)) else "auto",
                    iso(payload.tacho_last), iso(tacho_due), iso(payload.hu_last), iso(hu_due),
                    iso(payload.sp_last), iso(sp_due), iso(payload.first_aid_due), iso(payload.fire_extinguisher_due), timestamp, timestamp,
                    int(payload.tacho_due_manual), int(payload.hu_due_manual), int(payload.sp_due_manual),
                ),
            )
            row = con.execute("SELECT * FROM vehicles WHERE id=?", (cur.lastrowid,)).fetchone()
    except sqlite3.IntegrityError as exc:
        raise HTTPException(409, f"Das Kennzeichen {payload.plate} existiert bereits.") from exc
    return vehicle_to_dict(row)


@app.put("/api/vehicles/{vehicle_id}")
def edit_vehicle(vehicle_id: int, payload: VehiclePayload):
    tacho_due, hu_due, sp_due = _calculated_values(payload)
    try:
        with db() as con:
            if not con.execute("SELECT 1 FROM vehicles WHERE id=?", (vehicle_id,)).fetchone():
                raise HTTPException(404, "Fahrzeug nicht gefunden.")
            con.execute(
                """UPDATE vehicles SET plate=?, first_registration=?, calculation_mode=?,
                    tacho_last=?, tacho_due=?, hu_last=?, hu_due=?, sp_last=?, sp_due=?, first_aid_due=?, fire_extinguisher_due=?,
                    updated_at=?, tacho_due_manual=?, hu_due_manual=?, sp_due_manual=? WHERE id=?""",
                (
                    payload.plate, iso(payload.first_registration),
                    "manual" if any((payload.tacho_due_manual, payload.hu_due_manual, payload.sp_due_manual)) else "auto",
                    iso(payload.tacho_last), iso(tacho_due), iso(payload.hu_last), iso(hu_due),
                    iso(payload.sp_last), iso(sp_due), iso(payload.first_aid_due), iso(payload.fire_extinguisher_due), now_iso(), int(payload.tacho_due_manual),
                    int(payload.hu_due_manual), int(payload.sp_due_manual), vehicle_id,
                ),
            )
            row = con.execute("SELECT * FROM vehicles WHERE id=?", (vehicle_id,)).fetchone()
    except sqlite3.IntegrityError as exc:
        raise HTTPException(409, "Dieses Kennzeichen existiert bereits.") from exc
    return vehicle_to_dict(row)


@app.delete("/api/vehicles/{vehicle_id}", status_code=204)
def delete_vehicle(vehicle_id: int):
    with db() as con:
        cur = con.execute("DELETE FROM vehicles WHERE id=?", (vehicle_id,))
        if cur.rowcount == 0:
            raise HTTPException(404, "Fahrzeug nicht gefunden.")
    return None


def _history_row(
    con: sqlite3.Connection,
    vehicle_id: int,
    inspection_type: str,
    performed: date,
    old_due: Optional[str],
    next_due: Optional[str],
    timestamp: str,
) -> None:
    details = json.dumps(
        {"old_due": old_due, "performed_on": iso(performed), "next_due": next_due},
        ensure_ascii=False,
    )
    con.execute(
        """INSERT INTO inspection_history(
            vehicle_id, action, inspection_type, performed_on, old_due_date,
            next_due_date, details, created_at
        ) VALUES(?, 'renewed', ?, ?, ?, ?, ?, ?)""",
        (vehicle_id, inspection_type, iso(performed), old_due, next_due, details, timestamp),
    )


@app.post("/api/vehicles/{vehicle_id}/renew")
def renew_vehicle(vehicle_id: int, payload: RenewalRequest):
    with db() as con:
        row = con.execute(
            "SELECT * FROM vehicles WHERE id=?",
            (vehicle_id,),
        ).fetchone()

        if not row:
            raise HTTPException(404, "Fahrzeug nicht gefunden.")

        vehicle = dict(row)

        # Tag, an dem die Änderung/Prüfung im System eingetragen wird.
        performed = payload.performed_on

        first_registration = parse_date(vehicle["first_registration"])

        old_due = {
            category: vehicle[f"{category}_due"]
            for category in (
                "hu",
                "sp",
                "tacho",
                "first_aid",
                "fire_extinguisher",
            )
        }

        # ============================================================
        # HU / TÜV
        #
        # Das vom Frontend übergebene next_hu_due_manual ist bereits
        # die NÄCHSTE FÄLLIGKEIT.
        #
        # Beispiel:
        # 09.2027 -> 2027-09-30
        # ============================================================
        if payload.action in ("hu", "hu_sp"):
            if not payload.next_hu_due_manual:
                raise HTTPException(
                    400,
                    "Bitte das nächste HU-/TÜV-Fälligkeitsdatum eintragen.",
                )

            vehicle["hu_last"] = iso(performed)
            vehicle["hu_due"] = iso(payload.next_hu_due_manual)
            vehicle["hu_due_manual"] = 1

        # ============================================================
        # SP
        #
        # Auch hier ist next_sp_due_manual direkt die NÄCHSTE
        # FÄLLIGKEIT.
        #
        # Beispiel:
        # 09.2027 -> 2027-09-30
        # ============================================================
        if payload.action in ("sp", "hu_sp"):
            if payload.next_sp_due_manual:
                vehicle["sp_due"] = iso(payload.next_sp_due_manual)
                vehicle["sp_due_manual"] = 1
            else:
                vehicle["sp_due_manual"] = 0

            vehicle["sp_last"] = iso(performed)

        # ============================================================
        # TACHO
        #
        # Hier wird bewusst anders gearbeitet:
        #
        # Eingabe:
        # 02.10.2026
        #
        # Speicherung:
        # tacho_last = 02.10.2026
        # tacho_due  = 02.10.2028
        # ============================================================
        if payload.action == "tacho":
            vehicle["tacho_last"] = iso(performed)
            vehicle["tacho_due"] = iso(calculate_tacho_due(performed))
            vehicle["tacho_due_manual"] = 0

        # ============================================================
        # SP automatisch berechnen
        #
        # NUR wenn keine manuelle SP-Fälligkeit übergeben wurde.
        # ============================================================
        if payload.action in ("hu", "sp", "hu_sp") and not vehicle["sp_due_manual"]:

            if first_registration:
                vehicle["sp_due"] = iso(
                    calculate_sp_due(
                        first_registration,
                        parse_date(vehicle["hu_last"]),
                        parse_date(vehicle["sp_last"]),
                    )
                )

            elif payload.action in ("sp", "hu_sp"):
                raise HTTPException(
                    400,
                    "Bitte das nächste SP-Datum eintragen, da keine Erstzulassung hinterlegt ist.",
                )

        timestamp = now_iso()

        con.execute(
            """UPDATE vehicles SET
                tacho_last=?,
                tacho_due=?,
                hu_last=?,
                hu_due=?,
                sp_last=?,
                sp_due=?,
                updated_at=?,
                tacho_due_manual=?,
                hu_due_manual=?,
                sp_due_manual=?,
                calculation_mode=?
                WHERE id=?""",
            (
                vehicle["tacho_last"],
                vehicle["tacho_due"],
                vehicle["hu_last"],
                vehicle["hu_due"],
                vehicle["sp_last"],
                vehicle["sp_due"],
                timestamp,
                vehicle["tacho_due_manual"],
                vehicle["hu_due_manual"],
                vehicle["sp_due_manual"],
                "manual"
                if any(
                    (
                        vehicle["tacho_due_manual"],
                        vehicle["hu_due_manual"],
                        vehicle["sp_due_manual"],
                    )
                )
                else "auto",
                vehicle_id,
            ),
        )

        categories = {
            "hu": ("hu",),
            "sp": ("sp",),
            "hu_sp": ("hu", "sp"),
            "tacho": ("tacho",),
        }[payload.action]

        for category in categories:
            _history_row(
                con,
                vehicle_id,
                category,
                performed,
                old_due[category],
                vehicle[f"{category}_due"],
                timestamp,
            )

        updated = con.execute(
            "SELECT * FROM vehicles WHERE id=?",
            (vehicle_id,),
        ).fetchone()

    return vehicle_to_dict(updated)


@app.get("/api/vehicles/{vehicle_id}/history")
def vehicle_history(vehicle_id: int):
    with db() as con:
        if not con.execute("SELECT 1 FROM vehicles WHERE id=?", (vehicle_id,)).fetchone():
            raise HTTPException(404, "Fahrzeug nicht gefunden.")
        rows = con.execute(
            "SELECT * FROM inspection_history WHERE vehicle_id=? ORDER BY created_at DESC, id DESC",
            (vehicle_id,),
        ).fetchall()
    return [dict(row) for row in rows]


@app.get("/api/history")
def all_history():
    with db() as con:
        rows = con.execute(
            """SELECT h.*, v.plate FROM inspection_history h
               JOIN vehicles v ON v.id=h.vehicle_id ORDER BY h.created_at DESC, h.id DESC"""
        ).fetchall()
    return [dict(row) for row in rows]


@app.get("/api/push/public-key")
def push_public_key():
    return {"publicKey": vapid_public_key_b64()}


@app.get("/api/push/subscriptions")
def push_subscriptions():
    with db() as con:
        rows = con.execute(
            """SELECT id, endpoint, device_name, user_agent, created_at, last_success_at,
                      reminder_thresholds, overdue_daily
               FROM push_subscriptions ORDER BY created_at DESC"""
        ).fetchall()
    return [
        {
            "id": row["id"],
            "device_name": row["device_name"],
            "user_agent": row["user_agent"],
            "created_at": row["created_at"],
            "last_success_at": row["last_success_at"],
            "endpoint_hash": hashlib.sha256(row["endpoint"].encode()).hexdigest()[:12],
            **_subscription_settings(row),
        }
        for row in rows
    ]


@app.post("/api/push/subscription")
def current_push_subscription(payload: PushEndpoint):
    """Return settings for the calling browser without exposing any endpoint."""
    with db() as con:
        row = con.execute(
            """SELECT id, device_name, created_at, last_success_at,
                      reminder_thresholds, overdue_daily
               FROM push_subscriptions WHERE endpoint=?""",
            (payload.endpoint,),
        ).fetchone()
    if not row:
        raise HTTPException(404, "Dieses Gerät ist noch nicht registriert.")
    return {
        "id": row["id"],
        "device_name": row["device_name"],
        "created_at": row["created_at"],
        "last_success_at": row["last_success_at"],
        **_subscription_settings(row),
    }


@app.post("/api/push/subscribe", status_code=201)
def push_subscribe(payload: PushSubscriptionPayload, request: Request):
    raw = {"endpoint": payload.endpoint, "expirationTime": payload.expirationTime, "keys": payload.keys.model_dump()}
    timestamp = now_iso()
    user_agent = request.headers.get("user-agent", "")[:500]
    device_name = payload.device_name.strip()[:100]
    reminder_thresholds = json.dumps(payload.reminder_thresholds)
    with db() as con:
        con.execute(
            """INSERT INTO push_subscriptions(
                endpoint, subscription_json, p256dh, auth, device_name, user_agent, created_at,
                reminder_thresholds, overdue_daily
            ) VALUES(?,?,?,?,?,?,?,?,?)
            ON CONFLICT(endpoint) DO UPDATE SET
                subscription_json=excluded.subscription_json, p256dh=excluded.p256dh,
                auth=excluded.auth, device_name=excluded.device_name, user_agent=excluded.user_agent,
                reminder_thresholds=excluded.reminder_thresholds,
                overdue_daily=excluded.overdue_daily""",
            (
                payload.endpoint, json.dumps(raw), payload.keys.p256dh, payload.keys.auth,
                device_name, user_agent, timestamp, reminder_thresholds, int(payload.overdue_daily),
            ),
        )
    return {
        "ok": True,
        "device_name": device_name,
        "reminder_thresholds": payload.reminder_thresholds,
        "overdue_daily": payload.overdue_daily,
    }


@app.post("/api/push/unsubscribe", status_code=204)
def push_unsubscribe(payload: PushEndpoint):
    with db() as con:
        con.execute("DELETE FROM push_subscriptions WHERE endpoint=?", (payload.endpoint,))
    return None


@app.delete("/api/push/subscriptions/{subscription_id}", status_code=204)
def delete_subscription(subscription_id: int):
    with db() as con:
        cur = con.execute("DELETE FROM push_subscriptions WHERE id=?", (subscription_id,))
        if cur.rowcount == 0:
            raise HTTPException(404, "Gerät nicht gefunden.")
    return None


@app.post("/api/push/test")
def push_test(payload: Optional[PushEndpoint] = None):
    ensure_vapid_key()
    with db() as con:
        subscriptions = (
            con.execute("SELECT * FROM push_subscriptions WHERE endpoint=?", (payload.endpoint,)).fetchall()
            if payload
            else con.execute("SELECT * FROM push_subscriptions").fetchall()
        )
        if not subscriptions:
            raise HTTPException(400, "Für dieses Gerät ist keine Push-Subscription registriert.")

        sent = 0
        for sub in subscriptions:
            try:
                _send_webpush(
                    json.loads(sub["subscription_json"]),
                    json.dumps(
                        {
                            "title": "Fuhrpark – Testbenachrichtigung",
                            "body": "Browser-Benachrichtigungen funktionieren auf diesem Gerät.",
                            "url": "/?view=notifications",
                            "tag": f"fleet-test-{sub['id']}",
                        },
                        ensure_ascii=False,
                    ),
                )
                con.execute("UPDATE push_subscriptions SET last_success_at=? WHERE id=?", (now_iso(), sub["id"]))
                sent += 1
            except WebPushException as exc:
                status_code = getattr(getattr(exc, "response", None), "status_code", None)
                if status_code in (404, 410):
                    con.execute("DELETE FROM push_subscriptions WHERE id=?", (sub["id"],))
        con.commit()
    if not sent:
        raise HTTPException(502, "Testbenachrichtigung konnte nicht zugestellt werden.")
    return {"sent": sent}
