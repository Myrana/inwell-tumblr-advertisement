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
    initialize_database_for_startup,
    record_runner_log,
    run,
    settings_statistics,
    start_runner,
    upsert_app_settings,
    upsert_advertisement,
    upsert_queue_item,
    upsert_template,
    upsert_tumblr_account,
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
        self.advertisement_tags: dict[tuple[str, str], dict[str, Any]] = {}
        self.queue_definitions: dict[str, dict[str, Any]] = {}
        self.queue_schedule_settings: dict[str, dict[str, Any]] = {}
        self.runner_logs: dict[str, dict[str, Any]] = {}
        self.runner_log_details: dict[tuple[str, str], dict[str, Any]] = {}
        self.runner_settings: dict[str, dict[str, Any]] = {}
        self.schema_migrations: dict[str, dict[str, Any]] = {}
        self.settings_audit_events: dict[str, dict[str, Any]] = {}
        self.submission_queue: dict[str, dict[str, Any]] = {}
        self.submission_queue_runner_payload_values: dict[tuple[str, str], dict[str, Any]] = {}
        self.submit_targets: dict[str, dict[str, Any]] = {}
        self.tag_profile_tags: dict[tuple[str, str], dict[str, Any]] = {}
        self.templates: dict[str, dict[str, Any]] = {}
        self.template_tags: dict[tuple[str, str], dict[str, Any]] = {}
        self.tumblr_accounts: dict[str, dict[str, Any]] = {}

    def execute(self, query: str, params: tuple[Any, ...] | None = None) -> FakeCursor:
        normalized = " ".join(query.split()).lower()
        params = params or ()

        if normalized.startswith("create table") or normalized.startswith("alter table") or normalized.startswith("create index"):
            return FakeCursor()

        if normalized.startswith("drop table"):
            return FakeCursor()

        if normalized.startswith("select table_name from information_schema.tables"):
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
                "image_caption": params[6],
                "image_name": params[7],
                "image_data_url": params[8],
                "video_url": params[9],
                "video_name": params[10],
                "status": params[11],
                "created_at": params[12],
                "updated_at": params[13],
            }
            self.advertisements[str(params[0])] = row
            return FakeCursor()

        if normalized.startswith("delete from advertisements"):
            self.advertisements.pop(str(params[0]), None)
            return FakeCursor()

        if normalized.startswith("delete from advertisement_tags"):
            for key in [key for key in self.advertisement_tags if key[0] == str(params[0])]:
                self.advertisement_tags.pop(key, None)
            return FakeCursor()

        if normalized.startswith("insert into advertisement_tags"):
            row = {
                "advertisement_id": params[0],
                "tag": params[1],
                "sort_order": params[2],
                "created_at": params[3],
                "updated_at": params[4],
            }
            self.advertisement_tags[(str(params[0]), str(params[1]))] = row
            return FakeCursor()

        if normalized.startswith("select tag from advertisement_tags"):
            rows = [row for row in self.advertisement_tags.values() if row["advertisement_id"] == params[0]]
            return FakeCursor(sorted(rows, key=lambda row: (row["sort_order"], row["tag"])))

        if normalized.startswith("select * from app_settings where key"):
            return FakeCursor()

        if normalized.startswith("delete from submit_targets"):
            self.submit_targets.clear()
            return FakeCursor()

        if normalized.startswith("insert into submit_targets"):
            row = {
                "id": params[0],
                "name": params[1],
                "submit_url": params[2],
                "forum_url": params[3],
                "created_at": params[4],
                "updated_at": params[5],
            }
            self.submit_targets[str(params[0])] = row
            return FakeCursor()

        if normalized.startswith("select * from submit_targets order by"):
            return FakeCursor(sorted(self.submit_targets.values(), key=lambda row: row["name"]))

        if normalized.startswith("delete from queue_definitions"):
            self.queue_definitions.clear()
            return FakeCursor()

        if normalized.startswith("insert into queue_definitions"):
            row = {"id": params[0], "name": params[1], "created_at": params[2], "updated_at": params[3]}
            self.queue_definitions[str(params[0])] = row
            return FakeCursor()

        if normalized.startswith("select * from queue_definitions order by"):
            return FakeCursor(sorted(self.queue_definitions.values(), key=lambda row: row["name"]))

        if normalized.startswith("select created_at from tumblr_accounts"):
            row = self.tumblr_accounts.get(str(params[0]))
            return FakeCursor([{"created_at": row["created_at"]}] if row else [])

        if normalized.startswith("select * from tumblr_accounts where id"):
            row = self.tumblr_accounts.get(str(params[0]))
            return FakeCursor([row] if row else [])

        if normalized.startswith("select * from tumblr_accounts order by"):
            return FakeCursor(sorted(self.tumblr_accounts.values(), key=lambda row: row["display_name"]))

        if normalized.startswith("insert into tumblr_accounts"):
            row = {
                "id": params[0],
                "display_name": params[1],
                "blog_name": params[2],
                "user_data_dir": params[3],
                "status": params[4],
                "last_checked_at": params[5],
                "last_login_at": params[6],
                "notes": params[7],
                "created_at": params[8],
                "updated_at": params[9],
            }
            self.tumblr_accounts[str(params[0])] = row
            return FakeCursor()

        if normalized.startswith("delete from tumblr_accounts"):
            self.tumblr_accounts.pop(str(params[0]), None)
            return FakeCursor()

        if normalized.startswith("delete from tag_profile_tags") and not params:
            self.tag_profile_tags.clear()
            return FakeCursor()

        if normalized.startswith("delete from tag_profile_tags"):
            for key in [key for key in self.tag_profile_tags if key[0] == str(params[0])]:
                self.tag_profile_tags.pop(key, None)
            return FakeCursor()

        if normalized.startswith("insert into tag_profile_tags"):
            row = {
                "blog_id": params[0],
                "tag": params[1],
                "sort_order": params[2],
                "created_at": params[3],
                "updated_at": params[4],
            }
            self.tag_profile_tags[(str(params[0]), str(params[1]))] = row
            return FakeCursor()

        if normalized.startswith("select * from tag_profile_tags order by"):
            return FakeCursor(sorted(self.tag_profile_tags.values(), key=lambda row: (row["blog_id"], row["sort_order"], row["tag"])))

        if normalized.startswith("insert into runner_settings"):
            row = {
                "id": params[0],
                "media_dir": params[1],
                "slow_mo": params[2],
                "submit": params[3],
                "tumblr_account_id": params[4],
                "updated_at": params[5],
            }
            self.runner_settings[str(params[0])] = row
            return FakeCursor()

        if normalized.startswith("select * from runner_settings where id"):
            row = self.runner_settings.get(str(params[0]))
            return FakeCursor([row] if row else [])

        if normalized.startswith("delete from runner_settings"):
            self.runner_settings.clear()
            return FakeCursor()

        if normalized.startswith("insert into queue_schedule_settings"):
            row = {
                "id": params[0],
                "enabled": params[1],
                "daily_time": params[2],
                "timezone": params[3],
                "updated_at": params[4],
            }
            self.queue_schedule_settings[str(params[0])] = row
            return FakeCursor()

        if normalized.startswith("select * from queue_schedule_settings where id"):
            row = self.queue_schedule_settings.get(str(params[0]))
            return FakeCursor([row] if row else [])

        if normalized.startswith("delete from queue_schedule_settings"):
            self.queue_schedule_settings.clear()
            return FakeCursor()

        if normalized.startswith("insert into settings_audit_events"):
            row = {
                "id": params[0],
                "area": params[1],
                "action": params[2],
                "entity_id": params[3],
                "field_name": params[4],
                "old_value": params[5],
                "new_value": params[6],
                "created_at": params[7],
            }
            self.settings_audit_events[str(params[0])] = row
            return FakeCursor()

        if normalized.startswith("select * from settings_audit_events order by"):
            return FakeCursor(sorted(self.settings_audit_events.values(), key=lambda row: row["created_at"], reverse=True))

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
                "created_at": params[4],
                "updated_at": params[5],
            }
            self.templates[str(params[0])] = row
            return FakeCursor()

        if normalized.startswith("delete from template_tags"):
            for key in [key for key in self.template_tags if key[0] == str(params[0])]:
                self.template_tags.pop(key, None)
            return FakeCursor()

        if normalized.startswith("insert into template_tags"):
            row = {
                "template_id": params[0],
                "tag": params[1],
                "sort_order": params[2],
                "created_at": params[3],
                "updated_at": params[4],
            }
            self.template_tags[(str(params[0]), str(params[1]))] = row
            return FakeCursor()

        if normalized.startswith("select tag from template_tags"):
            rows = [row for row in self.template_tags.values() if row["template_id"] == params[0]]
            return FakeCursor(sorted(rows, key=lambda row: (row["sort_order"], row["tag"])))

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

        if normalized.startswith("insert into submission_queue ("):
            row = {
                "id": params[0],
                "ad_id": params[1],
                "target_id": params[2],
                "target_name": params[3],
                "tumblr_account_id": params[4],
                "queue_name": params[5],
                "submit_url": params[6],
                "post_type": params[7],
                "status": params[8],
                "scheduled_for": params[9],
                "timezone": params[10],
                "notes": params[11],
                "created_at": params[12],
                "updated_at": params[13],
                "last_run_at": params[14],
                "posted_at": params[15],
                "failed_at": params[16],
            }
            self.submission_queue[str(params[0])] = row
            return FakeCursor()

        if normalized.startswith("delete from submission_queue_runner_payload_values"):
            for key in [key for key in self.submission_queue_runner_payload_values if key[0] == str(params[0])]:
                self.submission_queue_runner_payload_values.pop(key, None)
            return FakeCursor()

        if normalized.startswith("insert into submission_queue_runner_payload_values"):
            row = {
                "queue_item_id": params[0],
                "payload_path": params[1],
                "sort_order": params[2],
                "value_type": params[3],
                "value_text": params[4],
                "created_at": params[5],
                "updated_at": params[6],
            }
            self.submission_queue_runner_payload_values[(str(params[0]), str(params[1]))] = row
            return FakeCursor()

        if normalized.startswith("select payload_path, value_type, value_text from submission_queue_runner_payload_values"):
            rows = [row for row in self.submission_queue_runner_payload_values.values() if row["queue_item_id"] == params[0]]
            return FakeCursor(sorted(rows, key=lambda row: (row["sort_order"], row["payload_path"])))

        if normalized.startswith("select * from submission_queue_runner_payload_values order by"):
            return FakeCursor(
                sorted(
                    self.submission_queue_runner_payload_values.values(),
                    key=lambda row: (row["queue_item_id"], row["sort_order"], row["payload_path"]),
                )
            )

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
                "created_at": params[6],
            }
            self.runner_logs[str(params[0])] = row
            return FakeCursor()

        if normalized.startswith("delete from runner_log_details"):
            if not params:
                self.runner_log_details.clear()
                return FakeCursor()
            for key in [key for key in self.runner_log_details if key[0] == str(params[0])]:
                self.runner_log_details.pop(key, None)
            return FakeCursor()

        if normalized.startswith("insert into runner_log_details"):
            row = {
                "log_id": params[0],
                "detail_key": params[1],
                "detail_value": params[2],
                "created_at": params[3],
            }
            self.runner_log_details[(str(params[0]), str(params[1]))] = row
            return FakeCursor()

        if normalized.startswith("select detail_key, detail_value from runner_log_details"):
            rows = [row for row in self.runner_log_details.values() if row["log_id"] == params[0]]
            return FakeCursor(sorted(rows, key=lambda row: row["detail_key"]))

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

    def test_cleared_templates_are_not_reseeded_after_schema_history_exists(self) -> None:
        self.connection.execute("DELETE FROM templates WHERE id = %s", ("template-open-canons",))
        self.connection.execute("DELETE FROM templates WHERE id = %s", ("template-plot-forward",))

        initialize(self.connection)

        rows = self.connection.execute("SELECT * FROM templates ORDER BY name").fetchall()
        self.assertEqual(rows, [])

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
        self.assertEqual([row["tag"] for row in self.connection.advertisement_tags.values()], ["#jcink", "#forum rp"])
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
        self.assertEqual(self.connection.advertisement_tags, {})
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
        self.assertEqual(
            [row["tag"] for row in self.connection.template_tags.values() if row["template_id"] == "template-custom"],
            ["#custom"],
        )

    def test_app_settings_upsert_round_trips_shared_state(self) -> None:
        saved = upsert_app_settings(
            self.connection,
            {
                "submitTargets": [
                    {
                        "id": "AllThingsRoleplay",
                        "name": "allthingsroleplay",
                        "submitUrl": "https://allthingsroleplay.tumblr.com/submit",
                        "forumUrl": "https://forum.example",
                    }
                ],
                "queueDefinitions": [{"id": "daily-adverts", "name": "Daily adverts"}],
                "tagProfiles": {"allthingsroleplay": ["Jcink Site", "jcink site", "premium jcink"]},
                "runnerSettings": {"mediaDir": "C:/media", "slowMo": 750, "submit": True, "tumblrAccountId": "snowleopardx"},
                "queueScheduleSettings": {"enabled": True, "dailyTime": "08:30", "timezone": "America/New_York"},
            },
        )

        self.assertEqual(saved["submitTargets"][0]["id"], "allthingsroleplay")
        self.assertEqual(saved["submitTargets"][0]["forumUrl"], "https://forum.example")
        self.assertEqual(saved["queueDefinitions"][0]["name"], "Daily adverts")
        self.assertEqual(saved["tagProfiles"]["allthingsroleplay"], ["jcink site", "premium jcink"])
        self.assertEqual(saved["runnerSettings"], {"mediaDir": "C:/media", "slowMo": 750, "submit": True, "tumblrAccountId": "snowleopardx"})
        self.assertEqual(saved["queueScheduleSettings"]["dailyTime"], "08:30")
        self.assertEqual(self.connection.submit_targets["allthingsroleplay"]["submit_url"], "https://allthingsroleplay.tumblr.com/submit")
        self.assertEqual(self.connection.queue_definitions["daily-adverts"]["name"], "Daily adverts")
        self.assertEqual(self.connection.runner_settings["default"]["slow_mo"], 750)
        self.assertEqual(self.connection.runner_settings["default"]["tumblr_account_id"], "snowleopardx")
        self.assertEqual(self.connection.queue_schedule_settings["default"]["daily_time"], "08:30")
        self.assertGreater(len(self.connection.settings_audit_events), 0)

    def test_app_settings_normalize_invalid_values(self) -> None:
        saved = upsert_app_settings(
            self.connection,
            {
                "submitTargets": [{"id": "", "submitUrl": ""}],
                "queueDefinitions": [{"name": ""}],
                "tagProfiles": {"blog": "not-a-list"},
                "runnerSettings": {"slowMo": "bad"},
                "queueScheduleSettings": {"dailyTime": "bad"},
            },
        )

        self.assertEqual(saved["submitTargets"], [])
        self.assertEqual(saved["queueDefinitions"], [{"id": "default-queue", "name": "Default queue"}])
        self.assertEqual(saved["tagProfiles"], {})
        self.assertEqual(saved["runnerSettings"]["slowMo"], 500)
        self.assertEqual(saved["queueScheduleSettings"]["dailyTime"], "09:00")

    def test_settings_statistics_count_relational_rows(self) -> None:
        upsert_app_settings(
            self.connection,
            {
                "submitTargets": [
                    {
                        "id": "allthingsroleplay",
                        "name": "allthingsroleplay",
                        "submitUrl": "https://allthingsroleplay.tumblr.com/submit",
                    }
                ],
                "queueDefinitions": [{"id": "daily-adverts", "name": "Daily adverts"}],
                "tagProfiles": {"allthingsroleplay": ["jcink site", "premium jcink"]},
                "runnerSettings": {"slowMo": 500},
                "queueScheduleSettings": {"dailyTime": "09:00"},
            },
        )

        stats = settings_statistics(self.connection)

        self.assertEqual(stats["submitTargets"], 1)
        self.assertEqual(stats["queueDefinitions"], 1)
        self.assertEqual(stats["tagProfileTags"], 2)
        self.assertEqual(stats["queueRunnerPayloadValues"], 0)
        self.assertEqual(stats["runnerSettings"], 1)
        self.assertEqual(stats["queueScheduleSettings"], 1)
        self.assertGreater(stats["settingsAuditEvents"], 0)

    def test_tumblr_account_upsert_tracks_session_metadata(self) -> None:
        saved = upsert_tumblr_account(
            self.connection,
            {
                "displayName": "Myrana Tumblr",
                "blogName": "snowleopardx",
                "status": "connected",
                "notes": "Logged in through Playwright.",
            },
        )

        self.assertEqual(saved["id"], "snowleopardx")
        self.assertEqual(saved["display_name"], "Myrana Tumblr")
        self.assertEqual(saved["blog_name"], "snowleopardx")
        self.assertEqual(saved["status"], "connected")
        self.assertIn(".tumblr-sessions", saved["user_data_dir"])
        self.assertEqual(self.connection.tumblr_accounts["snowleopardx"]["notes"], "Logged in through Playwright.")

    def test_queue_item_upsert_round_trips_schedule_and_status(self) -> None:
        saved = upsert_queue_item(
            self.connection,
            {
                "id": "queue-1",
                "adId": "ad-1",
                "targetId": "allthingsroleplay",
                "targetName": "allthingsroleplay",
                "tumblrAccountId": "snowleopardx",
                "queueName": "Daily adverts",
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
        self.assertEqual(saved["queue_name"], "Daily adverts")
        self.assertEqual(saved["tumblr_account_id"], "snowleopardx")
        self.assertEqual(saved["status"], "scheduled")
        self.assertEqual(saved["post_type"], "photo")
        self.assertIn("2026-06-18T14:30:00", saved["scheduled_for"])
        self.assertEqual(json.loads(saved["runner_payload"]), {})

    def test_queue_runner_payload_uses_relational_value_rows(self) -> None:
        saved = upsert_queue_item(
            self.connection,
            {
                "id": "queue-payload-1",
                "ad_id": "ad-1",
                "target_id": "target-1",
                "target_name": "allthingsroleplay",
                "submit_url": "https://example.tumblr.com/submit",
                "runnerPayload": json.dumps(
                    {
                        "version": 1,
                        "target": {"name": "allthingsroleplay"},
                        "advertisement": {"tags": ["jcink", "premium"]},
                        "fields": {"body": "Prepared copy"},
                        "runnerNotes": ["Review before submit"],
                    }
                ),
            },
        )

        stored_paths = {key[1] for key in self.connection.submission_queue_runner_payload_values}
        self.assertNotIn("runner_payload", self.connection.submission_queue["queue-payload-1"])
        self.assertIn("/fields/body", stored_paths)
        self.assertIn("/advertisement/tags/0", stored_paths)
        self.assertEqual(json.loads(saved["runner_payload"])["fields"]["body"], "Prepared copy")

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
                "status": "submitted",
                "message": "Submit button clicked.",
                "details": {"submit": True},
            },
        )

        self.assertEqual(log["message"], "Submit button clicked.")
        self.assertEqual(log["run_id"], "run-test")
        self.assertEqual(log["target_name"], "allthingsroleplay")
        self.assertEqual(log["details"], {"submit": True})
        self.assertEqual(self.connection.runner_log_details[(log["id"], "submit")]["detail_value"], "True")
        self.assertEqual(self.connection.submission_queue["queue-log-1"]["status"], "submitted")
        self.assertIsNone(self.connection.submission_queue["queue-log-1"]["posted_at"])

    def test_runner_log_fills_missing_run_and_target_from_active_runner_and_queue(self) -> None:
        old_run_id = app.RUNNER_LAST_RUN_ID
        app.RUNNER_LAST_RUN_ID = "run-active"
        upsert_queue_item(
            self.connection,
            {
                "id": "queue-log-2",
                "ad_id": "ad-1",
                "target_id": "target-2",
                "target_name": "jcinktinder",
                "submit_url": "https://jcinktinder.tumblr.com/submit",
                "runner_payload": "{}",
            },
        )

        try:
            log = record_runner_log(
                self.connection,
                {
                    "queue_item_id": "queue-log-2",
                    "level": "warning",
                    "status": "needs-review",
                    "message": "Could not switch post type to photo.",
                },
            )
        finally:
            app.RUNNER_LAST_RUN_ID = old_run_id

        self.assertEqual(log["run_id"], "run-active")
        self.assertEqual(log["target_name"], "jcinktinder")
        self.assertEqual(self.connection.submission_queue["queue-log-2"]["status"], "needs-review")

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

    def test_start_runner_uses_runtime_port_for_api_callback(self) -> None:
        temp_plan = Path("backend-test-runner-plan.json")
        process = Mock()
        process.pid = 123
        process.poll.return_value = None
        old_process = app.RUNNER_PROCESS
        old_command = app.RUNNER_LAST_COMMAND
        old_plan = app.RUNNER_PLAN_PATH
        old_port = os.environ.get("PORT")
        old_runner_api_base = os.environ.get("RUNNER_API_BASE_URL")
        app.RUNNER_PROCESS = None
        app.RUNNER_LAST_COMMAND = []
        app.RUNNER_PLAN_PATH = temp_plan
        os.environ["PORT"] = "9000"
        os.environ.pop("RUNNER_API_BASE_URL", None)

        try:
            with patch("app.subprocess.Popen", return_value=process):
                result = start_runner({"items": [{"id": "queue-1", "runnerPayload": "{}"}]})

            api_base_index = result["command"].index("--api-base") + 1
            self.assertEqual(result["command"][api_base_index], "http://127.0.0.1:9000/api")
        finally:
            if temp_plan.exists():
                temp_plan.unlink()
            app.RUNNER_PROCESS = old_process
            app.RUNNER_LAST_COMMAND = old_command
            app.RUNNER_PLAN_PATH = old_plan
            if old_port is None:
                os.environ.pop("PORT", None)
            else:
                os.environ["PORT"] = old_port
            if old_runner_api_base is None:
                os.environ.pop("RUNNER_API_BASE_URL", None)
            else:
                os.environ["RUNNER_API_BASE_URL"] = old_runner_api_base

    def test_run_honors_host_and_port_environment(self) -> None:
        old_host = os.environ.get("HOST")
        old_port = os.environ.get("PORT")
        os.environ["HOST"] = "0.0.0.0"
        os.environ["PORT"] = "9001"
        server = Mock()
        try:
            with (
                patch("app.initialize_database_for_startup") as initialize_database_for_startup,
                patch("app.ThreadingHTTPServer", return_value=server) as server_factory,
            ):
                run()

            initialize_database_for_startup.assert_called_once()
            server_factory.assert_called_once()
            self.assertEqual(server_factory.call_args.args[0], ("0.0.0.0", 9001))
            server.serve_forever.assert_called_once()
        finally:
            if old_host is None:
                os.environ.pop("HOST", None)
            else:
                os.environ["HOST"] = old_host
            if old_port is None:
                os.environ.pop("PORT", None)
            else:
                os.environ["PORT"] = old_port

    def test_startup_database_initialization_does_not_abort_on_connection_failure(self) -> None:
        with (
            patch("app.initialize_database", side_effect=app.psycopg.OperationalError("bad database url")),
            patch("builtins.print") as print_mock,
        ):
            initialize_database_for_startup()

        print_mock.assert_called_once()
        self.assertIn("database initialization skipped", print_mock.call_args.args[0])

    def test_start_runner_rejects_empty_queue(self) -> None:
        with self.assertRaises(ValueError):
            start_runner({"items": []})

if __name__ == "__main__":
    unittest.main()
