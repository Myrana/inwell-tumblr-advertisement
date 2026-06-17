from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


DB_PATH = Path(__file__).with_name("inwell.sqlite3")
POST_TYPES = {"text", "photo", "video"}

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


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def connect(db_path: Path | str = DB_PATH) -> sqlite3.Connection:
    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    initialize(connection)
    return connection


def initialize(connection: sqlite3.Connection) -> None:
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS advertisements (
            id TEXT PRIMARY KEY,
            post_type TEXT NOT NULL DEFAULT 'photo',
            title TEXT NOT NULL DEFAULT '',
            content TEXT NOT NULL DEFAULT '',
            destination_blog TEXT NOT NULL DEFAULT '',
            forum_url TEXT NOT NULL DEFAULT '',
            tags TEXT NOT NULL DEFAULT '[]',
            image_caption TEXT NOT NULL DEFAULT '',
            image_name TEXT NOT NULL DEFAULT '',
            image_data_url TEXT NOT NULL DEFAULT '',
            video_url TEXT NOT NULL DEFAULT '',
            video_name TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'draft',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
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
            tags TEXT NOT NULL DEFAULT '[]',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    ensure_column(connection, "advertisements", "post_type", "post_type TEXT NOT NULL DEFAULT 'photo'")
    ensure_column(connection, "advertisements", "video_url", "video_url TEXT NOT NULL DEFAULT ''")
    ensure_column(connection, "advertisements", "video_name", "video_name TEXT NOT NULL DEFAULT ''")
    seed_templates(connection)


def ensure_column(connection: sqlite3.Connection, table: str, column: str, definition: str) -> None:
    columns = {row["name"] for row in connection.execute(f"PRAGMA table_info({table})")}
    if column not in columns:
        connection.execute(f"ALTER TABLE {table} ADD COLUMN {definition}")


def seed_templates(connection: sqlite3.Connection) -> None:
    now = utc_now()
    for template in SEED_TEMPLATES:
        connection.execute(
            """
            INSERT OR IGNORE INTO templates (
                id, name, content, forum_url, tags, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
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


def row_to_advertisement(row: sqlite3.Row) -> dict[str, Any]:
    data = dict(row)
    data["tags"] = parse_tags(data["tags"])
    if data.get("post_type") not in POST_TYPES:
        data["post_type"] = "photo"
    return data


def row_to_template(row: sqlite3.Row) -> dict[str, Any]:
    data = dict(row)
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


def upsert_advertisement(connection: sqlite3.Connection, payload: dict[str, Any]) -> dict[str, Any]:
    advertisement = advertisement_from_payload(payload)
    if not advertisement["id"]:
        raise ValueError("id is required")

    now = utc_now()
    existing = connection.execute(
        "SELECT created_at FROM advertisements WHERE id = ?", (advertisement["id"],)
    ).fetchone()
    created_at = existing["created_at"] if existing else now

    connection.execute(
        """
        INSERT INTO advertisements (
            id, post_type, title, content, destination_blog, forum_url, tags,
            image_caption, image_name, image_data_url, video_url, video_name,
            status, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        "SELECT * FROM advertisements WHERE id = ?", (advertisement["id"],)
    ).fetchone()
    return row_to_advertisement(row)


def upsert_template(connection: sqlite3.Connection, payload: dict[str, Any]) -> dict[str, Any]:
    template = template_from_payload(payload)
    if not template["id"]:
        raise ValueError("id is required")
    if not template["name"]:
        raise ValueError("name is required")

    now = utc_now()
    existing = connection.execute(
        "SELECT created_at FROM templates WHERE id = ?", (template["id"],)
    ).fetchone()
    created_at = existing["created_at"] if existing else now

    connection.execute(
        """
        INSERT INTO templates (id, name, content, forum_url, tags, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
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

    row = connection.execute("SELECT * FROM templates WHERE id = ?", (template["id"],)).fetchone()
    return row_to_template(row)


class Handler(BaseHTTPRequestHandler):
    db_path = DB_PATH

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_common_headers()
        self.end_headers()

    def do_GET(self) -> None:
        collection, item_id = self.route()
        with connect(self.db_path) as connection:
            if collection == "advertisements" and item_id is None:
                rows = connection.execute(
                    "SELECT * FROM advertisements ORDER BY updated_at DESC"
                ).fetchall()
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
        with connect(self.db_path) as connection:
            connection.execute(f"DELETE FROM {table} WHERE id = ?", (item_id,))

        self.respond({"deleted": item_id})

    def save_resource(
        self,
        collection: str | None,
        payload: dict[str, Any],
        status: HTTPStatus = HTTPStatus.OK,
    ) -> None:
        try:
            with connect(self.db_path) as connection:
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
