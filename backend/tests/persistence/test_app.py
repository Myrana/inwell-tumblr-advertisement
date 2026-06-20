from __future__ import annotations

import io
import json
import os
import unittest
import zipfile
from pathlib import Path
import sys
from typing import Any
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).parents[2]))
import app
from app import (
    AuthRateLimitError,
    authenticate_request,
    clear_auth_failures,
    client_key_from_address,
    create_session,
    create_user_workspace,
    create_user_workspace_with_lock,
    database_settings,
    hash_session_token,
    initialize,
    initialize_database_for_startup,
    login_user,
    login_user_with_lock,
    record_runner_log,
    run,
    settings_statistics,
    start_runner,
    upsert_app_settings,
    upsert_advertisement,
    upsert_queue_item,
    upsert_template,
    upsert_tumblr_account,
    check_browserbase_tumblr_login,
    create_browserbase_tumblr_login,
    create_local_runner_token,
    get_app_settings,
    local_runner_command,
    local_runner_package,
    local_runner_plan,
    local_runner_status,
    latest_local_runner_status,
    local_runner_token_valid,
    record_persistent_local_runner_heartbeat,
    record_local_runner_heartbeat,
    remote_tumblr_login_launch,
    unsupported_tumblr_helper_message,
    validate_local_runner_token,
    verify_password,
    visible_tumblr_helper_supported,
)


class FakeCursor:
    def __init__(self, rows: list[dict[str, Any]] | None = None) -> None:
        self.rows = rows or []

    def fetchone(self) -> dict[str, Any] | None:
        return self.rows[0] if self.rows else None

    def fetchall(self) -> list[dict[str, Any]]:
        return self.rows


class ConnectionContext:
    def __init__(self, connection: Any) -> None:
        self.connection = connection

    def __enter__(self) -> Any:
        return self.connection

    def __exit__(self, exc_type: Any, exc: Any, traceback: Any) -> bool:
        return False


class FakePostgresConnection:
    def __init__(self) -> None:
        self.advertisements: dict[str, dict[str, Any]] = {}
        self.advertisement_tags: dict[tuple[str, str], dict[str, Any]] = {}
        self.auth_attempts: dict[str, dict[str, Any]] = {}
        self.local_runner_tokens: dict[str, dict[str, Any]] = {}
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
        self.users: dict[str, dict[str, Any]] = {}
        self.user_sessions: dict[str, dict[str, Any]] = {}
        self.workspaces: dict[str, dict[str, Any]] = {}

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

        if normalized.startswith("select * from auth_attempts"):
            rows = [
                row
                for row in self.auth_attempts.values()
                if row["action"] == params[0] and row["success"] == params[1] and row["created_at"] >= params[2]
            ]
            return FakeCursor(sorted(rows, key=lambda row: row["created_at"], reverse=True))

        if normalized.startswith("insert into auth_attempts"):
            self.auth_attempts[str(params[0])] = {
                "id": params[0],
                "action": params[1],
                "email": params[2],
                "client_key": params[3],
                "success": params[4],
                "created_at": params[5],
            }
            return FakeCursor()

        if normalized.startswith("delete from auth_attempts"):
            action, success, email, client_key = params
            for key in [
                key
                for key, row in self.auth_attempts.items()
                if row["action"] == action and row["success"] == success and (row["email"] == email or row["client_key"] == client_key)
            ]:
                self.auth_attempts.pop(key, None)
            return FakeCursor()

        if normalized.startswith("select * from users order by"):
            return FakeCursor(sorted(self.users.values(), key=lambda row: row["created_at"]))

        if normalized.startswith("select * from users where id"):
            row = self.users.get(str(params[0]))
            return FakeCursor([row] if row else [])

        if normalized.startswith("select * from users where email"):
            email = str(params[0])
            rows = [row for row in self.users.values() if row["email"] == email]
            return FakeCursor(rows)

        if normalized.startswith("insert into users"):
            self.users[str(params[0])] = {
                "id": params[0],
                "email": params[1],
                "display_name": params[2],
                "password_hash": params[3],
                "created_at": params[4],
                "updated_at": params[5],
            }
            return FakeCursor()

        if normalized.startswith("select * from workspaces where id"):
            row = self.workspaces.get(str(params[0]))
            return FakeCursor([row] if row else [])

        if normalized.startswith("select * from workspaces where owner_user_id"):
            rows = [row for row in self.workspaces.values() if row["owner_user_id"] == params[0]]
            return FakeCursor(sorted(rows, key=lambda row: row["created_at"]))

        if normalized.startswith("insert into workspaces"):
            self.workspaces[str(params[0])] = {
                "id": params[0],
                "owner_user_id": params[1],
                "name": params[2],
                "created_at": params[3],
                "updated_at": params[4],
            }
            return FakeCursor()

        if normalized.startswith("select * from user_sessions where token_hash"):
            rows = [row for row in self.user_sessions.values() if row["token_hash"] == params[0]]
            return FakeCursor(rows)

        if normalized.startswith("insert into user_sessions"):
            self.user_sessions[str(params[0])] = {
                "id": params[0],
                "user_id": params[1],
                "workspace_id": params[2],
                "token_hash": params[3],
                "expires_at": params[4],
                "created_at": params[5],
            }
            return FakeCursor()

        if normalized.startswith("delete from user_sessions"):
            self.user_sessions.pop(str(params[0]), None)
            return FakeCursor()

        if normalized.startswith("select * from local_runner_tokens where token_hash"):
            rows = [row for row in self.local_runner_tokens.values() if row["token_hash"] == params[0]]
            return FakeCursor(rows)

        if normalized.startswith("select * from local_runner_tokens where id"):
            row = self.local_runner_tokens.get(str(params[0]))
            return FakeCursor([row] if row else [])

        if normalized.startswith("select * from local_runner_tokens where workspace_id"):
            rows = [
                row
                for row in self.local_runner_tokens.values()
                if row["workspace_id"] == params[0] and row.get("revoked_at") is None and row.get("last_seen_at") is not None
            ]
            return FakeCursor(sorted(rows, key=lambda row: row["last_seen_at"], reverse=True)[:1])

        if normalized.startswith("insert into local_runner_tokens"):
            self.local_runner_tokens[str(params[0])] = {
                "id": params[0],
                "workspace_id": params[1],
                "device_name": params[2],
                "token_hash": params[3],
                "created_at": params[4],
                "last_used_at": params[5],
                "last_seen_at": None,
                "queue_name": "",
                "watching": False,
                "status": "",
                "version": "",
                "revoked_at": params[6],
            }
            return FakeCursor()

        if normalized.startswith("update local_runner_tokens set") and "last_seen_at" in normalized:
            row = self.local_runner_tokens.get(str(params[6]))
            if row:
                row["last_used_at"] = params[0]
                row["last_seen_at"] = params[1]
                row["queue_name"] = params[2]
                row["watching"] = params[3]
                row["status"] = params[4]
                row["version"] = params[5]
            return FakeCursor()

        if normalized.startswith("update local_runner_tokens set last_used_at"):
            row = self.local_runner_tokens.get(str(params[1]))
            if row:
                row["last_used_at"] = params[0]
            return FakeCursor()

        if normalized.startswith("update ") and " set workspace_id = %s where workspace_id = %s" in normalized:
            table_name = normalized.split()[1]
            table = getattr(self, table_name)
            for row in table.values():
                if row.get("workspace_id", "default") == params[1]:
                    row["workspace_id"] = params[0]
            return FakeCursor()

        if normalized.startswith("select created_at from advertisements"):
            row = self.advertisements.get(str(params[0]))
            return FakeCursor([{"created_at": row["created_at"]}] if row else [])

        if normalized.startswith("select * from advertisements where id"):
            row = self.advertisements.get(str(params[0]))
            return FakeCursor([row] if row else [])

        if normalized.startswith("select * from advertisements order by"):
            return FakeCursor(list(self.advertisements.values()))

        if normalized.startswith("select * from advertisements where workspace_id"):
            return FakeCursor([row for row in self.advertisements.values() if row.get("workspace_id") == params[0]])

        if normalized.startswith("insert into advertisements"):
            row = {
                "id": params[0],
                "workspace_id": params[1],
                "post_type": params[2],
                "title": params[3],
                "content": params[4],
                "destination_blog": params[5],
                "forum_url": params[6],
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

        if normalized.startswith("update advertisement_tags set workspace_id"):
            for row in self.advertisement_tags.values():
                if row["advertisement_id"] == params[1]:
                    row["workspace_id"] = params[0]
            return FakeCursor()

        if normalized.startswith("delete from advertisement_tags"):
            for key in [key for key in self.advertisement_tags if key[0] == str(params[0])]:
                self.advertisement_tags.pop(key, None)
            return FakeCursor()

        if normalized.startswith("insert into advertisement_tags"):
            row = {
                "advertisement_id": params[0],
                "workspace_id": "default",
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
            if params:
                for key in [key for key, row in self.submit_targets.items() if row.get("workspace_id") == params[0]]:
                    self.submit_targets.pop(key, None)
            else:
                self.submit_targets.clear()
            return FakeCursor()

        if normalized.startswith("insert into submit_targets"):
            row = {
                "id": params[0],
                "workspace_id": params[1],
                "name": params[2],
                "submit_url": params[3],
                "forum_url": params[4],
                "created_at": params[5],
                "updated_at": params[6],
            }
            self.submit_targets[str(params[0])] = row
            return FakeCursor()

        if normalized.startswith("select * from submit_targets order by"):
            return FakeCursor(sorted(self.submit_targets.values(), key=lambda row: row["name"]))

        if normalized.startswith("select * from submit_targets where workspace_id"):
            return FakeCursor(sorted([row for row in self.submit_targets.values() if row.get("workspace_id") == params[0]], key=lambda row: row["name"]))

        if normalized.startswith("delete from queue_definitions"):
            if params:
                for key in [key for key, row in self.queue_definitions.items() if row.get("workspace_id") == params[0]]:
                    self.queue_definitions.pop(key, None)
            else:
                self.queue_definitions.clear()
            return FakeCursor()

        if normalized.startswith("insert into queue_definitions"):
            row = {"id": params[0], "workspace_id": params[1], "name": params[2], "created_at": params[3], "updated_at": params[4]}
            self.queue_definitions[str(params[0])] = row
            return FakeCursor()

        if normalized.startswith("select * from queue_definitions order by"):
            return FakeCursor(sorted(self.queue_definitions.values(), key=lambda row: row["name"]))

        if normalized.startswith("select * from queue_definitions where workspace_id"):
            return FakeCursor(sorted([row for row in self.queue_definitions.values() if row.get("workspace_id") == params[0]], key=lambda row: row["name"]))

        if normalized.startswith("select created_at from tumblr_accounts"):
            row = self.tumblr_accounts.get(str(params[0]))
            return FakeCursor([{"created_at": row["created_at"]}] if row else [])

        if normalized.startswith("select * from tumblr_accounts where id"):
            row = self.tumblr_accounts.get(str(params[0]))
            if row and len(params) > 1 and row.get("workspace_id") != params[1]:
                row = None
            return FakeCursor([row] if row else [])

        if normalized.startswith("select * from tumblr_accounts where workspace_id"):
            rows = [row for row in self.tumblr_accounts.values() if row.get("workspace_id") == params[0]]
            return FakeCursor(sorted(rows, key=lambda row: row["display_name"]))

        if normalized.startswith("select * from tumblr_accounts order by"):
            return FakeCursor(sorted(self.tumblr_accounts.values(), key=lambda row: row["display_name"]))

        if normalized.startswith("insert into tumblr_accounts"):
            row = {
                "id": params[0],
                "workspace_id": params[1],
                "display_name": params[2],
                "blog_name": params[3],
                "user_data_dir": params[4],
                "status": params[5],
                "last_checked_at": params[6],
                "last_login_at": params[7],
                "notes": params[8],
                "browserbase_context_id": params[9],
                "browserbase_session_id": params[10],
                "browserbase_live_url": params[11],
                "browserbase_session_expires_at": params[12],
                "created_at": params[13],
                "updated_at": params[14],
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
            if "workspace_id" in normalized:
                for key in [key for key, row in self.tag_profile_tags.items() if row.get("workspace_id") == params[0]]:
                    self.tag_profile_tags.pop(key, None)
            else:
                for key in [key for key in self.tag_profile_tags if key[0] == str(params[0])]:
                    self.tag_profile_tags.pop(key, None)
            return FakeCursor()

        if normalized.startswith("update tag_profile_tags set workspace_id"):
            for row in self.tag_profile_tags.values():
                if row["blog_id"] == params[1]:
                    row["workspace_id"] = params[0]
            return FakeCursor()

        if normalized.startswith("insert into tag_profile_tags"):
            row = {
                "blog_id": params[0],
                "workspace_id": "default",
                "tag": params[1],
                "sort_order": params[2],
                "created_at": params[3],
                "updated_at": params[4],
            }
            self.tag_profile_tags[(str(params[0]), str(params[1]))] = row
            return FakeCursor()

        if normalized.startswith("select * from tag_profile_tags order by"):
            return FakeCursor(sorted(self.tag_profile_tags.values(), key=lambda row: (row["blog_id"], row["sort_order"], row["tag"])))

        if normalized.startswith("select * from tag_profile_tags where workspace_id"):
            rows = [row for row in self.tag_profile_tags.values() if row.get("workspace_id") == params[0]]
            return FakeCursor(sorted(rows, key=lambda row: (row["blog_id"], row["sort_order"], row["tag"])))

        if normalized.startswith("insert into runner_settings"):
            row = {
                "id": params[0],
                "workspace_id": params[1],
                "media_dir": params[2],
                "slow_mo": params[3],
                "submit": params[4],
                "tumblr_account_id": params[5],
                "remote_browser_provider": params[6],
                "remote_browser_launch_url": params[7],
                "updated_at": params[8],
            }
            self.runner_settings[str(params[0])] = row
            return FakeCursor()

        if normalized.startswith("select * from runner_settings where id"):
            row = self.runner_settings.get(str(params[0]))
            if row and len(params) > 1 and row.get("workspace_id") != params[1]:
                row = None
            return FakeCursor([row] if row else [])

        if normalized.startswith("select * from runner_settings where workspace_id"):
            rows = [row for row in self.runner_settings.values() if row.get("workspace_id") == params[0]]
            return FakeCursor(rows)

        if normalized.startswith("select * from runner_settings where id"):
            return FakeCursor([row] if row else [])

        if normalized.startswith("delete from runner_settings"):
            if params:
                for key in [key for key, row in self.runner_settings.items() if row.get("workspace_id") == params[0]]:
                    self.runner_settings.pop(key, None)
            else:
                self.runner_settings.clear()
            return FakeCursor()

        if normalized.startswith("insert into queue_schedule_settings"):
            row = {
                "id": params[0],
                "workspace_id": params[1],
                "enabled": params[2],
                "daily_time": params[3],
                "timezone": params[4],
                "updated_at": params[5],
            }
            self.queue_schedule_settings[str(params[0])] = row
            return FakeCursor()

        if normalized.startswith("select * from queue_schedule_settings where id"):
            row = self.queue_schedule_settings.get(str(params[0]))
            if row and len(params) > 1 and row.get("workspace_id") != params[1]:
                row = None
            return FakeCursor([row] if row else [])

        if normalized.startswith("select * from queue_schedule_settings where workspace_id"):
            rows = [row for row in self.queue_schedule_settings.values() if row.get("workspace_id") == params[0]]
            return FakeCursor(rows)

        if normalized.startswith("delete from queue_schedule_settings"):
            if params:
                for key in [key for key, row in self.queue_schedule_settings.items() if row.get("workspace_id") == params[0]]:
                    self.queue_schedule_settings.pop(key, None)
            else:
                self.queue_schedule_settings.clear()
            return FakeCursor()

        if normalized.startswith("insert into settings_audit_events"):
            row = {
                "id": params[0],
                "workspace_id": params[1],
                "area": params[2],
                "action": params[3],
                "entity_id": params[4],
                "field_name": params[5],
                "old_value": params[6],
                "new_value": params[7],
                "created_at": params[8],
            }
            self.settings_audit_events[str(params[0])] = row
            return FakeCursor()

        if normalized.startswith("select * from settings_audit_events order by"):
            return FakeCursor(sorted(self.settings_audit_events.values(), key=lambda row: row["created_at"], reverse=True))

        if normalized.startswith("select * from settings_audit_events where workspace_id"):
            rows = [row for row in self.settings_audit_events.values() if row.get("workspace_id") == params[0]]
            return FakeCursor(sorted(rows, key=lambda row: row["created_at"], reverse=True))

        if normalized.startswith("select created_at from templates"):
            row = self.templates.get(str(params[0]))
            return FakeCursor([{"created_at": row["created_at"]}] if row else [])

        if normalized.startswith("select * from templates where id"):
            row = self.templates.get(str(params[0]))
            return FakeCursor([row] if row else [])

        if normalized.startswith("select * from templates order by"):
            return FakeCursor(sorted(self.templates.values(), key=lambda row: row["name"]))

        if normalized.startswith("select * from templates where workspace_id"):
            rows = [row for row in self.templates.values() if row.get("workspace_id") == params[0]]
            return FakeCursor(sorted(rows, key=lambda row: row["name"]))

        if normalized.startswith("insert into templates"):
            if "do nothing" in normalized and str(params[0]) in self.templates:
                return FakeCursor()

            if "workspace_id" in normalized:
                row = {
                    "id": params[0],
                    "workspace_id": params[1],
                    "name": params[2],
                    "content": params[3],
                    "forum_url": params[4],
                    "created_at": params[5],
                    "updated_at": params[6],
                }
            else:
                row = {
                    "id": params[0],
                    "workspace_id": "default",
                    "name": params[1],
                    "content": params[2],
                    "forum_url": params[3],
                    "created_at": params[4],
                    "updated_at": params[5],
                }
            self.templates[str(params[0])] = row
            return FakeCursor()

        if normalized.startswith("update template_tags set workspace_id"):
            for row in self.template_tags.values():
                if row["template_id"] == params[1]:
                    row["workspace_id"] = params[0]
            return FakeCursor()

        if normalized.startswith("delete from template_tags"):
            for key in [key for key in self.template_tags if key[0] == str(params[0])]:
                self.template_tags.pop(key, None)
            return FakeCursor()

        if normalized.startswith("insert into template_tags"):
            row = {
                "template_id": params[0],
                "workspace_id": "default",
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

        if normalized.startswith("select * from submission_queue where workspace_id"):
            rows = [row for row in self.submission_queue.values() if row.get("workspace_id") == params[0]]
            return FakeCursor(sorted(rows, key=lambda row: row["updated_at"], reverse=True))

        if normalized.startswith("insert into submission_queue ("):
            row = {
                "id": params[0],
                "workspace_id": params[1],
                "ad_id": params[2],
                "target_id": params[3],
                "target_name": params[4],
                "tumblr_account_id": params[5],
                "queue_name": params[6],
                "submit_url": params[7],
                "post_type": params[8],
                "status": params[9],
                "scheduled_for": params[10],
                "timezone": params[11],
                "notes": params[12],
                "created_at": params[13],
                "updated_at": params[14],
                "last_run_at": params[15],
                "posted_at": params[16],
                "failed_at": params[17],
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
                "workspace_id": "default",
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

        if normalized.startswith("select * from submission_queue_runner_payload_values where workspace_id"):
            rows = [row for row in self.submission_queue_runner_payload_values.values() if row.get("workspace_id") == params[0]]
            return FakeCursor(sorted(rows, key=lambda row: (row["queue_item_id"], row["sort_order"], row["payload_path"])))

        if normalized.startswith("update submission_queue_runner_payload_values set workspace_id"):
            for row in self.submission_queue_runner_payload_values.values():
                if row["queue_item_id"] == params[1]:
                    row["workspace_id"] = params[0]
            return FakeCursor()

        if normalized.startswith("delete from submission_queue"):
            self.submission_queue.pop(str(params[0]), None)
            return FakeCursor()

        if normalized.startswith("insert into runner_logs"):
            row = {
                "id": params[0],
                "workspace_id": params[1],
                "run_id": params[2],
                "queue_item_id": params[3],
                "target_name": params[4],
                "level": params[5],
                "message": params[6],
                "created_at": params[7],
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
                "workspace_id": "default",
                "detail_key": params[1],
                "detail_value": params[2],
                "created_at": params[3],
            }
            self.runner_log_details[(str(params[0]), str(params[1]))] = row
            return FakeCursor()

        if normalized.startswith("select detail_key, detail_value from runner_log_details"):
            rows = [row for row in self.runner_log_details.values() if row["log_id"] == params[0]]
            return FakeCursor(sorted(rows, key=lambda row: row["detail_key"]))

        if normalized.startswith("update runner_log_details set workspace_id"):
            for row in self.runner_log_details.values():
                if row["log_id"] == params[1]:
                    row["workspace_id"] = params[0]
            return FakeCursor()

        if normalized.startswith("delete from runner_logs"):
            if params:
                for key in [key for key, row in self.runner_logs.items() if row.get("workspace_id") == params[0]]:
                    self.runner_logs.pop(key, None)
            else:
                self.runner_logs.clear()
            return FakeCursor()

        if normalized.startswith("select * from runner_logs where id"):
            row = self.runner_logs.get(str(params[0]))
            return FakeCursor([row] if row else [])

        if normalized.startswith("select * from runner_logs order by"):
            return FakeCursor(sorted(self.runner_logs.values(), key=lambda row: row["created_at"], reverse=True))

        if normalized.startswith("select * from runner_logs where workspace_id"):
            rows = [row for row in self.runner_logs.values() if row.get("workspace_id") == params[0]]
            return FakeCursor(sorted(rows, key=lambda row: row["created_at"], reverse=True))

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
                "runnerSettings": {
                    "mediaDir": "C:/media",
                    "slowMo": 750,
                    "submit": True,
                    "tumblrAccountId": "snowleopardx",
                    "remoteBrowserProvider": "custom",
                    "remoteBrowserLaunchUrl": "https://browser.example/live/snow",
                },
                "queueScheduleSettings": {"enabled": True, "dailyTime": "08:30", "timezone": "America/New_York"},
            },
        )

        self.assertEqual(saved["submitTargets"][0]["id"], "allthingsroleplay")
        self.assertEqual(saved["submitTargets"][0]["forumUrl"], "https://forum.example")
        self.assertEqual(saved["queueDefinitions"][0]["name"], "Daily adverts")
        self.assertEqual(saved["tagProfiles"]["allthingsroleplay"], ["jcink site", "premium jcink"])
        self.assertEqual(
            saved["runnerSettings"],
            {
                "mediaDir": "C:/media",
                "slowMo": 750,
                "submit": True,
                "tumblrAccountId": "snowleopardx",
                "remoteBrowserProvider": "custom",
                "remoteBrowserLaunchUrl": "https://browser.example/live/snow",
            },
        )
        self.assertEqual(saved["queueScheduleSettings"]["dailyTime"], "08:30")
        self.assertEqual(self.connection.submit_targets["allthingsroleplay"]["submit_url"], "https://allthingsroleplay.tumblr.com/submit")
        self.assertEqual(self.connection.queue_definitions["daily-adverts"]["name"], "Daily adverts")
        self.assertEqual(self.connection.runner_settings["default"]["slow_mo"], 750)
        self.assertEqual(self.connection.runner_settings["default"]["tumblr_account_id"], "snowleopardx")
        self.assertEqual(self.connection.runner_settings["default"]["remote_browser_provider"], "custom")
        self.assertEqual(self.connection.runner_settings["default"]["remote_browser_launch_url"], "https://browser.example/live/snow")
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
        self.assertEqual(saved["runnerSettings"]["remoteBrowserProvider"], "none")
        self.assertEqual(saved["runnerSettings"]["remoteBrowserLaunchUrl"], "")
        self.assertEqual(saved["queueScheduleSettings"]["dailyTime"], "09:00")

    def test_app_settings_uses_browserbase_env_as_default_provider(self) -> None:
        upsert_app_settings(self.connection, {"runnerSettings": {"remoteBrowserProvider": "none"}}, audit=False)

        with patch.dict(os.environ, {"REMOTE_BROWSER_PROVIDER": "browserbase"}, clear=True):
            settings = get_app_settings(self.connection)

        self.assertEqual(settings["runnerSettings"]["remoteBrowserProvider"], "browserbase")

    def test_remote_tumblr_login_launch_requires_configured_url(self) -> None:
        self.assertIsNone(remote_tumblr_login_launch({"remoteBrowserProvider": "none"}))

        self.assertIsNone(remote_tumblr_login_launch({"remoteBrowserProvider": "browserbase"}))

        with self.assertRaisesRegex(ValueError, "no live browser URL"):
            remote_tumblr_login_launch({"remoteBrowserProvider": "custom"})

        with self.assertRaisesRegex(ValueError, "must start"):
            remote_tumblr_login_launch({"remoteBrowserProvider": "custom", "remoteBrowserLaunchUrl": "browser.example/live"})

        launch = remote_tumblr_login_launch(
            {"remoteBrowserProvider": "custom", "remoteBrowserLaunchUrl": "https://browser.example/live/snow"}
        )
        self.assertEqual(launch["mode"], "remote")
        self.assertEqual(launch["provider"], "custom")
        self.assertEqual(launch["launchUrl"], "https://browser.example/live/snow")

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

    def test_tumblr_account_upsert_tracks_browserbase_metadata(self) -> None:
        saved = upsert_tumblr_account(
            self.connection,
            {
                "displayName": "Myrana Tumblr",
                "blogName": "snowleopardx",
                "browserbaseContextId": "ctx-123",
                "browserbaseSessionId": "session-123",
                "browserbaseLiveUrl": "https://browserbase.com/session/live",
                "browserbaseSessionExpiresAt": "2026-06-19T05:00:00Z",
            },
        )

        self.assertEqual(saved["browserbase_context_id"], "ctx-123")
        self.assertEqual(saved["browserbase_session_id"], "session-123")
        self.assertEqual(saved["browserbase_live_url"], "https://browserbase.com/session/live")
        self.assertIsNotNone(saved["browserbase_session_expires_at"])

    def test_create_browserbase_tumblr_login_creates_context_session_and_live_view(self) -> None:
        account = upsert_tumblr_account(
            self.connection,
            {"displayName": "Snow", "blogName": "snowleopardx", "workspace_id": "workspace-test"},
        )

        def fake_browserbase_request(method: str, path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
            if method == "POST" and path == "/contexts":
                self.assertEqual(payload["projectId"], "project-test")
                return {"id": "ctx-new"}
            if method == "POST" and path == "/sessions":
                self.assertEqual(payload["projectId"], "project-test")
                self.assertIs(payload["keepAlive"], True)
                self.assertEqual(payload["browserSettings"]["context"], {"id": "ctx-new", "persist": True})
                self.assertEqual(payload["userMetadata"]["tumblrAccountId"], "snowleopardx")
                return {"id": "session-new", "connectUrl": "wss://connect.browserbase.com/session-new", "expiresAt": "2026-06-19T05:00:00Z"}
            if method == "GET" and path == "/sessions/session-new/debug":
                return {"debuggerFullscreenUrl": "https://browserbase.com/live/session-new"}
            raise AssertionError(f"Unexpected Browserbase call: {method} {path}")

        with patch.dict(os.environ, {"BROWSERBASE_API_KEY": "key-test", "BROWSERBASE_PROJECT_ID": "project-test"}, clear=True):
            with patch("app.browserbase_request", side_effect=fake_browserbase_request):
                with patch("app.browserbase_navigate_session") as navigate_session:
                    login = create_browserbase_tumblr_login(self.connection, account, "workspace-test")

        self.assertEqual(login["provider"], "browserbase")
        self.assertEqual(login["sessionId"], "session-new")
        self.assertEqual(login["contextId"], "ctx-new")
        self.assertEqual(login["launchUrl"], "https://browserbase.com/live/session-new")
        navigate_session.assert_called_once_with("wss://connect.browserbase.com/session-new", "https://www.tumblr.com/login")
        stored = self.connection.tumblr_accounts["snowleopardx"]
        self.assertEqual(stored["browserbase_context_id"], "ctx-new")
        self.assertEqual(stored["browserbase_session_id"], "session-new")
        self.assertEqual(stored["status"], "checking")

    def test_create_browserbase_tumblr_login_requires_env(self) -> None:
        account = upsert_tumblr_account(self.connection, {"displayName": "Snow", "blogName": "snowleopardx"})

        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(ValueError, "BROWSERBASE_API_KEY"):
                create_browserbase_tumblr_login(self.connection, account, "default")

    def test_check_browserbase_tumblr_login_marks_saved_context_connected(self) -> None:
        account = upsert_tumblr_account(
            self.connection,
            {
                "displayName": "Snow",
                "blogName": "snowleopardx",
                "workspace_id": "workspace-test",
                "browserbaseContextId": "ctx-saved",
                "status": "checking",
            },
        )

        def fake_browserbase_request(method: str, path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
            if method == "POST" and path == "/sessions":
                self.assertEqual(payload["browserSettings"]["context"], {"id": "ctx-saved", "persist": True})
                return {"id": "session-check", "connectUrl": "wss://connect.browserbase.com/session-check", "expiresAt": "2026-06-19T05:00:00Z"}
            if method == "GET" and path == "/sessions/session-check/debug":
                return {"debuggerFullscreenUrl": "https://browserbase.com/live/session-check"}
            raise AssertionError(f"Unexpected Browserbase call: {method} {path}")

        with patch.dict(os.environ, {"BROWSERBASE_API_KEY": "key-test", "BROWSERBASE_PROJECT_ID": "project-test"}, clear=True):
            with patch("app.browserbase_request", side_effect=fake_browserbase_request):
                with patch(
                    "app.browserbase_page_state",
                    return_value={"url": "https://www.tumblr.com/dashboard", "text": "Dashboard Following For you Activity Account"},
                ) as page_state:
                    login = check_browserbase_tumblr_login(self.connection, account, "workspace-test")

        page_state.assert_called_once_with("wss://connect.browserbase.com/session-check", "https://www.tumblr.com/dashboard")
        self.assertTrue(login["loggedIn"])
        self.assertEqual(login["launchUrl"], "")
        stored = self.connection.tumblr_accounts["snowleopardx"]
        self.assertEqual(stored["status"], "connected")
        self.assertIn("Saved Tumblr login is active", stored["notes"])
        self.assertIsNotNone(stored["last_login_at"])

    def test_check_browserbase_tumblr_login_returns_live_view_when_saved_context_needs_login(self) -> None:
        account = upsert_tumblr_account(
            self.connection,
            {
                "displayName": "Snow",
                "blogName": "snowleopardx",
                "workspace_id": "workspace-test",
                "browserbaseContextId": "ctx-saved",
                "status": "checking",
            },
        )

        def fake_browserbase_request(method: str, path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
            if method == "POST" and path == "/sessions":
                return {"id": "session-check", "connectUrl": "wss://connect.browserbase.com/session-check", "expiresAt": "2026-06-19T05:00:00Z"}
            if method == "GET" and path == "/sessions/session-check/debug":
                return {"debuggerFullscreenUrl": "https://browserbase.com/live/session-check"}
            raise AssertionError(f"Unexpected Browserbase call: {method} {path}")

        with patch.dict(os.environ, {"BROWSERBASE_API_KEY": "key-test", "BROWSERBASE_PROJECT_ID": "project-test"}, clear=True):
            with patch("app.browserbase_request", side_effect=fake_browserbase_request):
                with patch("app.browserbase_page_state", return_value={"url": "https://www.tumblr.com/login", "text": "Log in to continue"}):
                    login = check_browserbase_tumblr_login(self.connection, account, "workspace-test")

        self.assertFalse(login["loggedIn"])
        self.assertEqual(login["launchUrl"], "https://browserbase.com/live/session-check")
        stored = self.connection.tumblr_accounts["snowleopardx"]
        self.assertEqual(stored["status"], "needs-login")
        self.assertIn("Saved Tumblr login was not active", stored["notes"])

    def test_check_browserbase_tumblr_login_requires_saved_context(self) -> None:
        account = upsert_tumblr_account(self.connection, {"displayName": "Snow", "blogName": "snowleopardx"})

        with self.assertRaisesRegex(ValueError, "Connect this Tumblr account once"):
            check_browserbase_tumblr_login(self.connection, account, "default")

    def test_browserbase_navigate_session_navigates_existing_page_to_tumblr(self) -> None:
        connection = Mock()
        commands: list[tuple[str, dict[str, Any] | None, str]] = []

        def fake_cdp_command(
            _connection: Any,
            _command_id: int,
            method: str,
            params: dict[str, Any] | None = None,
            session_id: str = "",
        ) -> dict[str, Any]:
            commands.append((method, params, session_id))
            if method == "Target.getTargets":
                return {"result": {"targetInfos": [{"type": "page", "targetId": "target-1"}]}}
            if method == "Target.attachToTarget":
                return {"result": {"sessionId": "cdp-session-1"}}
            if method == "Page.navigate":
                return {"result": {"frameId": "frame-1"}}
            raise AssertionError(f"Unexpected CDP command: {method}")

        with patch("app.websocket_open", return_value=connection) as websocket_open:
            with patch("app.cdp_command", side_effect=fake_cdp_command):
                app.browserbase_navigate_session("wss://connect.browserbase.com/session-new")

        websocket_open.assert_called_once_with("wss://connect.browserbase.com/session-new")
        self.assertEqual(
            commands,
            [
                ("Target.getTargets", None, ""),
                ("Target.attachToTarget", {"targetId": "target-1", "flatten": True}, ""),
                ("Page.navigate", {"url": "https://www.tumblr.com/login"}, "cdp-session-1"),
            ],
        )
        connection.close.assert_called_once()

    def test_visible_tumblr_helper_requires_desktop_display_on_non_windows(self) -> None:
        with patch("app.os.name", "posix"), patch.dict(os.environ, {}, clear=True):
            self.assertFalse(visible_tumblr_helper_supported())
            self.assertIn("Railway cannot show", unsupported_tumblr_helper_message())

        with patch("app.os.name", "posix"), patch.dict(os.environ, {"DISPLAY": ":99"}, clear=True):
            self.assertTrue(visible_tumblr_helper_supported())

    def test_create_user_workspace_hashes_password_and_assigns_default_data(self) -> None:
        template = upsert_template(
            self.connection,
            {
                "id": "template-owned",
                "name": "Owned template",
                "content": "Workspace copy",
                "tags": ["jcink"],
            },
        )

        user, workspace_id = create_user_workspace(
            self.connection,
            {
                "email": "myrana@example.test",
                "password": "super-secret-password",
                "displayName": "Myrana",
                "workspaceName": "Myrana workspace",
            },
        )
        token = create_session(self.connection, user["id"], workspace_id)
        auth = authenticate_request(self.connection, f"other=value; inwell_session={token}")

        stored_user = self.connection.users[user["id"]]
        self.assertNotEqual(stored_user["password_hash"], "super-secret-password")
        self.assertTrue(verify_password("super-secret-password", stored_user["password_hash"]))
        self.assertEqual(user["email"], "myrana@example.test")
        self.assertEqual(user["workspace"]["name"], "Myrana workspace")
        self.assertEqual(auth["workspace_id"], workspace_id)
        self.assertEqual(hash_session_token(token), next(iter(self.connection.user_sessions.values()))["token_hash"])
        self.assertEqual(self.connection.templates[template["id"]]["workspace_id"], workspace_id)
        self.assertEqual(self.connection.template_tags[(template["id"], "jcink")]["workspace_id"], workspace_id)

    def test_login_rejects_wrong_password_and_returns_workspace_for_valid_user(self) -> None:
        created_user, workspace_id = create_user_workspace(
            self.connection,
            {
                "email": "owner@example.test",
                "password": "correct-password",
                "displayName": "Owner",
                "workspaceName": "Owner workspace",
            },
        )

        with self.assertRaises(ValueError):
            login_user(self.connection, {"email": "owner@example.test", "password": "wrong-password"})

        logged_in_user, logged_in_workspace_id = login_user(
            self.connection,
            {"email": "owner@example.test", "password": "correct-password"},
        )

        self.assertEqual(logged_in_user["id"], created_user["id"])
        self.assertEqual(logged_in_workspace_id, workspace_id)
        self.assertEqual(logged_in_user["workspace"]["name"], "Owner workspace")

    def test_login_lock_limits_repeated_email_failures_and_clears_on_success(self) -> None:
        create_user_workspace(
            self.connection,
            {
                "email": "locked@example.test",
                "password": "correct-password",
                "displayName": "Owner",
                "workspaceName": "Owner workspace",
            },
        )
        client_key = client_key_from_address("203.0.113.10")

        for _ in range(app.AUTH_LOGIN_EMAIL_FAILURE_LIMIT):
            with self.assertRaises(ValueError):
                login_user_with_lock(
                    self.connection,
                    {"email": "locked@example.test", "password": "wrong-password"},
                    client_key,
                )

        with self.assertRaises(AuthRateLimitError) as error:
            login_user_with_lock(
                self.connection,
                {"email": "locked@example.test", "password": "correct-password"},
                client_key,
            )

        self.assertGreaterEqual(error.exception.retry_after_seconds, 60)
        self.assertEqual(
            len([row for row in self.connection.auth_attempts.values() if row["action"] == "login" and row["success"] is False]),
            app.AUTH_LOGIN_EMAIL_FAILURE_LIMIT,
        )

        clear_auth_failures(self.connection, "login", "locked@example.test", client_key)
        user, workspace_id = login_user_with_lock(
            self.connection,
            {"email": "locked@example.test", "password": "correct-password"},
            client_key,
        )

        self.assertEqual(user["email"], "locked@example.test")
        self.assertTrue(workspace_id.startswith("workspace-"))
        self.assertEqual([row for row in self.connection.auth_attempts.values() if row["success"] is False], [])

    def test_register_lock_limits_repeated_invalid_registration_attempts_by_client(self) -> None:
        client_key = client_key_from_address("203.0.113.11")

        for index in range(app.AUTH_REGISTER_CLIENT_ATTEMPT_LIMIT):
            with self.assertRaises(ValueError):
                create_user_workspace_with_lock(
                    self.connection,
                    {"email": f"bad-{index}", "password": "short"},
                    client_key,
                )

        with self.assertRaises(AuthRateLimitError):
            create_user_workspace_with_lock(
                self.connection,
                {
                    "email": "valid@example.test",
                    "password": "valid-password",
                    "displayName": "Valid",
                    "workspaceName": "Valid workspace",
                },
                client_key,
            )

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

    def test_local_runner_token_validates_configured_env_token(self) -> None:
        with patch.dict(os.environ, {"INWELL_LOCAL_RUNNER_TOKEN": "secret-token"}, clear=False):
            self.assertTrue(local_runner_token_valid("secret-token"))
            self.assertFalse(local_runner_token_valid("wrong-token"))

        with patch.dict(os.environ, {"INWELL_LOCAL_RUNNER_TOKEN": ""}, clear=False):
            self.assertFalse(local_runner_token_valid("secret-token"))

    def test_local_runner_device_token_is_hashed_and_workspace_scoped(self) -> None:
        created = create_local_runner_token(self.connection, "workspace-local", "Mandy laptop")
        token = created["token"]

        self.assertTrue(token.startswith("ilr_"))
        stored = next(iter(self.connection.local_runner_tokens.values()))
        self.assertNotEqual(stored["token_hash"], token)
        self.assertEqual(stored["token_hash"], hash_session_token(token))
        self.assertEqual(stored["workspace_id"], "workspace-local")

        valid = validate_local_runner_token(self.connection, token, "workspace-local", require_workspace=True)
        self.assertIsNotNone(valid)
        self.assertEqual(valid["workspace_id"], "workspace-local")
        self.assertIsNotNone(self.connection.local_runner_tokens[stored["id"]]["last_used_at"])
        self.assertIsNone(validate_local_runner_token(self.connection, token, "other-workspace", require_workspace=True))
        self.assertIsNone(validate_local_runner_token(self.connection, token, "", require_workspace=True))

    def test_local_runner_plan_returns_runnable_workspace_queue_items(self) -> None:
        upsert_tumblr_account(
            self.connection,
            {
                "id": "snowleopardx",
                "workspace_id": "workspace-local",
                "display_name": "Snow Leopard",
                "blog_name": "snowleopardx",
                "status": "connected",
                "user_data_dir": "C:/sessions/snowleopardx",
            },
        )
        upsert_queue_item(
            self.connection,
            {
                "id": "local-queue-1",
                "workspace_id": "workspace-local",
                "ad_id": "ad-1",
                "target_id": "target-1",
                "target_name": "inkwell-test",
                "queue_name": "Local queue",
                "submit_url": "https://inkwell-test.tumblr.com/submit",
                "post_type": "photo",
                "tumblr_account_id": "snowleopardx",
                "status": "queued",
                "runner_payload": "{\"fields\":{\"body\":\"Local body\"}}",
            },
        )
        upsert_queue_item(
            self.connection,
            {
                "id": "local-queue-2",
                "workspace_id": "workspace-local",
                "ad_id": "ad-2",
                "target_id": "target-2",
                "target_name": "done",
                "queue_name": "Local queue",
                "submit_url": "https://done.tumblr.com/submit",
                "status": "posted",
                "runner_payload": "{}",
            },
        )
        upsert_queue_item(
            self.connection,
            {
                "id": "local-queue-3",
                "workspace_id": "workspace-local",
                "ad_id": "ad-3",
                "target_id": "target-3",
                "target_name": "review",
                "queue_name": "Local queue",
                "submit_url": "https://review.tumblr.com/submit",
                "status": "needs-review",
                "runner_payload": "{}",
            },
        )

        plan = local_runner_plan(self.connection, "workspace-local", "Local queue")

        self.assertEqual(plan["workflow"], "tumblr-submission-queue")
        self.assertEqual(plan["workspaceId"], "workspace-local")
        self.assertEqual(plan["userDataDir"], "C:/sessions/snowleopardx")
        self.assertEqual(len(plan["items"]), 1)
        self.assertEqual(plan["items"][0]["id"], "local-queue-1")
        self.assertEqual(plan["items"][0]["targetName"], "inkwell-test")
        self.assertIn("Local body", plan["items"][0]["runnerPayload"])

    def test_local_runner_plan_omits_server_session_path(self) -> None:
        upsert_tumblr_account(
            self.connection,
            {
                "id": "server-session",
                "workspace_id": "workspace-local",
                "display_name": "Server Session",
                "blog_name": "server-session",
                "status": "connected",
                "user_data_dir": "/app/.tumblr-sessions/server-session",
            },
        )
        upsert_queue_item(
            self.connection,
            {
                "id": "local-queue-server-session",
                "workspace_id": "workspace-local",
                "ad_id": "ad-server-session",
                "target_id": "target-server-session",
                "target_name": "inkwell-test",
                "queue_name": "Local queue",
                "submit_url": "https://inkwell-test.tumblr.com/submit",
                "post_type": "photo",
                "tumblr_account_id": "server-session",
                "status": "queued",
                "runner_payload": "{}",
            },
        )

        plan = local_runner_plan(self.connection, "workspace-local", "Local queue")

        self.assertEqual(plan["userDataDir"], "")
        self.assertEqual(len(plan["items"]), 1)

    def test_local_runner_command_uses_watch_mode_without_token_placeholder(self) -> None:
        result = local_runner_command("https://example.test/api", "workspace-local", "Local queue")

        self.assertIn("tumblr:runner:local", result["command"])
        self.assertIn("--api-base 'https://example.test/api'", result["command"])
        self.assertIn("--workspace-id 'workspace-local'", result["command"])
        self.assertIn("--queue 'Local queue'", result["command"])
        self.assertIn("--watch", result["command"])
        self.assertIn("--serve", result["command"])
        self.assertNotIn("--no-pause", result["command"])
        self.assertIn("--submit", result["command"])
        self.assertNotIn("<paste", result["command"])
        self.assertIn("tumblr:runner:install-autostart", result["autoStartCommand"])
        self.assertIn("-ApiBase 'https://example.test/api'", result["autoStartCommand"])
        self.assertIn("-WorkspaceId 'workspace-local'", result["autoStartCommand"])
        self.assertIn("-Queue 'Local queue'", result["autoStartCommand"])
        self.assertIn("-Submit", result["autoStartCommand"])

    def test_local_runner_command_can_include_device_token(self) -> None:
        result = local_runner_command("https://example.test/api", "workspace-local", "Local queue", "ilr_secret")

        self.assertIn("--token 'ilr_secret'", result["command"])
        self.assertIn("-RunnerToken 'ilr_secret'", result["autoStartCommand"])
        self.assertTrue(result["tokenConfigured"])
        self.assertTrue(result["usesDeviceToken"])

    def test_local_runner_command_can_disable_submit_for_dry_run(self) -> None:
        result = local_runner_command("https://example.test/api", "workspace-local", "Local queue", "ilr_secret", submit=False)

        self.assertIn("--watch", result["command"])
        self.assertIn("--serve", result["command"])
        self.assertNotIn("--submit", result["command"])
        self.assertNotIn("-Submit", result["autoStartCommand"])

    def test_local_runner_package_includes_installer_assets(self) -> None:
        body, filename = local_runner_package("https://example.test/api", "workspace-local", "Local queue", "ilr_secret")

        self.assertEqual(filename, "inkwell-local-runner.zip")
        with zipfile.ZipFile(io.BytesIO(body)) as archive:
            names = set(archive.namelist())
            self.assertIn("inkwell-local-runner/package.json", names)
            self.assertIn("inkwell-local-runner/README.md", names)
            self.assertIn("inkwell-local-runner/install.ps1", names)
            self.assertIn("inkwell-local-runner/install.cmd", names)
            self.assertIn("inkwell-local-runner/scripts/tumblr-local-runner.mjs", names)
            self.assertIn("inkwell-local-runner/scripts/install-local-runner-autostart.ps1", names)
            readme = archive.read("inkwell-local-runner/README.md").decode("utf-8")
            install_ps1 = archive.read("inkwell-local-runner/install.ps1").decode("utf-8")
            script = archive.read("inkwell-local-runner/scripts/install-local-runner-autostart.ps1").decode("utf-8")

        self.assertIn("Double-click `install.cmd`", readme)
        self.assertIn("npm.cmd run tumblr:install-browsers", install_ps1)
        self.assertIn("Invoke-CheckedCommand", install_ps1)
        self.assertIn("Windows startup task install", install_ps1)
        self.assertIn("-RunnerToken 'ilr_secret'", install_ps1)
        self.assertNotIn("--no-pause", script)
        self.assertIn("-WorkspaceId 'workspace-local'", install_ps1)
        self.assertIn("-Queue 'Local queue'", install_ps1)

    def test_local_runner_autostart_script_uses_valid_windows_run_level(self) -> None:
        script = (Path(__file__).parents[3] / "scripts" / "install-local-runner-autostart.ps1").read_text(encoding="utf-8")

        self.assertIn("-RunLevel Limited", script)
        self.assertNotIn("-RunLevel LeastPrivilege", script)
        self.assertIn("Install-StartupLauncher", script)
        self.assertIn("Install-ProtocolLauncher", script)
        self.assertIn("HKCU:\\Software\\Classes\\inkwell-runner", script)
        self.assertIn("inkwell-runner://start", script)
        self.assertIn("GetFolderPath(\"Startup\")", script)
        self.assertIn("Install-RunnerPackage", script)
        self.assertIn('Join-Path $launcherRoot "runner"', script)
        self.assertIn("Copy-Item -LiteralPath", script)
        self.assertIn('Start-Transcript -Path $logPath -Append', script)
        self.assertIn('"runner.log"', script)
        self.assertIn("runner-launcher.log", script)
        self.assertIn("Local runner exited with code $LASTEXITCODE", script)
        self.assertNotIn("--no-pause", script)
        self.assertIn("Could not register scheduled task", script)
        self.assertNotIn('start "" powershell.exe', script)

    def test_local_runner_heartbeat_reports_online_for_matching_workspace(self) -> None:
        app.LOCAL_RUNNER_HEARTBEAT.clear()
        try:
            status = record_local_runner_heartbeat(
                {
                    "workspace_id": "workspace-local",
                    "queue_name": "Adverts",
                    "watching": True,
                    "status": "watching",
                    "version": "local-runner-test",
                }
            )

            self.assertTrue(status["online"])
            self.assertEqual(status["queue_name"], "Adverts")
            self.assertEqual(status["version"], "local-runner-test")
            self.assertTrue(local_runner_status("workspace-local")["online"])
            self.assertFalse(local_runner_status("other-workspace")["online"])
        finally:
            app.LOCAL_RUNNER_HEARTBEAT.clear()

    def test_persistent_local_runner_heartbeat_updates_device_status(self) -> None:
        created = create_local_runner_token(self.connection, "workspace-local", "Mandy laptop")
        token_record = validate_local_runner_token(self.connection, created["token"], "workspace-local", require_workspace=True)
        self.assertIsNotNone(token_record)

        status = record_persistent_local_runner_heartbeat(
            self.connection,
            token_record,
            {
                "workspace_id": "workspace-local",
                "queue_name": "Adverts",
                "watching": True,
                "status": "watching",
                "version": "local-runner-test",
            },
        )

        self.assertTrue(status["online"])
        self.assertEqual(status["queue_name"], "Adverts")
        self.assertEqual(status["version"], "local-runner-test")
        latest = latest_local_runner_status(self.connection, "workspace-local")
        self.assertTrue(latest["online"])
        self.assertEqual(latest["queue_name"], "Adverts")
        self.assertFalse(latest_local_runner_status(self.connection, "other-workspace")["online"])

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

    def test_start_runner_uses_browserbase_without_visible_local_browser(self) -> None:
        temp_plan = Path("backend-test-runner-plan.json")
        process = Mock()
        process.pid = 456
        process.poll.return_value = None
        old_process = app.RUNNER_PROCESS
        old_command = app.RUNNER_LAST_COMMAND
        old_plan = app.RUNNER_PLAN_PATH
        old_provider = app.RUNNER_LAST_BROWSER_PROVIDER
        old_live_url = app.RUNNER_LAST_LIVE_URL
        app.RUNNER_PROCESS = None
        app.RUNNER_LAST_COMMAND = []
        app.RUNNER_PLAN_PATH = temp_plan
        app.RUNNER_LAST_BROWSER_PROVIDER = "local"
        app.RUNNER_LAST_LIVE_URL = ""
        upsert_tumblr_account(
            self.connection,
            {
                "displayName": "Snow",
                "blogName": "snowleopardx",
                "workspace_id": "workspace-test",
                "status": "connected",
                "browserbaseContextId": "ctx-saved",
            },
        )

        try:
            with (
                patch("app.connect", return_value=ConnectionContext(self.connection)),
                patch("app.visible_tumblr_helper_supported", return_value=False),
                patch(
                    "app.create_browserbase_session",
                    return_value={
                        "id": "session-run",
                        "connectUrl": "wss://connect.browserbase.com/session-run",
                        "expiresAt": "2026-06-19T05:00:00Z",
                    },
                ) as create_session,
                patch("app.browserbase_live_view_url", return_value="https://browserbase.com/live/session-run"),
                patch("app.subprocess.Popen", return_value=process) as popen,
            ):
                result = start_runner(
                    {
                        "workspace_id": "workspace-test",
                        "items": [{"id": "queue-1", "runnerPayload": "{}"}],
                        "remoteBrowserProvider": "browserbase",
                        "tumblrAccountId": "snowleopardx",
                    }
                )

            self.assertTrue(result["running"])
            self.assertEqual(result["browser_provider"], "browserbase")
            self.assertEqual(result["live_url"], "https://browserbase.com/live/session-run")
            self.assertIn("--browserbase-cdp-url", result["command"])
            self.assertIn("wss://connect.browserbase.com/session-run", result["command"])
            self.assertIn("--browserbase-live-url", result["command"])
            create_session.assert_called_once_with("ctx-saved", "snowleopardx", "workspace-test")
            launched_command = popen.call_args.args[0]
            self.assertEqual(launched_command[0], "npm.cmd" if os.name == "nt" else "npm")
            self.assertEqual(self.connection.tumblr_accounts["snowleopardx"]["browserbase_session_id"], "session-run")
        finally:
            if temp_plan.exists():
                temp_plan.unlink()
            app.RUNNER_PROCESS = old_process
            app.RUNNER_LAST_COMMAND = old_command
            app.RUNNER_PLAN_PATH = old_plan
            app.RUNNER_LAST_BROWSER_PROVIDER = old_provider
            app.RUNNER_LAST_LIVE_URL = old_live_url

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

    def test_start_runner_reports_process_launch_failure(self) -> None:
        temp_plan = Path("backend-test-runner-plan.json")
        old_process = app.RUNNER_PROCESS
        old_command = app.RUNNER_LAST_COMMAND
        old_plan = app.RUNNER_PLAN_PATH
        old_run_id = app.RUNNER_LAST_RUN_ID
        old_provider = app.RUNNER_LAST_BROWSER_PROVIDER
        old_live_url = app.RUNNER_LAST_LIVE_URL
        app.RUNNER_PROCESS = None
        app.RUNNER_LAST_COMMAND = []
        app.RUNNER_PLAN_PATH = temp_plan
        app.RUNNER_LAST_RUN_ID = "run-old"
        app.RUNNER_LAST_BROWSER_PROVIDER = "browserbase"
        app.RUNNER_LAST_LIVE_URL = "https://browserbase.example/live"

        try:
            with patch("app.subprocess.Popen", side_effect=FileNotFoundError("node not found")):
                with self.assertRaisesRegex(ValueError, "Could not start the Tumblr runner process"):
                    start_runner({"items": [{"id": "queue-1", "runnerPayload": "{}"}]})

            self.assertEqual(app.RUNNER_LAST_COMMAND, [])
            self.assertEqual(app.RUNNER_LAST_RUN_ID, "")
            self.assertEqual(app.RUNNER_LAST_BROWSER_PROVIDER, "local")
            self.assertEqual(app.RUNNER_LAST_LIVE_URL, "")
        finally:
            if temp_plan.exists():
                temp_plan.unlink()
            app.RUNNER_PROCESS = old_process
            app.RUNNER_LAST_COMMAND = old_command
            app.RUNNER_PLAN_PATH = old_plan
            app.RUNNER_LAST_RUN_ID = old_run_id
            app.RUNNER_LAST_BROWSER_PROVIDER = old_provider
            app.RUNNER_LAST_LIVE_URL = old_live_url

    def test_start_runner_rejects_unsupported_visible_browser_environment(self) -> None:
        temp_plan = Path("backend-test-runner-plan.json")
        old_process = app.RUNNER_PROCESS
        old_plan = app.RUNNER_PLAN_PATH
        app.RUNNER_PROCESS = None
        app.RUNNER_PLAN_PATH = temp_plan

        try:
            with (
                patch("app.visible_tumblr_helper_supported", return_value=False),
                patch("app.subprocess.Popen") as popen,
            ):
                with self.assertRaisesRegex(ValueError, "visible browser"):
                    start_runner({"items": [{"id": "queue-1", "runnerPayload": "{}"}]})

            popen.assert_not_called()
            self.assertFalse(temp_plan.exists())
        finally:
            if temp_plan.exists():
                temp_plan.unlink()
            app.RUNNER_PROCESS = old_process
            app.RUNNER_PLAN_PATH = old_plan

if __name__ == "__main__":
    unittest.main()
