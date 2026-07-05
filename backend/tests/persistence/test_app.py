from __future__ import annotations

import io
import json
import os
import re
import unittest
import uuid
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
    origin_allowed_for_request,
    request_password_reset,
    record_runner_log,
    run,
    settings_statistics,
    start_runner,
    upsert_app_settings,
    upsert_advertisement,
    upsert_queue_item,
    upsert_template,
    upsert_tumblr_account,
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


class ScopedRows(dict[str | tuple[str, str], dict[str, Any]]):
    @staticmethod
    def key(workspace_id: Any, row_id: Any) -> tuple[str, str]:
        return (str(workspace_id), str(row_id))

    def _legacy_key(self, row_id: Any) -> str | tuple[str, str]:
        key = str(row_id)
        if dict.__contains__(self, key):
            return key
        matches = [stored_key for stored_key, row in self.items() if str(row.get("id")) == key]
        if len(matches) == 1:
            return matches[0]
        return key

    def __getitem__(self, key: str | tuple[str, str]) -> dict[str, Any]:
        if isinstance(key, tuple):
            return dict.__getitem__(self, key)
        return dict.__getitem__(self, self._legacy_key(key))

    def get(self, key: str | tuple[str, str], default: Any = None) -> Any:
        if isinstance(key, tuple):
            return dict.get(self, key, default)
        return dict.get(self, self._legacy_key(key), default)

    def pop(self, key: str | tuple[str, str], default: Any = None) -> Any:
        if isinstance(key, tuple):
            return dict.pop(self, key, default)
        return dict.pop(self, self._legacy_key(key), default)


class FakePostgresConnection:
    def __init__(self) -> None:
        self.advertisements: ScopedRows = ScopedRows()
        self.advertisement_tags: dict[tuple[str, str], dict[str, Any]] = {}
        self.auth_attempts: dict[str, dict[str, Any]] = {}
        self.local_runner_tokens: dict[str, dict[str, Any]] = {}
        self.queue_definitions: ScopedRows = ScopedRows()
        self.queue_schedule_settings: ScopedRows = ScopedRows()
        self.runner_logs: dict[str, dict[str, Any]] = {}
        self.runner_log_details: dict[tuple[str, str], dict[str, Any]] = {}
        self.runner_settings: ScopedRows = ScopedRows()
        self.schema_migrations: dict[str, dict[str, Any]] = {}
        self.settings_audit_events: dict[str, dict[str, Any]] = {}
        self.submission_queue: ScopedRows = ScopedRows()
        self.submission_queue_runner_payload_values: dict[tuple[str, str], dict[str, Any]] = {}
        self.submit_targets: ScopedRows = ScopedRows()
        self.tag_profile_tags: dict[tuple[str, str], dict[str, Any]] = {}
        self.templates: ScopedRows = ScopedRows()
        self.template_tags: dict[tuple[str, str], dict[str, Any]] = {}
        self.tumblr_accounts: ScopedRows = ScopedRows()
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

        if normalized.startswith("select a.attname as column_name from pg_index"):
            primary_keys = getattr(self, "primary_keys", {})
            return FakeCursor([{"column_name": column} for column in primary_keys.get(str(params[0]), ())])

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
            updates: list[tuple[Any, tuple[str, str], dict[str, Any]]] = []
            for key, row in list(table.items()):
                if row.get("workspace_id", "default") == params[1]:
                    row["workspace_id"] = params[0]
                    if isinstance(table, ScopedRows):
                        updates.append((key, ScopedRows.key(row["workspace_id"], row["id"]), row))
            for old_key, new_key, row in updates:
                table.pop(old_key, None)
                table[new_key] = row
            if table_name in {"advertisement_tags", "template_tags", "tag_profile_tags", "submission_queue_runner_payload_values"}:
                rekeyed: dict[tuple[str, str], dict[str, Any]] = {}
                for row in table.values():
                    if table_name == "advertisement_tags":
                        key = (f"{row['workspace_id']}:{row['advertisement_id']}", str(row["tag"]))
                    elif table_name == "template_tags":
                        key = (f"{row['workspace_id']}:{row['template_id']}", str(row["tag"]))
                    elif table_name == "tag_profile_tags":
                        key = (f"{row['workspace_id']}:{row['blog_id']}", str(row["tag"]))
                    else:
                        key = (f"{row['workspace_id']}:{row['queue_item_id']}", str(row["payload_path"]))
                    rekeyed[key] = row
                table.clear()
                table.update(rekeyed)
            return FakeCursor()

        if normalized.startswith("select created_at from advertisements"):
            row = self.advertisements.get(ScopedRows.key(params[1], params[0]) if len(params) > 1 else str(params[0]))
            return FakeCursor([{"created_at": row["created_at"]}] if row else [])

        if normalized.startswith("select * from advertisements where id"):
            row = self.advertisements.get(ScopedRows.key(params[1], params[0]) if len(params) > 1 else str(params[0]))
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
                "campaign_name": params[4],
                "content": params[5],
                "destination_blog": params[6],
                "forum_url": params[7],
                "image_caption": params[8],
                "image_name": params[9],
                "image_data_url": params[10],
                "video_url": params[11],
                "video_name": params[12],
                "status": params[13],
                "archived": params[14],
                "created_at": params[15],
                "updated_at": params[16],
            }
            self.advertisements[ScopedRows.key(row["workspace_id"], row["id"])] = row
            return FakeCursor()

        if normalized.startswith("delete from advertisements"):
            self.advertisements.pop(ScopedRows.key(params[1], params[0]) if len(params) > 1 else str(params[0]), None)
            return FakeCursor()

        if normalized.startswith("update advertisement_tags set workspace_id"):
            for key, row in list(self.advertisement_tags.items()):
                if row["advertisement_id"] == params[1]:
                    row["workspace_id"] = params[0]
                    self.advertisement_tags.pop(key, None)
                    self.advertisement_tags[(f"{row['workspace_id']}:{row['advertisement_id']}", str(row["tag"]))] = row
            return FakeCursor()

        if normalized.startswith("delete from advertisement_tags"):
            workspace_id = str(params[1]) if len(params) > 1 else None
            for key in [
                key
                for key, row in self.advertisement_tags.items()
                if row["advertisement_id"] == params[0] and (workspace_id is None or row.get("workspace_id") == workspace_id)
            ]:
                self.advertisement_tags.pop(key, None)
            return FakeCursor()

        if normalized.startswith("insert into advertisement_tags"):
            row = {
                "advertisement_id": params[0],
                "workspace_id": params[1],
                "tag": params[2],
                "sort_order": params[3],
                "created_at": params[4],
                "updated_at": params[5],
            }
            self.advertisement_tags[(f"{row['workspace_id']}:{row['advertisement_id']}", str(row["tag"]))] = row
            return FakeCursor()

        if normalized.startswith("select tag from advertisement_tags"):
            workspace_id = str(params[1]) if len(params) > 1 else None
            rows = [
                row
                for row in self.advertisement_tags.values()
                if row["advertisement_id"] == params[0] and (workspace_id is None or row.get("workspace_id") == workspace_id)
            ]
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
                "profile_name": params[3],
                "submit_url": params[4],
                "forum_url": params[5],
                "posting_rules": params[6],
                "created_at": params[7],
                "updated_at": params[8],
            }
            self.submit_targets[ScopedRows.key(row["workspace_id"], row["id"])] = row
            return FakeCursor()

        if normalized.startswith("select * from submit_targets order by"):
            return FakeCursor(sorted(self.submit_targets.values(), key=lambda row: row["name"]))

        if normalized.startswith("select * from submit_targets where id"):
            row = self.submit_targets.get(ScopedRows.key(params[1], params[0]) if len(params) > 1 else str(params[0]))
            return FakeCursor([row] if row else [])

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
            self.queue_definitions[ScopedRows.key(row["workspace_id"], row["id"])] = row
            return FakeCursor()

        if normalized.startswith("select * from queue_definitions order by"):
            return FakeCursor(sorted(self.queue_definitions.values(), key=lambda row: row["name"]))

        if normalized.startswith("select * from queue_definitions where id"):
            row = self.queue_definitions.get(ScopedRows.key(params[1], params[0]) if len(params) > 1 else str(params[0]))
            return FakeCursor([row] if row else [])

        if normalized.startswith("select * from queue_definitions where workspace_id"):
            return FakeCursor(sorted([row for row in self.queue_definitions.values() if row.get("workspace_id") == params[0]], key=lambda row: row["name"]))

        if normalized.startswith("select created_at from tumblr_accounts"):
            row = self.tumblr_accounts.get(ScopedRows.key(params[1], params[0]) if len(params) > 1 else str(params[0]))
            return FakeCursor([{"created_at": row["created_at"]}] if row else [])

        if normalized.startswith("select * from tumblr_accounts where id"):
            row = self.tumblr_accounts.get(ScopedRows.key(params[1], params[0]) if len(params) > 1 else str(params[0]))
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
            self.tumblr_accounts[ScopedRows.key(row["workspace_id"], row["id"])] = row
            return FakeCursor()

        if normalized.startswith("delete from tumblr_accounts"):
            self.tumblr_accounts.pop(ScopedRows.key(params[1], params[0]) if len(params) > 1 else str(params[0]), None)
            return FakeCursor()

        if normalized.startswith("delete from tag_profile_tags") and not params:
            self.tag_profile_tags.clear()
            return FakeCursor()

        if normalized.startswith("delete from tag_profile_tags"):
            if "workspace_id" in normalized:
                if len(params) > 1 and "blog_id" in normalized:
                    for key in [
                        key
                        for key, row in self.tag_profile_tags.items()
                        if row.get("blog_id") == params[0] and row.get("workspace_id") == params[1]
                    ]:
                        self.tag_profile_tags.pop(key, None)
                else:
                    for key in [key for key, row in self.tag_profile_tags.items() if row.get("workspace_id") == params[0]]:
                        self.tag_profile_tags.pop(key, None)
            else:
                for key in [key for key, row in self.tag_profile_tags.items() if row.get("blog_id") == params[0]]:
                    self.tag_profile_tags.pop(key, None)
            return FakeCursor()

        if normalized.startswith("update tag_profile_tags set workspace_id"):
            for key, row in list(self.tag_profile_tags.items()):
                if row["blog_id"] == params[1]:
                    row["workspace_id"] = params[0]
                    self.tag_profile_tags.pop(key, None)
                    self.tag_profile_tags[(f"{row['workspace_id']}:{row['blog_id']}", str(row["tag"]))] = row
            return FakeCursor()

        if normalized.startswith("insert into tag_profile_tags"):
            row = {
                "blog_id": params[0],
                "workspace_id": params[1],
                "tag": params[2],
                "sort_order": params[3],
                "created_at": params[4],
                "updated_at": params[5],
            }
            self.tag_profile_tags[(f"{row['workspace_id']}:{row['blog_id']}", str(row["tag"]))] = row
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
            self.runner_settings[ScopedRows.key(row["workspace_id"], row["id"])] = row
            return FakeCursor()

        if normalized.startswith("select * from runner_settings where id"):
            row = self.runner_settings.get(ScopedRows.key(params[1], params[0]) if len(params) > 1 else str(params[0]))
            return FakeCursor([row] if row else [])

        if normalized.startswith("select * from runner_settings where workspace_id"):
            rows = [row for row in self.runner_settings.values() if row.get("workspace_id") == params[0]]
            return FakeCursor(rows)

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
            self.queue_schedule_settings[ScopedRows.key(row["workspace_id"], row["id"])] = row
            return FakeCursor()

        if normalized.startswith("select * from queue_schedule_settings where id"):
            row = self.queue_schedule_settings.get(ScopedRows.key(params[1], params[0]) if len(params) > 1 else str(params[0]))
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
            row = self.templates.get(ScopedRows.key(params[1], params[0]) if len(params) > 1 else str(params[0]))
            return FakeCursor([{"created_at": row["created_at"]}] if row else [])

        if normalized.startswith("select * from templates where id"):
            row = self.templates.get(ScopedRows.key(params[1], params[0]) if len(params) > 1 else str(params[0]))
            return FakeCursor([row] if row else [])

        if normalized.startswith("select * from templates order by"):
            return FakeCursor(sorted(self.templates.values(), key=lambda row: row["name"]))

        if normalized.startswith("select * from templates where workspace_id"):
            rows = [row for row in self.templates.values() if row.get("workspace_id") == params[0]]
            return FakeCursor(sorted(rows, key=lambda row: row["name"]))

        if normalized.startswith("insert into templates"):
            workspace_id = params[1] if "workspace_id" in normalized else "default"
            if "do nothing" in normalized and ScopedRows.key(workspace_id, params[0]) in self.templates:
                return FakeCursor()

            if "workspace_id" in normalized and len(params) == 8:
                row = {
                    "id": params[0],
                    "workspace_id": params[1],
                    "name": params[2],
                    "content": params[3],
                    "forum_url": params[4],
                    "queue_name": params[5],
                    "created_at": params[6],
                    "updated_at": params[7],
                }
            elif "workspace_id" in normalized:
                row = {
                    "id": params[0],
                    "workspace_id": params[1],
                    "name": params[2],
                    "content": params[3],
                    "forum_url": params[4],
                    "queue_name": "",
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
                    "queue_name": "",
                    "created_at": params[4],
                    "updated_at": params[5],
                }
            self.templates[ScopedRows.key(row["workspace_id"], row["id"])] = row
            return FakeCursor()

        if normalized.startswith("update template_tags set workspace_id"):
            for key, row in list(self.template_tags.items()):
                if row["template_id"] == params[1]:
                    row["workspace_id"] = params[0]
                    self.template_tags.pop(key, None)
                    self.template_tags[(f"{row['workspace_id']}:{row['template_id']}", str(row["tag"]))] = row
            return FakeCursor()

        if normalized.startswith("delete from template_tags"):
            workspace_id = str(params[1]) if len(params) > 1 else None
            for key in [
                key
                for key, row in self.template_tags.items()
                if row["template_id"] == params[0] and (workspace_id is None or row.get("workspace_id") == workspace_id)
            ]:
                self.template_tags.pop(key, None)
            return FakeCursor()

        if normalized.startswith("insert into template_tags"):
            row = {
                "template_id": params[0],
                "workspace_id": params[1],
                "tag": params[2],
                "sort_order": params[3],
                "created_at": params[4],
                "updated_at": params[5],
            }
            self.template_tags[(f"{row['workspace_id']}:{row['template_id']}", str(row["tag"]))] = row
            return FakeCursor()

        if normalized.startswith("select tag from template_tags"):
            workspace_id = str(params[1]) if len(params) > 1 else None
            rows = [
                row
                for row in self.template_tags.values()
                if row["template_id"] == params[0] and (workspace_id is None or row.get("workspace_id") == workspace_id)
            ]
            return FakeCursor(sorted(rows, key=lambda row: (row["sort_order"], row["tag"])))

        if normalized.startswith("delete from templates"):
            self.templates.pop(ScopedRows.key(params[1], params[0]) if len(params) > 1 else str(params[0]), None)
            return FakeCursor()

        if normalized.startswith("select created_at from submission_queue"):
            row = self.submission_queue.get(ScopedRows.key(params[1], params[0]) if len(params) > 1 else str(params[0]))
            return FakeCursor([{"created_at": row["created_at"]}] if row else [])

        if normalized.startswith("select * from submission_queue where id"):
            row = self.submission_queue.get(ScopedRows.key(params[1], params[0]) if len(params) > 1 else str(params[0]))
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
            self.submission_queue[ScopedRows.key(row["workspace_id"], row["id"])] = row
            return FakeCursor()

        if normalized.startswith("delete from submission_queue_runner_payload_values"):
            workspace_id = str(params[1]) if len(params) > 1 else None
            for key in [
                key
                for key, row in self.submission_queue_runner_payload_values.items()
                if row["queue_item_id"] == params[0] and (workspace_id is None or row.get("workspace_id") == workspace_id)
            ]:
                self.submission_queue_runner_payload_values.pop(key, None)
            return FakeCursor()

        if normalized.startswith("insert into submission_queue_runner_payload_values"):
            row = {
                "queue_item_id": params[0],
                "workspace_id": params[1],
                "payload_path": params[2],
                "sort_order": params[3],
                "value_type": params[4],
                "value_text": params[5],
                "created_at": params[6],
                "updated_at": params[7],
            }
            self.submission_queue_runner_payload_values[(f"{row['workspace_id']}:{row['queue_item_id']}", str(row["payload_path"]))] = row
            return FakeCursor()

        if normalized.startswith("select payload_path, value_type, value_text from submission_queue_runner_payload_values"):
            workspace_id = str(params[1]) if len(params) > 1 else None
            rows = [
                row
                for row in self.submission_queue_runner_payload_values.values()
                if row["queue_item_id"] == params[0] and (workspace_id is None or row.get("workspace_id") == workspace_id)
            ]
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
            for key, row in list(self.submission_queue_runner_payload_values.items()):
                if row["queue_item_id"] == params[1]:
                    row["workspace_id"] = params[0]
                    self.submission_queue_runner_payload_values.pop(key, None)
                    self.submission_queue_runner_payload_values[(f"{row['workspace_id']}:{row['queue_item_id']}", str(row["payload_path"]))] = row
            return FakeCursor()

        if normalized.startswith("delete from submission_queue"):
            self.submission_queue.pop(ScopedRows.key(params[1], params[0]) if len(params) > 1 else str(params[0]), None)
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
            workspace_id = str(params[1]) if len(params) > 1 else None
            for key in [
                key
                for key, row in self.runner_log_details.items()
                if row["log_id"] == params[0] and (workspace_id is None or row.get("workspace_id") == workspace_id)
            ]:
                self.runner_log_details.pop(key, None)
            return FakeCursor()

        if normalized.startswith("insert into runner_log_details"):
            if "on conflict(log_id, detail_key)" in normalized:
                raise AssertionError("runner_log_details writes must conflict on workspace_id, log_id, and detail_key")
            row = {
                "log_id": params[0],
                "workspace_id": params[1],
                "detail_key": params[2],
                "detail_value": params[3],
                "created_at": params[4],
            }
            self.runner_log_details[(f"{row['workspace_id']}:{row['log_id']}", str(row["detail_key"]))] = row
            return FakeCursor()

        if normalized.startswith("select detail_key, detail_value from runner_log_details"):
            workspace_id = str(params[1]) if len(params) > 1 else None
            rows = [
                row
                for row in self.runner_log_details.values()
                if row["log_id"] == params[0] and (workspace_id is None or row.get("workspace_id") == workspace_id)
            ]
            return FakeCursor(sorted(rows, key=lambda row: row["detail_key"]))

        if normalized.startswith("update runner_log_details set workspace_id"):
            for key, row in list(self.runner_log_details.items()):
                if row["log_id"] == params[1]:
                    row["workspace_id"] = params[0]
                    self.runner_log_details.pop(key, None)
                    self.runner_log_details[(f"{row['workspace_id']}:{row['log_id']}", str(row["detail_key"]))] = row
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


class RecordingPostgresConnection(FakePostgresConnection):
    def __init__(self) -> None:
        super().__init__()
        self.executed_sql: list[str] = []

    def execute(self, query: str, params: tuple[Any, ...] | None = None) -> FakeCursor:
        self.executed_sql.append(" ".join(query.split()).lower())
        return super().execute(query, params)


class ConstraintCheckingPostgresConnection(RecordingPostgresConnection):
    def __init__(self, existing_old_schema: bool = False) -> None:
        super().__init__()
        self.existing_old_schema = existing_old_schema
        self.primary_keys: dict[str, tuple[str, ...]] = {
            "advertisements": ("id",),
            "templates": ("id",),
            "submission_queue": ("id",),
            "tumblr_accounts": ("id",),
            "submit_targets": ("id",),
            "queue_definitions": ("id",),
            "runner_settings": ("id",),
            "queue_schedule_settings": ("id",),
            "advertisement_tags": ("advertisement_id", "tag"),
            "template_tags": ("template_id", "tag"),
            "tag_profile_tags": ("blog_id", "tag"),
            "runner_log_details": ("log_id", "detail_key"),
            "submission_queue_runner_payload_values": ("queue_item_id", "payload_path"),
        } if existing_old_schema else {}

    def execute(self, query: str, params: tuple[Any, ...] | None = None) -> FakeCursor:
        normalized = " ".join(query.split()).lower()
        create_match = re.search(r"create table if not exists ([a-z_]+) .* primary key \(([^)]+)\)", normalized)
        if create_match and not self.existing_old_schema:
            self.primary_keys[create_match.group(1)] = tuple(column.strip() for column in create_match.group(2).split(","))

        alter_match = re.search(r"alter table ([a-z_]+) add constraint [a-z_]+_pkey primary key \(([^)]+)\)", normalized)
        if alter_match:
            self.primary_keys[alter_match.group(1)] = tuple(column.strip() for column in alter_match.group(2).split(","))

        insert_match = re.search(r"insert into ([a-z_]+).* on conflict\(([^)]+)\)", normalized)
        if insert_match:
            table = insert_match.group(1)
            conflict_columns = tuple(column.strip() for column in insert_match.group(2).split(","))
            primary_key = self.primary_keys.get(table)
            if primary_key and conflict_columns != primary_key:
                raise AssertionError(f"{table} conflict target {conflict_columns} does not match primary key {primary_key}")

        return super().execute(query, params)


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

    def test_initialize_emits_workspace_scoped_primary_key_sql_for_scoped_tables(self) -> None:
        connection = ConstraintCheckingPostgresConnection(existing_old_schema=True)
        initialize(connection)
        executed_sql = "\n".join(connection.executed_sql)

        for table, key_columns in {
            "advertisements": "workspace_id, id",
            "templates": "workspace_id, id",
            "submission_queue": "workspace_id, id",
            "tumblr_accounts": "workspace_id, id",
            "submit_targets": "workspace_id, id",
            "queue_definitions": "workspace_id, id",
            "runner_settings": "workspace_id, id",
            "queue_schedule_settings": "workspace_id, id",
            "advertisement_tags": "workspace_id, advertisement_id, tag",
            "template_tags": "workspace_id, template_id, tag",
            "tag_profile_tags": "workspace_id, blog_id, tag",
            "runner_log_details": "workspace_id, log_id, detail_key",
            "submission_queue_runner_payload_values": "workspace_id, queue_item_id, payload_path",
        }.items():
            self.assertIn(f"alter table {table} add constraint {table}_pkey primary key ({key_columns})", executed_sql)

    def test_initialize_does_not_remap_primary_keys_after_schema_version_is_applied(self) -> None:
        connection = RecordingPostgresConnection()
        initialize(connection)
        first_run_key_remaps = [
            sql for sql in connection.executed_sql if "add constraint" in sql and "primary key" in sql
        ]
        self.assertGreater(len(first_run_key_remaps), 0)

        connection.executed_sql.clear()
        initialize(connection)

        second_run_key_remaps = [
            sql for sql in connection.executed_sql if "add constraint" in sql and "primary key" in sql
        ]
        self.assertEqual(second_run_key_remaps, [])

    def test_runner_log_details_use_workspace_scoped_conflict_target(self) -> None:
        connection = ConstraintCheckingPostgresConnection()
        initialize(connection)
        upsert_queue_item(
            connection,
            {
                "id": "queue-log-sql",
                "workspace_id": "workspace-sql",
                "ad_id": "ad-1",
                "target_id": "target-1",
                "target_name": "Target",
                "submit_url": "https://example.tumblr.com/submit",
                "runner_payload": "{}",
            },
        )

        log = record_runner_log(
            connection,
            {
                "queue_item_id": "queue-log-sql",
                "workspace_id": "workspace-sql",
                "run_id": "run-sql",
                "level": "info",
                "status": "submitted",
                "message": "Submit button clicked.",
                "details": {"submit": True},
            },
        )

        executed_sql = "\n".join(connection.executed_sql)
        self.assertIn("delete from runner_log_details where log_id = %s and workspace_id = %s", executed_sql)
        self.assertIn("on conflict(workspace_id, log_id, detail_key) do update", executed_sql)
        self.assertNotIn("on conflict(log_id, detail_key)", executed_sql)
        self.assertEqual(connection.runner_log_details[(f"workspace-sql:{log['id']}", "submit")]["workspace_id"], "workspace-sql")

    def test_workspace_scoped_conflict_paths_match_declared_primary_keys(self) -> None:
        connection = ConstraintCheckingPostgresConnection()
        initialize(connection)

        for workspace_id, title in (("workspace-one", "Original"), ("workspace-two", "Second")):
            upsert_advertisement(
                connection,
                {
                    "id": "shared-ad",
                    "workspace_id": workspace_id,
                    "title": title,
                    "destination_blog": "snowleopardx",
                    "tags": ["jcink", "forum rp"],
                },
            )
            upsert_template(
                connection,
                {
                    "id": "shared-template",
                    "workspace_id": workspace_id,
                    "name": f"{title} template",
                    "content": "<p>Copy</p>",
                    "tags": ["wanted"],
                },
            )
            upsert_tumblr_account(
                connection,
                {
                    "id": "shared-account",
                    "workspace_id": workspace_id,
                    "display_name": f"{title} account",
                    "blog_name": "snowleopardx",
                },
            )
            upsert_queue_item(
                connection,
                {
                    "id": "shared-queue",
                    "workspace_id": workspace_id,
                    "ad_id": "shared-ad",
                    "target_id": "shared-target",
                    "target_name": "Target",
                    "submit_url": "https://example.tumblr.com/submit",
                    "runner_payload": json.dumps({"fields": {"body": title}}),
                },
            )
            upsert_app_settings(
                connection,
                {
                    "submitTargets": [{"id": "shared-target", "name": "Target", "submitUrl": "https://example.tumblr.com/submit"}],
                    "queueDefinitions": [{"id": "shared-queue-definition", "name": "Default queue"}],
                    "tagProfiles": {"snowleopardx": ["jcink"]},
                    "runnerSettings": {"slowMo": 500},
                    "queueScheduleSettings": {"enabled": True, "dailyTime": "09:00"},
                },
                workspace_id=workspace_id,
            )
            record_runner_log(
                connection,
                {
                    "queue_item_id": "shared-queue",
                    "workspace_id": workspace_id,
                    "run_id": f"run-{workspace_id}",
                    "level": "info",
                    "status": "submitted",
                    "message": "Submit button clicked.",
                    "details": {"workspace": workspace_id},
                },
            )

        self.assertEqual(connection.advertisements[("workspace-one", "shared-ad")]["title"], "Original")
        self.assertEqual(connection.advertisements[("workspace-two", "shared-ad")]["title"], "Second")
        self.assertEqual(connection.templates[("workspace-one", "shared-template")]["name"], "Original template")
        self.assertEqual(connection.templates[("workspace-two", "shared-template")]["name"], "Second template")
        self.assertEqual(connection.tumblr_accounts[("workspace-one", "shared-account")]["display_name"], "Original account")
        self.assertEqual(connection.tumblr_accounts[("workspace-two", "shared-account")]["display_name"], "Second account")
        self.assertEqual(connection.submission_queue[("workspace-one", "shared-queue")]["workspace_id"], "workspace-one")
        self.assertEqual(connection.submission_queue[("workspace-two", "shared-queue")]["workspace_id"], "workspace-two")
        self.assertEqual(connection.runner_settings[("workspace-one", "default")]["slow_mo"], 500)
        self.assertEqual(connection.queue_schedule_settings[("workspace-two", "default")]["daily_time"], "09:00")

    def test_postgres_workspace_scoped_constraints_and_conflicts(self) -> None:
        dsn = os.environ.get("INWELL_TEST_POSTGRES_DSN")
        if not dsn:
            self.skipTest("INWELL_TEST_POSTGRES_DSN is not configured")

        schema_name = f"inwell_test_{uuid.uuid4().hex}"
        with app.psycopg.connect(dsn, row_factory=app.dict_row) as connection:
            connection.execute(f'CREATE SCHEMA "{schema_name}"')
            connection.execute(f'SET search_path TO "{schema_name}"')
            try:
                initialize(connection)
                for table, columns in app.workspace_scoped_primary_keys().items():
                    self.assertEqual(app.primary_key_columns(connection, table), columns)

                for workspace_id, title in (("workspace-one", "Original"), ("workspace-two", "Second")):
                    upsert_advertisement(
                        connection,
                        {
                            "id": "shared-ad",
                            "workspace_id": workspace_id,
                            "title": title,
                            "destination_blog": "snowleopardx",
                            "tags": ["jcink", "forum rp"],
                        },
                    )
                    upsert_template(
                        connection,
                        {
                            "id": "shared-template",
                            "workspace_id": workspace_id,
                            "name": f"{title} template",
                            "content": "<p>Copy</p>",
                            "tags": ["wanted"],
                        },
                    )
                    upsert_tumblr_account(
                        connection,
                        {
                            "id": "shared-account",
                            "workspace_id": workspace_id,
                            "display_name": f"{title} account",
                            "blog_name": "snowleopardx",
                        },
                    )
                    upsert_queue_item(
                        connection,
                        {
                            "id": "shared-queue",
                            "workspace_id": workspace_id,
                            "ad_id": "shared-ad",
                            "target_id": "shared-target",
                            "target_name": "Target",
                            "submit_url": "https://example.tumblr.com/submit",
                            "runner_payload": json.dumps({"fields": {"body": title}}),
                        },
                    )
                    upsert_app_settings(
                        connection,
                        {
                            "submitTargets": [
                                {"id": "shared-target", "name": "Target", "submitUrl": "https://example.tumblr.com/submit"}
                            ],
                            "queueDefinitions": [{"id": "shared-queue-definition", "name": "Default queue"}],
                            "tagProfiles": {"snowleopardx": ["jcink"]},
                            "runnerSettings": {"slowMo": 500},
                            "queueScheduleSettings": {"enabled": True, "dailyTime": "09:00"},
                        },
                        workspace_id=workspace_id,
                    )
                    record_runner_log(
                        connection,
                        {
                            "queue_item_id": "shared-queue",
                            "workspace_id": workspace_id,
                            "run_id": f"run-{workspace_id}",
                            "level": "info",
                            "status": "submitted",
                            "message": "Submit button clicked.",
                            "details": {"workspace": workspace_id},
                        },
                    )

                first_ad = connection.execute(
                    "SELECT * FROM advertisements WHERE id = %s AND workspace_id = %s", ("shared-ad", "workspace-one")
                ).fetchone()
                second_ad = connection.execute(
                    "SELECT * FROM advertisements WHERE id = %s AND workspace_id = %s", ("shared-ad", "workspace-two")
                ).fetchone()
                self.assertEqual(first_ad["title"], "Original")
                self.assertEqual(second_ad["title"], "Second")
                details = connection.execute(
                    "SELECT * FROM runner_log_details WHERE workspace_id = %s ORDER BY detail_key", ("workspace-two",)
                ).fetchall()
                self.assertTrue(any(row["detail_key"] == "workspace" and row["detail_value"] == "workspace-two" for row in details))
            finally:
                connection.execute(f'DROP SCHEMA "{schema_name}" CASCADE')

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
                "campaign_name": "Summer campaign",
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
                "archived": False,
            },
        )

        self.assertEqual(saved["id"], "ad-1")
        self.assertEqual(saved["post_type"], "video")
        self.assertEqual(saved["campaign_name"], "Summer campaign")
        self.assertEqual(saved["content"], "<p>Optional copy</p>")
        self.assertEqual(saved["tags"], ["#jcink", "#forum rp"])
        self.assertEqual([row["tag"] for row in self.connection.advertisement_tags.values()], ["#jcink", "#forum rp"])
        self.assertEqual(saved["image_caption"], "Picture post caption")
        self.assertEqual(saved["video_url"], "https://video.example.test/watch")
        self.assertEqual(saved["video_name"], "tour.mp4")
        self.assertFalse(saved["archived"])

        updated = upsert_advertisement(
            self.connection,
            {
                **saved,
                "title": "Updated title",
                "tags": [],
                "status": "ready",
                "archived": True,
            },
        )

        self.assertEqual(updated["title"], "Updated title")
        self.assertEqual(updated["tags"], [])
        self.assertEqual(self.connection.advertisement_tags, {})
        self.assertEqual(updated["status"], "ready")
        self.assertTrue(updated["archived"])

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
                "queue_name": "Wanted Ads",
                "tags": ["#custom"],
            },
        )

        self.assertEqual(saved["name"], "Custom template")
        self.assertEqual(saved["queue_name"], "Wanted Ads")
        self.assertEqual(saved["tags"], ["#custom"])
        self.assertEqual(
            [row["tag"] for row in self.connection.template_tags.values() if row["template_id"] == "template-custom"],
            ["#custom"],
        )

    def test_workspace_scoped_upserts_keep_cross_workspace_ids_isolated(self) -> None:
        upsert_advertisement(
            self.connection,
            {
                "id": "shared-ad",
                "workspace_id": "workspace-one",
                "title": "Original",
                "destination_blog": "snowleopardx",
            },
        )
        upsert_advertisement(
            self.connection,
            {
                "id": "shared-ad",
                "workspace_id": "workspace-two",
                "title": "Second workspace",
                "destination_blog": "snowleopardx",
            },
        )
        self.assertEqual(self.connection.advertisements[("workspace-one", "shared-ad")]["title"], "Original")
        self.assertEqual(self.connection.advertisements[("workspace-two", "shared-ad")]["title"], "Second workspace")

        upsert_template(
            self.connection,
            {
                "id": "shared-template",
                "workspace_id": "workspace-one",
                "name": "Original template",
                "content": "<p>Safe</p>",
            },
        )
        upsert_template(
            self.connection,
            {
                "id": "shared-template",
                "workspace_id": "workspace-two",
                "name": "Second template",
                "content": "<p>Changed</p>",
            },
        )
        self.assertEqual(self.connection.templates[("workspace-one", "shared-template")]["name"], "Original template")
        self.assertEqual(self.connection.templates[("workspace-two", "shared-template")]["name"], "Second template")

        upsert_tumblr_account(
            self.connection,
            {
                "id": "shared-account",
                "workspace_id": "workspace-one",
                "display_name": "Original account",
                "blog_name": "original",
            },
        )
        upsert_tumblr_account(
            self.connection,
            {
                "id": "shared-account",
                "workspace_id": "workspace-two",
                "display_name": "Second account",
                "blog_name": "second",
            },
        )
        self.assertEqual(self.connection.tumblr_accounts[("workspace-one", "shared-account")]["display_name"], "Original account")
        self.assertEqual(self.connection.tumblr_accounts[("workspace-two", "shared-account")]["display_name"], "Second account")

        upsert_queue_item(
            self.connection,
            {
                "id": "shared-queue",
                "workspace_id": "workspace-one",
                "ad_id": "ad-1",
                "target_id": "target-1",
                "target_name": "Target",
                "submit_url": "https://example.tumblr.com/submit",
                "runner_payload": "{}",
            },
        )
        upsert_queue_item(
            self.connection,
            {
                "id": "shared-queue",
                "workspace_id": "workspace-two",
                "ad_id": "ad-2",
                "target_id": "target-2",
                "target_name": "Other",
                "submit_url": "https://other.tumblr.com/submit",
                "runner_payload": "{}",
            },
        )
        self.assertEqual(self.connection.submission_queue[("workspace-one", "shared-queue")]["target_name"], "Target")
        self.assertEqual(self.connection.submission_queue[("workspace-two", "shared-queue")]["target_name"], "Other")

    def test_workspace_scoped_settings_keep_cross_workspace_ids_isolated(self) -> None:
        upsert_app_settings(
            self.connection,
            {
                "submitTargets": [
                    {
                        "id": "shared-target",
                        "name": "Original target",
                        "profileName": "Original",
                        "submitUrl": "https://original.tumblr.com/submit",
                    }
                ]
            },
            workspace_id="workspace-one",
        )
        upsert_app_settings(
            self.connection,
            {
                "submitTargets": [
                    {
                        "id": "shared-target",
                        "name": "Second target",
                        "profileName": "Second",
                        "submitUrl": "https://second.tumblr.com/submit",
                    }
                ]
            },
            workspace_id="workspace-two",
        )
        self.assertEqual(self.connection.submit_targets[("workspace-one", "shared-target")]["name"], "Original target")
        self.assertEqual(self.connection.submit_targets[("workspace-two", "shared-target")]["name"], "Second target")
        self.connection.runner_settings.clear()
        self.connection.queue_schedule_settings.clear()

        upsert_app_settings(
            self.connection,
            {"queueDefinitions": [{"id": "shared-queue-definition", "name": "Original queue"}]},
            workspace_id="workspace-three",
        )
        upsert_app_settings(
            self.connection,
            {"queueDefinitions": [{"id": "shared-queue-definition", "name": "Second queue"}]},
            workspace_id="workspace-four",
        )
        self.assertEqual(self.connection.queue_definitions[("workspace-three", "shared-queue-definition")]["name"], "Original queue")
        self.assertEqual(self.connection.queue_definitions[("workspace-four", "shared-queue-definition")]["name"], "Second queue")
        self.connection.runner_settings.clear()
        self.connection.queue_schedule_settings.clear()

        upsert_app_settings(self.connection, {"runnerSettings": {"slowMo": 500}}, workspace_id="workspace-five")
        upsert_app_settings(self.connection, {"runnerSettings": {"slowMo": 900}}, workspace_id="workspace-six")
        self.assertEqual(self.connection.runner_settings[("workspace-five", "default")]["slow_mo"], 500)
        self.assertEqual(self.connection.runner_settings[("workspace-six", "default")]["slow_mo"], 900)

        self.connection.runner_settings.clear()
        self.connection.queue_schedule_settings.clear()
        upsert_app_settings(
            self.connection,
            {"queueScheduleSettings": {"enabled": True, "dailyTime": "09:00"}},
            workspace_id="workspace-seven",
        )
        upsert_app_settings(
            self.connection,
            {"queueScheduleSettings": {"enabled": True, "dailyTime": "10:30"}},
            workspace_id="workspace-eight",
        )
        self.assertEqual(self.connection.queue_schedule_settings[("workspace-seven", "default")]["daily_time"], "09:00")
        self.assertEqual(self.connection.queue_schedule_settings[("workspace-eight", "default")]["daily_time"], "10:30")

    def test_app_settings_upsert_round_trips_shared_state(self) -> None:
        saved = upsert_app_settings(
            self.connection,
            {
                "submitTargets": [
                    {
                        "id": "AllThingsRoleplay",
                        "name": "allthingsroleplay",
                        "profileName": "All Things Roleplay ads",
                        "submitUrl": "https://allthingsroleplay.tumblr.com/submit",
                        "forumUrl": "https://forum.example",
                        "postingRules": "Use photo posts and credit the forum.",
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
                "queueScheduleSettings": {
                    "enabled": True,
                    "dailyTime": "08:30",
                    "timezone": "America/New_York",
                    "perQueue": {"Daily adverts": {"enabled": True, "dailyTime": "10:15", "timezone": "America/New_York"}},
                },
            },
        )

        self.assertEqual(saved["submitTargets"][0]["id"], "allthingsroleplay")
        self.assertEqual(saved["submitTargets"][0]["profileName"], "All Things Roleplay ads")
        self.assertEqual(saved["submitTargets"][0]["forumUrl"], "https://forum.example")
        self.assertEqual(saved["submitTargets"][0]["postingRules"], "Use photo posts and credit the forum.")
        self.assertEqual(saved["queueDefinitions"][0]["name"], "Daily adverts")
        self.assertEqual(saved["tagProfiles"]["allthingsroleplay"], ["jcink site", "premium jcink"])
        self.assertEqual(
            saved["runnerSettings"],
            {
                "mediaDir": "C:/media",
                "slowMo": 750,
                "submit": True,
                "tumblrAccountId": "snowleopardx",
                "remoteBrowserProvider": "none",
                "remoteBrowserLaunchUrl": "",
            },
        )
        self.assertEqual(saved["queueScheduleSettings"]["dailyTime"], "08:30")
        self.assertEqual(saved["queueScheduleSettings"]["perQueue"]["Daily adverts"]["dailyTime"], "10:15")
        self.assertEqual(self.connection.submit_targets["allthingsroleplay"]["submit_url"], "https://allthingsroleplay.tumblr.com/submit")
        self.assertEqual(self.connection.submit_targets["allthingsroleplay"]["profile_name"], "All Things Roleplay ads")
        self.assertEqual(self.connection.submit_targets["allthingsroleplay"]["posting_rules"], "Use photo posts and credit the forum.")
        self.assertEqual(self.connection.queue_definitions["daily-adverts"]["name"], "Daily adverts")
        self.assertEqual(self.connection.runner_settings["default"]["slow_mo"], 750)
        self.assertEqual(self.connection.runner_settings["default"]["tumblr_account_id"], "snowleopardx")
        self.assertEqual(self.connection.runner_settings["default"]["remote_browser_provider"], "none")
        self.assertEqual(self.connection.runner_settings["default"]["remote_browser_launch_url"], "")
        self.assertEqual(self.connection.queue_schedule_settings["default"]["daily_time"], "08:30")
        self.assertEqual(self.connection.queue_schedule_settings["queue:Daily adverts"]["daily_time"], "10:15")
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

    def test_app_settings_ignores_remote_env_provider(self) -> None:
        upsert_app_settings(self.connection, {"runnerSettings": {"remoteBrowserProvider": "none"}}, audit=False)

        with patch.dict(os.environ, {"REMOTE_BROWSER_PROVIDER": "browserless"}, clear=True):
            settings = get_app_settings(self.connection)

        self.assertEqual(settings["runnerSettings"]["remoteBrowserProvider"], "none")

    def test_app_settings_ignores_browserbase_env_provider(self) -> None:
        upsert_app_settings(self.connection, {"runnerSettings": {"remoteBrowserProvider": "none"}}, audit=False)

        with patch.dict(os.environ, {"REMOTE_BROWSER_PROVIDER": "browserbase"}, clear=True):
            settings = get_app_settings(self.connection)

        self.assertEqual(settings["runnerSettings"]["remoteBrowserProvider"], "none")

    def test_remote_tumblr_login_launch_is_disabled(self) -> None:
        self.assertIsNone(remote_tumblr_login_launch({"remoteBrowserProvider": "none"}))
        self.assertIsNone(remote_tumblr_login_launch({"remoteBrowserProvider": "browserbase"}))
        self.assertIsNone(remote_tumblr_login_launch({"remoteBrowserProvider": "browserless"}))
        self.assertIsNone(remote_tumblr_login_launch({"remoteBrowserProvider": "custom", "remoteBrowserLaunchUrl": "https://browser.example/live/snow"}))

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
        self.assertEqual(self.connection.template_tags[(f"{workspace_id}:{template['id']}", "jcink")]["workspace_id"], workspace_id)

    def test_credentialed_cors_allows_only_trusted_origins(self) -> None:
        with patch.dict(os.environ, {"INWELL_ALLOWED_ORIGINS": "https://app.example.test"}, clear=False):
            self.assertTrue(origin_allowed_for_request("https://app.example.test", "https://api.example.test"))
            self.assertTrue(origin_allowed_for_request("http://127.0.0.1:8020", "https://api.example.test"))
            self.assertFalse(origin_allowed_for_request("https://api.example.test", "https://api.example.test"))
            self.assertFalse(origin_allowed_for_request("https://spoofed.example.test", "https://spoofed.example.test"))
            self.assertFalse(origin_allowed_for_request("https://evil.example.test", "https://evil.example.test"))
            self.assertFalse(origin_allowed_for_request("https://evil.example.test", "https://api.example.test"))
            self.assertFalse(origin_allowed_for_request("", "https://api.example.test"))

    def test_create_user_workspace_allows_additional_accounts_without_stealing_default_data(self) -> None:
        first_user, first_workspace_id = create_user_workspace(
            self.connection,
            {
                "email": "owner@example.test",
                "password": "correct-password",
                "displayName": "Owner",
                "workspaceName": "Owner workspace",
            },
        )
        second_user, second_workspace_id = create_user_workspace(
            self.connection,
            {
                "email": "second@example.test",
                "password": "another-password",
                "displayName": "Second",
                "workspaceName": "Second workspace",
            },
        )

        self.assertNotEqual(first_user["id"], second_user["id"])
        self.assertNotEqual(first_workspace_id, second_workspace_id)
        self.assertEqual(second_user["workspace"]["name"], "Second workspace")

        with self.assertRaises(ValueError):
            create_user_workspace(
                self.connection,
                {
                    "email": "second@example.test",
                    "password": "another-password",
                    "displayName": "Duplicate",
                    "workspaceName": "Duplicate workspace",
                },
            )

    def test_password_reset_request_returns_generic_message(self) -> None:
        create_user_workspace(
            self.connection,
            {
                "email": "owner@example.test",
                "password": "correct-password",
                "displayName": "Owner",
                "workspaceName": "Owner workspace",
            },
        )

        known = request_password_reset(self.connection, {"email": "owner@example.test"})
        unknown = request_password_reset(self.connection, {"email": "missing@example.test"})

        self.assertTrue(known["submitted"])
        self.assertEqual(known["message"], unknown["message"])
        self.assertIn("reset instructions", known["message"])

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
        self.assertEqual(self.connection.runner_log_details[(f"{log['workspace_id']}:{log['id']}", "submit")]["detail_value"], "True")
        self.assertEqual(self.connection.submission_queue["queue-log-1"]["status"], "submitted")
        self.assertIsNone(self.connection.submission_queue["queue-log-1"]["posted_at"])

    def test_runner_log_infers_submitted_status_from_submit_click_message(self) -> None:
        upsert_queue_item(
            self.connection,
            {
                "id": "queue-log-click-message",
                "ad_id": "ad-1",
                "target_id": "target-click-message",
                "target_name": "rpadverts",
                "submit_url": "https://rpadverts.tumblr.com/submit",
                "status": "queued",
                "runner_payload": "{}",
            },
        )

        record_runner_log(
            self.connection,
            {
                "queue_item_id": "queue-log-click-message",
                "run_id": "run-click-message",
                "level": "info",
                "message": "Submit button clicked.",
                "details": {"postedUrl": ""},
                "created_at": "2026-06-24T12:37:00+00:00",
            },
        )

        queue_item = self.connection.submission_queue["queue-log-click-message"]
        self.assertEqual(queue_item["status"], "submitted")
        self.assertEqual(str(queue_item["updated_at"]), "2026-06-24 12:37:00+00:00")
        self.assertIsNone(queue_item["failed_at"])

    def test_runner_log_maps_clicked_status_to_submitted(self) -> None:
        upsert_queue_item(
            self.connection,
            {
                "id": "queue-log-clicked-status",
                "ad_id": "ad-1",
                "target_id": "target-clicked-status",
                "target_name": "therpdirectory",
                "submit_url": "https://therpdirectory.tumblr.com/submit",
                "status": "queued",
                "runner_payload": "{}",
            },
        )

        record_runner_log(
            self.connection,
            {
                "queue_item_id": "queue-log-clicked-status",
                "run_id": "run-clicked-status",
                "level": "info",
                "status": "clicked",
                "message": "Submit button clicked.",
                "details": {"status": "clicked"},
            },
        )

        self.assertEqual(self.connection.submission_queue["queue-log-clicked-status"]["status"], "submitted")

    def test_runner_log_does_not_infer_submitted_from_disabled_submit(self) -> None:
        upsert_queue_item(
            self.connection,
            {
                "id": "queue-log-disabled-submit",
                "ad_id": "ad-1",
                "target_id": "target-disabled-submit",
                "target_name": "disabledsubmit",
                "submit_url": "https://disabledsubmit.tumblr.com/submit",
                "status": "queued",
                "runner_payload": "{}",
            },
        )

        record_runner_log(
            self.connection,
            {
                "queue_item_id": "queue-log-disabled-submit",
                "run_id": "run-disabled-submit",
                "level": "warning",
                "message": "Submit button is disabled after filling the form.",
                "details": {"status": "disabled"},
            },
        )

        self.assertEqual(self.connection.submission_queue["queue-log-disabled-submit"]["status"], "queued")

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
            self.assertIn("inkwell-local-runner/scripts/discord-run-summary.mjs", names)
            self.assertIn("inkwell-local-runner/scripts/tumblr-login.mjs", names)
            self.assertIn("inkwell-local-runner/scripts/tumblr-runner-results.mjs", names)
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
        self.assertIn("--watch --serve", script)
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
        self.assertIn("Resolve-NpmCommand", script)
        self.assertIn("& $(Quote-PowerShell $npmCommand) run tumblr:runner:local", script)
        self.assertIn("--watch --serve --companion-port", script)
        self.assertIn("Could not find npm.cmd", script)
        self.assertIn("Test-CompanionOnline", script)
        self.assertIn("Start-RunnerLauncher", script)
        self.assertIn("Started local runner companion.", script)
        self.assertIn("Remove-Item -LiteralPath $legacyStartupPs1", script)
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
        old_workspace_id = app.RUNNER_LAST_WORKSPACE_ID
        old_plan = app.RUNNER_PLAN_PATH
        app.RUNNER_PROCESS = None
        app.RUNNER_LAST_COMMAND = []
        app.RUNNER_LAST_WORKSPACE_ID = ""
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
            self.assertIn("--workspace-id", result["command"])
            self.assertIn("--media-dir", result["command"])
            self.assertIn("--submit", result["command"])
            workspace_index = result["command"].index("--workspace-id") + 1
            self.assertEqual(result["command"][workspace_index], "default")
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
            app.RUNNER_LAST_WORKSPACE_ID = old_workspace_id
            app.RUNNER_PLAN_PATH = old_plan

    def test_start_runner_propagates_workspace_to_active_run_logs(self) -> None:
        temp_plan = Path("backend-test-runner-plan.json")
        process = Mock()
        process.pid = 123
        process.poll.return_value = None
        old_process = app.RUNNER_PROCESS
        old_command = app.RUNNER_LAST_COMMAND
        old_run_id = app.RUNNER_LAST_RUN_ID
        old_workspace_id = app.RUNNER_LAST_WORKSPACE_ID
        old_plan = app.RUNNER_PLAN_PATH
        app.RUNNER_PROCESS = None
        app.RUNNER_LAST_COMMAND = []
        app.RUNNER_LAST_RUN_ID = ""
        app.RUNNER_LAST_WORKSPACE_ID = ""
        app.RUNNER_PLAN_PATH = temp_plan
        upsert_queue_item(
            self.connection,
            {
                "id": "shared-runner-queue",
                "workspace_id": "default",
                "ad_id": "default-ad",
                "target_id": "default-target",
                "target_name": "Default target",
                "submit_url": "https://default.example/submit",
                "status": "queued",
                "runner_payload": "{}",
            },
        )
        upsert_queue_item(
            self.connection,
            {
                "id": "shared-runner-queue",
                "workspace_id": "workspace-local",
                "ad_id": "local-ad",
                "target_id": "local-target",
                "target_name": "Local target",
                "submit_url": "https://local.example/submit",
                "status": "queued",
                "runner_payload": "{}",
            },
        )

        try:
            with patch("app.subprocess.Popen", return_value=process):
                result = start_runner(
                    {
                        "items": [{"id": "shared-runner-queue", "runnerPayload": "{}"}],
                        "workspace_id": "workspace-local",
                    }
                )

            workspace_index = result["command"].index("--workspace-id") + 1
            self.assertEqual(result["command"][workspace_index], "workspace-local")
            self.assertEqual(app.RUNNER_LAST_WORKSPACE_ID, "workspace-local")

            log = record_runner_log(
                self.connection,
                {
                    "run_id": app.RUNNER_LAST_RUN_ID,
                    "workspace_id": "workspace-local",
                    "queue_item_id": "shared-runner-queue",
                    "target_name": "Local target",
                    "level": "info",
                    "status": "submitted",
                    "message": "Submit button clicked.",
                },
            )

            self.assertEqual(log["workspace_id"], "workspace-local")
            self.assertEqual(self.connection.submission_queue[("workspace-local", "shared-runner-queue")]["status"], "submitted")
            self.assertEqual(self.connection.submission_queue[("default", "shared-runner-queue")]["status"], "queued")
            self.assertTrue(all(row["workspace_id"] != "default" for row in self.connection.runner_logs.values()))
        finally:
            if temp_plan.exists():
                temp_plan.unlink()
            app.RUNNER_PROCESS = old_process
            app.RUNNER_LAST_COMMAND = old_command
            app.RUNNER_LAST_RUN_ID = old_run_id
            app.RUNNER_LAST_WORKSPACE_ID = old_workspace_id
            app.RUNNER_PLAN_PATH = old_plan

    def test_start_runner_uses_runtime_port_for_api_callback(self) -> None:
        temp_plan = Path("backend-test-runner-plan.json")
        process = Mock()
        process.pid = 123
        process.poll.return_value = None
        old_process = app.RUNNER_PROCESS
        old_command = app.RUNNER_LAST_COMMAND
        old_workspace_id = app.RUNNER_LAST_WORKSPACE_ID
        old_plan = app.RUNNER_PLAN_PATH
        old_port = os.environ.get("PORT")
        old_runner_api_base = os.environ.get("RUNNER_API_BASE_URL")
        app.RUNNER_PROCESS = None
        app.RUNNER_LAST_COMMAND = []
        app.RUNNER_LAST_WORKSPACE_ID = ""
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
            app.RUNNER_LAST_WORKSPACE_ID = old_workspace_id
            app.RUNNER_PLAN_PATH = old_plan
            if old_port is None:
                os.environ.pop("PORT", None)
            else:
                os.environ["PORT"] = old_port
            if old_runner_api_base is None:
                os.environ.pop("RUNNER_API_BASE_URL", None)
            else:
                os.environ["RUNNER_API_BASE_URL"] = old_runner_api_base

    def test_start_runner_rejects_browserbase_provider(self) -> None:
        temp_plan = Path("backend-test-runner-plan.json")
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

        try:
            with self.assertRaisesRegex(ValueError, "local runner only"):
                start_runner(
                    {
                        "workspace_id": "workspace-test",
                        "items": [{"id": "queue-1", "runnerPayload": "{}"}],
                        "remoteBrowserProvider": "browserbase",
                        "tumblrAccountId": "snowleopardx",
                    }
                )
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
