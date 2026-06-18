from __future__ import annotations

import json
import os
import unittest
from pathlib import Path
import sys
from typing import Any
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).parents[2]))
import app
from app import (
    database_settings,
    initialize,
    record_runner_log,
    start_runner,
    upsert_advertisement,
    upsert_queue_item,
    upsert_template,
)


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
        self.runner_logs: dict[str, dict[str, Any]] = {}
        self.schema_migrations: dict[str, dict[str, Any]] = {}
        self.submission_queue: dict[str, dict[str, Any]] = {}
        self.templates: dict[str, dict[str, Any]] = {}

    def execute(self, query: str, params: tuple[Any, ...] | None = None) -> FakeCursor:
        normalized = " ".join(query.split()).lower()
        params = params or ()

        if normalized.startswith("create table") or normalized.startswith("alter table"):
            return FakeCursor()

        if normalized.startswith("select * from schema_migrations order by"):
            return FakeCursor(sorted(self.schema_migrations.values(), key=lambda row: row["version"]))

        if normalized.startswith("insert into schema_migrations"):
            if str(params[0]) not in self.schema_migrations:
                self.schema_migrations[str(params[0])] = {
                    "version": params[0],
                    "applied_at": params[1],
                }
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

        if normalized.startswith("select created_at from submission_queue"):
            row = self.submission_queue.get(str(params[0]))
            return FakeCursor([{"created_at": row["created_at"]}] if row else [])

        if normalized.startswith("select * from submission_queue where id"):
            row = self.submission_queue.get(str(params[0]))
            return FakeCursor([row] if row else [])

        if normalized.startswith("select * from submission_queue order by"):
            return FakeCursor(sorted(self.submission_queue.values(), key=lambda row: row["updated_at"], reverse=True))

        if normalized.startswith("insert into submission_queue"):
            row = {
                "id": params[0],
                "ad_id": params[1],
                "target_id": params[2],
                "target_name": params[3],
                "submit_url": params[4],
                "post_type": params[5],
                "status": params[6],
                "scheduled_for": params[7],
                "timezone": params[8],
                "notes": params[9],
                "runner_payload": params[10],
                "created_at": params[11],
                "updated_at": params[12],
                "last_run_at": params[13],
                "posted_at": params[14],
                "failed_at": params[15],
            }
            self.submission_queue[str(params[0])] = row
            return FakeCursor()

        if normalized.startswith("delete from submission_queue"):
            self.submission_queue.pop(str(params[0]), None)
            return FakeCursor()

        if normalized.startswith("insert into runner_logs"):
            row = {
                "id": params[0],
                "run_id": params[1],
                "queue_item_id": params[2],
                "target_name": params[3],
                "level": params[4],
                "message": params[5],
                "details": json.loads(params[6]),
                "created_at": params[7],
            }
            self.runner_logs[str(params[0])] = row
            return FakeCursor()

        if normalized == "delete from runner_logs":
            self.runner_logs.clear()
            return FakeCursor()

        if normalized.startswith("select * from runner_logs where id"):
            row = self.runner_logs.get(str(params[0]))
            return FakeCursor([row] if row else [])

        if normalized.startswith("select * from runner_logs order by"):
            return FakeCursor(sorted(self.runner_logs.values(), key=lambda row: row["created_at"], reverse=True))

        raise AssertionError(f"Unexpected query: {query}")


class PersistenceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.connection = FakePostgresConnection()
        initialize(self.connection)

    def test_database_settings_default_to_requested_postgres_host(self) -> None:
        self.assertEqual(database_settings()["host"], "192.168.1.3")
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

    def test_initialize_records_current_schema_version_once(self) -> None:
        initialize(self.connection)

        rows = self.connection.execute("SELECT * FROM schema_migrations ORDER BY version").fetchall()

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["version"], app.CURRENT_SCHEMA_VERSION)

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

    def test_queue_item_upsert_round_trips_schedule_and_status(self) -> None:
        saved = upsert_queue_item(
            self.connection,
            {
                "id": "queue-1",
                "adId": "ad-1",
                "targetId": "allthingsroleplay",
                "targetName": "allthingsroleplay",
                "submitUrl": "https://allthingsroleplay.tumblr.com/submit",
                "postType": "photo",
                "status": "scheduled",
                "scheduledFor": "2026-06-18T14:30:00+00:00",
                "timezone": "America/New_York",
                "notes": "Scheduled for posting.",
                "runnerPayload": "{}",
            },
        )

        self.assertEqual(saved["id"], "queue-1")
        self.assertEqual(saved["ad_id"], "ad-1")
        self.assertEqual(saved["status"], "scheduled")
        self.assertEqual(saved["post_type"], "photo")
        self.assertIn("2026-06-18T14:30:00", saved["scheduled_for"])

    def test_runner_log_updates_queue_status(self) -> None:
        upsert_queue_item(
            self.connection,
            {
                "id": "queue-log-1",
                "ad_id": "ad-1",
                "target_id": "target-1",
                "target_name": "allthingsroleplay",
                "submit_url": "https://example.tumblr.com/submit",
                "runner_payload": "{}",
            },
        )

        log = record_runner_log(
            self.connection,
            {
                "queue_item_id": "queue-log-1",
                "run_id": "run-test",
                "level": "info",
                "status": "posted",
                "message": "Submit button clicked.",
                "details": {"submit": True},
            },
        )

        self.assertEqual(log["message"], "Submit button clicked.")
        self.assertEqual(log["run_id"], "run-test")
        self.assertEqual(log["target_name"], "allthingsroleplay")
        self.assertEqual(log["details"], {"submit": True})
        self.assertEqual(self.connection.submission_queue["queue-log-1"]["status"], "posted")
        self.assertIsNotNone(self.connection.submission_queue["queue-log-1"]["posted_at"])

    def test_start_runner_writes_plan_and_launches_known_command(self) -> None:
        temp_plan = Path("backend-test-runner-plan.json")
        process = Mock()
        process.pid = 123
        process.poll.return_value = None
        old_process = app.RUNNER_PROCESS
        old_command = app.RUNNER_LAST_COMMAND
        old_plan = app.RUNNER_PLAN_PATH
        app.RUNNER_PROCESS = None
        app.RUNNER_LAST_COMMAND = []
        app.RUNNER_PLAN_PATH = temp_plan

        try:
            with patch("app.subprocess.Popen", return_value=process) as popen:
                result = start_runner(
                    {
                        "items": [{"id": "queue-1", "runnerPayload": "{}"}],
                        "mediaDir": r"C:\media",
                        "slowMo": 700,
                        "submit": True,
                    }
                )

            self.assertTrue(result["running"])
            self.assertEqual(result["pid"], 123)
            self.assertIn("--login-first", result["command"])
            self.assertIn("--api-base", result["command"])
            self.assertIn("--run-id", result["command"])
            self.assertIn("--media-dir", result["command"])
            self.assertIn("--submit", result["command"])
            plan = json.loads(temp_plan.read_text(encoding="utf-8"))
            self.assertEqual(plan["items"][0]["id"], "queue-1")
            self.assertTrue(plan["runId"].startswith("run-"))
            self.assertEqual(result["run_id"], plan["runId"])
            popen.assert_called_once()
            launched_command = popen.call_args.args[0]
            if os.name == "nt":
                self.assertEqual(launched_command[0], "powershell.exe")
                self.assertIn("; & 'npm.cmd' 'run' 'tumblr:runner'", launched_command[3])
                self.assertIn("'--plan'", launched_command[3])
                self.assertIn("'--login-first'", launched_command[3])
        finally:
            if temp_plan.exists():
                temp_plan.unlink()
            app.RUNNER_PROCESS = old_process
            app.RUNNER_LAST_COMMAND = old_command
            app.RUNNER_PLAN_PATH = old_plan

    def test_start_runner_rejects_empty_queue(self) -> None:
        with self.assertRaises(ValueError):
            start_runner({"items": []})

if __name__ == "__main__":
    unittest.main()
