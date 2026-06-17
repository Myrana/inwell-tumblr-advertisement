from __future__ import annotations

import json
import os
import unittest
from pathlib import Path
import sys
from typing import Any

sys.path.insert(0, str(Path(__file__).parent))
from app import database_settings, initialize, upsert_advertisement, upsert_template


class FakeCursor:
    def __init__(self, rows: list[dict[str, Any]] | None = None) -> None:
        self.rows = rows or []

    def fetchone(self) -> dict[str, Any] | None:
        return self.rows[0] if self.rows else None

    def fetchall(self) -> list[dict[str, Any]]:
        return self.rows


class FakePostgresConnection:
    def __init__(self) -> None:
        self.advertisements: dict[str, dict[str, Any]] = {}
        self.templates: dict[str, dict[str, Any]] = {}

    def execute(self, query: str, params: tuple[Any, ...] | None = None) -> FakeCursor:
        normalized = " ".join(query.split()).lower()
        params = params or ()

        if normalized.startswith("create table"):
            return FakeCursor()

        if normalized.startswith("select created_at from advertisements"):
            row = self.advertisements.get(str(params[0]))
            return FakeCursor([{"created_at": row["created_at"]}] if row else [])

        if normalized.startswith("select * from advertisements where id"):
            row = self.advertisements.get(str(params[0]))
            return FakeCursor([row] if row else [])

        if normalized.startswith("select * from advertisements order by"):
            return FakeCursor(list(self.advertisements.values()))

        if normalized.startswith("insert into advertisements"):
            row = {
                "id": params[0],
                "post_type": params[1],
                "title": params[2],
                "content": params[3],
                "destination_blog": params[4],
                "forum_url": params[5],
                "tags": json.loads(params[6]),
                "image_caption": params[7],
                "image_name": params[8],
                "image_data_url": params[9],
                "video_url": params[10],
                "video_name": params[11],
                "status": params[12],
                "created_at": params[13],
                "updated_at": params[14],
            }
            self.advertisements[str(params[0])] = row
            return FakeCursor()

        if normalized.startswith("delete from advertisements"):
            self.advertisements.pop(str(params[0]), None)
            return FakeCursor()

        if normalized.startswith("select created_at from templates"):
            row = self.templates.get(str(params[0]))
            return FakeCursor([{"created_at": row["created_at"]}] if row else [])

        if normalized.startswith("select * from templates where id"):
            row = self.templates.get(str(params[0]))
            return FakeCursor([row] if row else [])

        if normalized.startswith("select * from templates order by"):
            return FakeCursor(sorted(self.templates.values(), key=lambda row: row["name"]))

        if normalized.startswith("insert into templates"):
            if "do nothing" in normalized and str(params[0]) in self.templates:
                return FakeCursor()

            row = {
                "id": params[0],
                "name": params[1],
                "content": params[2],
                "forum_url": params[3],
                "tags": json.loads(params[4]),
                "created_at": params[5],
                "updated_at": params[6],
            }
            self.templates[str(params[0])] = row
            return FakeCursor()

        if normalized.startswith("delete from templates"):
            self.templates.pop(str(params[0]), None)
            return FakeCursor()

        raise AssertionError(f"Unexpected query: {query}")


class PersistenceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.connection = FakePostgresConnection()
        initialize(self.connection)

    def test_database_settings_default_to_requested_postgres_host(self) -> None:
        self.assertEqual(database_settings()["host"], "19.168.1.3")
        self.assertEqual(database_settings()["dbname"], "inwell_tumblr_advertisement")

    def test_database_settings_honor_environment_overrides(self) -> None:
        old_host = os.environ.get("PGHOST")
        os.environ["PGHOST"] = "192.168.1.3"
        try:
            self.assertEqual(database_settings()["host"], "192.168.1.3")
        finally:
            if old_host is None:
                os.environ.pop("PGHOST", None)
            else:
                os.environ["PGHOST"] = old_host

    def test_seed_templates_are_created(self) -> None:
        rows = self.connection.execute("SELECT * FROM templates ORDER BY name").fetchall()

        self.assertGreaterEqual(len(rows), 2)
        self.assertEqual(rows[0]["id"], "template-open-canons")

    def test_advertisement_upsert_round_trips_tags_and_image_fields(self) -> None:
        saved = upsert_advertisement(
            self.connection,
            {
                "id": "ad-1",
                "post_type": "video",
                "title": "Open canons",
                "content": "<p>Optional copy</p>",
                "destination_blog": "inwell-ads",
                "forum_url": "https://forum.example.test",
                "tags": ["#jcink", "#forum rp"],
                "image_caption": "Picture post caption",
                "image_name": "banner.png",
                "image_data_url": "/banner.png",
                "video_url": "https://video.example.test/watch",
                "video_name": "tour.mp4",
                "status": "draft",
            },
        )

        self.assertEqual(saved["id"], "ad-1")
        self.assertEqual(saved["post_type"], "video")
        self.assertEqual(saved["content"], "<p>Optional copy</p>")
        self.assertEqual(saved["tags"], ["#jcink", "#forum rp"])
        self.assertEqual(saved["image_caption"], "Picture post caption")
        self.assertEqual(saved["video_url"], "https://video.example.test/watch")
        self.assertEqual(saved["video_name"], "tour.mp4")

        updated = upsert_advertisement(
            self.connection,
            {
                **saved,
                "title": "Updated title",
                "tags": [],
                "status": "ready",
            },
        )

        self.assertEqual(updated["title"], "Updated title")
        self.assertEqual(updated["tags"], [])
        self.assertEqual(updated["status"], "ready")

    def test_invalid_post_type_defaults_to_photo(self) -> None:
        saved = upsert_advertisement(
            self.connection,
            {
                "id": "ad-invalid-type",
                "post_type": "audio",
                "title": "Bad type",
                "destination_blog": "inwell-ads",
                "forum_url": "https://forum.example.test",
                "status": "draft",
            },
        )

        self.assertEqual(saved["post_type"], "photo")

    def test_advertisement_list_and_delete_use_postgres_style_queries(self) -> None:
        upsert_advertisement(
            self.connection,
            {
                "id": "ad-delete",
                "post_type": "photo",
                "title": "Delete me",
                "destination_blog": "inwell-ads",
                "forum_url": "https://forum.example.test",
            },
        )

        rows = self.connection.execute("SELECT * FROM advertisements ORDER BY updated_at DESC").fetchall()
        self.assertEqual([row["id"] for row in rows], ["ad-delete"])

        self.connection.execute("DELETE FROM advertisements WHERE id = %s", ("ad-delete",))
        rows = self.connection.execute("SELECT * FROM advertisements ORDER BY updated_at DESC").fetchall()
        self.assertEqual(rows, [])

    def test_template_upsert_round_trips_reusable_copy(self) -> None:
        saved = upsert_template(
            self.connection,
            {
                "id": "template-custom",
                "name": "Custom template",
                "content": "Reusable advertisement copy",
                "forum_url": "https://custom.example.test",
                "tags": ["#custom"],
            },
        )

        self.assertEqual(saved["name"], "Custom template")
        self.assertEqual(saved["tags"], ["#custom"])


if __name__ == "__main__":
    unittest.main()
