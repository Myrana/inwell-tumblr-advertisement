from __future__ import annotations

import json
import mimetypes
import os
import re
import subprocess
import uuid
from datetime import date, datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Protocol
from urllib.parse import urlparse

import psycopg
from psycopg.rows import dict_row


POST_TYPES = {"text", "photo", "video"}
QUEUE_STATUSES = {"queued", "scheduled", "running", "submitted", "posted", "needs-review", "failed"}
LOG_LEVELS = {"info", "warning", "error"}
DEFAULT_TIMEZONE = "America/New_York"
DEFAULT_PGHOST = "192.168.1.3"
DEFAULT_PGDATABASE = "inwell_tumblr_advertisement"
DEFAULT_PGUSER = "postgres"
CURRENT_SCHEMA_VERSION = "0007_tumblr_account_sessions"
REPO_ROOT = Path(__file__).resolve().parent.parent
DIST_ROOT = REPO_ROOT / "dist"
RUNNER_PLAN_PATH = REPO_ROOT / "tumblr-runner-plan.json"
RUNNER_PROCESS: subprocess.Popen[Any] | None = None
RUNNER_LAST_COMMAND: list[str] = []
RUNNER_LAST_RUN_ID = ""

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


def initialize_database() -> None:
    with connect():
        pass


def initialize_database_for_startup() -> None:
    try:
        initialize_database()
    except psycopg.Error as error:
        print(f"Inwell database initialization skipped: {error}", flush=True)


def initialize(connection: ConnectionLike) -> None:
    ensure_schema_version_table(connection)
    has_schema_history = bool(connection.execute("SELECT * FROM schema_migrations ORDER BY version").fetchall())
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS advertisements (
            id TEXT PRIMARY KEY,
            post_type TEXT NOT NULL DEFAULT 'photo',
            title TEXT NOT NULL DEFAULT '',
            content TEXT NOT NULL DEFAULT '',
            destination_blog TEXT NOT NULL DEFAULT '',
            forum_url TEXT NOT NULL DEFAULT '',
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
            tumblr_account_id TEXT NOT NULL DEFAULT '',
            queue_name TEXT NOT NULL DEFAULT 'Default queue',
            submit_url TEXT NOT NULL,
            post_type TEXT NOT NULL DEFAULT 'photo',
            status TEXT NOT NULL DEFAULT 'queued',
            scheduled_for TIMESTAMPTZ,
            timezone TEXT NOT NULL DEFAULT 'America/New_York',
            notes TEXT NOT NULL DEFAULT '',
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
        CREATE TABLE IF NOT EXISTS submission_queue_runner_payload_values (
            queue_item_id TEXT NOT NULL,
            payload_path TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            value_type TEXT NOT NULL,
            value_text TEXT NOT NULL DEFAULT '',
            created_at TIMESTAMPTZ NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL,
            PRIMARY KEY (queue_item_id, payload_path)
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS tumblr_accounts (
            id TEXT PRIMARY KEY,
            display_name TEXT NOT NULL DEFAULT '',
            blog_name TEXT NOT NULL DEFAULT '',
            user_data_dir TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'needs-login',
            last_checked_at TIMESTAMPTZ,
            last_login_at TIMESTAMPTZ,
            notes TEXT NOT NULL DEFAULT '',
            created_at TIMESTAMPTZ NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS runner_logs (
            id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL DEFAULT '',
            queue_item_id TEXT NOT NULL,
            target_name TEXT NOT NULL DEFAULT '',
            level TEXT NOT NULL DEFAULT 'info',
            message TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS advertisement_tags (
            advertisement_id TEXT NOT NULL,
            tag TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMPTZ NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL,
            PRIMARY KEY (advertisement_id, tag)
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS template_tags (
            template_id TEXT NOT NULL,
            tag TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMPTZ NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL,
            PRIMARY KEY (template_id, tag)
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS runner_log_details (
            log_id TEXT NOT NULL,
            detail_key TEXT NOT NULL,
            detail_value TEXT NOT NULL DEFAULT '',
            created_at TIMESTAMPTZ NOT NULL,
            PRIMARY KEY (log_id, detail_key)
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS submit_targets (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL DEFAULT '',
            submit_url TEXT NOT NULL DEFAULT '',
            forum_url TEXT NOT NULL DEFAULT '',
            created_at TIMESTAMPTZ NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS queue_definitions (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL DEFAULT '',
            created_at TIMESTAMPTZ NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS tag_profile_tags (
            blog_id TEXT NOT NULL,
            tag TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMPTZ NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL,
            PRIMARY KEY (blog_id, tag)
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS runner_settings (
            id TEXT PRIMARY KEY,
            media_dir TEXT NOT NULL DEFAULT '',
            slow_mo INTEGER NOT NULL DEFAULT 500,
            submit BOOLEAN NOT NULL DEFAULT FALSE,
            tumblr_account_id TEXT NOT NULL DEFAULT '',
            updated_at TIMESTAMPTZ NOT NULL
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS queue_schedule_settings (
            id TEXT PRIMARY KEY,
            enabled BOOLEAN NOT NULL DEFAULT FALSE,
            daily_time TEXT NOT NULL DEFAULT '09:00',
            timezone TEXT NOT NULL DEFAULT 'America/New_York',
            updated_at TIMESTAMPTZ NOT NULL
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS settings_audit_events (
            id TEXT PRIMARY KEY,
            area TEXT NOT NULL,
            action TEXT NOT NULL,
            entity_id TEXT NOT NULL DEFAULT '',
            field_name TEXT NOT NULL DEFAULT '',
            old_value TEXT NOT NULL DEFAULT '',
            new_value TEXT NOT NULL DEFAULT '',
            created_at TIMESTAMPTZ NOT NULL
        )
        """
    )
    connection.execute("ALTER TABLE runner_logs ADD COLUMN IF NOT EXISTS run_id TEXT NOT NULL DEFAULT ''")
    connection.execute("ALTER TABLE runner_logs ADD COLUMN IF NOT EXISTS target_name TEXT NOT NULL DEFAULT ''")
    connection.execute("ALTER TABLE submission_queue ADD COLUMN IF NOT EXISTS queue_name TEXT NOT NULL DEFAULT 'Default queue'")
    connection.execute("ALTER TABLE submission_queue ADD COLUMN IF NOT EXISTS tumblr_account_id TEXT NOT NULL DEFAULT ''")
    connection.execute("ALTER TABLE runner_settings ADD COLUMN IF NOT EXISTS tumblr_account_id TEXT NOT NULL DEFAULT ''")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_advertisement_tags_tag ON advertisement_tags(tag)")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_template_tags_tag ON template_tags(tag)")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_runner_log_details_key ON runner_log_details(detail_key)")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_submission_queue_payload_path ON submission_queue_runner_payload_values(payload_path)")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_submission_queue_tumblr_account ON submission_queue(tumblr_account_id)")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_tumblr_accounts_status ON tumblr_accounts(status)")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_submit_targets_name ON submit_targets(name)")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_queue_definitions_name ON queue_definitions(name)")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_tag_profile_tags_blog_order ON tag_profile_tags(blog_id, sort_order)")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_settings_audit_area_created ON settings_audit_events(area, created_at)")
    migrate_legacy_tag_blobs(connection)
    migrate_legacy_queue_runner_payloads(connection)
    migrate_legacy_runner_log_details(connection)
    if legacy_app_settings_exists(connection):
        migrate_legacy_app_settings(connection)
        connection.execute("DROP TABLE IF EXISTS app_settings")
    connection.execute("ALTER TABLE advertisements DROP COLUMN IF EXISTS tags")
    connection.execute("ALTER TABLE templates DROP COLUMN IF EXISTS tags")
    connection.execute("ALTER TABLE submission_queue DROP COLUMN IF EXISTS runner_payload")
    connection.execute("ALTER TABLE runner_logs DROP COLUMN IF EXISTS details")
    if not has_schema_history:
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


def replace_ordered_values(
    connection: ConnectionLike,
    table: str,
    id_column: str,
    id_value: str,
    value_column: str,
    values: list[str],
) -> None:
    now = utc_now()
    connection.execute(f"DELETE FROM {table} WHERE {id_column} = %s", (id_value,))
    for index, value in enumerate(values):
        connection.execute(
            f"""
            INSERT INTO {table} ({id_column}, {value_column}, sort_order, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT({id_column}, {value_column}) DO UPDATE SET
                sort_order = excluded.sort_order,
                updated_at = excluded.updated_at
            """,
            (id_value, value, index, now, now),
        )


def load_ordered_values(
    connection: ConnectionLike,
    table: str,
    id_column: str,
    id_value: str,
    value_column: str,
) -> list[str]:
    rows = connection.execute(
        f"SELECT {value_column} FROM {table} WHERE {id_column} = %s ORDER BY sort_order, {value_column}",
        (id_value,),
    ).fetchall()
    return [str(row[value_column]) for row in rows]


def replace_runner_log_details(connection: ConnectionLike, log_id: str, details: dict[str, Any]) -> None:
    now = utc_now()
    connection.execute("DELETE FROM runner_log_details WHERE log_id = %s", (log_id,))
    for key, value in sorted(details.items()):
        connection.execute(
            """
            INSERT INTO runner_log_details (log_id, detail_key, detail_value, created_at)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT(log_id, detail_key) DO UPDATE SET
                detail_value = excluded.detail_value
            """,
            (log_id, str(key), "" if value is None else str(value), now),
        )


def load_runner_log_details(connection: ConnectionLike, log_id: str) -> dict[str, Any]:
    rows = connection.execute(
        "SELECT detail_key, detail_value FROM runner_log_details WHERE log_id = %s ORDER BY detail_key",
        (log_id,),
    ).fetchall()
    return {str(row["detail_key"]): parse_detail_value(str(row["detail_value"])) for row in rows}


def parse_detail_value(value: str) -> Any:
    lowered = value.lower()
    if lowered == "true":
        return True
    if lowered == "false":
        return False
    if lowered == "none" or lowered == "null":
        return None
    try:
        return int(value)
    except ValueError:
        return value


def parse_runner_payload(value: Any) -> Any:
    if isinstance(value, dict | list):
        return value
    if not isinstance(value, str) or not value.strip():
        return {}
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return {"raw": value}
    return parsed if isinstance(parsed, dict | list) else {"value": parsed}


def escape_payload_path_segment(value: str) -> str:
    return value.replace("~", "~0").replace("/", "~1")


def unescape_payload_path_segment(value: str) -> str:
    return value.replace("~1", "/").replace("~0", "~")


def flatten_payload_values(value: Any) -> list[tuple[str, int, str, str]]:
    rows: list[tuple[str, int, str, str]] = []

    def append_leaf(path: str, raw_value: Any) -> None:
        if isinstance(raw_value, dict):
            value_type = "object"
            value_text = ""
        elif isinstance(raw_value, list):
            value_type = "array"
            value_text = ""
        elif raw_value is None:
            value_type = "null"
            value_text = ""
        elif isinstance(raw_value, bool):
            value_type = "boolean"
            value_text = "true" if raw_value else "false"
        elif isinstance(raw_value, int | float):
            value_type = "number"
            value_text = str(raw_value)
        else:
            value_type = "string"
            value_text = str(raw_value)
        rows.append((path or "/", len(rows), value_type, value_text))

    def walk(path: str, current: Any) -> None:
        if isinstance(current, dict):
            if not current:
                append_leaf(path, current)
            for key, child in current.items():
                walk(f"{path}/{escape_payload_path_segment(str(key))}", child)
            return
        if isinstance(current, list):
            if not current:
                append_leaf(path, current)
            for index, child in enumerate(current):
                walk(f"{path}/{index}", child)
            return
        append_leaf(path, current)

    walk("", value)
    return rows


def typed_payload_value(value_type: str, value_text: str) -> Any:
    if value_type == "null":
        return None
    if value_type == "boolean":
        return value_text.lower() == "true"
    if value_type == "number":
        try:
            return int(value_text)
        except ValueError:
            try:
                return float(value_text)
            except ValueError:
                return value_text
    if value_type == "object":
        return {}
    if value_type == "array":
        return []
    return value_text


def payload_path_segments(path: str) -> list[str]:
    if not path or path == "/":
        return []
    return [unescape_payload_path_segment(segment) for segment in path.strip("/").split("/")]


def assign_payload_value(root: Any, segments: list[str], value: Any) -> Any:
    if not segments:
        return value
    if root is None:
        root = [] if segments[0].isdigit() else {}

    current = root
    for index, segment in enumerate(segments):
        last = index == len(segments) - 1
        next_is_list = not last and segments[index + 1].isdigit()

        if isinstance(current, list):
            position = int(segment) if segment.isdigit() else len(current)
            while len(current) <= position:
                current.append(None)
            if last:
                current[position] = value
                continue
            if current[position] is None:
                current[position] = [] if next_is_list else {}
            current = current[position]
            continue

        if last:
            current[segment] = value
            continue
        if segment not in current or current[segment] is None:
            current[segment] = [] if next_is_list else {}
        current = current[segment]

    return root


def replace_runner_payload_values(connection: ConnectionLike, queue_item_id: str, runner_payload: Any) -> None:
    now = utc_now()
    connection.execute("DELETE FROM submission_queue_runner_payload_values WHERE queue_item_id = %s", (queue_item_id,))
    for path, sort_order, value_type, value_text in flatten_payload_values(parse_runner_payload(runner_payload)):
        connection.execute(
            """
            INSERT INTO submission_queue_runner_payload_values (
                queue_item_id, payload_path, sort_order, value_type, value_text, created_at, updated_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT(queue_item_id, payload_path) DO UPDATE SET
                sort_order = excluded.sort_order,
                value_type = excluded.value_type,
                value_text = excluded.value_text,
                updated_at = excluded.updated_at
            """,
            (queue_item_id, path, sort_order, value_type, value_text, now, now),
        )


def load_runner_payload(connection: ConnectionLike, queue_item_id: str) -> str:
    rows = connection.execute(
        """
        SELECT payload_path, value_type, value_text
        FROM submission_queue_runner_payload_values
        WHERE queue_item_id = %s
        ORDER BY sort_order, payload_path
        """,
        (queue_item_id,),
    ).fetchall()
    if not rows:
        return ""

    root: Any = None
    for row in rows:
        root = assign_payload_value(
            root,
            payload_path_segments(str(row["payload_path"])),
            typed_payload_value(str(row["value_type"]), str(row["value_text"])),
        )
    return json.dumps(root if root is not None else {}, indent=2)


def migrate_legacy_tag_blobs(connection: ConnectionLike) -> None:
    rows = connection.execute("SELECT * FROM advertisements ORDER BY updated_at DESC").fetchall()
    for row in rows:
        data = row_to_dict(row)
        if "tags" in data:
            replace_ordered_values(connection, "advertisement_tags", "advertisement_id", str(data["id"]), "tag", parse_tags(data["tags"]))

    rows = connection.execute("SELECT * FROM templates ORDER BY name").fetchall()
    for row in rows:
        data = row_to_dict(row)
        if "tags" in data:
            replace_ordered_values(connection, "template_tags", "template_id", str(data["id"]), "tag", parse_tags(data["tags"]))


def migrate_legacy_queue_runner_payloads(connection: ConnectionLike) -> None:
    rows = connection.execute("SELECT * FROM submission_queue ORDER BY updated_at DESC").fetchall()
    for row in rows:
        data = row_to_dict(row)
        runner_payload = data.get("runner_payload")
        if runner_payload:
            replace_runner_payload_values(connection, str(data["id"]), runner_payload)


def legacy_app_settings_exists(connection: ConnectionLike) -> bool:
    row = connection.execute(
        """
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = current_schema()
          AND table_name = %s
        """,
        ("app_settings",),
    ).fetchone()
    return bool(row)


def migrate_legacy_runner_log_details(connection: ConnectionLike) -> None:
    rows = connection.execute("SELECT * FROM runner_logs ORDER BY created_at DESC LIMIT 150").fetchall()
    for row in rows:
        data = row_to_dict(row)
        details = data.get("details")
        if isinstance(details, str):
            try:
                loaded = json.loads(details)
            except json.JSONDecodeError:
                loaded = {}
            details = loaded
        if isinstance(details, dict):
            replace_runner_log_details(connection, str(data["id"]), details)


def migrate_legacy_app_settings(connection: ConnectionLike) -> None:
    row = connection.execute("SELECT * FROM app_settings WHERE key = %s", ("app",)).fetchone()
    if not row:
        return

    value = row_to_dict(row).get("value") or {}
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            value = {}
    if isinstance(value, dict):
        upsert_app_settings(connection, value, audit=False)


def seed_templates(connection: ConnectionLike) -> None:
    now = utc_now()
    for template in SEED_TEMPLATES:
        connection.execute(
            """
            INSERT INTO templates (
                id, name, content, forum_url, created_at, updated_at
            )
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT(id) DO NOTHING
            """,
            (
                template["id"],
                template["name"],
                template["content"],
                template["forum_url"],
                now,
                now,
            ),
        )
        replace_ordered_values(connection, "template_tags", "template_id", template["id"], "tag", parse_tags(template["tags"]))


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


def normalize_tag_profile_values(value: Any) -> list[str]:
    tags = parse_tags(value)
    normalized: list[str] = []
    seen: set[str] = set()
    for tag in tags:
        candidate = " ".join(str(tag).strip().lower().split())
        if candidate and candidate not in seen:
            seen.add(candidate)
            normalized.append(candidate)
    return normalized


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


def row_to_advertisement(row: Any, tags: list[str] | None = None) -> dict[str, Any]:
    data = row_to_dict(row)
    data["tags"] = tags if tags is not None else parse_tags(data.get("tags", []))
    if data.get("post_type") not in POST_TYPES:
        data["post_type"] = "photo"
    return data


def row_to_template(row: Any, tags: list[str] | None = None) -> dict[str, Any]:
    data = row_to_dict(row)
    data["tags"] = tags if tags is not None else parse_tags(data.get("tags", []))
    return data


def row_to_queue_item(row: Any, runner_payload: str | None = None) -> dict[str, Any]:
    data = row_to_dict(row)
    if runner_payload is not None:
        data["runner_payload"] = runner_payload
    elif "runner_payload" not in data:
        data["runner_payload"] = ""
    data["tumblr_account_id"] = str(data.get("tumblr_account_id") or "")
    data["queue_name"] = str(data.get("queue_name") or "Default queue").strip() or "Default queue"
    if data.get("post_type") not in POST_TYPES:
        data["post_type"] = "photo"
    if data.get("status") not in QUEUE_STATUSES:
        data["status"] = "queued"
    return data


def row_to_tumblr_account(row: Any) -> dict[str, Any]:
    data = row_to_dict(row)
    data["display_name"] = str(data.get("display_name") or "")
    data["blog_name"] = str(data.get("blog_name") or "")
    data["user_data_dir"] = str(data.get("user_data_dir") or "")
    data["status"] = normalize_tumblr_account_status(data.get("status"))
    data["notes"] = str(data.get("notes") or "")
    return data


def row_to_runner_log(row: Any, details: dict[str, Any] | None = None) -> dict[str, Any]:
    data = row_to_dict(row)
    data["run_id"] = str(data.get("run_id") or "")
    data["target_name"] = str(data.get("target_name") or "")
    data["details"] = details if details is not None else {}
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
        return "submitted"
    if status == "manual-action":
        return "needs-review"
    return status if status in QUEUE_STATUSES else "queued"


def normalize_tumblr_account_status(value: Any) -> str:
    status = str(value or "").strip().lower()
    return status if status in {"connected", "needs-login", "expired", "checking"} else "needs-login"


def default_tumblr_user_data_dir(account_id: str) -> str:
    safe_id = re.sub(r"[^a-zA-Z0-9_.-]+", "-", account_id).strip("-") or "default"
    return str(REPO_ROOT / ".tumblr-sessions" / safe_id)


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
        "tumblr_account_id": str(payload_field(payload, "tumblr_account_id", "tumblrAccountId")).strip(),
        "queue_name": str(payload_field(payload, "queue_name", "queueName", "Default queue") or "Default queue").strip() or "Default queue",
        "submit_url": str(payload_field(payload, "submit_url", "submitUrl")).strip(),
        "post_type": post_type,
        "status": normalize_queue_status(payload.get("status")),
        "scheduled_for": parse_optional_datetime(payload_field(payload, "scheduled_for", "scheduledFor")),
        "timezone": str(payload_field(payload, "timezone", "timezone", DEFAULT_TIMEZONE) or DEFAULT_TIMEZONE).strip() or DEFAULT_TIMEZONE,
        "notes": str(payload.get("notes", "")),
        "runner_payload": payload_field(payload, "runner_payload", "runnerPayload"),
        "created_at": parse_optional_datetime(payload_field(payload, "created_at", "createdAt")),
        "updated_at": parse_optional_datetime(payload_field(payload, "updated_at", "updatedAt")),
        "last_run_at": parse_optional_datetime(payload_field(payload, "last_run_at", "lastRunAt")),
        "posted_at": parse_optional_datetime(payload_field(payload, "posted_at", "postedAt")),
        "failed_at": parse_optional_datetime(payload_field(payload, "failed_at", "failedAt")),
    }


def normalize_submit_target(value: Any) -> dict[str, str] | None:
    if not isinstance(value, dict):
        return None

    target_id = str(value.get("id", "")).strip().lower()
    submit_url = str(value.get("submitUrl") or value.get("submit_url") or "").strip()
    name = str(value.get("name") or target_id).strip() or target_id
    forum_url = str(value.get("forumUrl") or value.get("forum_url") or "").strip()

    if not target_id or not submit_url:
        return None

    return {
        "id": target_id,
        "name": name,
        "submitUrl": submit_url,
        "forumUrl": forum_url,
    }


def normalize_queue_definition(value: Any) -> dict[str, str] | None:
    if not isinstance(value, dict):
        return None

    name = str(value.get("name") or "").strip() or "Default queue"
    setting_id = str(value.get("id") or "").strip() or "-".join(name.lower().split()) or "default-queue"
    return {"id": setting_id, "name": name}


def normalize_runner_settings(value: Any) -> dict[str, Any]:
    data = value if isinstance(value, dict) else {}
    try:
        slow_mo = int(data.get("slowMo", 500))
    except (TypeError, ValueError):
        slow_mo = 500

    return {
        "mediaDir": str(data.get("mediaDir") or ""),
        "slowMo": max(0, min(slow_mo, 5000)),
        "submit": bool(data.get("submit")),
        "tumblrAccountId": str(data.get("tumblrAccountId") or data.get("tumblr_account_id") or "").strip(),
    }


def normalize_queue_schedule_settings(value: Any) -> dict[str, Any]:
    data = value if isinstance(value, dict) else {}
    daily_time = str(data.get("dailyTime") or "09:00")
    if not re.match(r"^\d{2}:\d{2}$", daily_time):
        daily_time = "09:00"

    return {
        "enabled": bool(data.get("enabled")),
        "dailyTime": daily_time,
        "timezone": DEFAULT_TIMEZONE,
    }


def app_settings_from_payload(payload: dict[str, Any]) -> dict[str, Any]:
    submit_targets = payload.get("submitTargets", [])
    queue_definitions = payload.get("queueDefinitions", [])
    tag_profiles = payload.get("tagProfiles", {})
    submit_target_items = submit_targets if isinstance(submit_targets, list) else []
    queue_definition_items = queue_definitions if isinstance(queue_definitions, list) else []

    normalized_profiles: dict[str, list[str]] = {}
    if isinstance(tag_profiles, dict):
        for blog, tags in tag_profiles.items():
            if isinstance(tags, list):
                normalized_profiles[str(blog)] = normalize_tag_profile_values(tags)

    return {
        "submitTargets": [
            target
            for target in (normalize_submit_target(item) for item in submit_target_items)
            if target
        ],
        "queueDefinitions": [
            queue
            for queue in (normalize_queue_definition(item) for item in queue_definition_items)
            if queue
        ],
        "tagProfiles": normalized_profiles,
        "runnerSettings": normalize_runner_settings(payload.get("runnerSettings")),
        "queueScheduleSettings": normalize_queue_schedule_settings(payload.get("queueScheduleSettings")),
    }


def tumblr_account_from_payload(payload: dict[str, Any]) -> dict[str, Any]:
    account_id = str(payload.get("id") or "").strip().lower()
    display_name = str(payload.get("displayName") or payload.get("display_name") or "").strip()
    blog_name = str(payload.get("blogName") or payload.get("blog_name") or "").strip().lower()
    if not account_id:
        account_id = re.sub(r"[^a-z0-9]+", "-", (blog_name or display_name).lower()).strip("-")
    if not account_id:
        raise ValueError("id or blogName is required")
    if not display_name:
        display_name = blog_name or account_id

    user_data_dir = str(payload.get("userDataDir") or payload.get("user_data_dir") or "").strip()
    if not user_data_dir:
        user_data_dir = default_tumblr_user_data_dir(account_id)

    return {
        "id": account_id,
        "display_name": display_name,
        "blog_name": blog_name,
        "user_data_dir": user_data_dir,
        "status": normalize_tumblr_account_status(payload.get("status")),
        "last_checked_at": parse_optional_datetime(payload.get("lastCheckedAt") or payload.get("last_checked_at")),
        "last_login_at": parse_optional_datetime(payload.get("lastLoginAt") or payload.get("last_login_at")),
        "notes": str(payload.get("notes") or ""),
    }


def get_app_settings(connection: ConnectionLike) -> dict[str, Any]:
    submit_targets = [
        {
            "id": row["id"],
            "name": row["name"],
            "submitUrl": row["submit_url"],
            "forumUrl": row["forum_url"],
        }
        for row in connection.execute("SELECT * FROM submit_targets ORDER BY name").fetchall()
    ]
    queue_definitions = [
        {"id": row["id"], "name": row["name"]}
        for row in connection.execute("SELECT * FROM queue_definitions ORDER BY name").fetchall()
    ]
    tag_profiles: dict[str, list[str]] = {}
    for row in connection.execute("SELECT * FROM tag_profile_tags ORDER BY blog_id, sort_order, tag").fetchall():
        tag_profiles.setdefault(str(row["blog_id"]), []).append(str(row["tag"]))

    runner_row = connection.execute("SELECT * FROM runner_settings WHERE id = %s", ("default",)).fetchone()
    schedule_row = connection.execute("SELECT * FROM queue_schedule_settings WHERE id = %s", ("default",)).fetchone()

    return {
        "submitTargets": submit_targets,
        "queueDefinitions": queue_definitions,
        "tagProfiles": tag_profiles,
        "runnerSettings": normalize_runner_settings(
            {
                "mediaDir": runner_row["media_dir"] if runner_row else "",
                "slowMo": runner_row["slow_mo"] if runner_row else 500,
                "submit": runner_row["submit"] if runner_row else False,
                "tumblrAccountId": runner_row["tumblr_account_id"] if runner_row else "",
            }
        ),
        "queueScheduleSettings": normalize_queue_schedule_settings(
            {
                "enabled": schedule_row["enabled"] if schedule_row else False,
                "dailyTime": schedule_row["daily_time"] if schedule_row else "09:00",
                "timezone": schedule_row["timezone"] if schedule_row else DEFAULT_TIMEZONE,
            }
        ),
    }


def record_settings_audit(
    connection: ConnectionLike,
    area: str,
    action: str,
    entity_id: str = "",
    field_name: str = "",
    old_value: Any = "",
    new_value: Any = "",
) -> None:
    connection.execute(
        """
        INSERT INTO settings_audit_events (
            id, area, action, entity_id, field_name, old_value, new_value, created_at
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (
            f"audit-{uuid.uuid4().hex}",
            area,
            action,
            entity_id,
            field_name,
            "" if old_value is None else str(old_value),
            "" if new_value is None else str(new_value),
            utc_now(),
        ),
    )


def settings_statistics(connection: ConnectionLike) -> dict[str, int]:
    counts: dict[str, int] = {}
    queries = {
        "submitTargets": "SELECT * FROM submit_targets ORDER BY name",
        "queueDefinitions": "SELECT * FROM queue_definitions ORDER BY name",
        "tagProfileTags": "SELECT * FROM tag_profile_tags ORDER BY blog_id, sort_order, tag",
        "queueRunnerPayloadValues": "SELECT * FROM submission_queue_runner_payload_values ORDER BY queue_item_id, sort_order, payload_path",
        "runnerSettings": "SELECT * FROM runner_settings WHERE id = %s",
        "queueScheduleSettings": "SELECT * FROM queue_schedule_settings WHERE id = %s",
        "settingsAuditEvents": "SELECT * FROM settings_audit_events ORDER BY created_at DESC",
    }
    for key, query in queries.items():
        params = ("default",) if key in {"runnerSettings", "queueScheduleSettings"} else ()
        counts[key] = len(connection.execute(query, params).fetchall())
    return counts


def upsert_app_settings(connection: ConnectionLike, payload: dict[str, Any], audit: bool = True) -> dict[str, Any]:
    settings = app_settings_from_payload(payload)
    now = utc_now()
    connection.execute("DELETE FROM submit_targets")
    for target in settings["submitTargets"]:
        connection.execute(
            """
            INSERT INTO submit_targets (id, name, submit_url, forum_url, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                submit_url = excluded.submit_url,
                forum_url = excluded.forum_url,
                updated_at = excluded.updated_at
            """,
            (target["id"], target["name"], target["submitUrl"], target["forumUrl"], now, now),
        )
        if audit:
            for field_name in ("name", "submitUrl", "forumUrl"):
                record_settings_audit(connection, "submit_targets", "upsert", target["id"], field_name, "", target[field_name])

    connection.execute("DELETE FROM queue_definitions")
    for queue in settings["queueDefinitions"]:
        connection.execute(
            """
            INSERT INTO queue_definitions (id, name, created_at, updated_at)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                updated_at = excluded.updated_at
            """,
            (queue["id"], queue["name"], now, now),
        )
        if audit:
            record_settings_audit(connection, "queue_definitions", "upsert", queue["id"], "name", "", queue["name"])

    connection.execute("DELETE FROM tag_profile_tags")
    for blog_id, tags in settings["tagProfiles"].items():
        replace_ordered_values(connection, "tag_profile_tags", "blog_id", str(blog_id), "tag", tags)
        if audit:
            for tag in tags:
                record_settings_audit(connection, "tag_profile_tags", "upsert", str(blog_id), "tag", "", tag)

    runner_settings = settings["runnerSettings"]
    connection.execute(
        """
        INSERT INTO runner_settings (id, media_dir, slow_mo, submit, tumblr_account_id, updated_at)
        VALUES (%s, %s, %s, %s, %s, %s)
        ON CONFLICT(id) DO UPDATE SET
            media_dir = excluded.media_dir,
            slow_mo = excluded.slow_mo,
            submit = excluded.submit,
            tumblr_account_id = excluded.tumblr_account_id,
            updated_at = excluded.updated_at
        """,
        (
            "default",
            runner_settings["mediaDir"],
            runner_settings["slowMo"],
            runner_settings["submit"],
            runner_settings["tumblrAccountId"],
            now,
        ),
    )
    if audit:
        for field_name in ("mediaDir", "slowMo", "submit", "tumblrAccountId"):
            record_settings_audit(connection, "runner_settings", "upsert", "default", field_name, "", runner_settings[field_name])

    schedule_settings = settings["queueScheduleSettings"]
    connection.execute(
        """
        INSERT INTO queue_schedule_settings (id, enabled, daily_time, timezone, updated_at)
        VALUES (%s, %s, %s, %s, %s)
        ON CONFLICT(id) DO UPDATE SET
            enabled = excluded.enabled,
            daily_time = excluded.daily_time,
            timezone = excluded.timezone,
            updated_at = excluded.updated_at
        """,
        (
            "default",
            schedule_settings["enabled"],
            schedule_settings["dailyTime"],
            schedule_settings["timezone"],
            now,
        ),
    )
    if audit:
        for field_name in ("enabled", "dailyTime", "timezone"):
            record_settings_audit(connection, "queue_schedule_settings", "upsert", "default", field_name, "", schedule_settings[field_name])
    return get_app_settings(connection)


def upsert_tumblr_account(connection: ConnectionLike, payload: dict[str, Any]) -> dict[str, Any]:
    account = tumblr_account_from_payload(payload)
    now = utc_now()
    existing = connection.execute("SELECT created_at FROM tumblr_accounts WHERE id = %s", (account["id"],)).fetchone()
    created_at = existing["created_at"] if existing else now

    connection.execute(
        """
        INSERT INTO tumblr_accounts (
            id, display_name, blog_name, user_data_dir, status, last_checked_at,
            last_login_at, notes, created_at, updated_at
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT(id) DO UPDATE SET
            display_name = excluded.display_name,
            blog_name = excluded.blog_name,
            user_data_dir = excluded.user_data_dir,
            status = excluded.status,
            last_checked_at = excluded.last_checked_at,
            last_login_at = excluded.last_login_at,
            notes = excluded.notes,
            updated_at = excluded.updated_at
        """,
        (
            account["id"],
            account["display_name"],
            account["blog_name"],
            account["user_data_dir"],
            account["status"],
            account["last_checked_at"],
            account["last_login_at"],
            account["notes"],
            created_at,
            now,
        ),
    )
    row = connection.execute("SELECT * FROM tumblr_accounts WHERE id = %s", (account["id"],)).fetchone()
    return row_to_tumblr_account(row)


def update_tumblr_account_status(
    connection: ConnectionLike,
    account_id: str,
    status: str,
    notes: str,
    checked_at: datetime | None = None,
    login_at: datetime | None = None,
) -> dict[str, Any] | None:
    existing = connection.execute("SELECT * FROM tumblr_accounts WHERE id = %s", (account_id,)).fetchone()
    if not existing:
        return None

    data = row_to_tumblr_account(existing)
    timestamp = checked_at or utc_now()
    data.update(
        {
            "status": normalize_tumblr_account_status(status),
            "notes": notes,
            "last_checked_at": timestamp,
            "last_login_at": login_at or parse_optional_datetime(data.get("last_login_at")),
        }
    )
    return upsert_tumblr_account(connection, data)


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
            id, post_type, title, content, destination_blog, forum_url,
            image_caption, image_name, image_data_url, video_url, video_name,
            status, created_at, updated_at
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT(id) DO UPDATE SET
            post_type = excluded.post_type,
            title = excluded.title,
            content = excluded.content,
            destination_blog = excluded.destination_blog,
            forum_url = excluded.forum_url,
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
    replace_ordered_values(connection, "advertisement_tags", "advertisement_id", advertisement["id"], "tag", advertisement["tags"])

    row = connection.execute(
        "SELECT * FROM advertisements WHERE id = %s", (advertisement["id"],)
    ).fetchone()
    return row_to_advertisement(
        row,
        load_ordered_values(connection, "advertisement_tags", "advertisement_id", advertisement["id"], "tag"),
    )


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
        INSERT INTO templates (id, name, content, forum_url, created_at, updated_at)
        VALUES (%s, %s, %s, %s, %s, %s)
        ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            content = excluded.content,
            forum_url = excluded.forum_url,
            updated_at = excluded.updated_at
        """,
        (
            template["id"],
            template["name"],
            template["content"],
            template["forum_url"],
            created_at,
            now,
        ),
    )
    replace_ordered_values(connection, "template_tags", "template_id", template["id"], "tag", template["tags"])

    row = connection.execute("SELECT * FROM templates WHERE id = %s", (template["id"],)).fetchone()
    return row_to_template(row, load_ordered_values(connection, "template_tags", "template_id", template["id"], "tag"))


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
            id, ad_id, target_id, target_name, tumblr_account_id, queue_name, submit_url, post_type, status,
            scheduled_for, timezone, notes, created_at, updated_at,
            last_run_at, posted_at, failed_at
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT(id) DO UPDATE SET
            ad_id = excluded.ad_id,
            target_id = excluded.target_id,
            target_name = excluded.target_name,
            tumblr_account_id = excluded.tumblr_account_id,
            queue_name = excluded.queue_name,
            submit_url = excluded.submit_url,
            post_type = excluded.post_type,
            status = excluded.status,
            scheduled_for = excluded.scheduled_for,
            timezone = excluded.timezone,
            notes = excluded.notes,
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
            queue_item["tumblr_account_id"],
            queue_item["queue_name"],
            queue_item["submit_url"],
            queue_item["post_type"],
            queue_item["status"],
            queue_item["scheduled_for"],
            queue_item["timezone"],
            queue_item["notes"],
            created_at,
            updated_at,
            queue_item["last_run_at"],
            queue_item["posted_at"],
            queue_item["failed_at"],
        ),
    )
    replace_runner_payload_values(connection, queue_item["id"], queue_item["runner_payload"])

    row = connection.execute("SELECT * FROM submission_queue WHERE id = %s", (queue_item["id"],)).fetchone()
    return row_to_queue_item(row, load_runner_payload(connection, queue_item["id"]))


def runner_log_from_payload(payload: dict[str, Any]) -> dict[str, Any]:
    level = str(payload.get("level", "info")).strip().lower()
    if level not in LOG_LEVELS:
        level = "info"

    details = payload.get("details", {})
    if not isinstance(details, dict):
        details = {"value": str(details)}

    return {
        "id": str(payload.get("id") or f"log-{uuid.uuid4().hex}").strip(),
        "run_id": str(payload.get("run_id", "")).strip(),
        "queue_item_id": str(payload.get("queue_item_id", "")).strip(),
        "target_name": str(payload.get("target_name", "")).strip(),
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
    if not log["run_id"]:
        log["run_id"] = RUNNER_LAST_RUN_ID

    if not log["target_name"]:
        existing = connection.execute("SELECT * FROM submission_queue WHERE id = %s", (log["queue_item_id"],)).fetchone()
        if existing:
            log["target_name"] = str(row_to_queue_item(existing).get("target_name") or "")

    connection.execute(
        """
        INSERT INTO runner_logs (id, run_id, queue_item_id, target_name, level, message, created_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        """,
        (
            log["id"],
            log["run_id"],
            log["queue_item_id"],
            log["target_name"],
            log["level"],
            log["message"],
            log["created_at"],
        ),
    )
    replace_runner_log_details(connection, log["id"], log["details"])

    if log["status"]:
        touch_queue_item_status(connection, log["queue_item_id"], log["status"], log["message"], log["created_at"])

    row = connection.execute("SELECT * FROM runner_logs WHERE id = %s", (log["id"],)).fetchone()
    return row_to_runner_log(row, load_runner_log_details(connection, log["id"]))


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

    data = row_to_queue_item(existing, load_runner_payload(connection, queue_item_id))
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


def runner_status() -> dict[str, Any]:
    running = RUNNER_PROCESS is not None and RUNNER_PROCESS.poll() is None
    return {
        "running": running,
        "pid": RUNNER_PROCESS.pid if RUNNER_PROCESS is not None else None,
        "plan_path": str(RUNNER_PLAN_PATH),
        "command": RUNNER_LAST_COMMAND,
        "run_id": RUNNER_LAST_RUN_ID,
    }


def start_runner(payload: dict[str, Any]) -> dict[str, Any]:
    global RUNNER_LAST_COMMAND, RUNNER_LAST_RUN_ID, RUNNER_PROCESS

    items = payload.get("items")
    if not isinstance(items, list) or not items:
        raise ValueError("items are required")

    if RUNNER_PROCESS is not None and RUNNER_PROCESS.poll() is None:
        raise ValueError("runner is already running")

    run_id = str(payload.get("runId") or f"run-{uuid.uuid4().hex}").strip()

    plan = {
        "version": 1,
        "workflow": "tumblr-submission-queue",
        "runId": run_id,
        "generatedAt": utc_now().isoformat(),
        "items": items,
    }
    RUNNER_PLAN_PATH.write_text(json.dumps(plan, indent=2), encoding="utf-8")

    slow_mo = int(payload.get("slowMo") or 500)
    slow_mo = max(0, min(slow_mo, 5000))
    media_dir = str(payload.get("mediaDir") or "").strip()
    submit = bool(payload.get("submit"))
    user_data_dir = str(payload.get("userDataDir") or "").strip()
    tumblr_account_id = str(payload.get("tumblrAccountId") or "").strip()
    if tumblr_account_id and not user_data_dir:
        with connect() as connection:
            account = connection.execute("SELECT * FROM tumblr_accounts WHERE id = %s", (tumblr_account_id,)).fetchone()
            if account:
                user_data_dir = str(row_to_tumblr_account(account).get("user_data_dir") or "")

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
        os.environ.get("RUNNER_API_BASE_URL", f"http://127.0.0.1:{os.environ.get('PORT', '8021')}/api"),
        "--run-id",
        run_id,
    ]
    if media_dir:
        runner_args.extend(["--media-dir", media_dir])
    if user_data_dir:
        runner_args.extend(["--user-data-dir", user_data_dir])
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
    RUNNER_LAST_RUN_ID = run_id
    RUNNER_PROCESS = subprocess.Popen(command, cwd=REPO_ROOT, creationflags=creationflags)
    return runner_status()


def powershell_quote(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


class Handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_common_headers()
        self.end_headers()

    def do_GET(self) -> None:
        collection, item_id = self.route()
        if collection is None and item_id is None:
            self.serve_static()
            return

        if collection == "runner/status" and item_id is None:
            self.respond({"runner": runner_status()})
            return

        with connect() as connection:
            if collection == "advertisements" and item_id is None:
                rows = connection.execute("SELECT * FROM advertisements ORDER BY updated_at DESC").fetchall()
                self.respond(
                    {
                        "advertisements": [
                            row_to_advertisement(
                                row,
                                load_ordered_values(connection, "advertisement_tags", "advertisement_id", str(row["id"]), "tag"),
                            )
                            for row in rows
                        ]
                    }
                )
                return

            if collection == "templates" and item_id is None:
                rows = connection.execute("SELECT * FROM templates ORDER BY name").fetchall()
                self.respond(
                    {
                        "templates": [
                            row_to_template(
                                row,
                                load_ordered_values(connection, "template_tags", "template_id", str(row["id"]), "tag"),
                            )
                            for row in rows
                        ]
                    }
                )
                return

            if collection == "queue" and item_id is None:
                rows = connection.execute("SELECT * FROM submission_queue ORDER BY updated_at DESC").fetchall()
                self.respond({"queue": [row_to_queue_item(row, load_runner_payload(connection, str(row["id"]))) for row in rows]})
                return

            if collection == "tumblr/accounts" and item_id is None:
                rows = connection.execute("SELECT * FROM tumblr_accounts ORDER BY display_name").fetchall()
                self.respond({"accounts": [row_to_tumblr_account(row) for row in rows]})
                return

            if collection == "runner/logs" and item_id is None:
                rows = connection.execute("SELECT * FROM runner_logs ORDER BY created_at DESC LIMIT 150").fetchall()
                self.respond({"logs": [row_to_runner_log(row, load_runner_log_details(connection, str(row["id"]))) for row in rows]})
                return

            if collection == "settings" and item_id is None:
                self.respond({"settings": get_app_settings(connection)})
                return

            if collection == "settings/stats" and item_id is None:
                self.respond({"stats": settings_statistics(connection)})
                return

            if collection == "settings/audit" and item_id is None:
                rows = connection.execute("SELECT * FROM settings_audit_events ORDER BY created_at DESC LIMIT 150").fetchall()
                self.respond({"audit": [row_to_dict(row) for row in rows]})
                return

        self.send_error(HTTPStatus.NOT_FOUND)

    def serve_static(self) -> None:
        parsed_path = urlparse(self.path).path
        requested_path = parsed_path.lstrip("/") or "index.html"
        candidate = (DIST_ROOT / requested_path).resolve()
        dist_root = DIST_ROOT.resolve()

        try:
            candidate.relative_to(dist_root)
        except ValueError:
            candidate = DIST_ROOT / "index.html"

        if not candidate.is_file():
            candidate = DIST_ROOT / "index.html"

        if not candidate.is_file():
            self.send_error(HTTPStatus.NOT_FOUND)
            return

        body = candidate.read_bytes()
        content_type = mimetypes.guess_type(candidate.name)[0] or "application/octet-stream"
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:
        collection, item_id = self.route()
        if item_id is not None:
            self.send_error(HTTPStatus.NOT_FOUND)
            return

        if collection == "runner/start":
            try:
                payload = self.read_json()
                runner = start_runner(payload)
                with connect() as connection:
                    for item in payload.get("items", []):
                        if not isinstance(item, dict):
                            continue
                        record_runner_log(
                            connection,
                            {
                                "run_id": runner.get("run_id", ""),
                                "queue_item_id": item.get("id", ""),
                                "target_name": payload_field(item, "target_name", "targetName"),
                                "status": "running",
                                "message": "Runner launched this queue item.",
                            },
                        )
                self.respond({"runner": runner}, HTTPStatus.CREATED)
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

        if collection == "tumblr/login":
            try:
                payload = self.read_json()
                account_id = str(payload.get("accountId") or payload.get("account_id") or "").strip()
                if not account_id:
                    raise ValueError("accountId is required")
                with connect() as connection:
                    account = connection.execute("SELECT * FROM tumblr_accounts WHERE id = %s", (account_id,)).fetchone()
                    if not account:
                        raise ValueError("Tumblr account not found")
                    account_data = row_to_tumblr_account(account)
                    update_tumblr_account_status(
                        connection,
                        account_id,
                        "checking",
                        "Login helper launched. Complete Tumblr login in the visible browser.",
                        utc_now(),
                    )
                runner_args = [
                    "npm.cmd" if os.name == "nt" else "npm",
                    "run",
                    "tumblr:login",
                    "--",
                    "--user-data-dir",
                    account_data["user_data_dir"],
                    "--slow-mo",
                    str(int(payload.get("slowMo") or 250)),
                ]
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
                process = subprocess.Popen(command, cwd=REPO_ROOT, creationflags=creationflags)
                self.respond({"login": {"pid": process.pid, "command": runner_args}}, HTTPStatus.CREATED)
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
        if collection == "runner/logs" and item_id is None:
            with connect() as connection:
                connection.execute("DELETE FROM runner_log_details")
                connection.execute("DELETE FROM runner_logs")
            self.respond({"deleted": "runner_logs"})
            return

        if item_id is None or collection not in {"advertisements", "templates", "queue", "settings", "tumblr/accounts"}:
            self.send_error(HTTPStatus.NOT_FOUND)
            return

        if collection == "settings":
            with connect() as connection:
                for table in (
                    "submit_targets",
                    "queue_definitions",
                    "tag_profile_tags",
                    "runner_settings",
                    "queue_schedule_settings",
                ):
                    connection.execute(f"DELETE FROM {table}")
                record_settings_audit(connection, "settings", "delete", item_id)
            self.respond({"deleted": item_id})
            return

        table = {
            "advertisements": "advertisements",
            "templates": "templates",
            "queue": "submission_queue",
            "tumblr/accounts": "tumblr_accounts",
        }[collection]
        with connect() as connection:
            if collection == "advertisements":
                connection.execute("DELETE FROM advertisement_tags WHERE advertisement_id = %s", (item_id,))
            if collection == "templates":
                connection.execute("DELETE FROM template_tags WHERE template_id = %s", (item_id,))
            if collection == "queue":
                connection.execute("DELETE FROM submission_queue_runner_payload_values WHERE queue_item_id = %s", (item_id,))
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

                if collection == "tumblr/accounts":
                    item = upsert_tumblr_account(connection, payload)
                    self.respond({"account": item}, status)
                    return

                if collection == "settings":
                    self.respond({"settings": upsert_app_settings(connection, payload)}, status)
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
        if len(parts) == 3 and parts[0] == "api" and parts[1] == "tumblr" and parts[2] in {"accounts", "login"}:
            return f"{parts[1]}/{parts[2]}", None
        if len(parts) == 4 and parts[0] == "api" and parts[1] == "tumblr" and parts[2] == "accounts":
            return f"{parts[1]}/{parts[2]}", parts[3]
        if len(parts) == 3 and parts[0] == "api" and parts[1] == "settings" and parts[2] == "stats":
            return f"{parts[1]}/{parts[2]}", None
        if len(parts) == 3 and parts[0] == "api" and parts[1] == "settings" and parts[2] == "audit":
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


def run(port: int | None = None, host: str | None = None) -> None:
    port = port or int(os.environ.get("PORT", "8021"))
    host = host or os.environ.get("HOST", "127.0.0.1")
    initialize_database_for_startup()
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"Inwell web service listening on http://{host}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    run()
