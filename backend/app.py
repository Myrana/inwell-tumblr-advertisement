from __future__ import annotations

import json
import sqlite3
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


DB_PATH = Path(__file__).with_name("inwell.sqlite3")


@dataclass
class Advertisement:
    title: str
    content: str
    destination_blog: str
    forum_url: str
    tags: list[str]
    image_caption: str = ""
    status: str = "draft"


def connect() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS advertisements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            destination_blog TEXT NOT NULL,
            forum_url TEXT NOT NULL,
            tags TEXT NOT NULL,
            image_caption TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'draft',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    return connection


def row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    data = dict(row)
    data["tags"] = json.loads(data["tags"])
    return data


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.path != "/api/advertisements":
            self.send_error(HTTPStatus.NOT_FOUND)
            return

        with connect() as connection:
            rows = connection.execute(
                "SELECT * FROM advertisements ORDER BY updated_at DESC"
            ).fetchall()

        self.respond({"advertisements": [row_to_dict(row) for row in rows]})

    def do_POST(self) -> None:
        if self.path != "/api/advertisements":
            self.send_error(HTTPStatus.NOT_FOUND)
            return

        payload = self.read_json()
        advertisement = Advertisement(
            title=str(payload.get("title", "")).strip(),
            content=str(payload.get("content", "")).strip(),
            destination_blog=str(payload.get("destination_blog", "")).strip(),
            forum_url=str(payload.get("forum_url", "")).strip(),
            tags=[str(tag) for tag in payload.get("tags", [])],
            image_caption=str(payload.get("image_caption", "")).strip(),
            status=str(payload.get("status", "draft")).strip() or "draft",
        )

        if not advertisement.title or not advertisement.content:
            self.respond({"error": "title and content are required"}, HTTPStatus.BAD_REQUEST)
            return

        now = datetime.now(timezone.utc).isoformat()
        with connect() as connection:
            cursor = connection.execute(
                """
                INSERT INTO advertisements (
                    title, content, destination_blog, forum_url, tags,
                    image_caption, status, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    advertisement.title,
                    advertisement.content,
                    advertisement.destination_blog,
                    advertisement.forum_url,
                    json.dumps(advertisement.tags),
                    advertisement.image_caption,
                    advertisement.status,
                    now,
                    now,
                ),
            )
            row = connection.execute(
                "SELECT * FROM advertisements WHERE id = ?", (cursor.lastrowid,)
            ).fetchone()

        self.respond({"advertisement": row_to_dict(row)}, HTTPStatus.CREATED)

    def read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("content-length", "0"))
        raw = self.rfile.read(length) if length else b"{}"
        return json.loads(raw.decode("utf-8"))

    def respond(self, payload: dict[str, Any], status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)


def run(port: int = 8021) -> None:
    connect().close()
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"Inwell API listening on http://127.0.0.1:{port}")
    server.serve_forever()


if __name__ == "__main__":
    run()
