from __future__ import annotations

import json
import os
import subprocess
from datetime import date, datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Protocol
from urllib.parse import urlparse

import psycopg
from psycopg.rows import dict_row


POST_TYPES = {"text", "photo", "video"}
DEFAULT_PGHOST = "192.168.1.3"
DEFAULT_PGDATABASE = "inwell_tumblr_advertisement"
DEFAULT_PGUSER = "postgres"
REPO_ROOT = Path(__file__).resolve().parent.parent
RUNNER_PLAN_PATH = REPO_ROOT / "tumblr-runner-plan.json"
RUNNER_PROCESS: subprocess.Popen[Any] | None = None
RUNNER_LAST_COMMAND: list[str] = []

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
    seed_templates(connection)


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
            f"Set-Location '{REPO_ROOT}'; " + " ".join(powershell_quote(arg) for arg in runner_args),
        ]
        creationflags = subprocess.CREATE_NEW_CONSOLE
    else:
        command = runner_args
        creationflags = 0

    RUNNER_LAST_COMMAND = runner_args
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
        if item_id is None or collection not in {"advertisements", "templates"}:
            self.send_error(HTTPStatus.NOT_FOUND)
            return

        table = "advertisements" if collection == "advertisements" else "templates"
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
    connect().close()
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"Inwell API listening on http://127.0.0.1:{port}")
    server.serve_forever()


if __name__ == "__main__":
    run()
