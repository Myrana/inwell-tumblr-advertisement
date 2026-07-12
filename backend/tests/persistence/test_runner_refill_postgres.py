from __future__ import annotations

import os
import subprocess
import sys
import time
import unittest
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[2]))
import app
from app import initialize, record_runner_log, upsert_advertisement, upsert_app_settings, upsert_queue_item


WORKER = """
import sys, time
sys.path.insert(0, 'backend')
import app
dsn, schema, workspace, item, start_at = sys.argv[1:]
while time.time() < float(start_at):
    time.sleep(0.005)
with app.psycopg.connect(dsn, row_factory=app.dict_row) as connection:
    connection.execute(f'SET search_path TO \"{schema}\"')
    app.record_runner_log(connection, {'workspace_id': workspace, 'queue_item_id': item, 'run_id': f'run-{item}', 'level': 'info', 'status': 'submitted', 'message': 'Submitted.'})
"""


class RunnerRefillPostgresIntegrationTests(unittest.TestCase):
    workspace_id = "workspace-postgres-refill"
    queue_name = "Postgres queue"

    def setUp(self) -> None:
        self.dsn = os.environ.get("INWELL_TEST_POSTGRES_DSN")
        if not self.dsn:
            self.skipTest("INWELL_TEST_POSTGRES_DSN is not configured")
        self.schema_name = f"inwell_refill_{uuid.uuid4().hex}"
        with self.connection() as connection:
            connection.execute(f'CREATE SCHEMA "{self.schema_name}"')
            connection.execute(f'SET search_path TO "{self.schema_name}"')
            initialize(connection)
            self.seed_fixture(connection)

    def tearDown(self) -> None:
        if not getattr(self, "dsn", None) or not getattr(self, "schema_name", None):
            return
        with app.psycopg.connect(self.dsn, autocommit=True) as connection:
            connection.execute(f'DROP SCHEMA IF EXISTS "{self.schema_name}" CASCADE')

    def connection(self, *, autocommit: bool = False):
        return app.psycopg.connect(self.dsn, row_factory=app.dict_row, autocommit=autocommit)

    def seed_fixture(self, connection) -> None:
        upsert_app_settings(
            connection,
            {
                "submitTargets": [
                    {"id": f"target-{index}", "name": f"Target {index}", "submitUrl": f"https://target-{index}.tumblr.com/submit"}
                    for index in range(2)
                ],
                "queueScheduleSettings": {
                    "enabled": False,
                    "perQueue": {self.queue_name: {"enabled": True, "dailyTime": "09:00", "timezone": "America/New_York"}},
                },
            },
            workspace_id=self.workspace_id,
            audit=False,
        )
        for index in range(2):
            upsert_advertisement(
                connection,
                {
                    "id": f"ad-{index}", "workspace_id": self.workspace_id, "post_type": "photo", "title": f"Ad {index}",
                    "content": "<p>Prepared</p>", "image_caption": "<p>Prepared</p>", "image_name": f"ad-{index}.png",
                    "destination_blog": f"target-{index}", "forum_url": "https://forums.example/ad", "status": "ready",
                },
            )
            self.seed_running(connection, f"running-{index}", self.queue_name)

    def seed_running(self, connection, item_id: str, queue_name: str) -> None:
        upsert_queue_item(
            connection,
            {
                "id": item_id, "workspace_id": self.workspace_id, "ad_id": f"active-{item_id}",
                "target_id": f"target-{item_id}", "target_name": item_id, "queue_name": queue_name,
                "submit_url": "https://active.tumblr.com/submit", "post_type": "photo", "status": "running",
            },
        )

    def run_workers(self, item_ids: list[str]) -> None:
        start_at = str(time.time() + 0.5)
        processes = [
            subprocess.Popen([sys.executable, "-c", WORKER, self.dsn, self.schema_name, self.workspace_id, item_id, start_at])
            for item_id in item_ids
        ]
        try:
            self.assertEqual([process.wait(timeout=15) for process in processes], [0] * len(processes))
        finally:
            for process in processes:
                if process.poll() is None:
                    process.kill()

    def test_cross_process_completions_serialize_to_correct_depth(self) -> None:
        self.run_workers(["running-0", "running-1"])

        with self.connection() as connection:
            connection.execute(f'SET search_path TO "{self.schema_name}"')
            rows = connection.execute(
                "SELECT * FROM submission_queue WHERE workspace_id = %s AND status = 'scheduled'", (self.workspace_id,)
            ).fetchall()
            self.assertEqual(len(rows), 2)
            self.assertEqual(len({row["id"] for row in rows}), 2)

    def test_cross_process_duplicate_completion_creates_one_replacement(self) -> None:
        self.run_workers(["running-0", "running-0"])

        with self.connection() as connection:
            connection.execute(f'SET search_path TO "{self.schema_name}"')
            replacements = connection.execute(
                "SELECT * FROM submission_queue WHERE workspace_id = %s AND status = 'scheduled'", (self.workspace_id,)
            ).fetchall()
            completed = connection.execute(
                "SELECT * FROM submission_queue WHERE workspace_id = %s AND id = %s", (self.workspace_id, "running-0")
            ).fetchone()
            self.assertEqual(completed["status"], "submitted")
            self.assertEqual(len(replacements), 1)
            self.assertEqual(len({row["id"] for row in replacements}), 1)

    def test_completion_and_replacement_roll_back_atomically(self) -> None:
        with self.connection() as connection:
            connection.execute(f'SET search_path TO "{self.schema_name}"')
            self.seed_running(connection, "rollback-running", self.queue_name)
            connection.commit()
            record_runner_log(
                connection,
                {"workspace_id": self.workspace_id, "queue_item_id": "rollback-running", "run_id": "run-rollback", "level": "info", "status": "submitted", "message": "Submitted."},
            )
            connection.rollback()
            item = connection.execute(
                "SELECT * FROM submission_queue WHERE workspace_id = %s AND id = %s", (self.workspace_id, "rollback-running")
            ).fetchone()
            self.assertEqual(item["status"], "running")
            replacement_count = connection.execute(
                "SELECT COUNT(*) AS count FROM submission_queue WHERE workspace_id = %s AND status = 'scheduled'", (self.workspace_id,)
            ).fetchone()["count"]
            self.assertEqual(replacement_count, 0)


if __name__ == "__main__":
    unittest.main()
