from __future__ import annotations

import json
import sys
import threading
import time
import unittest
from datetime import datetime
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).parents[2]))
import app
from app import initialize, local_runner_plan, record_runner_log, upsert_advertisement, upsert_app_settings, upsert_queue_item
from backend.tests.persistence.test_app import FakePostgresConnection


class RunnerCompletionRefillPersistenceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.connection = FakePostgresConnection()
        initialize(self.connection)

    def seed_submit_target(self, workspace_id: str, target_id: str, name: str | None = None) -> None:
        upsert_app_settings(
            self.connection,
            {
                "submitTargets": [
                    {
                        "id": target_id,
                        "name": name or target_id,
                        "profileName": f"{name or target_id} profile",
                        "submitUrl": f"https://{target_id}.tumblr.com/submit",
                        "forumUrl": f"https://forums.example/{target_id}",
                        "postingRules": "Use the public submit form.",
                    }
                ]
            },
            workspace_id=workspace_id,
        )

    def seed_ready_ad(
        self,
        workspace_id: str,
        ad_id: str,
        destination_blog: str,
        *,
        post_type: str = "photo",
        status: str = "ready",
        archived: bool = False,
        content: str = "<p>Prepared ad copy</p>",
        image_caption: str = "<p>Prepared caption</p>",
        image_name: str = "",
        image_data_url: str = "",
        video_name: str = "",
        video_url: str = "",
        updated_at: str | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "id": ad_id,
            "workspace_id": workspace_id,
            "post_type": post_type,
            "title": f"{ad_id} title",
            "campaign_name": "Summer campaign",
            "content": content,
            "destination_blog": destination_blog,
            "forum_url": f"https://forums.example/{ad_id}",
            "image_click_through_url": f"https://forums.example/{ad_id}/image",
            "image_caption": image_caption,
            "image_name": image_name or f"{ad_id}.png",
            "image_data_url": image_data_url,
            "video_name": video_name,
            "video_url": video_url,
            "status": status,
            "archived": archived,
            "tags": ["jcink", "premium"],
        }
        advertisement = upsert_advertisement(self.connection, payload)
        if updated_at:
            self.connection.advertisements[(workspace_id, ad_id)]["updated_at"] = datetime.fromisoformat(updated_at)
        return advertisement

    def seed_running_queue_item(
        self,
        workspace_id: str,
        queue_item_id: str,
        *,
        ad_id: str = "active-ad",
        target_id: str = "active-target",
        queue_name: str = "Automation queue",
        tumblr_account_id: str = "snowleopardx",
    ) -> dict[str, Any]:
        return upsert_queue_item(
            self.connection,
            {
                "id": queue_item_id,
                "workspace_id": workspace_id,
                "ad_id": ad_id,
                "target_id": target_id,
                "target_name": target_id,
                "tumblr_account_id": tumblr_account_id,
                "queue_name": queue_name,
                "submit_url": f"https://{target_id}.tumblr.com/submit",
                "post_type": "photo",
                "status": "running",
                "runner_payload": "{}",
            },
        )

    def submitted_log(self, workspace_id: str, queue_item_id: str, created_at: str = "2026-07-11T12:00:00+00:00") -> None:
        record_runner_log(
            self.connection,
            {
                "workspace_id": workspace_id,
                "queue_item_id": queue_item_id,
                "run_id": f"run-{queue_item_id}",
                "level": "info",
                "status": "submitted",
                "message": "Submit button clicked.",
                "created_at": created_at,
            },
        )

    def replacements(self, workspace_id: str, prefix: str) -> list[dict[str, Any]]:
        return [
            row
            for row in self.connection.submission_queue.values()
            if row.get("workspace_id") == workspace_id and str(row.get("id", "")).startswith(prefix)
        ]

    def test_runner_log_submitted_refills_queue_from_ready_ads(self) -> None:
        workspace_id = "workspace-refill"
        queue_name = "Automation queue"
        self.seed_submit_target(workspace_id, "ready-target", "Ready target")
        self.seed_ready_ad(workspace_id, "ad-replacement", "ready-target")
        self.seed_running_queue_item(workspace_id, "queue-refill-1", queue_name=queue_name, tumblr_account_id="tumblr-runner")

        self.submitted_log(workspace_id, "queue-refill-1")

        original = self.connection.submission_queue[(workspace_id, "queue-refill-1")]
        self.assertEqual(original["status"], "submitted")
        self.assertEqual(str(original["posted_at"]), "2026-07-11 12:00:00+00:00")
        replacements = [row for row in self.connection.submission_queue.values() if row.get("workspace_id") == workspace_id and row.get("id") != "queue-refill-1"]
        self.assertEqual(len(replacements), 1)
        replacement = replacements[0]
        self.assertEqual(replacement["ad_id"], "ad-replacement")
        self.assertEqual(replacement["target_id"], "ready-target")
        self.assertEqual(replacement["queue_name"], queue_name)
        self.assertEqual(replacement["tumblr_account_id"], "tumblr-runner")
        self.assertEqual(replacement["status"], "queued")
        self.assertIn("Auto-added", replacement["notes"])

        payload = json.loads(app.load_runner_payload(self.connection, replacement["id"], workspace_id))
        self.assertEqual(payload["target"]["id"], "ready-target")
        self.assertEqual(payload["advertisement"]["id"], "ad-replacement")
        self.assertIn("Tumblr Photo Post", payload["fields"]["package"])

        upsert_app_settings(
            self.connection,
            {
                "queueScheduleSettings": {
                    "enabled": False,
                    "dailyTime": "09:00",
                    "perQueue": {
                        queue_name: {
                            "enabled": True,
                            "dailyTime": "00:00",
                            "timezone": "America/New_York",
                        }
                    },
                }
            },
            workspace_id=workspace_id,
            audit=False,
        )
        plan = local_runner_plan(
            self.connection,
            workspace_id,
            queue_name,
            mode="watcher",
            now=datetime(2026, 7, 11, 12, 0, tzinfo=app.EASTERN_TZ),
        )
        self.assertEqual([item["id"] for item in plan["items"]], [replacement["id"]])

    def test_runner_log_posted_refills_queue_from_ready_ads(self) -> None:
        workspace_id = "workspace-posted-refill"
        queue_name = "Posted queue"
        self.seed_submit_target(workspace_id, "posted-target")
        self.seed_ready_ad(workspace_id, "ad-posted-replacement", "posted-target")
        self.seed_running_queue_item(workspace_id, "queue-posted-refill", queue_name=queue_name)

        record_runner_log(
            self.connection,
            {
                "workspace_id": workspace_id,
                "queue_item_id": "queue-posted-refill",
                "run_id": "run-posted-refill",
                "level": "info",
                "status": "posted",
                "message": "Posted successfully.",
                "created_at": "2026-07-11T12:03:00+00:00",
            },
        )

        rows = [row for row in self.connection.submission_queue.values() if row.get("workspace_id") == workspace_id]
        self.assertEqual(len(rows), 2)
        self.assertEqual(self.connection.submission_queue[(workspace_id, "queue-posted-refill")]["status"], "posted")
        replacements = [row for row in rows if row.get("id") != "queue-posted-refill"]
        self.assertEqual(replacements[0]["status"], "queued")
        self.assertEqual(replacements[0]["ad_id"], "ad-posted-replacement")

    def test_runner_log_refill_restores_runnable_depth_with_attention_items(self) -> None:
        workspace_id = "workspace-attention-depth"
        queue_name = "Attention queue"
        for index in range(3):
            target_id = f"ready-target-{index}"
            self.seed_submit_target(workspace_id, target_id)
            self.seed_ready_ad(workspace_id, f"ad-ready-{index}", target_id)
        self.seed_running_queue_item(workspace_id, "queue-attention-running", queue_name=queue_name)
        for status in ("failed", "needs-review"):
            upsert_queue_item(
                self.connection,
                {
                    "id": f"queue-attention-{status}",
                    "workspace_id": workspace_id,
                    "ad_id": f"ad-{status}",
                    "target_id": f"target-{status}",
                    "target_name": f"target-{status}",
                    "queue_name": queue_name,
                    "submit_url": f"https://target-{status}.tumblr.com/submit",
                    "post_type": "photo",
                    "status": status,
                    "runner_payload": "{}",
                },
            )

        self.submitted_log(workspace_id, "queue-attention-running", "2026-07-11T12:04:00+00:00")

        replacements = self.replacements(workspace_id, "ad-ready-")
        self.assertEqual(len(replacements), 3)
        self.assertEqual({row["status"] for row in replacements}, {"queued"})

    def test_runner_log_refill_does_not_overfill_multiple_running_items(self) -> None:
        workspace_id = "workspace-multiple-running"
        queue_name = "Parallel queue"
        for index in range(2):
            target_id = f"parallel-target-{index}"
            self.seed_submit_target(workspace_id, target_id)
            self.seed_ready_ad(workspace_id, f"ad-parallel-{index}", target_id)
        self.seed_running_queue_item(workspace_id, "queue-running-1", ad_id="active-ad-1", target_id="active-target-1", queue_name=queue_name)
        self.seed_running_queue_item(workspace_id, "queue-running-2", ad_id="active-ad-2", target_id="active-target-2", queue_name=queue_name)

        self.submitted_log(workspace_id, "queue-running-1", "2026-07-11T12:06:00+00:00")
        self.assertEqual(len(self.replacements(workspace_id, "ad-parallel-")), 1)

        self.submitted_log(workspace_id, "queue-running-2", "2026-07-11T12:07:00+00:00")
        final_replacements = self.replacements(workspace_id, "ad-parallel-")
        self.assertEqual(len(final_replacements), 2)
        self.assertEqual({row["status"] for row in final_replacements}, {"queued"})

    def test_runner_log_duplicate_completion_refills_once(self) -> None:
        workspace_id = "workspace-duplicate-completion"
        queue_name = "Duplicate queue"
        for index in range(2):
            target_id = f"duplicate-target-{index}"
            self.seed_submit_target(workspace_id, target_id)
            self.seed_ready_ad(workspace_id, f"ad-duplicate-{index}", target_id)
        self.seed_running_queue_item(workspace_id, "queue-duplicate-completion", queue_name=queue_name)

        for run_id in ("run-duplicate-1", "run-duplicate-2"):
            record_runner_log(
                self.connection,
                {
                    "workspace_id": workspace_id,
                    "queue_item_id": "queue-duplicate-completion",
                    "run_id": run_id,
                    "level": "info",
                    "status": "submitted",
                    "message": "Submit button clicked.",
                    "created_at": "2026-07-11T12:08:00+00:00",
                },
            )

        replacements = self.replacements(workspace_id, "ad-duplicate-")
        self.assertEqual(len(replacements), 1)
        self.assertEqual(replacements[0]["status"], "queued")

    def test_runner_log_overlapping_duplicate_completion_refills_once(self) -> None:
        workspace_id = "workspace-overlap-completion"
        queue_name = "Overlap queue"
        for index in range(2):
            target_id = f"overlap-target-{index}"
            self.seed_submit_target(workspace_id, target_id)
            self.seed_ready_ad(workspace_id, f"ad-overlap-{index}", target_id)
        self.seed_running_queue_item(workspace_id, "queue-overlap-completion", queue_name=queue_name)

        original_target_depth = app.queue_refill.queue_refill_target_depth_before_completion
        first_depth_read_entered = threading.Event()
        release_first_depth_read = threading.Event()
        second_depth_read_entered = threading.Event()
        call_count = 0
        call_count_lock = threading.Lock()
        errors: list[BaseException] = []

        def delayed_target_depth(*args: Any, **kwargs: Any) -> int:
            nonlocal call_count
            with call_count_lock:
                call_count += 1
                current_call = call_count
            if current_call == 1:
                first_depth_read_entered.set()
                if not release_first_depth_read.wait(timeout=2):
                    raise AssertionError("Timed out waiting to release first completion depth read.")
            else:
                second_depth_read_entered.set()
            return original_target_depth(*args, **kwargs)

        def complete_from_runner(run_id: str) -> None:
            try:
                record_runner_log(
                    self.connection,
                    {
                        "workspace_id": workspace_id,
                        "queue_item_id": "queue-overlap-completion",
                        "run_id": run_id,
                        "level": "info",
                        "status": "submitted",
                        "message": "Submit button clicked.",
                        "created_at": "2026-07-11T12:09:00+00:00",
                    },
                )
            except BaseException as error:
                errors.append(error)

        app.queue_refill.queue_refill_target_depth_before_completion = delayed_target_depth
        try:
            first_thread = threading.Thread(target=complete_from_runner, args=("run-overlap-1",))
            second_thread = threading.Thread(target=complete_from_runner, args=("run-overlap-2",))
            first_thread.start()
            self.assertTrue(first_depth_read_entered.wait(timeout=1))
            second_thread.start()
            time.sleep(0.1)
            self.assertFalse(second_depth_read_entered.is_set())
            release_first_depth_read.set()
            first_thread.join(timeout=2)
            second_thread.join(timeout=2)
            self.assertFalse(first_thread.is_alive())
            self.assertFalse(second_thread.is_alive())
        finally:
            release_first_depth_read.set()
            app.queue_refill.queue_refill_target_depth_before_completion = original_target_depth

        if errors:
            raise AssertionError(f"Unexpected runner completion errors: {errors!r}")
        replacements = self.replacements(workspace_id, "ad-overlap-")
        self.assertEqual(len(replacements), 1)
        self.assertEqual(replacements[0]["status"], "queued")
        self.assertEqual(call_count, 1)

    def test_runner_log_completion_does_not_refill_without_ready_ads(self) -> None:
        workspace_id = "workspace-no-ready"
        self.seed_submit_target(workspace_id, "draft-target")
        self.seed_ready_ad(workspace_id, "ad-draft", "draft-target", status="draft")
        self.seed_running_queue_item(workspace_id, "queue-no-ready")

        self.submitted_log(workspace_id, "queue-no-ready", "2026-07-11T12:05:00+00:00")

        rows = [row for row in self.connection.submission_queue.values() if row.get("workspace_id") == workspace_id]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["status"], "submitted")

    def test_runner_log_failed_and_needs_review_do_not_refill(self) -> None:
        for status in ("failed", "needs-review"):
            with self.subTest(status=status):
                self.connection = FakePostgresConnection()
                initialize(self.connection)
                workspace_id = f"workspace-{status}"
                self.seed_submit_target(workspace_id, "ready-target")
                self.seed_ready_ad(workspace_id, "ad-replacement", "ready-target")
                self.seed_running_queue_item(workspace_id, f"queue-{status}")

                record_runner_log(
                    self.connection,
                    {
                        "workspace_id": workspace_id,
                        "queue_item_id": f"queue-{status}",
                        "run_id": f"run-{status}",
                        "level": "error" if status == "failed" else "warning",
                        "status": status,
                        "message": f"Runner reported {status}.",
                        "created_at": "2026-07-11T12:10:00+00:00",
                    },
                )

                rows = [row for row in self.connection.submission_queue.values() if row.get("workspace_id") == workspace_id]
                self.assertEqual(len(rows), 1)
                self.assertEqual(rows[0]["status"], status)

    def test_runner_log_completion_respects_refill_cooldown(self) -> None:
        workspace_id = "workspace-cooldown"
        queue_name = "Automation queue"
        self.seed_submit_target(workspace_id, "cool-target")
        self.seed_submit_target(workspace_id, "fresh-target")
        self.seed_ready_ad(workspace_id, "ad-cooldown", "cool-target")
        self.seed_ready_ad(workspace_id, "ad-fresh", "fresh-target")
        self.seed_running_queue_item(workspace_id, "queue-cooldown", ad_id="ad-active", target_id="active-target", queue_name=queue_name)
        upsert_queue_item(
            self.connection,
            {
                "id": "queue-recent-completed",
                "workspace_id": workspace_id,
                "ad_id": "ad-cooldown",
                "target_id": "cool-target",
                "target_name": "cool-target",
                "queue_name": queue_name,
                "submit_url": "https://cool-target.tumblr.com/submit",
                "post_type": "photo",
                "status": "submitted",
                "posted_at": "2026-07-10T12:00:00+00:00",
                "runner_payload": "{}",
            },
        )

        self.submitted_log(workspace_id, "queue-cooldown", "2026-07-11T12:15:00+00:00")

        replacements = self.replacements(workspace_id, "ad-")
        self.assertEqual(len(replacements), 1)
        self.assertEqual(replacements[0]["ad_id"], "ad-fresh")

    def test_runner_log_completion_allows_refill_at_cooldown_boundary(self) -> None:
        workspace_id = "workspace-cooldown-boundary"
        queue_name = "Boundary queue"
        self.seed_submit_target(workspace_id, "boundary-target")
        self.seed_ready_ad(workspace_id, "ad-boundary", "boundary-target")
        self.seed_running_queue_item(workspace_id, "queue-boundary", ad_id="ad-active", target_id="active-target", queue_name=queue_name)
        upsert_queue_item(
            self.connection,
            {
                "id": "queue-boundary-completed",
                "workspace_id": workspace_id,
                "ad_id": "ad-boundary",
                "target_id": "boundary-target",
                "target_name": "boundary-target",
                "queue_name": queue_name,
                "submit_url": "https://boundary-target.tumblr.com/submit",
                "post_type": "photo",
                "status": "submitted",
                "posted_at": "2026-06-27T12:15:00+00:00",
                "runner_payload": "{}",
            },
        )

        self.submitted_log(workspace_id, "queue-boundary", "2026-07-11T12:15:00+00:00")

        replacements = self.replacements(workspace_id, "ad-boundary-")
        self.assertEqual(len(replacements), 1)
        self.assertEqual(replacements[0]["ad_id"], "ad-boundary")

    def test_runner_refill_skips_ineligible_ready_ads(self) -> None:
        workspace_id = "workspace-ineligible"
        queue_name = "Eligibility queue"
        for target_id in ["archived-target", "missing-body-target", "missing-media-target", "inwell-ads", "eligible-target"]:
            if target_id != "inwell-ads":
                self.seed_submit_target(workspace_id, target_id)
        self.seed_ready_ad(workspace_id, "ad-archived", "archived-target", archived=True)
        self.seed_ready_ad(workspace_id, "ad-missing-body", "missing-body-target", content="", image_caption="")
        self.seed_ready_ad(workspace_id, "ad-missing-media", "missing-media-target", image_name="", image_data_url="")
        self.seed_ready_ad(workspace_id, "ad-removed-target", "inwell-ads")
        self.seed_ready_ad(workspace_id, "ad-eligible", "eligible-target")
        self.seed_running_queue_item(workspace_id, "queue-ineligible", queue_name=queue_name)

        self.submitted_log(workspace_id, "queue-ineligible", "2026-07-11T12:20:00+00:00")

        replacements = self.replacements(workspace_id, "ad-")
        self.assertEqual(len(replacements), 1)
        self.assertEqual(replacements[0]["ad_id"], "ad-eligible")

    def test_runner_refill_uses_updated_at_desc_ad_order(self) -> None:
        workspace_id = "workspace-ordering"
        queue_name = "Ordering queue"
        self.seed_submit_target(workspace_id, "older-target")
        self.seed_submit_target(workspace_id, "newer-target")
        self.seed_ready_ad(workspace_id, "ad-older", "older-target", updated_at="2026-07-10T12:00:00+00:00")
        self.seed_ready_ad(workspace_id, "ad-newer", "newer-target", updated_at="2026-07-11T12:00:00+00:00")
        self.seed_running_queue_item(workspace_id, "queue-ordering", queue_name=queue_name)

        self.submitted_log(workspace_id, "queue-ordering", "2026-07-11T12:30:00+00:00")

        replacements = self.replacements(workspace_id, "ad-")
        self.assertEqual(len(replacements), 1)
        self.assertEqual(replacements[0]["ad_id"], "ad-newer")


if __name__ == "__main__":
    unittest.main()
