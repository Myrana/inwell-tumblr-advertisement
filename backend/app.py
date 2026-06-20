from __future__ import annotations

import base64
import hashlib
import hmac
import json
import mimetypes
import os
import re
import secrets
import socket
import ssl
import subprocess
import struct
import time
import uuid
from datetime import date, datetime, timedelta, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Protocol
from urllib.parse import parse_qs, urlparse
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import psycopg
from psycopg.rows import dict_row


POST_TYPES = {"text", "photo", "video"}
QUEUE_STATUSES = {"queued", "scheduled", "running", "submitted", "posted", "needs-review", "failed"}
LOG_LEVELS = {"info", "warning", "error"}
DEFAULT_TIMEZONE = "America/New_York"
DEFAULT_PGHOST = "192.168.1.3"
DEFAULT_PGDATABASE = "inwell_tumblr_advertisement"
DEFAULT_PGUSER = "postgres"
CURRENT_SCHEMA_VERSION = "0011_browserbase_connect"
SESSION_COOKIE_NAME = "inwell_session"
SESSION_DAYS = 14
AUTH_LOCK_WINDOW_MINUTES = 15
AUTH_LOGIN_EMAIL_FAILURE_LIMIT = 5
AUTH_LOGIN_CLIENT_FAILURE_LIMIT = 25
AUTH_REGISTER_CLIENT_ATTEMPT_LIMIT = 8
REMOTE_BROWSER_PROVIDERS = {"none", "browserbase", "browserless", "custom"}
REMOTE_BROWSER_ACTIVE_PROVIDERS = {"browserbase", "browserless", "custom"}
BROWSERBASE_API_URL = "https://api.browserbase.com/v1"
TUMBLR_LOGIN_URL = "https://www.tumblr.com/login"
TUMBLR_DASHBOARD_URL = "https://www.tumblr.com/dashboard"
REPO_ROOT = Path(__file__).resolve().parent.parent
DIST_ROOT = REPO_ROOT / "dist"
RUNNER_PLAN_PATH = REPO_ROOT / "tumblr-runner-plan.json"
RUNNER_PROCESS: subprocess.Popen[Any] | None = None
RUNNER_LAST_COMMAND: list[str] = []
RUNNER_LAST_RUN_ID = ""
RUNNER_LAST_BROWSER_PROVIDER = "local"
RUNNER_LAST_LIVE_URL = ""
LOCAL_RUNNER_TOKEN_ENV = "INWELL_LOCAL_RUNNER_TOKEN"
LOCAL_RUNNER_HEARTBEAT_TIMEOUT_SECONDS = 60
LOCAL_RUNNER_HEARTBEAT: dict[str, Any] = {}

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
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            email TEXT NOT NULL UNIQUE,
            display_name TEXT NOT NULL DEFAULT '',
            password_hash TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS workspaces (
            id TEXT PRIMARY KEY,
            owner_user_id TEXT NOT NULL DEFAULT '',
            name TEXT NOT NULL DEFAULT '',
            created_at TIMESTAMPTZ NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS user_sessions (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            workspace_id TEXT NOT NULL,
            token_hash TEXT NOT NULL UNIQUE,
            expires_at TIMESTAMPTZ NOT NULL,
            created_at TIMESTAMPTZ NOT NULL
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS local_runner_tokens (
            id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL,
            device_name TEXT NOT NULL DEFAULT '',
            token_hash TEXT NOT NULL UNIQUE,
            created_at TIMESTAMPTZ NOT NULL,
            last_used_at TIMESTAMPTZ,
            revoked_at TIMESTAMPTZ
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS auth_attempts (
            id TEXT PRIMARY KEY,
            action TEXT NOT NULL,
            email TEXT NOT NULL DEFAULT '',
            client_key TEXT NOT NULL DEFAULT '',
            success BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMPTZ NOT NULL
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS advertisements (
            id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL DEFAULT 'default',
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
            workspace_id TEXT NOT NULL DEFAULT 'default',
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
            workspace_id TEXT NOT NULL DEFAULT 'default',
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
            workspace_id TEXT NOT NULL DEFAULT 'default',
            display_name TEXT NOT NULL DEFAULT '',
            blog_name TEXT NOT NULL DEFAULT '',
            user_data_dir TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'needs-login',
            last_checked_at TIMESTAMPTZ,
            last_login_at TIMESTAMPTZ,
            notes TEXT NOT NULL DEFAULT '',
            browserbase_context_id TEXT NOT NULL DEFAULT '',
            browserbase_session_id TEXT NOT NULL DEFAULT '',
            browserbase_live_url TEXT NOT NULL DEFAULT '',
            browserbase_session_expires_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS runner_logs (
            id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL DEFAULT 'default',
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
            remote_browser_provider TEXT NOT NULL DEFAULT 'none',
            remote_browser_launch_url TEXT NOT NULL DEFAULT '',
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
            workspace_id TEXT NOT NULL DEFAULT 'default',
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
    connection.execute("ALTER TABLE tumblr_accounts ADD COLUMN IF NOT EXISTS browserbase_context_id TEXT NOT NULL DEFAULT ''")
    connection.execute("ALTER TABLE tumblr_accounts ADD COLUMN IF NOT EXISTS browserbase_session_id TEXT NOT NULL DEFAULT ''")
    connection.execute("ALTER TABLE tumblr_accounts ADD COLUMN IF NOT EXISTS browserbase_live_url TEXT NOT NULL DEFAULT ''")
    connection.execute("ALTER TABLE tumblr_accounts ADD COLUMN IF NOT EXISTS browserbase_session_expires_at TIMESTAMPTZ")
    for table in ("advertisements", "templates", "submission_queue", "tumblr_accounts", "runner_logs"):
        connection.execute(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS workspace_id TEXT NOT NULL DEFAULT 'default'")
    for table in (
        "advertisement_tags",
        "template_tags",
        "runner_log_details",
        "submission_queue_runner_payload_values",
        "submit_targets",
        "queue_definitions",
        "tag_profile_tags",
        "runner_settings",
        "queue_schedule_settings",
        "settings_audit_events",
    ):
        connection.execute(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS workspace_id TEXT NOT NULL DEFAULT 'default'")
    connection.execute("ALTER TABLE submission_queue ADD COLUMN IF NOT EXISTS queue_name TEXT NOT NULL DEFAULT 'Default queue'")
    connection.execute("ALTER TABLE submission_queue ADD COLUMN IF NOT EXISTS tumblr_account_id TEXT NOT NULL DEFAULT ''")
    connection.execute("ALTER TABLE runner_settings ADD COLUMN IF NOT EXISTS tumblr_account_id TEXT NOT NULL DEFAULT ''")
    connection.execute("ALTER TABLE runner_settings ADD COLUMN IF NOT EXISTS remote_browser_provider TEXT NOT NULL DEFAULT 'none'")
    connection.execute("ALTER TABLE runner_settings ADD COLUMN IF NOT EXISTS remote_browser_launch_url TEXT NOT NULL DEFAULT ''")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_advertisement_tags_tag ON advertisement_tags(tag)")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_template_tags_tag ON template_tags(tag)")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_runner_log_details_key ON runner_log_details(detail_key)")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_submission_queue_payload_path ON submission_queue_runner_payload_values(payload_path)")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_submission_queue_tumblr_account ON submission_queue(tumblr_account_id)")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_tumblr_accounts_status ON tumblr_accounts(status)")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_user_sessions_token_hash ON user_sessions(token_hash)")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_local_runner_tokens_token_hash ON local_runner_tokens(token_hash)")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_local_runner_tokens_workspace ON local_runner_tokens(workspace_id)")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_auth_attempts_action_created ON auth_attempts(action, created_at)")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_auth_attempts_email_created ON auth_attempts(email, created_at)")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_auth_attempts_client_created ON auth_attempts(client_key, created_at)")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_advertisements_workspace ON advertisements(workspace_id)")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_templates_workspace ON templates(workspace_id)")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_submission_queue_workspace ON submission_queue(workspace_id)")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_tumblr_accounts_workspace ON tumblr_accounts(workspace_id)")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_runner_logs_workspace ON runner_logs(workspace_id)")
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


def hash_password(password: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 210_000)
    return "pbkdf2_sha256$210000$" + base64.urlsafe_b64encode(salt).decode("ascii") + "$" + base64.urlsafe_b64encode(digest).decode("ascii")


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        algorithm, iterations, salt_text, digest_text = stored_hash.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        salt = base64.urlsafe_b64decode(salt_text.encode("ascii"))
        expected = base64.urlsafe_b64decode(digest_text.encode("ascii"))
        actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, int(iterations))
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def hash_session_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


class AuthRateLimitError(ValueError):
    def __init__(self, message: str, retry_after_seconds: int) -> None:
        super().__init__(message)
        self.retry_after_seconds = retry_after_seconds


def normalize_email(value: Any) -> str:
    return str(value or "").strip().lower()


def client_key_from_address(address: str) -> str:
    normalized = str(address or "unknown").split(",")[0].strip().lower() or "unknown"
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def recent_auth_failures(connection: ConnectionLike, action: str) -> list[dict[str, Any]]:
    since = utc_now() - timedelta(minutes=AUTH_LOCK_WINDOW_MINUTES)
    rows = connection.execute(
        """
        SELECT * FROM auth_attempts
        WHERE action = %s AND success = %s AND created_at >= %s
        ORDER BY created_at DESC
        """,
        (action, False, since),
    ).fetchall()
    return [row_to_dict(row) for row in rows]


def retry_after_for_attempts(attempts: list[dict[str, Any]]) -> int:
    oldest = min((parse_optional_datetime(row.get("created_at")) for row in attempts), default=None)
    if not oldest:
        return AUTH_LOCK_WINDOW_MINUTES * 60
    unlock_at = oldest + timedelta(minutes=AUTH_LOCK_WINDOW_MINUTES)
    return max(60, int((unlock_at - utc_now()).total_seconds()))


def enforce_login_lock(connection: ConnectionLike, email: str, client_key: str) -> None:
    failures = recent_auth_failures(connection, "login")
    email_failures = [row for row in failures if row.get("email") == email]
    client_failures = [row for row in failures if row.get("client_key") == client_key]
    if len(email_failures) >= AUTH_LOGIN_EMAIL_FAILURE_LIMIT:
        raise AuthRateLimitError("Too many failed login attempts. Try again later.", retry_after_for_attempts(email_failures))
    if len(client_failures) >= AUTH_LOGIN_CLIENT_FAILURE_LIMIT:
        raise AuthRateLimitError("Too many failed login attempts from this network. Try again later.", retry_after_for_attempts(client_failures))


def enforce_register_lock(connection: ConnectionLike, client_key: str) -> None:
    failures = recent_auth_failures(connection, "register")
    client_failures = [row for row in failures if row.get("client_key") == client_key]
    if len(client_failures) >= AUTH_REGISTER_CLIENT_ATTEMPT_LIMIT:
        raise AuthRateLimitError("Too many registration attempts. Try again later.", retry_after_for_attempts(client_failures))


def record_auth_attempt(connection: ConnectionLike, action: str, email: str, client_key: str, success: bool) -> None:
    connection.execute(
        """
        INSERT INTO auth_attempts (id, action, email, client_key, success, created_at)
        VALUES (%s, %s, %s, %s, %s, %s)
        """,
        (f"auth-attempt-{uuid.uuid4().hex}", action, email, client_key, success, utc_now()),
    )


def clear_auth_failures(connection: ConnectionLike, action: str, email: str, client_key: str) -> None:
    connection.execute(
        """
        DELETE FROM auth_attempts
        WHERE action = %s AND success = %s AND (email = %s OR client_key = %s)
        """,
        (action, False, email, client_key),
    )


def create_user_workspace_with_lock(connection: ConnectionLike, payload: dict[str, Any], client_key: str) -> tuple[dict[str, Any], str]:
    email = normalize_email(payload.get("email"))
    enforce_register_lock(connection, client_key)
    try:
        user, workspace_id = create_user_workspace(connection, payload)
    except ValueError:
        record_auth_attempt(connection, "register", email, client_key, False)
        raise
    record_auth_attempt(connection, "register", email, client_key, True)
    return user, workspace_id


def login_user_with_lock(connection: ConnectionLike, payload: dict[str, Any], client_key: str) -> tuple[dict[str, Any], str]:
    email = normalize_email(payload.get("email"))
    enforce_login_lock(connection, email, client_key)
    try:
        user, workspace_id = login_user(connection, payload)
    except ValueError as error:
        record_auth_attempt(connection, "login", email, client_key, False)
        raise ValueError("Invalid email or password") from error
    clear_auth_failures(connection, "login", email, client_key)
    record_auth_attempt(connection, "login", email, client_key, True)
    return user, workspace_id


def row_to_user(row: Any, workspace: Any | None = None) -> dict[str, Any]:
    data = row_to_dict(row)
    user = {
        "id": str(data.get("id") or ""),
        "email": str(data.get("email") or ""),
        "displayName": str(data.get("display_name") or ""),
    }
    if workspace:
        workspace_data = row_to_dict(workspace)
        user["workspace"] = {
            "id": str(workspace_data.get("id") or ""),
            "name": str(workspace_data.get("name") or ""),
        }
    return user


def users_exist(connection: ConnectionLike) -> bool:
    return bool(connection.execute("SELECT * FROM users ORDER BY created_at").fetchone())


def authenticate_request(connection: ConnectionLike, cookie_header: str | None) -> dict[str, Any] | None:
    token = ""
    for part in (cookie_header or "").split(";"):
        name, _, value = part.strip().partition("=")
        if name == SESSION_COOKIE_NAME:
            token = value
            break
    if not token:
        return None

    session = connection.execute("SELECT * FROM user_sessions WHERE token_hash = %s", (hash_session_token(token),)).fetchone()
    if not session:
        return None
    session_data = row_to_dict(session)
    expires_at = parse_optional_datetime(session_data.get("expires_at"))
    if expires_at and expires_at < utc_now():
        connection.execute("DELETE FROM user_sessions WHERE id = %s", (session_data["id"],))
        return None

    user = connection.execute("SELECT * FROM users WHERE id = %s", (session_data["user_id"],)).fetchone()
    workspace = connection.execute("SELECT * FROM workspaces WHERE id = %s", (session_data["workspace_id"],)).fetchone()
    if not user or not workspace:
        return None
    return {"user": row_to_user(user, workspace), "workspace_id": str(session_data["workspace_id"]), "session_id": str(session_data["id"])}


def row_to_dict(row: Any) -> dict[str, Any]:
    return {key: normalize_datetime(value) for key, value in dict(row).items()}


def row_to_advertisement(row: Any, tags: list[str] | None = None) -> dict[str, Any]:
    data = row_to_dict(row)
    data["workspace_id"] = str(data.get("workspace_id") or "default")
    data["tags"] = tags if tags is not None else parse_tags(data.get("tags", []))
    if data.get("post_type") not in POST_TYPES:
        data["post_type"] = "photo"
    return data


def row_to_template(row: Any, tags: list[str] | None = None) -> dict[str, Any]:
    data = row_to_dict(row)
    data["workspace_id"] = str(data.get("workspace_id") or "default")
    data["tags"] = tags if tags is not None else parse_tags(data.get("tags", []))
    return data


def row_to_queue_item(row: Any, runner_payload: str | None = None) -> dict[str, Any]:
    data = row_to_dict(row)
    if runner_payload is not None:
        data["runner_payload"] = runner_payload
    elif "runner_payload" not in data:
        data["runner_payload"] = ""
    data["tumblr_account_id"] = str(data.get("tumblr_account_id") or "")
    data["workspace_id"] = str(data.get("workspace_id") or "default")
    data["queue_name"] = str(data.get("queue_name") or "Default queue").strip() or "Default queue"
    if data.get("post_type") not in POST_TYPES:
        data["post_type"] = "photo"
    if data.get("status") not in QUEUE_STATUSES:
        data["status"] = "queued"
    return data


def row_to_tumblr_account(row: Any) -> dict[str, Any]:
    data = row_to_dict(row)
    data["display_name"] = str(data.get("display_name") or "")
    data["workspace_id"] = str(data.get("workspace_id") or "default")
    data["blog_name"] = str(data.get("blog_name") or "")
    data["user_data_dir"] = str(data.get("user_data_dir") or "")
    data["status"] = normalize_tumblr_account_status(data.get("status"))
    data["notes"] = str(data.get("notes") or "")
    data["browserbase_context_id"] = str(data.get("browserbase_context_id") or "")
    data["browserbase_session_id"] = str(data.get("browserbase_session_id") or "")
    data["browserbase_live_url"] = str(data.get("browserbase_live_url") or "")
    return data


def row_to_runner_log(row: Any, details: dict[str, Any] | None = None) -> dict[str, Any]:
    data = row_to_dict(row)
    data["run_id"] = str(data.get("run_id") or "")
    data["workspace_id"] = str(data.get("workspace_id") or "default")
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
        "workspace_id": str(payload.get("workspace_id") or "default"),
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
        "workspace_id": str(payload.get("workspace_id") or "default"),
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
        "workspace_id": str(payload.get("workspace_id") or "default"),
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


def environment_remote_browser_provider() -> str:
    provider = os.environ.get("REMOTE_BROWSER_PROVIDER", "").strip().lower()
    return provider if provider in REMOTE_BROWSER_ACTIVE_PROVIDERS else "none"


def normalize_runner_settings(value: Any) -> dict[str, Any]:
    data = value if isinstance(value, dict) else {}
    try:
        slow_mo = int(data.get("slowMo", 500))
    except (TypeError, ValueError):
        slow_mo = 500
    provider = str(data.get("remoteBrowserProvider") or data.get("remote_browser_provider") or "none").strip().lower()
    if provider not in REMOTE_BROWSER_PROVIDERS:
        provider = "none"

    return {
        "mediaDir": str(data.get("mediaDir") or ""),
        "slowMo": max(0, min(slow_mo, 5000)),
        "submit": bool(data.get("submit")),
        "tumblrAccountId": str(data.get("tumblrAccountId") or data.get("tumblr_account_id") or "").strip(),
        "remoteBrowserProvider": provider,
        "remoteBrowserLaunchUrl": str(data.get("remoteBrowserLaunchUrl") or data.get("remote_browser_launch_url") or "").strip(),
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
        "workspace_id": str(payload.get("workspace_id") or "default"),
        "display_name": display_name,
        "blog_name": blog_name,
        "user_data_dir": user_data_dir,
        "status": normalize_tumblr_account_status(payload.get("status")),
        "last_checked_at": parse_optional_datetime(payload.get("lastCheckedAt") or payload.get("last_checked_at")),
        "last_login_at": parse_optional_datetime(payload.get("lastLoginAt") or payload.get("last_login_at")),
        "notes": str(payload.get("notes") or ""),
        "browserbase_context_id": str(payload.get("browserbaseContextId") or payload.get("browserbase_context_id") or "").strip(),
        "browserbase_session_id": str(payload.get("browserbaseSessionId") or payload.get("browserbase_session_id") or "").strip(),
        "browserbase_live_url": str(payload.get("browserbaseLiveUrl") or payload.get("browserbase_live_url") or "").strip(),
        "browserbase_session_expires_at": parse_optional_datetime(
            payload.get("browserbaseSessionExpiresAt") or payload.get("browserbase_session_expires_at")
        ),
    }


def get_app_settings(connection: ConnectionLike, workspace_id: str = "default") -> dict[str, Any]:
    submit_targets = [
        {
            "id": row["id"],
            "name": row["name"],
            "submitUrl": row["submit_url"],
            "forumUrl": row["forum_url"],
        }
        for row in connection.execute("SELECT * FROM submit_targets WHERE workspace_id = %s ORDER BY name", (workspace_id,)).fetchall()
    ]
    queue_definitions = [
        {"id": row["id"], "name": row["name"]}
        for row in connection.execute("SELECT * FROM queue_definitions WHERE workspace_id = %s ORDER BY name", (workspace_id,)).fetchall()
    ]
    tag_profiles: dict[str, list[str]] = {}
    for row in connection.execute("SELECT * FROM tag_profile_tags WHERE workspace_id = %s ORDER BY blog_id, sort_order, tag", (workspace_id,)).fetchall():
        tag_profiles.setdefault(str(row["blog_id"]), []).append(str(row["tag"]))

    runner_row = connection.execute("SELECT * FROM runner_settings WHERE id = %s AND workspace_id = %s", ("default", workspace_id)).fetchone()
    schedule_row = connection.execute("SELECT * FROM queue_schedule_settings WHERE id = %s AND workspace_id = %s", ("default", workspace_id)).fetchone()
    remote_browser_provider = runner_row["remote_browser_provider"] if runner_row else "none"
    if remote_browser_provider == "none":
        remote_browser_provider = environment_remote_browser_provider()

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
                "remoteBrowserProvider": remote_browser_provider,
                "remoteBrowserLaunchUrl": runner_row["remote_browser_launch_url"] if runner_row else "",
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
    workspace_id: str = "default",
) -> None:
    connection.execute(
        """
        INSERT INTO settings_audit_events (
            id, workspace_id, area, action, entity_id, field_name, old_value, new_value, created_at
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (
            f"audit-{uuid.uuid4().hex}",
            workspace_id,
            area,
            action,
            entity_id,
            field_name,
            "" if old_value is None else str(old_value),
            "" if new_value is None else str(new_value),
            utc_now(),
        ),
    )


def settings_statistics(connection: ConnectionLike, workspace_id: str = "default") -> dict[str, int]:
    counts: dict[str, int] = {}
    queries = {
        "submitTargets": "SELECT * FROM submit_targets WHERE workspace_id = %s ORDER BY name",
        "queueDefinitions": "SELECT * FROM queue_definitions WHERE workspace_id = %s ORDER BY name",
        "tagProfileTags": "SELECT * FROM tag_profile_tags WHERE workspace_id = %s ORDER BY blog_id, sort_order, tag",
        "queueRunnerPayloadValues": "SELECT * FROM submission_queue_runner_payload_values WHERE workspace_id = %s ORDER BY queue_item_id, sort_order, payload_path",
        "runnerSettings": "SELECT * FROM runner_settings WHERE workspace_id = %s",
        "queueScheduleSettings": "SELECT * FROM queue_schedule_settings WHERE workspace_id = %s",
        "settingsAuditEvents": "SELECT * FROM settings_audit_events WHERE workspace_id = %s ORDER BY created_at DESC",
    }
    for key, query in queries.items():
        counts[key] = len(connection.execute(query, (workspace_id,)).fetchall())
    return counts


def upsert_app_settings(connection: ConnectionLike, payload: dict[str, Any], audit: bool = True, workspace_id: str = "default") -> dict[str, Any]:
    settings = app_settings_from_payload(payload)
    now = utc_now()
    connection.execute("DELETE FROM submit_targets WHERE workspace_id = %s", (workspace_id,))
    for target in settings["submitTargets"]:
        connection.execute(
            """
            INSERT INTO submit_targets (id, workspace_id, name, submit_url, forum_url, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                submit_url = excluded.submit_url,
                forum_url = excluded.forum_url,
                updated_at = excluded.updated_at
            """,
            (target["id"], workspace_id, target["name"], target["submitUrl"], target["forumUrl"], now, now),
        )
        if audit:
            for field_name in ("name", "submitUrl", "forumUrl"):
                record_settings_audit(connection, "submit_targets", "upsert", target["id"], field_name, "", target[field_name], workspace_id)

    connection.execute("DELETE FROM queue_definitions WHERE workspace_id = %s", (workspace_id,))
    for queue in settings["queueDefinitions"]:
        connection.execute(
            """
            INSERT INTO queue_definitions (id, workspace_id, name, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                updated_at = excluded.updated_at
            """,
            (queue["id"], workspace_id, queue["name"], now, now),
        )
        if audit:
            record_settings_audit(connection, "queue_definitions", "upsert", queue["id"], "name", "", queue["name"], workspace_id)

    connection.execute("DELETE FROM tag_profile_tags WHERE workspace_id = %s", (workspace_id,))
    for blog_id, tags in settings["tagProfiles"].items():
        replace_ordered_values(connection, "tag_profile_tags", "blog_id", str(blog_id), "tag", tags)
        connection.execute("UPDATE tag_profile_tags SET workspace_id = %s WHERE blog_id = %s", (workspace_id, str(blog_id)))
        if audit:
            for tag in tags:
                record_settings_audit(connection, "tag_profile_tags", "upsert", str(blog_id), "tag", "", tag, workspace_id)

    runner_settings = settings["runnerSettings"]
    connection.execute(
        """
        INSERT INTO runner_settings (
            id, workspace_id, media_dir, slow_mo, submit, tumblr_account_id,
            remote_browser_provider, remote_browser_launch_url, updated_at
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT(id) DO UPDATE SET
            media_dir = excluded.media_dir,
            slow_mo = excluded.slow_mo,
            submit = excluded.submit,
            tumblr_account_id = excluded.tumblr_account_id,
            remote_browser_provider = excluded.remote_browser_provider,
            remote_browser_launch_url = excluded.remote_browser_launch_url,
            updated_at = excluded.updated_at
        """,
        (
            "default",
            workspace_id,
            runner_settings["mediaDir"],
            runner_settings["slowMo"],
            runner_settings["submit"],
            runner_settings["tumblrAccountId"],
            runner_settings["remoteBrowserProvider"],
            runner_settings["remoteBrowserLaunchUrl"],
            now,
        ),
    )
    if audit:
        for field_name in ("mediaDir", "slowMo", "submit", "tumblrAccountId", "remoteBrowserProvider", "remoteBrowserLaunchUrl"):
            record_settings_audit(connection, "runner_settings", "upsert", "default", field_name, "", runner_settings[field_name], workspace_id)

    schedule_settings = settings["queueScheduleSettings"]
    connection.execute(
        """
        INSERT INTO queue_schedule_settings (id, workspace_id, enabled, daily_time, timezone, updated_at)
        VALUES (%s, %s, %s, %s, %s, %s)
        ON CONFLICT(id) DO UPDATE SET
            enabled = excluded.enabled,
            daily_time = excluded.daily_time,
            timezone = excluded.timezone,
            updated_at = excluded.updated_at
        """,
        (
            "default",
            workspace_id,
            schedule_settings["enabled"],
            schedule_settings["dailyTime"],
            schedule_settings["timezone"],
            now,
        ),
    )
    if audit:
        for field_name in ("enabled", "dailyTime", "timezone"):
            record_settings_audit(connection, "queue_schedule_settings", "upsert", "default", field_name, "", schedule_settings[field_name], workspace_id)
    return get_app_settings(connection, workspace_id)


def upsert_tumblr_account(connection: ConnectionLike, payload: dict[str, Any]) -> dict[str, Any]:
    account = tumblr_account_from_payload(payload)
    now = utc_now()
    existing = connection.execute("SELECT created_at FROM tumblr_accounts WHERE id = %s", (account["id"],)).fetchone()
    created_at = existing["created_at"] if existing else now

    connection.execute(
        """
        INSERT INTO tumblr_accounts (
            id, workspace_id, display_name, blog_name, user_data_dir, status, last_checked_at,
            last_login_at, notes, browserbase_context_id, browserbase_session_id, browserbase_live_url,
            browserbase_session_expires_at, created_at, updated_at
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT(id) DO UPDATE SET
            workspace_id = excluded.workspace_id,
            display_name = excluded.display_name,
            blog_name = excluded.blog_name,
            user_data_dir = excluded.user_data_dir,
            status = excluded.status,
            last_checked_at = excluded.last_checked_at,
            last_login_at = excluded.last_login_at,
            notes = excluded.notes,
            browserbase_context_id = excluded.browserbase_context_id,
            browserbase_session_id = excluded.browserbase_session_id,
            browserbase_live_url = excluded.browserbase_live_url,
            browserbase_session_expires_at = excluded.browserbase_session_expires_at,
            updated_at = excluded.updated_at
        """,
        (
            account["id"],
            account["workspace_id"],
            account["display_name"],
            account["blog_name"],
            account["user_data_dir"],
            account["status"],
            account["last_checked_at"],
            account["last_login_at"],
            account["notes"],
            account["browserbase_context_id"],
            account["browserbase_session_id"],
            account["browserbase_live_url"],
            account["browserbase_session_expires_at"],
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


def create_user_workspace(connection: ConnectionLike, payload: dict[str, Any]) -> tuple[dict[str, Any], str]:
    email = normalize_email(payload.get("email"))
    password = str(payload.get("password") or "")
    display_name = str(payload.get("displayName") or payload.get("display_name") or email.split("@")[0]).strip()
    workspace_name = str(payload.get("workspaceName") or payload.get("workspace_name") or f"{display_name or 'Inkwell'} workspace").strip()
    if not email or "@" not in email:
        raise ValueError("Valid email is required")
    if len(password) < 8:
        raise ValueError("Password must be at least 8 characters")
    if users_exist(connection):
        raise ValueError("Registration is closed after the first user is created")

    now = utc_now()
    user_id = f"user-{uuid.uuid4().hex}"
    workspace_id = f"workspace-{uuid.uuid4().hex}"
    connection.execute(
        """
        INSERT INTO users (id, email, display_name, password_hash, created_at, updated_at)
        VALUES (%s, %s, %s, %s, %s, %s)
        """,
        (user_id, email, display_name or email, hash_password(password), now, now),
    )
    connection.execute(
        """
        INSERT INTO workspaces (id, owner_user_id, name, created_at, updated_at)
        VALUES (%s, %s, %s, %s, %s)
        """,
        (workspace_id, user_id, workspace_name or "Inkwell workspace", now, now),
    )
    assign_default_workspace_data(connection, workspace_id)
    user = connection.execute("SELECT * FROM users WHERE id = %s", (user_id,)).fetchone()
    workspace = connection.execute("SELECT * FROM workspaces WHERE id = %s", (workspace_id,)).fetchone()
    return row_to_user(user, workspace), workspace_id


def login_user(connection: ConnectionLike, payload: dict[str, Any]) -> tuple[dict[str, Any], str]:
    email = normalize_email(payload.get("email"))
    password = str(payload.get("password") or "")
    user = connection.execute("SELECT * FROM users WHERE email = %s", (email,)).fetchone()
    if not user or not verify_password(password, str(user["password_hash"])):
        raise ValueError("Invalid email or password")

    workspace = connection.execute("SELECT * FROM workspaces WHERE owner_user_id = %s ORDER BY created_at", (user["id"],)).fetchone()
    if not workspace:
        raise ValueError("No workspace is available for this user")
    return row_to_user(user, workspace), str(workspace["id"])


def create_session(connection: ConnectionLike, user_id: str, workspace_id: str) -> str:
    token = secrets.token_urlsafe(32)
    now = utc_now()
    connection.execute(
        """
        INSERT INTO user_sessions (id, user_id, workspace_id, token_hash, expires_at, created_at)
        VALUES (%s, %s, %s, %s, %s, %s)
        """,
        (f"session-{uuid.uuid4().hex}", user_id, workspace_id, hash_session_token(token), now + timedelta(days=SESSION_DAYS), now),
    )
    return token


def assign_default_workspace_data(connection: ConnectionLike, workspace_id: str) -> None:
    for table in (
        "advertisements",
        "templates",
        "submission_queue",
        "tumblr_accounts",
        "runner_logs",
        "advertisement_tags",
        "template_tags",
        "runner_log_details",
        "submission_queue_runner_payload_values",
        "submit_targets",
        "queue_definitions",
        "tag_profile_tags",
        "runner_settings",
        "queue_schedule_settings",
        "settings_audit_events",
    ):
        connection.execute(f"UPDATE {table} SET workspace_id = %s WHERE workspace_id = %s", (workspace_id, "default"))


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
            id, workspace_id, post_type, title, content, destination_blog, forum_url,
            image_caption, image_name, image_data_url, video_url, video_name,
            status, created_at, updated_at
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT(id) DO UPDATE SET
            workspace_id = excluded.workspace_id,
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
            advertisement["workspace_id"],
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
    connection.execute(
        "UPDATE advertisement_tags SET workspace_id = %s WHERE advertisement_id = %s",
        (advertisement["workspace_id"], advertisement["id"]),
    )

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
        INSERT INTO templates (id, workspace_id, name, content, forum_url, created_at, updated_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT(id) DO UPDATE SET
            workspace_id = excluded.workspace_id,
            name = excluded.name,
            content = excluded.content,
            forum_url = excluded.forum_url,
            updated_at = excluded.updated_at
        """,
        (
            template["id"],
            template["workspace_id"],
            template["name"],
            template["content"],
            template["forum_url"],
            created_at,
            now,
        ),
    )
    replace_ordered_values(connection, "template_tags", "template_id", template["id"], "tag", template["tags"])
    connection.execute(
        "UPDATE template_tags SET workspace_id = %s WHERE template_id = %s",
        (template["workspace_id"], template["id"]),
    )

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
            id, workspace_id, ad_id, target_id, target_name, tumblr_account_id, queue_name, submit_url, post_type, status,
            scheduled_for, timezone, notes, created_at, updated_at,
            last_run_at, posted_at, failed_at
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT(id) DO UPDATE SET
            workspace_id = excluded.workspace_id,
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
            queue_item["workspace_id"],
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
    connection.execute(
        "UPDATE submission_queue_runner_payload_values SET workspace_id = %s WHERE queue_item_id = %s",
        (queue_item["workspace_id"], queue_item["id"]),
    )

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
        "workspace_id": str(payload.get("workspace_id") or "default"),
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

    existing_queue = connection.execute("SELECT * FROM submission_queue WHERE id = %s", (log["queue_item_id"],)).fetchone()
    if existing_queue:
        queue_data = row_to_queue_item(existing_queue)
        log["workspace_id"] = queue_data["workspace_id"]
        if not log["target_name"]:
            log["target_name"] = str(queue_data.get("target_name") or "")

    connection.execute(
        """
        INSERT INTO runner_logs (id, workspace_id, run_id, queue_item_id, target_name, level, message, created_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (
            log["id"],
            log["workspace_id"],
            log["run_id"],
            log["queue_item_id"],
            log["target_name"],
            log["level"],
            log["message"],
            log["created_at"],
        ),
    )
    replace_runner_log_details(connection, log["id"], log["details"])
    connection.execute(
        "UPDATE runner_log_details SET workspace_id = %s WHERE log_id = %s",
        (log["workspace_id"], log["id"]),
    )

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


def local_runner_status(workspace_id: str = "") -> dict[str, Any]:
    heartbeat = dict(LOCAL_RUNNER_HEARTBEAT)
    last_seen = heartbeat.get("last_seen_at")
    matches_workspace = not workspace_id or heartbeat.get("workspace_id") in {"", workspace_id}
    online = bool(
        matches_workspace
        and isinstance(last_seen, datetime)
        and (utc_now() - last_seen).total_seconds() <= LOCAL_RUNNER_HEARTBEAT_TIMEOUT_SECONDS
    )
    return {
        "online": online,
        "last_seen_at": last_seen.isoformat() if isinstance(last_seen, datetime) else "",
        "workspace_id": str(heartbeat.get("workspace_id") or ""),
        "queue_name": str(heartbeat.get("queue_name") or ""),
        "watching": bool(heartbeat.get("watching")),
        "status": str(heartbeat.get("status") or ("online" if online else "offline")),
        "version": str(heartbeat.get("version") or ""),
    }


def record_local_runner_heartbeat(payload: dict[str, Any]) -> dict[str, Any]:
    LOCAL_RUNNER_HEARTBEAT.clear()
    LOCAL_RUNNER_HEARTBEAT.update(
        {
            "last_seen_at": utc_now(),
            "workspace_id": str(payload.get("workspace_id") or payload.get("workspaceId") or "").strip(),
            "queue_name": str(payload.get("queue_name") or payload.get("queueName") or "").strip(),
            "watching": bool(payload.get("watching")),
            "status": str(payload.get("status") or "watching").strip() or "watching",
            "version": str(payload.get("version") or "").strip(),
        }
    )
    return local_runner_status(str(LOCAL_RUNNER_HEARTBEAT.get("workspace_id") or ""))


def runner_status(workspace_id: str = "") -> dict[str, Any]:
    running = RUNNER_PROCESS is not None and RUNNER_PROCESS.poll() is None
    return {
        "running": running,
        "pid": RUNNER_PROCESS.pid if RUNNER_PROCESS is not None else None,
        "plan_path": str(RUNNER_PLAN_PATH),
        "command": RUNNER_LAST_COMMAND,
        "run_id": RUNNER_LAST_RUN_ID,
        "browser_provider": RUNNER_LAST_BROWSER_PROVIDER,
        "live_url": RUNNER_LAST_LIVE_URL,
        "local_runner": local_runner_status(workspace_id),
    }


def local_runner_token_configured() -> bool:
    return bool(os.environ.get(LOCAL_RUNNER_TOKEN_ENV, "").strip())


def local_runner_token_valid(value: str) -> bool:
    expected = os.environ.get(LOCAL_RUNNER_TOKEN_ENV, "").strip()
    token = str(value or "").strip()
    return bool(expected and token and hmac.compare_digest(expected, token))


def row_to_local_runner_token(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(row.get("id") or ""),
        "workspace_id": str(row.get("workspace_id") or ""),
        "device_name": str(row.get("device_name") or ""),
        "created_at": normalize_datetime(row.get("created_at")) or "",
        "last_used_at": normalize_datetime(row.get("last_used_at")) or "",
        "revoked_at": normalize_datetime(row.get("revoked_at")) or "",
    }


def create_local_runner_token(connection: ConnectionLike, workspace_id: str, device_name: str) -> dict[str, Any]:
    now = utc_now()
    token = f"ilr_{secrets.token_urlsafe(32)}"
    row = {
        "id": f"local-runner-token-{uuid.uuid4().hex}",
        "workspace_id": workspace_id,
        "device_name": str(device_name or "Local runner").strip()[:80] or "Local runner",
        "token_hash": hash_session_token(token),
        "created_at": now,
        "last_used_at": None,
        "revoked_at": None,
    }
    connection.execute(
        """
        INSERT INTO local_runner_tokens (
            id, workspace_id, device_name, token_hash, created_at, last_used_at, revoked_at
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        """,
        (
            row["id"],
            row["workspace_id"],
            row["device_name"],
            row["token_hash"],
            row["created_at"],
            row["last_used_at"],
            row["revoked_at"],
        ),
    )
    public_row = row_to_local_runner_token(row)
    public_row["token"] = token
    return public_row


def validate_local_runner_token(
    connection: ConnectionLike,
    value: str,
    workspace_id: str = "",
    *,
    require_workspace: bool = False,
) -> dict[str, Any] | None:
    token = str(value or "").strip()
    if not token:
        return None

    if local_runner_token_valid(token):
        return {
            "id": "env-bootstrap",
            "workspace_id": workspace_id,
            "device_name": "Environment bootstrap token",
            "source": "environment",
        }

    row = connection.execute(
        "SELECT * FROM local_runner_tokens WHERE token_hash = %s",
        (hash_session_token(token),),
    ).fetchone()
    if not row:
        return None

    data = row_to_dict(row)
    if data.get("revoked_at"):
        return None
    token_workspace_id = str(data.get("workspace_id") or "")
    if require_workspace and not workspace_id:
        return None
    if workspace_id and token_workspace_id != workspace_id:
        return None

    connection.execute(
        "UPDATE local_runner_tokens SET last_used_at = %s WHERE id = %s",
        (utc_now(), data["id"]),
    )
    data["source"] = "device"
    return data


def bearer_token_from_header(header: str | None) -> str:
    scheme, _, token = str(header or "").partition(" ")
    return token.strip() if scheme.lower() == "bearer" else ""


def queue_item_to_runner_plan_item(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": item["id"],
        "targetId": item["target_id"],
        "targetName": item["target_name"],
        "submitUrl": item["submit_url"],
        "postType": item["post_type"],
        "tumblrAccountId": item.get("tumblr_account_id", ""),
        "runnerPayload": item.get("runner_payload", ""),
    }


def local_runner_plan(connection: ConnectionLike, workspace_id: str, queue_name: str = "", limit: int = 0) -> dict[str, Any]:
    rows = connection.execute(
        "SELECT * FROM submission_queue WHERE workspace_id = %s ORDER BY updated_at DESC",
        (workspace_id,),
    ).fetchall()
    items = []
    for row in rows:
        item = row_to_queue_item(row, load_runner_payload(connection, str(row["id"])))
        if queue_name and item["queue_name"] != queue_name:
            continue
        if item["status"] in {"submitted", "posted", "running"}:
            continue
        items.append(queue_item_to_runner_plan_item(item))
        if limit and len(items) >= limit:
            break

    run_id = f"local-run-{uuid.uuid4().hex}"
    return {
        "version": 1,
        "workflow": "tumblr-submission-queue",
        "runId": run_id,
        "workspaceId": workspace_id,
        "queueName": queue_name,
        "generatedAt": utc_now().isoformat(),
        "items": items,
    }


def local_runner_command(api_base_url: str, workspace_id: str, queue_name: str, token: str = "") -> dict[str, Any]:
    queue_arg = queue_name or "Default queue"
    token_arg = f"--token {powershell_quote(token)} " if token else ""
    command = (
        f"npm.cmd run tumblr:runner:local -- --api-base {powershell_quote(api_base_url)} "
        f"{token_arg}"
        f"--workspace-id {powershell_quote(workspace_id)} "
        f"--queue {powershell_quote(queue_arg)} "
        "--user-data-dir .tumblr-runner-profile-local --watch --no-pause --submit"
    )
    autostart_command = (
        "npm.cmd run tumblr:runner:install-autostart -- "
        f"-ApiBase {powershell_quote(api_base_url)} "
        f"-WorkspaceId {powershell_quote(workspace_id)} "
        f"-Queue {powershell_quote(queue_arg)}"
        + (f" -RunnerToken {powershell_quote(token)}" if token else "")
    )
    return {
        "command": command,
        "autoStartCommand": autostart_command,
        "tokenConfigured": bool(token) or local_runner_token_configured(),
        "usesDeviceToken": bool(token),
        "tokenEnv": LOCAL_RUNNER_TOKEN_ENV,
        "message": (
            "Run this on your Windows computer from the repo checkout. The copied command includes a device token."
            if token
            else "Run this on your Windows computer from the repo checkout. Keep INWELL_LOCAL_RUNNER_TOKEN set locally and in Railway."
        ),
    }


def start_runner(payload: dict[str, Any]) -> dict[str, Any]:
    global RUNNER_LAST_BROWSER_PROVIDER, RUNNER_LAST_COMMAND, RUNNER_LAST_LIVE_URL, RUNNER_LAST_RUN_ID, RUNNER_PROCESS

    items = payload.get("items")
    if not isinstance(items, list) or not items:
        raise ValueError("items are required")

    if RUNNER_PROCESS is not None and RUNNER_PROCESS.poll() is None:
        raise ValueError("runner is already running")

    remote_browser_provider = str(payload.get("remoteBrowserProvider") or "none").strip().lower()
    if remote_browser_provider not in {"none", "browserbase"}:
        raise ValueError("Queue runner supports Browserbase remote sessions or a local visible browser.")

    if remote_browser_provider != "browserbase" and not visible_tumblr_helper_supported():
        raise ValueError(unsupported_tumblr_helper_message())

    run_id = str(payload.get("runId") or f"run-{uuid.uuid4().hex}").strip()
    browserbase_session = prepare_browserbase_runner_session(payload) if remote_browser_provider == "browserbase" else {}

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
    if remote_browser_provider != "browserbase" and tumblr_account_id and not user_data_dir:
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
    if browserbase_session:
        runner_args.extend(["--browserbase-cdp-url", str(browserbase_session["connect_url"])])
        runner_args.extend(["--browserbase-live-url", str(browserbase_session["live_url"])])

    if os.name == "nt" and not browserbase_session:
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
    RUNNER_LAST_BROWSER_PROVIDER = "browserbase" if browserbase_session else "local"
    RUNNER_LAST_LIVE_URL = str(browserbase_session.get("live_url") or "")
    try:
        RUNNER_PROCESS = subprocess.Popen(command, cwd=REPO_ROOT, creationflags=creationflags)
    except OSError as error:
        RUNNER_LAST_COMMAND = []
        RUNNER_LAST_RUN_ID = ""
        RUNNER_LAST_BROWSER_PROVIDER = "local"
        RUNNER_LAST_LIVE_URL = ""
        raise ValueError(f"Could not start the Tumblr runner process: {error.strerror or error}") from error
    return runner_status()


def visible_tumblr_helper_supported() -> bool:
    if os.name == "nt":
        return True
    return bool(os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY"))


def unsupported_tumblr_helper_message() -> str:
    return "Tumblr login helper needs a visible browser on your local desktop. Railway cannot show that browser."


def prepare_browserbase_runner_session(payload: dict[str, Any]) -> dict[str, str]:
    workspace_id = str(payload.get("workspace_id") or "").strip()
    account_id = str(payload.get("tumblrAccountId") or "").strip()
    if not workspace_id:
        raise ValueError("workspace_id is required for Browserbase queue runs")
    if not account_id:
        raise ValueError("Select a Tumblr account session before starting the Browserbase runner.")

    with connect() as connection:
        account = connection.execute("SELECT * FROM tumblr_accounts WHERE id = %s AND workspace_id = %s", (account_id, workspace_id)).fetchone()
        if not account:
            raise ValueError("Tumblr account not found")
        account_data = row_to_tumblr_account(account)
        context_id = str(account_data.get("browserbase_context_id") or "").strip()
        if not context_id:
            raise ValueError("Connect this Tumblr account with Browserbase before running the queue.")

        session = create_browserbase_session(context_id, account_id, workspace_id)
        session_id = str(session.get("id") or "").strip()
        connect_url = str(session.get("connectUrl") or "").strip()
        if not connect_url:
            raise ValueError("Browserbase did not return a CDP connection URL.")
        live_url = browserbase_live_view_url(session_id)
        upsert_tumblr_account(
            connection,
            {
                **account_data,
                "workspace_id": workspace_id,
                "status": account_data.get("status") or "connected",
                "notes": "Browserbase queue runner session is active.",
                "last_checked_at": utc_now(),
                "browserbase_context_id": context_id,
                "browserbase_session_id": session_id,
                "browserbase_live_url": live_url,
                "browserbase_session_expires_at": session.get("expiresAt"),
            },
        )

    return {
        "provider": "browserbase",
        "context_id": context_id,
        "session_id": session_id,
        "connect_url": connect_url,
        "live_url": live_url,
    }


def browserbase_credentials() -> tuple[str, str]:
    api_key = os.environ.get("BROWSERBASE_API_KEY", "").strip()
    project_id = os.environ.get("BROWSERBASE_PROJECT_ID", "").strip()
    if not api_key:
        raise ValueError("BROWSERBASE_API_KEY is not configured for the web service.")
    if not project_id:
        raise ValueError("BROWSERBASE_PROJECT_ID is not configured for the web service.")
    return api_key, project_id


def browserbase_request(method: str, path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    api_key, _project_id = browserbase_credentials()
    body = json.dumps(payload or {}).encode("utf-8") if payload is not None else None
    request = Request(
        f"{BROWSERBASE_API_URL}{path}",
        data=body,
        method=method,
        headers={
            "Content-Type": "application/json",
            "X-BB-API-Key": api_key,
        },
    )

    try:
        with urlopen(request, timeout=20) as response:
            raw = response.read().decode("utf-8")
    except HTTPError as error:
        raw_error = error.read().decode("utf-8", errors="replace")
        message = f"Browserbase request failed with HTTP {error.code}."
        try:
            error_payload = json.loads(raw_error)
            detail = error_payload.get("message") or error_payload.get("error")
            if detail:
                message = f"Browserbase request failed: {detail}"
        except json.JSONDecodeError:
            if raw_error:
                message = f"Browserbase request failed with HTTP {error.code}."
        raise ValueError(message) from error
    except URLError as error:
        raise ValueError("Could not reach Browserbase. Check Railway networking and Browserbase environment variables.") from error

    try:
        return json.loads(raw) if raw else {}
    except json.JSONDecodeError as error:
        raise ValueError("Browserbase returned an invalid response.") from error


def create_browserbase_context() -> str:
    _api_key, project_id = browserbase_credentials()
    response = browserbase_request("POST", "/contexts", {"projectId": project_id})
    context_id = str(response.get("id") or "").strip()
    if not context_id:
        raise ValueError("Browserbase did not return a context id.")
    return context_id


def create_browserbase_session(context_id: str, account_id: str, workspace_id: str) -> dict[str, Any]:
    _api_key, project_id = browserbase_credentials()
    payload = {
        "projectId": project_id,
        "keepAlive": True,
        "browserSettings": {
            "context": {
                "id": context_id,
                "persist": True,
            }
        },
        "userMetadata": {
            "app": "inkwell",
            "tumblrAccountId": account_id,
            "workspaceId": workspace_id,
        },
    }
    response = browserbase_request("POST", "/sessions", payload)
    session_id = str(response.get("id") or "").strip()
    if not session_id:
        raise ValueError("Browserbase did not return a session id.")
    return response


def browserbase_live_view_url(session_id: str) -> str:
    response = browserbase_request("GET", f"/sessions/{session_id}/debug")
    live_url = str(response.get("debuggerFullscreenUrl") or response.get("debuggerUrl") or "").strip()
    if not live_url:
        raise ValueError("Browserbase did not return a Live View URL.")
    return live_url


def websocket_read_exact(connection: socket.socket, size: int) -> bytes:
    chunks: list[bytes] = []
    remaining = size
    while remaining:
        chunk = connection.recv(remaining)
        if not chunk:
            raise ValueError("Browserbase CDP connection closed unexpectedly.")
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


def websocket_send_json(connection: socket.socket, payload: dict[str, Any]) -> None:
    data = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    header = bytearray([0x81])
    length = len(data)
    if length < 126:
        header.append(0x80 | length)
    elif length <= 0xFFFF:
        header.extend((0x80 | 126, *struct.pack("!H", length)))
    else:
        header.extend((0x80 | 127, *struct.pack("!Q", length)))
    mask = os.urandom(4)
    masked = bytes(byte ^ mask[index % 4] for index, byte in enumerate(data))
    connection.sendall(bytes(header) + mask + masked)


def websocket_receive_json(connection: socket.socket) -> dict[str, Any]:
    while True:
        first, second = websocket_read_exact(connection, 2)
        opcode = first & 0x0F
        masked = bool(second & 0x80)
        length = second & 0x7F
        if length == 126:
            length = struct.unpack("!H", websocket_read_exact(connection, 2))[0]
        elif length == 127:
            length = struct.unpack("!Q", websocket_read_exact(connection, 8))[0]
        mask = websocket_read_exact(connection, 4) if masked else b""
        payload = websocket_read_exact(connection, length) if length else b""
        if masked:
            payload = bytes(byte ^ mask[index % 4] for index, byte in enumerate(payload))
        if opcode == 0x8:
            raise ValueError("Browserbase CDP connection closed before navigation completed.")
        if opcode == 0x9:
            continue
        if opcode != 0x1:
            continue
        try:
            return json.loads(payload.decode("utf-8"))
        except json.JSONDecodeError as error:
            raise ValueError("Browserbase CDP returned an invalid response.") from error


def websocket_open(url: str, timeout: int = 15) -> socket.socket:
    parsed = urlparse(url)
    if parsed.scheme not in {"ws", "wss"} or not parsed.hostname:
        raise ValueError("Browserbase returned an invalid CDP connection URL.")
    port = parsed.port or (443 if parsed.scheme == "wss" else 80)
    raw_connection = socket.create_connection((parsed.hostname, port), timeout=timeout)
    connection: socket.socket = raw_connection
    if parsed.scheme == "wss":
        connection = ssl.create_default_context().wrap_socket(raw_connection, server_hostname=parsed.hostname)
    path = parsed.path or "/"
    if parsed.query:
        path = f"{path}?{parsed.query}"
    key = base64.b64encode(os.urandom(16)).decode("ascii")
    host = parsed.hostname if parsed.port is None else f"{parsed.hostname}:{parsed.port}"
    request = (
        f"GET {path} HTTP/1.1\r\n"
        f"Host: {host}\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        f"Sec-WebSocket-Key: {key}\r\n"
        "Sec-WebSocket-Version: 13\r\n"
        "\r\n"
    )
    connection.sendall(request.encode("ascii"))
    response = b""
    while b"\r\n\r\n" not in response:
        chunk = connection.recv(4096)
        if not chunk:
            break
        response += chunk
        if len(response) > 8192:
            break
    header_text = response.decode("iso-8859-1", errors="replace")
    header_lines = header_text.split("\r\n")
    headers = {
        name.strip().lower(): value.strip()
        for line in header_lines[1:]
        if ":" in line
        for name, value in [line.split(":", 1)]
    }
    accept_source = f"{key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11".encode("ascii")
    expected_accept = base64.b64encode(hashlib.sha1(accept_source).digest()).decode("ascii")
    if (
        not response.startswith(b"HTTP/1.1 101")
        and not response.startswith(b"HTTP/1.0 101")
        or headers.get("sec-websocket-accept") != expected_accept
    ):
        connection.close()
        raise ValueError("Browserbase CDP connection was not accepted.")
    return connection


def cdp_command(connection: socket.socket, command_id: int, method: str, params: dict[str, Any] | None = None, session_id: str = "") -> dict[str, Any]:
    payload: dict[str, Any] = {"id": command_id, "method": method}
    if params is not None:
        payload["params"] = params
    if session_id:
        payload["sessionId"] = session_id
    websocket_send_json(connection, payload)
    while True:
        response = websocket_receive_json(connection)
        if response.get("id") != command_id:
            continue
        if "error" in response:
            message = response["error"].get("message") if isinstance(response["error"], dict) else ""
            raise ValueError(f"Browserbase CDP command failed: {message or method}")
        return response


def browserbase_open_page_session(connect_url: str) -> tuple[socket.socket, str]:
    if not connect_url.strip():
        raise ValueError("Browserbase did not return a CDP connection URL.")
    connection = websocket_open(connect_url)
    try:
        targets_response = cdp_command(connection, 1, "Target.getTargets")
        targets = targets_response.get("result", {}).get("targetInfos", [])
        page_target = next((target for target in targets if target.get("type") == "page"), None)
        target_id = page_target.get("targetId") if isinstance(page_target, dict) else ""
        if not target_id:
            created = cdp_command(connection, 2, "Target.createTarget", {"url": "about:blank"})
            target_id = created.get("result", {}).get("targetId", "")
        if not target_id:
            raise ValueError("Browserbase CDP did not return a page target.")
        attached = cdp_command(connection, 3, "Target.attachToTarget", {"targetId": target_id, "flatten": True})
        session_id = str(attached.get("result", {}).get("sessionId") or "")
        if not session_id:
            raise ValueError("Browserbase CDP did not attach to the page target.")
        return connection, session_id
    except Exception:
        connection.close()
        raise


def browserbase_navigate_session(connect_url: str, url: str = TUMBLR_LOGIN_URL) -> None:
    connection, session_id = browserbase_open_page_session(connect_url)
    try:
        cdp_command(connection, 4, "Page.navigate", {"url": url}, session_id=session_id)
    finally:
        connection.close()


def browserbase_page_state(connect_url: str, url: str) -> dict[str, str]:
    connection, session_id = browserbase_open_page_session(connect_url)
    try:
        cdp_command(connection, 4, "Page.navigate", {"url": url}, session_id=session_id)
        time.sleep(2)
        response = cdp_command(
            connection,
            5,
            "Runtime.evaluate",
            {
                "expression": "JSON.stringify({url: location.href, text: document.body ? document.body.innerText : ''})",
                "returnByValue": True,
            },
            session_id=session_id,
        )
    finally:
        connection.close()
    value = response.get("result", {}).get("result", {}).get("value", "")
    try:
        parsed = json.loads(str(value))
    except json.JSONDecodeError:
        parsed = {}
    return {"url": str(parsed.get("url") or ""), "text": str(parsed.get("text") or "")}


def tumblr_page_appears_logged_in(page_state: dict[str, str]) -> bool:
    url = page_state.get("url", "").lower()
    text = page_state.get("text", "").lower()
    if "/login" in url or "log in to continue" in text:
        return False
    if "tumblr.com/dashboard" in url and any(marker in text for marker in ("dashboard", "following", "for you", "activity", "account")):
        return True
    return False


def create_browserbase_tumblr_login(connection: ConnectionLike, account_data: dict[str, Any], workspace_id: str) -> dict[str, Any]:
    account_id = str(account_data["id"])
    context_id = str(account_data.get("browserbase_context_id") or "").strip() or create_browserbase_context()
    session = create_browserbase_session(context_id, account_id, workspace_id)
    session_id = str(session["id"])
    browserbase_navigate_session(str(session.get("connectUrl") or ""), TUMBLR_LOGIN_URL)
    live_url = browserbase_live_view_url(session_id)
    message = "Browserbase login session is ready. Complete Tumblr login in the opened browser."

    updated = upsert_tumblr_account(
        connection,
        {
            **account_data,
            "workspace_id": workspace_id,
            "status": "checking",
            "notes": message,
            "last_checked_at": utc_now(),
            "browserbase_context_id": context_id,
            "browserbase_session_id": session_id,
            "browserbase_live_url": live_url,
            "browserbase_session_expires_at": session.get("expiresAt"),
        },
    )

    return {
        "mode": "remote",
        "provider": "browserbase",
        "sessionId": session_id,
        "contextId": context_id,
        "launchUrl": live_url,
        "message": message,
        "account": updated,
    }


def check_browserbase_tumblr_login(connection: ConnectionLike, account_data: dict[str, Any], workspace_id: str) -> dict[str, Any]:
    account_id = str(account_data["id"])
    context_id = str(account_data.get("browserbase_context_id") or "").strip()
    if not context_id:
        raise ValueError("Connect this Tumblr account once before checking saved login.")

    session = create_browserbase_session(context_id, account_id, workspace_id)
    session_id = str(session["id"])
    connect_url = str(session.get("connectUrl") or "")
    page_state = browserbase_page_state(connect_url, TUMBLR_DASHBOARD_URL)
    live_url = browserbase_live_view_url(session_id)
    logged_in = tumblr_page_appears_logged_in(page_state)
    message = (
        "Saved Tumblr login is active. This account is ready for queue runs."
        if logged_in
        else "Saved Tumblr login was not active. Complete Tumblr login in the opened Browserbase session."
    )
    now = utc_now()

    updated = upsert_tumblr_account(
        connection,
        {
            **account_data,
            "workspace_id": workspace_id,
            "status": "connected" if logged_in else "needs-login",
            "notes": message,
            "last_checked_at": now,
            "last_login_at": now if logged_in else account_data.get("last_login_at"),
            "browserbase_context_id": context_id,
            "browserbase_session_id": session_id,
            "browserbase_live_url": live_url,
            "browserbase_session_expires_at": session.get("expiresAt"),
        },
    )

    return {
        "mode": "remote",
        "provider": "browserbase",
        "loggedIn": logged_in,
        "sessionId": session_id,
        "contextId": context_id,
        "launchUrl": "" if logged_in else live_url,
        "message": message,
        "account": updated,
    }


def remote_tumblr_login_launch(settings: dict[str, Any]) -> dict[str, str] | None:
    provider = str(settings.get("remoteBrowserProvider") or "none").strip().lower()
    if provider == "browserbase":
        return None
    if provider not in REMOTE_BROWSER_ACTIVE_PROVIDERS:
        return None

    launch_url = str(settings.get("remoteBrowserLaunchUrl") or "").strip()
    if not launch_url:
        raise ValueError(
            "Remote Tumblr login is selected, but no live browser URL is configured. Add the provider launch URL on Tumblr Accounts."
        )
    if not launch_url.startswith(("https://", "http://")):
        raise ValueError("Remote browser launch URL must start with http:// or https://.")

    return {
        "mode": "remote",
        "provider": provider,
        "launchUrl": launch_url,
        "message": "Remote browser login session is ready. Complete Tumblr login in the opened browser.",
    }


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

        if collection == "auth/session" and item_id is None:
            with connect() as connection:
                auth = authenticate_request(connection, self.headers.get("Cookie"))
                self.respond({"authenticated": bool(auth), "user": auth["user"] if auth else None, "bootstrapRequired": not users_exist(connection)})
            return

        if collection == "runner/local-plan" and item_id is None:
            token = bearer_token_from_header(self.headers.get("Authorization"))
            query = parse_qs(urlparse(self.path).query)
            workspace_id = str(query.get("workspaceId", [""])[0] or "").strip()
            queue_name = str(query.get("queueName", [""])[0] or "").strip()
            limit = int(str(query.get("limit", ["0"])[0] or "0") or 0)
            if not workspace_id:
                self.respond({"error": "workspaceId is required"}, HTTPStatus.BAD_REQUEST)
                return
            with connect() as connection:
                if not validate_local_runner_token(connection, token, workspace_id, require_workspace=True):
                    self.respond({"error": "Local runner token is required"}, HTTPStatus.UNAUTHORIZED)
                    return
                self.respond({"plan": local_runner_plan(connection, workspace_id, queue_name, limit)})
            return

        auth = self.require_auth()
        if not auth:
            return
        workspace_id = auth["workspace_id"]

        if collection == "runner/status" and item_id is None:
            self.respond({"runner": runner_status(workspace_id)})
            return

        if collection == "runner/local-command" and item_id is None:
            query = parse_qs(urlparse(self.path).query)
            queue_name = str(query.get("queueName", ["Default queue"])[0] or "Default queue").strip() or "Default queue"
            with connect() as connection:
                device = create_local_runner_token(connection, workspace_id, f"Windows local runner - {queue_name}")
            self.respond(
                {
                    "localRunner": local_runner_command(
                        f"{self.request_base_url()}/api",
                        workspace_id,
                        queue_name,
                        str(device["token"]),
                    )
                }
            )
            return

        with connect() as connection:
            if collection == "advertisements" and item_id is None:
                rows = connection.execute("SELECT * FROM advertisements WHERE workspace_id = %s ORDER BY updated_at DESC", (workspace_id,)).fetchall()
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
                rows = connection.execute("SELECT * FROM templates WHERE workspace_id = %s ORDER BY name", (workspace_id,)).fetchall()
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
                rows = connection.execute("SELECT * FROM submission_queue WHERE workspace_id = %s ORDER BY updated_at DESC", (workspace_id,)).fetchall()
                self.respond({"queue": [row_to_queue_item(row, load_runner_payload(connection, str(row["id"]))) for row in rows]})
                return

            if collection == "tumblr/accounts" and item_id is None:
                rows = connection.execute("SELECT * FROM tumblr_accounts WHERE workspace_id = %s ORDER BY display_name", (workspace_id,)).fetchall()
                self.respond({"accounts": [row_to_tumblr_account(row) for row in rows]})
                return

            if collection == "runner/logs" and item_id is None:
                rows = connection.execute("SELECT * FROM runner_logs WHERE workspace_id = %s ORDER BY created_at DESC LIMIT 150", (workspace_id,)).fetchall()
                self.respond({"logs": [row_to_runner_log(row, load_runner_log_details(connection, str(row["id"]))) for row in rows]})
                return

            if collection == "settings" and item_id is None:
                self.respond({"settings": get_app_settings(connection, workspace_id)})
                return

            if collection == "settings/stats" and item_id is None:
                self.respond({"stats": settings_statistics(connection, workspace_id)})
                return

            if collection == "settings/audit" and item_id is None:
                rows = connection.execute("SELECT * FROM settings_audit_events WHERE workspace_id = %s ORDER BY created_at DESC LIMIT 150", (workspace_id,)).fetchall()
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

        if collection in {"auth/register", "auth/login"}:
            try:
                payload = self.read_json()
                client_key = self.auth_client_key()
                with connect() as connection:
                    user, workspace_id = (
                        create_user_workspace_with_lock(connection, payload, client_key)
                        if collection == "auth/register"
                        else login_user_with_lock(connection, payload, client_key)
                    )
                    token = create_session(connection, user["id"], workspace_id)
                self.respond_with_cookie({"authenticated": True, "user": user}, token, HTTPStatus.CREATED)
            except AuthRateLimitError as error:
                self.respond_rate_limited(str(error), error.retry_after_seconds)
            except ValueError as error:
                self.respond({"error": str(error)}, HTTPStatus.BAD_REQUEST)
            return

        if collection == "auth/logout":
            with connect() as connection:
                auth = authenticate_request(connection, self.headers.get("Cookie"))
                if auth:
                    connection.execute("DELETE FROM user_sessions WHERE id = %s", (auth["session_id"],))
            self.respond_clear_cookie({"authenticated": False})
            return

        if collection == "runner/local-heartbeat":
            payload = self.read_json()
            workspace_id = str(payload.get("workspace_id") or payload.get("workspaceId") or "").strip()
            token = bearer_token_from_header(self.headers.get("Authorization"))
            with connect() as connection:
                if not validate_local_runner_token(connection, token, workspace_id, require_workspace=True):
                    self.respond({"error": "Local runner token is required"}, HTTPStatus.UNAUTHORIZED)
                    return
            self.respond({"localRunner": record_local_runner_heartbeat(payload)}, HTTPStatus.CREATED)
            return

        if collection == "runner/logs":
            payload = self.read_json()
            if str(payload.get("run_id") or "") == RUNNER_LAST_RUN_ID:
                try:
                    with connect() as connection:
                        self.respond({"log": record_runner_log(connection, payload)}, HTTPStatus.CREATED)
                except ValueError as error:
                    self.respond({"error": str(error)}, HTTPStatus.BAD_REQUEST)
                return
            token = bearer_token_from_header(self.headers.get("Authorization"))
            workspace_id = str(payload.get("workspace_id") or payload.get("workspaceId") or "").strip()
            with connect() as connection:
                runner_token = validate_local_runner_token(connection, token, workspace_id, require_workspace=True)
            if runner_token:
                payload["workspace_id"] = str(runner_token.get("workspace_id") or workspace_id)
                try:
                    with connect() as connection:
                        self.respond({"log": record_runner_log(connection, payload)}, HTTPStatus.CREATED)
                except ValueError as error:
                    self.respond({"error": str(error)}, HTTPStatus.BAD_REQUEST)
                return
            auth = self.require_auth()
            if not auth:
                return
            payload["workspace_id"] = auth["workspace_id"]
            try:
                with connect() as connection:
                    self.respond({"log": record_runner_log(connection, payload)}, HTTPStatus.CREATED)
            except ValueError as error:
                self.respond({"error": str(error)}, HTTPStatus.BAD_REQUEST)
            return

        auth = self.require_auth()
        if not auth:
            return
        workspace_id = auth["workspace_id"]

        if collection == "runner/start":
            try:
                payload = self.read_json()
                payload["workspace_id"] = workspace_id
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
                                "workspace_id": workspace_id,
                                "status": "running",
                                "message": "Runner launched this queue item.",
                            },
                        )
                self.respond({"runner": runner}, HTTPStatus.CREATED)
            except ValueError as error:
                self.respond({"error": str(error)}, HTTPStatus.BAD_REQUEST)
            return

        if collection in {"tumblr/login", "tumblr/login-check"}:
            try:
                payload = self.read_json()
                payload["workspace_id"] = workspace_id
                account_id = str(payload.get("accountId") or payload.get("account_id") or "").strip()
                if not account_id:
                    raise ValueError("accountId is required")
                with connect() as connection:
                    account = connection.execute("SELECT * FROM tumblr_accounts WHERE id = %s AND workspace_id = %s", (account_id, workspace_id)).fetchone()
                    if not account:
                        raise ValueError("Tumblr account not found")
                    account_data = row_to_tumblr_account(account)
                    if collection == "tumblr/login-check":
                        self.respond({"login": check_browserbase_tumblr_login(connection, account_data, workspace_id)}, HTTPStatus.CREATED)
                        return
                    runner_settings = get_app_settings(connection, workspace_id)["runnerSettings"]
                    if runner_settings["remoteBrowserProvider"] == "browserbase":
                        self.respond({"login": create_browserbase_tumblr_login(connection, account_data, workspace_id)}, HTTPStatus.CREATED)
                        return
                    remote_launch = remote_tumblr_login_launch(runner_settings)
                    if remote_launch:
                        update_tumblr_account_status(
                            connection,
                            account_id,
                            "checking",
                            remote_launch["message"],
                            utc_now(),
                        )
                        self.respond({"login": remote_launch}, HTTPStatus.CREATED)
                        return
                if not visible_tumblr_helper_supported():
                    raise ValueError(unsupported_tumblr_helper_message())
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
                with connect() as connection:
                    update_tumblr_account_status(
                        connection,
                        account_id,
                        "checking",
                        "Login helper launched. Complete Tumblr login in the visible browser.",
                        utc_now(),
                    )
                self.respond(
                    {
                        "login": {
                            "mode": "local",
                            "pid": process.pid,
                            "command": runner_args,
                            "message": f"Login helper opened in process {process.pid}. Finish Tumblr login in that browser.",
                        }
                    },
                    HTTPStatus.CREATED,
                )
            except (OSError, ValueError) as error:
                message = unsupported_tumblr_helper_message() if isinstance(error, OSError) else str(error)
                self.respond({"error": message}, HTTPStatus.BAD_REQUEST)
            return

        payload = self.read_json()
        payload["workspace_id"] = workspace_id
        self.save_resource(collection, payload, HTTPStatus.CREATED, workspace_id)

    def do_PUT(self) -> None:
        collection, item_id = self.route()
        if item_id is None:
            self.send_error(HTTPStatus.NOT_FOUND)
            return

        auth = self.require_auth()
        if not auth:
            return
        workspace_id = auth["workspace_id"]
        payload = self.read_json()
        payload["id"] = item_id
        payload["workspace_id"] = workspace_id
        self.save_resource(collection, payload, HTTPStatus.OK, workspace_id)

    def do_DELETE(self) -> None:
        collection, item_id = self.route()
        auth = self.require_auth()
        if not auth:
            return
        workspace_id = auth["workspace_id"]
        if collection == "runner/logs" and item_id is None:
            with connect() as connection:
                connection.execute("DELETE FROM runner_log_details WHERE workspace_id = %s", (workspace_id,))
                connection.execute("DELETE FROM runner_logs WHERE workspace_id = %s", (workspace_id,))
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
                    connection.execute(f"DELETE FROM {table} WHERE workspace_id = %s", (workspace_id,))
                record_settings_audit(connection, "settings", "delete", item_id, workspace_id=workspace_id)
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
                connection.execute("DELETE FROM advertisement_tags WHERE advertisement_id = %s AND workspace_id = %s", (item_id, workspace_id))
            if collection == "templates":
                connection.execute("DELETE FROM template_tags WHERE template_id = %s AND workspace_id = %s", (item_id, workspace_id))
            if collection == "queue":
                connection.execute("DELETE FROM submission_queue_runner_payload_values WHERE queue_item_id = %s AND workspace_id = %s", (item_id, workspace_id))
            connection.execute(f"DELETE FROM {table} WHERE id = %s AND workspace_id = %s", (item_id, workspace_id))

        self.respond({"deleted": item_id})

    def save_resource(
        self,
        collection: str | None,
        payload: dict[str, Any],
        status: HTTPStatus = HTTPStatus.OK,
        workspace_id: str = "default",
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
                    self.respond({"settings": upsert_app_settings(connection, payload, workspace_id=workspace_id)}, status)
                    return
        except ValueError as error:
            self.respond({"error": str(error)}, HTTPStatus.BAD_REQUEST)
            return

        self.send_error(HTTPStatus.NOT_FOUND)

    def route(self) -> tuple[str | None, str | None]:
        parts = [part for part in urlparse(self.path).path.split("/") if part]
        if len(parts) == 2 and parts[0] == "api":
            return parts[1], None
        if len(parts) == 3 and parts[0] == "api" and parts[1] == "auth":
            return f"{parts[1]}/{parts[2]}", None
        if len(parts) == 3 and parts[0] == "api" and parts[1] == "runner":
            return f"{parts[1]}/{parts[2]}", None
        if len(parts) == 3 and parts[0] == "api" and parts[1] == "tumblr" and parts[2] in {"accounts", "login", "login-check"}:
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

    def require_auth(self) -> dict[str, Any] | None:
        with connect() as connection:
            auth = authenticate_request(connection, self.headers.get("Cookie"))
            if auth:
                return auth
        self.respond({"error": "Authentication required"}, HTTPStatus.UNAUTHORIZED)
        return None

    def auth_client_key(self) -> str:
        forwarded_for = self.headers.get("X-Forwarded-For") or self.headers.get("X-Real-IP") or ""
        address = forwarded_for or (self.client_address[0] if self.client_address else "unknown")
        return client_key_from_address(address)

    def request_base_url(self) -> str:
        proto = self.headers.get("X-Forwarded-Proto") or "http"
        host = self.headers.get("X-Forwarded-Host") or self.headers.get("Host") or "127.0.0.1"
        return f"{proto}://{host}".rstrip("/")

    def respond(self, payload: dict[str, Any], status: HTTPStatus = HTTPStatus.OK) -> None:
        self.respond_with_headers(payload, status)

    def respond_rate_limited(self, message: str, retry_after_seconds: int) -> None:
        self.respond_with_headers(
            {"error": message, "retryAfterSeconds": retry_after_seconds},
            HTTPStatus.TOO_MANY_REQUESTS,
            [f"Retry-After: {retry_after_seconds}"],
        )

    def respond_with_cookie(self, payload: dict[str, Any], token: str, status: HTTPStatus = HTTPStatus.OK) -> None:
        self.respond_with_headers(payload, status, [self.session_cookie_header(token)])

    def respond_clear_cookie(self, payload: dict[str, Any], status: HTTPStatus = HTTPStatus.OK) -> None:
        self.respond_with_headers(payload, status, [f"{SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax"])

    def respond_with_headers(
        self,
        payload: dict[str, Any],
        status: HTTPStatus = HTTPStatus.OK,
        extra_headers: list[str] | None = None,
    ) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_common_headers()
        for header in extra_headers or []:
            if ": " in header:
                name, _, value = header.partition(": ")
                self.send_header(name, value)
            else:
                self.send_header("Set-Cookie", header)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def session_cookie_header(self, token: str) -> str:
        secure = " Secure;" if self.headers.get("X-Forwarded-Proto", "").lower() == "https" else ""
        return f"{SESSION_COOKIE_NAME}={token}; Path=/; Max-Age={SESSION_DAYS * 24 * 60 * 60}; HttpOnly;{secure} SameSite=Lax"

    def send_common_headers(self) -> None:
        self.send_header("Content-Type", "application/json")
        origin = self.headers.get("Origin")
        self.send_header("Access-Control-Allow-Origin", origin or "*")
        self.send_header("Access-Control-Allow-Credentials", "true")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")


def run(port: int | None = None, host: str | None = None) -> None:
    port = port or int(os.environ.get("PORT", "8021"))
    host = host or os.environ.get("HOST", "127.0.0.1")
    initialize_database_for_startup()
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"Inwell web service listening on http://{host}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    run()
