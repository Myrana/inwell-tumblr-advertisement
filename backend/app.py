from __future__ import annotations

import json
import os
import subprocess
import tempfile
import uuid
from base64 import b64decode
from datetime import date, datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Protocol
from urllib.parse import urlparse

import psycopg
from PIL import Image, ImageEnhance, ImageOps
from psycopg.rows import dict_row


POST_TYPES = {"text", "photo", "video"}
QUEUE_STATUSES = {"queued", "scheduled", "running", "posted", "needs-review", "failed"}
LOG_LEVELS = {"info", "warning", "error"}
DEFAULT_TIMEZONE = "America/New_York"
DEFAULT_PGHOST = "192.168.1.3"
DEFAULT_PGDATABASE = "inwell_tumblr_advertisement"
DEFAULT_PGUSER = "postgres"
CURRENT_SCHEMA_VERSION = "0002_queue_logs"
REPO_ROOT = Path(__file__).resolve().parent.parent
RUNNER_PLAN_PATH = REPO_ROOT / "tumblr-runner-plan.json"
RUNNER_PROCESS: subprocess.Popen[Any] | None = None
RUNNER_LAST_COMMAND: list[str] = []
TAG_WORDS = {
    "advertisement",
    "animated",
    "animal",
    "app",
    "based",
    "boards",
    "celeb",
    "character",
    "city",
    "fantasy",
    "futuristic",
    "genre",
    "harry",
    "historical",
    "invisionfree",
    "jcink",
    "multi",
    "other",
    "potter",
    "premium",
    "profile",
    "public",
    "real",
    "request",
    "resource",
    "rpg",
    "school",
    "scifi",
    "semi",
    "shipper",
    "short",
    "site",
    "staff",
    "supernatural",
    "zifboards",
}
KNOWN_TAGS = [
    "invisionfree/zifboards site",
    "jcink site",
    "premium jcink",
    "site buzz",
    "advertisement",
    "character request",
    "staff request",
    "semi-private site",
    "public site",
    "short app",
    "shipper app",
    "profile app",
    "band celeb rpg",
    "city town rpg",
    "historical rpg",
    "school rpg",
    "other real life rpg",
    "futuristic postapoc rpg",
    "harry potter rpg",
    "supernatural rpg",
    "other fantasy rpg",
    "other scifi rpg",
    "based on rpg",
    "multi genre rpg",
    "animal rpg",
    "animated rpg",
    "resource site",
    "6 months",
    "1 year",
    "3 years",
]

SEED_TEMPLATES = [
    {
        "id": "template-plot-forward",
        "name": "Plot-forward forum ad",
        "forum_url": "https://example-jcink-forum.test",
        "tags": ["#jcink", "#jcink forum", "#forum rp", "#site advertisement"],
        "content": (
            "A character-driven Jcink forum with active plotting, seasonal events, "
            "and a welcoming staff team. New members can jump into open threads, "
            "browse wanted ads, and build long-form stories at their own pace."
        ),
    },
    {
        "id": "template-open-canons",
        "name": "Open canons and wanted ads",
        "forum_url": "https://wanted-ads.example.test",
        "tags": ["#jcink", "#forum roleplay", "#site advertisement"],
        "content": (
            "Open canons, wanted connections, and new-member prompts are ready "
            "for players who want an easy entry point. Browse the latest openings "
            "and bring a fresh character into the story."
        ),
    },
]


class CursorLike(Protocol):
    def fetchone(self) -> Any: ...

    def fetchall(self) -> list[Any]: ...


class ConnectionLike(Protocol):
    def execute(self, query: str, params: tuple[Any, ...] | None = None) -> CursorLike: ...


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def database_settings() -> dict[str, Any]:
    return {
        "host": os.environ.get("PGHOST", DEFAULT_PGHOST),
        "port": int(os.environ.get("PGPORT", "5432")),
        "dbname": os.environ.get("PGDATABASE", DEFAULT_PGDATABASE),
        "user": os.environ.get("PGUSER", DEFAULT_PGUSER),
        "password": os.environ.get("PGPASSWORD", ""),
        "connect_timeout": int(os.environ.get("PGCONNECT_TIMEOUT", "5")),
    }


def connect() -> psycopg.Connection[Any]:
    conninfo = os.environ.get("DATABASE_URL")
    if conninfo:
        connection = psycopg.connect(conninfo, row_factory=dict_row)
    else:
        settings = {key: value for key, value in database_settings().items() if value != ""}
        connection = psycopg.connect(row_factory=dict_row, **settings)

    initialize(connection)
    return connection


def initialize(connection: ConnectionLike) -> None:
    ensure_schema_version_table(connection)
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS advertisements (
            id TEXT PRIMARY KEY,
            post_type TEXT NOT NULL DEFAULT 'photo',
            title TEXT NOT NULL DEFAULT '',
            content TEXT NOT NULL DEFAULT '',
            destination_blog TEXT NOT NULL DEFAULT '',
            forum_url TEXT NOT NULL DEFAULT '',
            tags JSONB NOT NULL DEFAULT '[]'::jsonb,
            image_caption TEXT NOT NULL DEFAULT '',
            image_name TEXT NOT NULL DEFAULT '',
            image_data_url TEXT NOT NULL DEFAULT '',
            video_url TEXT NOT NULL DEFAULT '',
            video_name TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'draft',
            created_at TIMESTAMPTZ NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS templates (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            content TEXT NOT NULL DEFAULT '',
            forum_url TEXT NOT NULL DEFAULT '',
            tags JSONB NOT NULL DEFAULT '[]'::jsonb,
            created_at TIMESTAMPTZ NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS submission_queue (
            id TEXT PRIMARY KEY,
            ad_id TEXT NOT NULL,
            target_id TEXT NOT NULL,
            target_name TEXT NOT NULL DEFAULT '',
            submit_url TEXT NOT NULL,
            post_type TEXT NOT NULL DEFAULT 'photo',
            status TEXT NOT NULL DEFAULT 'queued',
            scheduled_for TIMESTAMPTZ,
            timezone TEXT NOT NULL DEFAULT 'America/New_York',
            notes TEXT NOT NULL DEFAULT '',
            runner_payload TEXT NOT NULL DEFAULT '',
            created_at TIMESTAMPTZ NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL,
            last_run_at TIMESTAMPTZ,
            posted_at TIMESTAMPTZ,
            failed_at TIMESTAMPTZ
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS runner_logs (
            id TEXT PRIMARY KEY,
            queue_item_id TEXT NOT NULL,
            level TEXT NOT NULL DEFAULT 'info',
            message TEXT NOT NULL,
            details JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL
        )
        """
    )
    seed_templates(connection)
    record_schema_version(connection, CURRENT_SCHEMA_VERSION)


def ensure_schema_version_table(connection: ConnectionLike) -> None:
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version TEXT PRIMARY KEY,
            applied_at TIMESTAMPTZ NOT NULL
        )
        """
    )


def record_schema_version(connection: ConnectionLike, version: str) -> None:
    connection.execute(
        """
        INSERT INTO schema_migrations (version, applied_at)
        VALUES (%s, %s)
        ON CONFLICT(version) DO NOTHING
        """,
        (version, utc_now()),
    )


def seed_templates(connection: ConnectionLike) -> None:
    now = utc_now()
    for template in SEED_TEMPLATES:
        connection.execute(
            """
            INSERT INTO templates (
                id, name, content, forum_url, tags, created_at, updated_at
            )
            VALUES (%s, %s, %s, %s, %s::jsonb, %s, %s)
            ON CONFLICT(id) DO NOTHING
            """,
            (
                template["id"],
                template["name"],
                template["content"],
                template["forum_url"],
                json.dumps(template["tags"]),
                now,
                now,
            ),
        )


def parse_tags(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(tag) for tag in value]
    if isinstance(value, str):
        try:
            loaded = json.loads(value)
        except json.JSONDecodeError:
            return []
        return [str(tag) for tag in loaded] if isinstance(loaded, list) else []
    return []


def normalize_datetime(value: Any) -> Any:
    if isinstance(value, datetime | date):
        return value.isoformat()
    return value


def parse_optional_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value
    if not value:
        return None
    if isinstance(value, str):
        raw = value.strip()
        if not raw:
            return None
        try:
            return datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            return None
    return None


def row_to_dict(row: Any) -> dict[str, Any]:
    return {key: normalize_datetime(value) for key, value in dict(row).items()}


def row_to_advertisement(row: Any) -> dict[str, Any]:
    data = row_to_dict(row)
    data["tags"] = parse_tags(data["tags"])
    if data.get("post_type") not in POST_TYPES:
        data["post_type"] = "photo"
    return data


def row_to_template(row: Any) -> dict[str, Any]:
    data = row_to_dict(row)
    data["tags"] = parse_tags(data["tags"])
    return data


def row_to_queue_item(row: Any) -> dict[str, Any]:
    data = row_to_dict(row)
    if data.get("post_type") not in POST_TYPES:
        data["post_type"] = "photo"
    if data.get("status") not in QUEUE_STATUSES:
        data["status"] = "queued"
    return data


def row_to_runner_log(row: Any) -> dict[str, Any]:
    data = row_to_dict(row)
    details = data.get("details")
    if isinstance(details, str):
        try:
            data["details"] = json.loads(details)
        except json.JSONDecodeError:
            data["details"] = {}
    elif not isinstance(details, dict):
        data["details"] = {}
    if data.get("level") not in LOG_LEVELS:
        data["level"] = "info"
    return data


def advertisement_from_payload(payload: dict[str, Any]) -> dict[str, Any]:
    post_type = str(payload.get("post_type", "photo")).strip().lower()
    if post_type not in POST_TYPES:
        post_type = "photo"

    return {
        "id": str(payload.get("id", "")).strip(),
        "post_type": post_type,
        "title": str(payload.get("title", "")).strip(),
        "content": str(payload.get("content", "")),
        "destination_blog": str(payload.get("destination_blog", "")).strip(),
        "forum_url": str(payload.get("forum_url", "")).strip(),
        "tags": parse_tags(payload.get("tags", [])),
        "image_caption": str(payload.get("image_caption", "")),
        "image_name": str(payload.get("image_name", "")),
        "image_data_url": str(payload.get("image_data_url", "")),
        "video_url": str(payload.get("video_url", "")),
        "video_name": str(payload.get("video_name", "")),
        "status": str(payload.get("status", "draft")).strip() or "draft",
    }


def template_from_payload(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(payload.get("id", "")).strip(),
        "name": str(payload.get("name", "")).strip(),
        "content": str(payload.get("content", "")),
        "forum_url": str(payload.get("forum_url", "")).strip(),
        "tags": parse_tags(payload.get("tags", [])),
    }


def normalize_queue_status(value: Any) -> str:
    status = str(value or "queued").strip().lower()
    if status == "submitting":
        return "running"
    if status == "submitted":
        return "posted"
    if status == "manual-action":
        return "needs-review"
    return status if status in QUEUE_STATUSES else "queued"


def payload_field(payload: dict[str, Any], snake_name: str, camel_name: str, default: Any = "") -> Any:
    if snake_name in payload:
        return payload.get(snake_name, default)
    return payload.get(camel_name, default)


def queue_item_from_payload(payload: dict[str, Any]) -> dict[str, Any]:
    post_type = str(payload_field(payload, "post_type", "postType", "photo")).strip().lower()
    if post_type not in POST_TYPES:
        post_type = "photo"

    return {
        "id": str(payload.get("id", "")).strip(),
        "ad_id": str(payload_field(payload, "ad_id", "adId")).strip(),
        "target_id": str(payload_field(payload, "target_id", "targetId")).strip(),
        "target_name": str(payload_field(payload, "target_name", "targetName")).strip(),
        "submit_url": str(payload_field(payload, "submit_url", "submitUrl")).strip(),
        "post_type": post_type,
        "status": normalize_queue_status(payload.get("status")),
        "scheduled_for": parse_optional_datetime(payload_field(payload, "scheduled_for", "scheduledFor")),
        "timezone": str(payload_field(payload, "timezone", "timezone", DEFAULT_TIMEZONE) or DEFAULT_TIMEZONE).strip() or DEFAULT_TIMEZONE,
        "notes": str(payload.get("notes", "")),
        "runner_payload": str(payload_field(payload, "runner_payload", "runnerPayload")),
        "created_at": parse_optional_datetime(payload_field(payload, "created_at", "createdAt")),
        "updated_at": parse_optional_datetime(payload_field(payload, "updated_at", "updatedAt")),
        "last_run_at": parse_optional_datetime(payload_field(payload, "last_run_at", "lastRunAt")),
        "posted_at": parse_optional_datetime(payload_field(payload, "posted_at", "postedAt")),
        "failed_at": parse_optional_datetime(payload_field(payload, "failed_at", "failedAt")),
    }


def upsert_advertisement(connection: ConnectionLike, payload: dict[str, Any]) -> dict[str, Any]:
    advertisement = advertisement_from_payload(payload)
    if not advertisement["id"]:
        raise ValueError("id is required")

    now = utc_now()
    existing = connection.execute(
        "SELECT created_at FROM advertisements WHERE id = %s", (advertisement["id"],)
    ).fetchone()
    created_at = existing["created_at"] if existing else now

    connection.execute(
        """
        INSERT INTO advertisements (
            id, post_type, title, content, destination_blog, forum_url, tags,
            image_caption, image_name, image_data_url, video_url, video_name,
            status, created_at, updated_at
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT(id) DO UPDATE SET
            post_type = excluded.post_type,
            title = excluded.title,
            content = excluded.content,
            destination_blog = excluded.destination_blog,
            forum_url = excluded.forum_url,
            tags = excluded.tags,
            image_caption = excluded.image_caption,
            image_name = excluded.image_name,
            image_data_url = excluded.image_data_url,
            video_url = excluded.video_url,
            video_name = excluded.video_name,
            status = excluded.status,
            updated_at = excluded.updated_at
        """,
        (
            advertisement["id"],
            advertisement["post_type"],
            advertisement["title"],
            advertisement["content"],
            advertisement["destination_blog"],
            advertisement["forum_url"],
            json.dumps(advertisement["tags"]),
            advertisement["image_caption"],
            advertisement["image_name"],
            advertisement["image_data_url"],
            advertisement["video_url"],
            advertisement["video_name"],
            advertisement["status"],
            created_at,
            now,
        ),
    )

    row = connection.execute(
        "SELECT * FROM advertisements WHERE id = %s", (advertisement["id"],)
    ).fetchone()
    return row_to_advertisement(row)


def upsert_template(connection: ConnectionLike, payload: dict[str, Any]) -> dict[str, Any]:
    template = template_from_payload(payload)
    if not template["id"]:
        raise ValueError("id is required")
    if not template["name"]:
        raise ValueError("name is required")

    now = utc_now()
    existing = connection.execute("SELECT created_at FROM templates WHERE id = %s", (template["id"],)).fetchone()
    created_at = existing["created_at"] if existing else now

    connection.execute(
        """
        INSERT INTO templates (id, name, content, forum_url, tags, created_at, updated_at)
        VALUES (%s, %s, %s, %s, %s::jsonb, %s, %s)
        ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            content = excluded.content,
            forum_url = excluded.forum_url,
            tags = excluded.tags,
            updated_at = excluded.updated_at
        """,
        (
            template["id"],
            template["name"],
            template["content"],
            template["forum_url"],
            json.dumps(template["tags"]),
            created_at,
            now,
        ),
    )

    row = connection.execute("SELECT * FROM templates WHERE id = %s", (template["id"],)).fetchone()
    return row_to_template(row)


def upsert_queue_item(connection: ConnectionLike, payload: dict[str, Any]) -> dict[str, Any]:
    queue_item = queue_item_from_payload(payload)
    if not queue_item["id"]:
        raise ValueError("id is required")
    if not queue_item["ad_id"]:
        raise ValueError("ad_id is required")
    if not queue_item["target_id"]:
        raise ValueError("target_id is required")
    if not queue_item["submit_url"]:
        raise ValueError("submit_url is required")

    now = utc_now()
    existing = connection.execute("SELECT created_at FROM submission_queue WHERE id = %s", (queue_item["id"],)).fetchone()
    created_at = queue_item["created_at"] or (existing["created_at"] if existing else now)
    updated_at = queue_item["updated_at"] or now

    connection.execute(
        """
        INSERT INTO submission_queue (
            id, ad_id, target_id, target_name, submit_url, post_type, status,
            scheduled_for, timezone, notes, runner_payload, created_at, updated_at,
            last_run_at, posted_at, failed_at
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT(id) DO UPDATE SET
            ad_id = excluded.ad_id,
            target_id = excluded.target_id,
            target_name = excluded.target_name,
            submit_url = excluded.submit_url,
            post_type = excluded.post_type,
            status = excluded.status,
            scheduled_for = excluded.scheduled_for,
            timezone = excluded.timezone,
            notes = excluded.notes,
            runner_payload = excluded.runner_payload,
            updated_at = excluded.updated_at,
            last_run_at = excluded.last_run_at,
            posted_at = excluded.posted_at,
            failed_at = excluded.failed_at
        """,
        (
            queue_item["id"],
            queue_item["ad_id"],
            queue_item["target_id"],
            queue_item["target_name"],
            queue_item["submit_url"],
            queue_item["post_type"],
            queue_item["status"],
            queue_item["scheduled_for"],
            queue_item["timezone"],
            queue_item["notes"],
            queue_item["runner_payload"],
            created_at,
            updated_at,
            queue_item["last_run_at"],
            queue_item["posted_at"],
            queue_item["failed_at"],
        ),
    )

    row = connection.execute("SELECT * FROM submission_queue WHERE id = %s", (queue_item["id"],)).fetchone()
    return row_to_queue_item(row)


def runner_log_from_payload(payload: dict[str, Any]) -> dict[str, Any]:
    level = str(payload.get("level", "info")).strip().lower()
    if level not in LOG_LEVELS:
        level = "info"

    details = payload.get("details", {})
    if not isinstance(details, dict):
        details = {"value": str(details)}

    return {
        "id": str(payload.get("id") or f"log-{uuid.uuid4().hex}").strip(),
        "queue_item_id": str(payload.get("queue_item_id", "")).strip(),
        "level": level,
        "message": str(payload.get("message", "")).strip(),
        "details": details,
        "created_at": parse_optional_datetime(payload.get("created_at")) or utc_now(),
        "status": normalize_queue_status(payload.get("status")) if payload.get("status") else "",
    }


def record_runner_log(connection: ConnectionLike, payload: dict[str, Any]) -> dict[str, Any]:
    log = runner_log_from_payload(payload)
    if not log["queue_item_id"]:
        raise ValueError("queue_item_id is required")
    if not log["message"]:
        raise ValueError("message is required")

    connection.execute(
        """
        INSERT INTO runner_logs (id, queue_item_id, level, message, details, created_at)
        VALUES (%s, %s, %s, %s, %s::jsonb, %s)
        """,
        (
            log["id"],
            log["queue_item_id"],
            log["level"],
            log["message"],
            json.dumps(log["details"]),
            log["created_at"],
        ),
    )

    if log["status"]:
        touch_queue_item_status(connection, log["queue_item_id"], log["status"], log["message"], log["created_at"])

    row = connection.execute("SELECT * FROM runner_logs WHERE id = %s", (log["id"],)).fetchone()
    return row_to_runner_log(row)


def touch_queue_item_status(
    connection: ConnectionLike,
    queue_item_id: str,
    status: str,
    notes: str,
    timestamp: datetime,
) -> None:
    existing = connection.execute("SELECT * FROM submission_queue WHERE id = %s", (queue_item_id,)).fetchone()
    if not existing:
        return

    data = row_to_queue_item(existing)
    data["status"] = status
    data["notes"] = notes
    data["updated_at"] = timestamp
    if status == "running":
        data["last_run_at"] = timestamp
    elif status == "posted":
        data["posted_at"] = timestamp
    elif status == "failed":
        data["failed_at"] = timestamp
    upsert_queue_item(connection, data)


def mark_runner_items_started(items: list[Any]) -> None:
    try:
        with connect() as connection:
            now = utc_now()
            for item in items:
                if not isinstance(item, dict) or not item.get("id"):
                    continue
                persisted = upsert_queue_item(
                    connection,
                    {
                        **item,
                        "status": "running",
                        "last_run_at": now.isoformat(),
                        "notes": "Runner launched this queue item.",
                    },
                )
                record_runner_log(
                    connection,
                    {
                        "queue_item_id": persisted["id"],
                        "level": "info",
                        "status": "running",
                        "message": "Runner launched this queue item.",
                        "created_at": now.isoformat(),
                    },
                )
    except Exception as error:
        print(f"[api] Could not persist runner start state: {error}")


def runner_status() -> dict[str, Any]:
    running = RUNNER_PROCESS is not None and RUNNER_PROCESS.poll() is None
    return {
        "running": running,
        "pid": RUNNER_PROCESS.pid if RUNNER_PROCESS is not None else None,
        "plan_path": str(RUNNER_PLAN_PATH),
        "command": RUNNER_LAST_COMMAND,
    }


def start_runner(payload: dict[str, Any]) -> dict[str, Any]:
    global RUNNER_LAST_COMMAND, RUNNER_PROCESS

    items = payload.get("items")
    if not isinstance(items, list) or not items:
        raise ValueError("items are required")

    if RUNNER_PROCESS is not None and RUNNER_PROCESS.poll() is None:
        raise ValueError("runner is already running")

    mark_runner_items_started(items)

    plan = {
        "version": 1,
        "workflow": "tumblr-submission-queue",
        "generatedAt": utc_now().isoformat(),
        "items": items,
    }
    RUNNER_PLAN_PATH.write_text(json.dumps(plan, indent=2), encoding="utf-8")

    slow_mo = int(payload.get("slowMo") or 500)
    slow_mo = max(0, min(slow_mo, 5000))
    media_dir = str(payload.get("mediaDir") or "").strip()
    submit = bool(payload.get("submit"))

    runner_args = [
        "npm.cmd" if os.name == "nt" else "npm",
        "run",
        "tumblr:runner",
        "--",
        "--plan",
        str(RUNNER_PLAN_PATH),
        "--login-first",
        "--slow-mo",
        str(slow_mo),
        "--api-base",
        "http://127.0.0.1:8021/api",
    ]
    if media_dir:
        runner_args.extend(["--media-dir", media_dir])
    if submit:
        runner_args.append("--submit")

    if os.name == "nt":
        command = [
            "powershell.exe",
            "-NoExit",
            "-Command",
            f"Set-Location -LiteralPath {powershell_quote(str(REPO_ROOT))}; & "
            + " ".join(powershell_quote(arg) for arg in runner_args),
        ]
        creationflags = subprocess.CREATE_NEW_CONSOLE
    else:
        command = runner_args
        creationflags = 0

    RUNNER_LAST_COMMAND = runner_args
    RUNNER_PROCESS = subprocess.Popen(command, cwd=REPO_ROOT, creationflags=creationflags)
    return runner_status()


def ocr_tags_from_payload(payload: dict[str, Any]) -> dict[str, Any]:
    data_url = str(payload.get("imageDataUrl") or "")
    image_bytes, suffix = image_bytes_from_data_url(data_url)
    temp_path = Path(tempfile.gettempdir()) / f"inwell-tag-ocr-{uuid.uuid4().hex}{suffix}"

    try:
        temp_path.write_bytes(image_bytes)
        preprocess_ocr_image(temp_path)
        completed = subprocess.run(
            ["tesseract", str(temp_path), "stdout", "--psm", "6"],
            capture_output=True,
            check=False,
            text=True,
            timeout=30,
        )
    except FileNotFoundError:
        return {
            "available": False,
            "text": "",
            "tags": [],
            "message": "Tesseract OCR is not installed or not on PATH. Paste the tags manually or install Tesseract.",
        }
    except (subprocess.SubprocessError, OSError) as error:
        return {
            "available": True,
            "text": "",
            "tags": [],
            "message": f"OCR failed: {error}",
        }
    finally:
        temp_path.unlink(missing_ok=True)

    text = completed.stdout.strip()
    tags = parse_ocr_tags(text)
    message = "Tags detected from screenshot." if tags else "OCR ran but did not find tag text. Paste the tags manually."
    if completed.returncode != 0 and not text:
        message = completed.stderr.strip() or message

    return {
        "available": True,
        "text": text,
        "tags": tags,
        "message": message,
    }


def image_bytes_from_data_url(data_url: str) -> tuple[bytes, str]:
    if not data_url.startswith("data:image/") or "," not in data_url:
        raise ValueError("imageDataUrl must be an image data URL")

    header, encoded = data_url.split(",", 1)
    suffix = ".png"
    if "image/jpeg" in header:
        suffix = ".jpg"
    elif "image/webp" in header:
        suffix = ".webp"
    elif "image/gif" in header:
        suffix = ".gif"

    if ";base64" not in header:
        raise ValueError("imageDataUrl must be base64 encoded")

    return b64decode(encoded), suffix


def preprocess_ocr_image(path: Path) -> None:
    image = Image.open(path).convert("L")
    image = ImageOps.autocontrast(image)
    image = ImageEnhance.Contrast(image).enhance(3)
    image = image.resize((image.width * 4, image.height * 4), Image.Resampling.LANCZOS)
    image = image.point(lambda pixel: 0 if pixel < 180 else 255)
    image.save(path)


def parse_ocr_tags(text: str) -> list[str]:
    normalized = " ".join(text.lower().replace("\r", "\n").replace("|", "\n").split())
    known_matches = [tag for tag in KNOWN_TAGS if ocr_contains_tag(normalized, tag)]
    if known_matches:
        return known_matches

    cleaned = text.replace("\r", "\n").replace("|", "\n")
    cleaned = cleaned.replace("()", "\n").replace("( )", "\n").replace("c)", "\n").replace("o)", "\n")
    candidates: list[str] = []
    for raw_line in cleaned.splitlines():
        line = " ".join(raw_line.replace("[", " ").replace("]", " ").split()).lower()
        line = line.strip(":-*•()co ")
        if line.startswith(("x ", "v ")):
            line = line[2:].strip()
        if not line or line == "tags":
            continue
        if any(word in line for word in TAG_WORDS):
            candidates.append(line)
    return list(dict.fromkeys(candidates))


def ocr_contains_tag(text: str, tag: str) -> bool:
    compact_text = text.replace(" ", "")
    compact_tag = tag.replace(" ", "")
    if compact_tag in compact_text:
        return True

    if tag == "invisionfree/zifboards site":
        return "invisionfree/zif" in text or "zifooards" in text
    if tag == "other scifi rpg":
        return "other scfi" in text or "other scifi" in text
    return False


def powershell_quote(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


class Handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_common_headers()
        self.end_headers()

    def do_GET(self) -> None:
        collection, item_id = self.route()
        if collection == "runner/status" and item_id is None:
            self.respond({"runner": runner_status()})
            return

        with connect() as connection:
            if collection == "advertisements" and item_id is None:
                rows = connection.execute("SELECT * FROM advertisements ORDER BY updated_at DESC").fetchall()
                self.respond({"advertisements": [row_to_advertisement(row) for row in rows]})
                return

            if collection == "templates" and item_id is None:
                rows = connection.execute("SELECT * FROM templates ORDER BY name").fetchall()
                self.respond({"templates": [row_to_template(row) for row in rows]})
                return

            if collection == "queue" and item_id is None:
                rows = connection.execute("SELECT * FROM submission_queue ORDER BY updated_at DESC").fetchall()
                self.respond({"queue": [row_to_queue_item(row) for row in rows]})
                return

            if collection == "runner/logs" and item_id is None:
                rows = connection.execute("SELECT * FROM runner_logs ORDER BY created_at DESC LIMIT 100").fetchall()
                self.respond({"logs": [row_to_runner_log(row) for row in rows]})
                return

        self.send_error(HTTPStatus.NOT_FOUND)

    def do_POST(self) -> None:
        collection, item_id = self.route()
        if item_id is not None:
            self.send_error(HTTPStatus.NOT_FOUND)
            return

        if collection == "runner/start":
            try:
                self.respond({"runner": start_runner(self.read_json())}, HTTPStatus.CREATED)
            except ValueError as error:
                self.respond({"error": str(error)}, HTTPStatus.BAD_REQUEST)
            return

        if collection == "tags/ocr":
            try:
                self.respond({"ocr": ocr_tags_from_payload(self.read_json())})
            except ValueError as error:
                self.respond({"error": str(error)}, HTTPStatus.BAD_REQUEST)
            return

        if collection == "runner/logs":
            try:
                with connect() as connection:
                    self.respond({"log": record_runner_log(connection, self.read_json())}, HTTPStatus.CREATED)
            except ValueError as error:
                self.respond({"error": str(error)}, HTTPStatus.BAD_REQUEST)
            return

        self.save_resource(collection, self.read_json(), HTTPStatus.CREATED)

    def do_PUT(self) -> None:
        collection, item_id = self.route()
        if item_id is None:
            self.send_error(HTTPStatus.NOT_FOUND)
            return

        payload = self.read_json()
        payload["id"] = item_id
        self.save_resource(collection, payload)

    def do_DELETE(self) -> None:
        collection, item_id = self.route()
        if item_id is None or collection not in {"advertisements", "templates", "queue"}:
            self.send_error(HTTPStatus.NOT_FOUND)
            return

        table = {"advertisements": "advertisements", "templates": "templates", "queue": "submission_queue"}[collection]
        with connect() as connection:
            connection.execute(f"DELETE FROM {table} WHERE id = %s", (item_id,))

        self.respond({"deleted": item_id})

    def save_resource(
        self,
        collection: str | None,
        payload: dict[str, Any],
        status: HTTPStatus = HTTPStatus.OK,
    ) -> None:
        try:
            with connect() as connection:
                if collection == "advertisements":
                    item = upsert_advertisement(connection, payload)
                    self.respond({"advertisement": item}, status)
                    return

                if collection == "templates":
                    item = upsert_template(connection, payload)
                    self.respond({"template": item}, status)
                    return

                if collection == "queue":
                    item = upsert_queue_item(connection, payload)
                    self.respond({"queue_item": item}, status)
                    return
        except ValueError as error:
            self.respond({"error": str(error)}, HTTPStatus.BAD_REQUEST)
            return

        self.send_error(HTTPStatus.NOT_FOUND)

    def route(self) -> tuple[str | None, str | None]:
        parts = [part for part in urlparse(self.path).path.split("/") if part]
        if len(parts) == 2 and parts[0] == "api":
            return parts[1], None
        if len(parts) == 3 and parts[0] == "api" and parts[1] == "runner":
            return f"{parts[1]}/{parts[2]}", None
        if len(parts) == 3 and parts[0] == "api" and parts[1] == "tags":
            return f"{parts[1]}/{parts[2]}", None
        if len(parts) == 3 and parts[0] == "api":
            return parts[1], parts[2]
        return None, None

    def read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("content-length", "0"))
        raw = self.rfile.read(length) if length else b"{}"
        return json.loads(raw.decode("utf-8"))

    def respond(self, payload: dict[str, Any], status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_common_headers()
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_common_headers(self) -> None:
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")


def run(port: int = 8021) -> None:
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"Inwell API listening on http://127.0.0.1:{port}")
    server.serve_forever()


if __name__ == "__main__":
    run()
