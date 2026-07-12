from __future__ import annotations

import json
import hashlib
import re
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Callable


COMPLETED_QUEUE_STATUSES = {"submitted", "posted"}
RUNNABLE_QUEUE_STATUSES = {"queued", "scheduled"}
DEFAULT_TIMEZONE = "America/New_York"


@dataclass(frozen=True)
class QueueRefillServices:
    load_ordered_values: Callable[[Any, str, str, str, str, str], list[str]]
    load_runner_payload: Callable[[Any, str, str], str]
    parse_optional_datetime: Callable[[Any], datetime | None]
    parse_tags: Callable[[Any], list[str]]
    row_to_advertisement: Callable[[Any, list[str] | None], dict[str, Any]]
    row_to_dict: Callable[[Any], dict[str, Any]]
    row_to_queue_item: Callable[[Any, str], dict[str, Any]]
    upsert_queue_item: Callable[[Any, dict[str, Any]], dict[str, Any]]
    next_queue_recurrence: Callable[[Any, str, str, datetime], tuple[datetime, str] | None]


def queue_id_from_name(name: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "-", str(name or "").strip().lower()).strip("-")
    return normalized or "default-queue"


def advertisement_body(advertisement: dict[str, Any]) -> str:
    return str(advertisement.get("image_caption") or advertisement.get("content") or "").strip()


def html_to_plain_text(value: str) -> str:
    text = re.sub(r"<br\s*/?>", "\n", value, flags=re.IGNORECASE)
    text = re.sub(r"</p>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)
    return text.replace("&nbsp;", " ").strip()


def advertisement_queueable(advertisement: dict[str, Any]) -> bool:
    if advertisement.get("archived") or advertisement.get("status") != "ready":
        return False
    if not str(advertisement.get("title") or "").strip():
        return False
    if not str(advertisement.get("destination_blog") or "").strip():
        return False
    if not str(advertisement.get("forum_url") or "").strip():
        return False
    if not html_to_plain_text(advertisement_body(advertisement)):
        return False
    post_type = str(advertisement.get("post_type") or "photo")
    if post_type == "photo" and not (str(advertisement.get("image_data_url") or "").strip() or str(advertisement.get("image_name") or "").strip()):
        return False
    if post_type == "video" and not (str(advertisement.get("video_url") or "").strip() or str(advertisement.get("video_name") or "").strip()):
        return False
    return True


def target_from_advertisement(connection: Any, advertisement: dict[str, Any], workspace_id: str, services: QueueRefillServices) -> dict[str, str] | None:
    target_id = str(advertisement.get("destination_blog") or "").strip()
    if not target_id:
        return None
    row = connection.execute("SELECT * FROM submit_targets WHERE id = %s AND workspace_id = %s", (target_id, workspace_id)).fetchone()
    if row:
        data = services.row_to_dict(row)
        return {
            "id": str(data.get("id") or ""),
            "name": str(data.get("name") or data.get("id") or ""),
            "profileName": str(data.get("profile_name") or data.get("name") or data.get("id") or ""),
            "submitUrl": str(data.get("submit_url") or ""),
            "forumUrl": str(data.get("forum_url") or ""),
            "postingRules": str(data.get("posting_rules") or ""),
        }
    if target_id in {"inwell-ads", "jcink-directory", "roleplay-finder"}:
        return None
    return {
        "id": target_id,
        "name": target_id,
        "profileName": target_id,
        "submitUrl": f"https://{target_id}.tumblr.com/submit",
        "forumUrl": "",
        "postingRules": "",
    }


def prepared_post_for_advertisement(advertisement: dict[str, Any], services: QueueRefillServices) -> str:
    rich_body = advertisement_body(advertisement)
    tags = services.parse_tags(advertisement.get("tags", []))
    shared_lines = [
        "",
        f"Forum: {str(advertisement.get('forum_url') or '').strip()}",
        f"Tags: {' '.join(tags)}" if tags else "",
    ]
    shared_lines = [line for line in shared_lines if line]
    post_type = str(advertisement.get("post_type") or "photo")
    if post_type == "text":
        return "\n".join([line for line in ["Tumblr Text Post", rich_body, *shared_lines] if line])
    if post_type == "video":
        return "\n".join(
            [
                line
                for line in [
                    "Tumblr Video Post",
                    f"Video URL: {str(advertisement.get('video_url') or '').strip()}" if str(advertisement.get("video_url") or "").strip() else "",
                    f"Video file: {str(advertisement.get('video_name') or '').strip()}" if str(advertisement.get("video_name") or "").strip() else "",
                    "",
                    rich_body,
                    *shared_lines,
                ]
                if line
            ]
        )
    return "\n".join(
        [
            line
            for line in [
                "Tumblr Photo Post",
                f"Image: {str(advertisement.get('image_name') or '').strip()}" if str(advertisement.get("image_name") or "").strip() else "",
                "",
                rich_body,
                *shared_lines,
            ]
            if line
        ]
    )


def runner_payload_for_refill(advertisement: dict[str, Any], target: dict[str, str], post_package: str, services: QueueRefillServices) -> str:
    tags = services.parse_tags(advertisement.get("tags", []))
    payload = {
        "version": 1,
        "workflow": "tumblr-public-submit-page",
        "target": target,
        "targetProfile": {
            "name": target.get("profileName") or target.get("name") or "",
            "postingRules": target.get("postingRules") or "",
        },
        "advertisement": {
            "id": advertisement.get("id") or "",
            "savedOptionName": advertisement.get("title") or "",
            "campaignName": advertisement.get("campaign_name") or "",
            "postType": advertisement.get("post_type") or "photo",
            "forumUrl": advertisement.get("forum_url") or "",
            "imageClickThroughUrl": advertisement.get("image_click_through_url") or "",
            "tags": tags,
            "imageName": advertisement.get("image_name") or "",
            "imageDataUrl": advertisement.get("image_data_url") or "",
            "imageLinkUrl": advertisement.get("image_click_through_url") or "",
            "videoName": advertisement.get("video_name") or "",
            "videoUrl": advertisement.get("video_url") or "",
        },
        "fields": {
            "body": advertisement_body(advertisement),
            "caption": advertisement_body(advertisement),
            "videoUrl": advertisement.get("video_url") or "",
            "imageDataUrl": advertisement.get("image_data_url") or "",
            "package": post_package,
        },
        "runnerNotes": [
            "Open submitUrl in a logged-in Tumblr browser session.",
            "Choose the matching text/photo/video form.",
            "Paste the prepared fields, upload local media when needed, accept required blog terms, and submit.",
            "If Tumblr shows login, captcha, or changed form markup, pause for manual action.",
            *([f"Target posting rules: {target.get('postingRules')}"] if target.get("postingRules") else []),
        ],
    }
    return json.dumps(payload, indent=2)


def queue_item_completed(item: dict[str, Any]) -> bool:
    return str(item.get("status") or "") in COMPLETED_QUEUE_STATUSES


def queue_item_runnable(item: dict[str, Any]) -> bool:
    return str(item.get("status") or "") in RUNNABLE_QUEUE_STATUSES


def active_queue_match(item: dict[str, Any], ad_id: str, target_id: str, queue_name: str) -> bool:
    if item.get("queue_name") != queue_name or item.get("ad_id") != ad_id or item.get("target_id") != target_id:
        return False
    return not queue_item_completed(item)


def runner_tumblr_account_id(connection: Any, workspace_id: str, fallback: str, services: QueueRefillServices) -> str:
    if fallback:
        return fallback
    row = connection.execute("SELECT * FROM runner_settings WHERE id = %s AND workspace_id = %s", ("default", workspace_id)).fetchone()
    return str(services.row_to_dict(row).get("tumblr_account_id") or "") if row else ""


def queue_refill_target_depth_before_completion(items: list[dict[str, Any]], queue_name: str, completed_item_id: str) -> int:
    return len(
        [
            item
            for item in items
            if item.get("queue_name") == queue_name
            and (item.get("id") == completed_item_id or (not queue_item_completed(item) and str(item.get("status") or "") != "running"))
        ]
    )


def runnable_queue_depth(items: list[dict[str, Any]], queue_name: str) -> int:
    return len([item for item in items if item.get("queue_name") == queue_name and queue_item_runnable(item)])


def queue_items_for_workspace(connection: Any, workspace_id: str, services: QueueRefillServices) -> list[dict[str, Any]]:
    queue_rows = connection.execute("SELECT * FROM submission_queue WHERE workspace_id = %s ORDER BY updated_at DESC", (workspace_id,)).fetchall()
    return [services.row_to_queue_item(row, services.load_runner_payload(connection, str(row["id"]), workspace_id)) for row in queue_rows]


def refill_queue_after_completion(
    connection: Any,
    *,
    workspace_id: str,
    queue_name: str,
    tumblr_account_id: str,
    target_depth: int,
    timestamp: datetime,
    services: QueueRefillServices,
) -> list[dict[str, Any]]:
    if target_depth <= 0:
        return []

    recurrence = services.next_queue_recurrence(connection, workspace_id, queue_name, timestamp)
    if not recurrence:
        return []
    next_occurrence, timezone_name = recurrence
    return reconcile_queue_occurrence(
        connection,
        workspace_id=workspace_id,
        queue_name=queue_name,
        tumblr_account_id=tumblr_account_id,
        timezone_name=timezone_name,
        target_depth=target_depth,
        timestamp=timestamp,
        next_occurrence=next_occurrence,
        services=services,
    )


def reconcile_queue_occurrence(
    connection: Any,
    *,
    workspace_id: str,
    queue_name: str,
    tumblr_account_id: str,
    timezone_name: str,
    target_depth: int,
    timestamp: datetime,
    next_occurrence: datetime,
    services: QueueRefillServices,
) -> list[dict[str, Any]]:
    queue_items = queue_items_for_workspace(connection, workspace_id, services)
    needed = max(0, target_depth - runnable_queue_depth(queue_items, queue_name))
    if needed <= 0:
        return []

    ad_rows = connection.execute("SELECT * FROM advertisements WHERE workspace_id = %s ORDER BY updated_at DESC", (workspace_id,)).fetchall()
    added: list[dict[str, Any]] = []
    occurrence_key = next_occurrence.strftime("%Y%m%dT%H%M%SZ")
    queue_identity = f"{queue_id_from_name(queue_name)}-{hashlib.sha256(queue_name.encode('utf-8')).hexdigest()[:12]}"
    for row in ad_rows:
        if len(added) >= needed:
            break
        advertisement = services.row_to_advertisement(
            row,
            services.load_ordered_values(connection, "advertisement_tags", "advertisement_id", str(row["id"]), "tag", workspace_id),
        )
        if not advertisement_queueable(advertisement):
            continue
        target = target_from_advertisement(connection, advertisement, workspace_id, services)
        if not target or not target.get("id") or not target.get("submitUrl"):
            continue
        if any(active_queue_match(item, str(advertisement["id"]), target["id"], queue_name) for item in [*queue_items, *added]):
            continue

        post_package = prepared_post_for_advertisement(advertisement, services)
        item = services.upsert_queue_item(
            connection,
            {
                "id": f"{advertisement['id']}-{queue_identity}-{target['id']}-refill-{occurrence_key}",
                "workspace_id": workspace_id,
                "ad_id": advertisement["id"],
                "target_id": target["id"],
                "target_name": target.get("name") or target["id"],
                "tumblr_account_id": runner_tumblr_account_id(connection, workspace_id, tumblr_account_id, services),
                "queue_name": queue_name,
                "submit_url": target["submitUrl"],
                "post_type": advertisement.get("post_type") or "photo",
                "status": "scheduled",
                "scheduled_for": next_occurrence,
                "timezone": timezone_name or DEFAULT_TIMEZONE,
                "notes": f"Auto-added for the next queue run at {next_occurrence.isoformat()}.",
                "runner_payload": runner_payload_for_refill(advertisement, target, post_package, services),
                "created_at": timestamp,
                "updated_at": timestamp,
            },
        )
        added.append(item)
        queue_items.append(item)
    return added
