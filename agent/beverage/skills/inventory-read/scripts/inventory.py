#!/usr/bin/env python3
"""Brix's scoped inventory bridge: exact rows, preview, then explicit writes."""

import argparse
from contextlib import contextmanager
import json
import os
from pathlib import Path
import sqlite3
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid


CATALOG_FIELDS = ("name", "item_name", "category", "subcategory", "size", "unit", "quantity_status", "count_verified_at")
CATEGORIES = ("syrups", "alcohol", "ingredients", "supplies")


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_):
        return None


def _open(request):
    # Do not forward the service bearer token to a redirect target.
    return urllib.request.build_opener(_NoRedirect).open(request, timeout=15)


def _profile_env():
    homes = [os.environ.get("HERMES_HOME")]
    homes.append(str(Path(__file__).resolve().parents[4]))
    for home in filter(None, homes):
        path = Path(home) / ".env"
        try:
            lines = path.read_text(encoding="utf-8").splitlines()
        except OSError:
            continue
        for line in lines:
            key, separator, value = line.partition("=")
            key = key.strip()
            if separator and key in {"INVENTORY_SERVICE_URL", "BRIX_INVENTORY_READ_TOKEN", "BRIX_INVENTORY_WRITE_TOKEN"}:
                os.environ.setdefault(key, value.strip().strip('"').strip("'"))
        return


def _config(write=False):
    _profile_env()
    base = os.environ.get("INVENTORY_SERVICE_URL", "").rstrip("/")
    token = os.environ.get("BRIX_INVENTORY_WRITE_TOKEN" if write else "BRIX_INVENTORY_READ_TOKEN", "").strip()
    parsed = urllib.parse.urlparse(base)
    local = parsed.hostname in {"localhost", "127.0.0.1"}
    if parsed.scheme != "https" and not (parsed.scheme == "http" and local):
        raise ValueError("Inventory service URL must use HTTPS")
    if not parsed.hostname or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment:
        raise ValueError("Inventory service URL must be an origin only")
    if not token:
        raise ValueError("Brix inventory write credential is not configured" if write else "Brix inventory read credential is not configured")
    return base, token


def _request(path, payload=None):
    write = payload is not None
    base, token = _config(write=write)
    request = urllib.request.Request(
        base + path,
        data=json.dumps(payload).encode("utf-8") if write else None,
        headers={"Authorization": f"Bearer {token}", "Accept": "application/json", **({"Content-Type": "application/json"} if write else {})},
        method="POST" if write else "GET",
    )
    try:
        with _open(request) as response:
            result = json.load(response)
    except urllib.error.HTTPError as error:
        raise ValueError(f"Inventory service refused the {'action' if write else 'read'} (HTTP {error.code})") from None
    except (urllib.error.URLError, TimeoutError):
        raise ValueError("Inventory service response is uncertain; refresh inventory before retrying") from None
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise ValueError("Inventory service returned an invalid response; refresh inventory before retrying") from None
    if not isinstance(result, dict) or result.get("success") is not True:
        raise ValueError("Inventory service did not confirm the action; refresh inventory before retrying")
    return result


def _get(path):
    return _request(path)


def _post(path, payload):
    return _request(path, payload)


def _safe_rows(rows):
    if not isinstance(rows, list):
        raise ValueError("Inventory service returned invalid rows")
    if any(not isinstance(row, dict) for row in rows):
        raise ValueError("Inventory service returned invalid rows")
    result = []
    for row in rows:
        item = {key: row[key] for key in CATALOG_FIELDS if key in row}
        if row.get("quantity_status") == "verified" and type(row.get("quantity")) is int:
            item["quantity"] = row["quantity"]
        result.append(item)
    return result


def _items(category=None):
    suffix = "?" + urllib.parse.urlencode({"category": category}) if category else ""
    rows = _get("/api/hermes/inventory" + suffix).get("items")
    if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
        raise ValueError("Inventory service returned invalid rows")
    return rows


def _exact_target(rows, category, name, size):
    matches = [row for row in rows if row.get("category") == category
               and str(row.get("item_name", "")).strip().casefold() == name.strip().casefold()
               and str(row.get("size") or "").replace(" ", "").casefold() == str(size or "").replace(" ", "").casefold()]
    if len(matches) != 1:
        raise ValueError("Item and size did not resolve to one exact row; list candidates before changing stock")
    row = matches[0]
    if type(row.get("_row_index")) is not int or row["_row_index"] < 2:
        raise ValueError("Inventory row identity unavailable; no stock was changed")
    if not isinstance(row.get("raw_quantity"), str) or not isinstance(row.get("raw_count_verified_at"), str):
        raise ValueError("Inventory snapshot unavailable; no stock was changed")
    return row


@contextmanager
def _journal():
    """Persistent single-flight journal; failure to open it forbids a stock write."""
    profile = Path(os.environ.get("HERMES_HOME") or Path(__file__).resolve().parents[4])
    path = Path(os.environ.get("BRIX_INVENTORY_ACTION_DB") or profile / "state" / "brix-inventory-actions.sqlite3")
    marker = (path.with_suffix(".initialized") if os.environ.get("BRIX_INVENTORY_ACTION_DB")
              else profile / ".brix-inventory-journal-initialized")
    connection = None
    try:
        if marker.exists() != path.exists():
            raise ValueError("Inventory journal or initialization marker is missing; no stock write is allowed")
        path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        connection = sqlite3.connect(path, timeout=15)
        os.chmod(path, 0o600)
        connection.execute("PRAGMA synchronous=FULL")
        connection.execute("""CREATE TABLE IF NOT EXISTS actions (
            id TEXT PRIMARY KEY, payload TEXT NOT NULL, status TEXT NOT NULL,
            result TEXT, actor TEXT NOT NULL DEFAULT 'Ashley via Brix',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )""")
        connection.commit()
        if not marker.exists():
            with marker.open("x", encoding="utf-8") as record:
                record.write(str(path.resolve()))
                record.flush()
                os.fsync(record.fileno())
            os.chmod(marker, 0o600)
        yield connection
        connection.commit()
    except (OSError, sqlite3.Error):
        if connection:
            connection.rollback()
        raise ValueError("Inventory action journal unavailable; no stock was changed") from None
    except BaseException:
        if connection:
            connection.rollback()
        raise
    finally:
        if connection:
            connection.close()


def _preview_action(path, payload, was_verified=None):
    preview = _post(path, payload)
    action_id = str(uuid.uuid4())
    with _journal() as journal:
        try:
            journal.execute("INSERT INTO actions (id, payload, status) VALUES (?, ?, 'preview')",
                            (action_id, json.dumps({"path": path, "payload": payload, "was_verified": was_verified}, sort_keys=True)))
        except sqlite3.Error:
            raise ValueError("Inventory action journal unavailable; no stock was changed") from None
    return {"ok": True, "action_id": action_id, "preview": _public_result(preview, payload, was_verified), "applied": False}


def _public_result(result, payload, was_verified):
    clean = dict(result)
    if payload.get("operation") == "count" and was_verified is not True:
        clean.pop("previous_raw_quantity", None)
    return clean


def _apply_action(action_id):
    if not action_id:
        raise ValueError("Apply requires the action ID returned by preview")
    with _journal() as journal:
        try:
            journal.execute("BEGIN IMMEDIATE")
            row = journal.execute("SELECT payload, status, result FROM actions WHERE id = ?", (action_id,)).fetchone()
            if row is None:
                raise ValueError("Unknown preview action; no stock was changed")
            payload_json, status, result_json = row
            if status == "confirmed":
                stored = json.loads(payload_json)
                return {"ok": True, "action_id": action_id, "result": _public_result(json.loads(result_json), stored["payload"], stored.get("was_verified")), "applied": True, "replayed": True}
            if status != "preview":
                raise ValueError("This action is uncertain or already in progress; inspect the Sheet before any new action")
            active = journal.execute("SELECT id FROM actions WHERE status IN ('pending', 'uncertain') LIMIT 1").fetchone()
            if active:
                raise ValueError("Another stock action is pending or uncertain; reconcile it before writing")
            journal.execute("UPDATE actions SET status = 'pending' WHERE id = ?", (action_id,))
            journal.commit()  # Durable intent before any network write.
        except ValueError:
            journal.rollback()
            raise
        except sqlite3.Error:
            journal.rollback()
            raise ValueError("Inventory action journal unavailable; no stock was changed") from None

    stored = json.loads(payload_json)
    payload = {**stored["payload"], "dry_run": False}
    try:
        confirmed = _post(stored["path"], payload)
    except ValueError:
        with _journal() as journal:
            journal.execute("UPDATE actions SET status = 'uncertain' WHERE id = ? AND status = 'pending'", (action_id,))
        raise ValueError("Stock action outcome is uncertain; inspect the Sheet and reconcile before any new action") from None
    try:
        with _journal() as journal:
            journal.execute("UPDATE actions SET status = 'confirmed', result = ? WHERE id = ? AND status = 'pending'",
                            (json.dumps(confirmed, sort_keys=True), action_id))
    except (ValueError, sqlite3.Error):
        raise ValueError("Stock write may have succeeded but its journal confirmation failed; reconcile before any new action") from None
    return {"ok": True, "action_id": action_id, "result": _public_result(confirmed, payload, stored.get("was_verified")), "applied": True}


def _journal_status():
    with _journal() as journal:
        blocking = journal.execute(
            "SELECT id, payload, status, created_at FROM actions WHERE status IN ('pending', 'uncertain') ORDER BY rowid DESC"
        ).fetchall()
        recent = journal.execute(
            "SELECT id, payload, status, created_at FROM actions ORDER BY rowid DESC LIMIT 50"
        ).fetchall()
    blocking_ids = {entry[0] for entry in blocking}
    entries = blocking + [entry for entry in recent if entry[0] not in blocking_ids]
    actions = []
    for action_id, payload_json, status, created_at in entries:
        stored = json.loads(payload_json)
        request = dict(stored["payload"])
        if request.get("operation") == "count" and stored.get("was_verified") is not True:
            request.pop("expected_raw_quantity", None)
        actions.append({"action_id": action_id, "status": status, "created_at": created_at, "request": request})
    return {"ok": True, "actions": actions}


def _reconcile_action(action_id, outcome, note, owner_approved):
    """Resolve a stuck action only after checking the canonical Sheet row."""
    if not action_id or outcome not in {"applied", "not-applied"} or not note or not owner_approved:
        raise ValueError("Reconciliation needs action ID, outcome, note, and explicit Ashley approval")
    with _journal() as journal:
        row = journal.execute("SELECT payload, status FROM actions WHERE id = ?", (action_id,)).fetchone()
    if row is None or row[1] not in {"pending", "uncertain"}:
        raise ValueError("Action is not pending or uncertain")
    stored = json.loads(row[0])
    payload = stored["payload"]
    rows = _items(payload["category"])
    if stored["path"].endswith("/create-verified"):
        matches = [item for item in rows if item.get("category") == payload["category"]
                   and str(item.get("item_name", "")).strip().casefold() == payload["item_name"].strip().casefold()
                   and str(item.get("size") or "").replace(" ", "").casefold() == str(payload.get("size") or "").replace(" ", "").casefold()]
        observed_applied = len(matches) == 1 and matches[0].get("quantity_status") == "verified" and matches[0].get("quantity") == payload["quantity"]
        observed_not_applied = len(matches) == 0
    else:
        matches = [item for item in rows if item.get("category") == payload["category"]
                   and item.get("_row_index") == payload["row_index"]
                   and item.get("item_name") == payload["expected_name"]
                   and str(item.get("size") or "").replace(" ", "").casefold() == str(payload.get("expected_size") or "").replace(" ", "").casefold()]
        if len(matches) != 1:
            raise ValueError("Canonical item row changed; cannot reconcile automatically")
        item = matches[0]
        before = payload["expected_raw_quantity"]
        try:
            prior_count = int(float(before))
        except ValueError:
            prior_count = None
        operation = payload["operation"]
        expected_new = payload["quantity"] if operation == "count" else (
            prior_count + (payload["quantity"] if operation == "add" else -payload["quantity"])
            if prior_count is not None else None
        )
        observed_applied = (item.get("quantity_status") == "verified"
                            and item.get("quantity") == expected_new
                            and item.get("raw_count_verified_at") != payload["expected_verified_at"])
        observed_not_applied = (item.get("raw_quantity") == before
                                and item.get("raw_count_verified_at") == payload["expected_verified_at"])
    if (outcome == "applied" and not observed_applied) or (outcome == "not-applied" and not observed_not_applied):
        raise ValueError("Canonical Sheet readback does not prove that outcome; action remains blocked")
    result = {"reconciled": True, "outcome": outcome, "note": note, "observed": _safe_rows(matches)}
    with _journal() as journal:
        journal.execute("BEGIN IMMEDIATE")
        current = journal.execute("SELECT status FROM actions WHERE id = ?", (action_id,)).fetchone()
        if not current or current[0] not in {"pending", "uncertain"}:
            raise ValueError("Action state changed during reconciliation")
        journal.execute("UPDATE actions SET status = ?, result = ? WHERE id = ?",
                        ("confirmed" if outcome == "applied" else "resolved_not_applied", json.dumps(result, sort_keys=True), action_id))
    return {"ok": True, "action_id": action_id, "outcome": outcome, "readback": result}


def run(command, category=None, search=None, *, name=None, size=None, quantity=None, operation=None, reason=None, subcategory=None, action_id=None, outcome=None, note=None, owner_approved=False):
    if command == "status":
        result = _get("/api/hermes/status")
        return {
            "ok": True,
            "enabled": result.get("enabled"),
            "configured": result.get("brix_read_configured"),
            "write_configured": result.get("brix_write_configured"),
            "workbook": result.get("active_workbook_title"),
            "quantity_status": "per_item",
        }
    if command == "inventory":
        rows = _safe_rows(_items(category))
        if search:
            term = search.casefold()
            rows = [row for row in rows if term in str(row.get("name") or row.get("item") or "").casefold()]
        return {
            "ok": True,
            "source": "inventory_sheet",
            "quantity_status": "per_item",
            "item_count": len(rows),
            "items": rows,
        }
    if command == "change":
        if category not in CATEGORIES or not name or operation not in {"count", "add", "remove"}:
            raise ValueError("Category, exact item name, and count/add/remove are required")
        if type(quantity) is not int or quantity < 0 or (operation != "count" and quantity == 0):
            raise ValueError("Use a nonnegative whole count or a positive whole adjustment")
        row = _exact_target(_items(category), category, name, size)
        if operation != "count" and row.get("quantity_status") != "verified":
            raise ValueError("Record a physical count before adding or removing this item's stock")
        payload = {"operation": operation, "category": category, "row_index": row["_row_index"],
                   "expected_name": row["item_name"], "expected_size": row.get("size"),
                   "expected_raw_quantity": row["raw_quantity"], "expected_verified_at": row["raw_count_verified_at"],
                   "quantity": quantity, "reason": reason or "Ashley-directed inventory change", "dry_run": True}
        return _preview_action("/api/hermes/inventory/change", payload, was_verified=row.get("quantity_status") == "verified")
    if command == "create":
        if category not in CATEGORIES or not name or type(quantity) is not int or quantity < 0:
            raise ValueError("Category, item name, and a physical starting count are required")
        payload = {"category": category, "item_name": name, "quantity": quantity, "size": size,
                   "subcategory": subcategory, "dry_run": True}
        return _preview_action("/api/hermes/inventory/create-verified", payload)
    if command == "apply":
        return _apply_action(action_id)
    if command == "journal-status":
        return _journal_status()
    if command == "reconcile":
        return _reconcile_action(action_id, outcome, note, owner_approved)
    if command == "pickup":
        raise ValueError("The inventory app's pickup list is not maintained; use the CRM packing/prep list instead")
    raise ValueError("Unsupported inventory command")


def main():
    parser = argparse.ArgumentParser(description="Brix inventory catalogue and exact counted stock operations")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("status")
    inventory = sub.add_parser("inventory")
    inventory.add_argument("--category", choices=CATEGORIES)
    inventory.add_argument("--search")
    change = sub.add_parser("change")
    change.add_argument("--category", required=True, choices=CATEGORIES)
    change.add_argument("--name", required=True)
    change.add_argument("--size")
    change.add_argument("--operation", required=True, choices=("count", "add", "remove"))
    change.add_argument("--quantity", required=True, type=int)
    change.add_argument("--reason")
    create = sub.add_parser("create")
    create.add_argument("--category", required=True, choices=CATEGORIES)
    create.add_argument("--name", required=True)
    create.add_argument("--size")
    create.add_argument("--subcategory")
    create.add_argument("--quantity", required=True, type=int)
    apply_parser = sub.add_parser("apply")
    apply_parser.add_argument("--action-id", required=True)
    sub.add_parser("journal-status")
    reconcile = sub.add_parser("reconcile")
    reconcile.add_argument("--action-id", required=True)
    reconcile.add_argument("--outcome", required=True, choices=("applied", "not-applied"))
    reconcile.add_argument("--note", required=True)
    reconcile.add_argument("--owner-approved", action="store_true")
    sub.add_parser("pickup")
    args = parser.parse_args()
    try:
        output = run(args.command, getattr(args, "category", None), getattr(args, "search", None),
                     name=getattr(args, "name", None), size=getattr(args, "size", None),
                     quantity=getattr(args, "quantity", None), operation=getattr(args, "operation", None),
                     reason=getattr(args, "reason", None), subcategory=getattr(args, "subcategory", None),
                     action_id=getattr(args, "action_id", None), outcome=getattr(args, "outcome", None),
                     note=getattr(args, "note", None), owner_approved=getattr(args, "owner_approved", False))
        print(json.dumps(output, ensure_ascii=False))
    except ValueError as error:
        print(json.dumps({"ok": False, "error": str(error)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
