#!/usr/bin/env python3
"""Read item names from Brix's inventory bridge; stock counts are unverified."""

import argparse
import json
import os
from pathlib import Path
import sys
import urllib.error
import urllib.parse
import urllib.request


CATALOG_FIELDS = ("name", "item", "category", "subcategory", "size", "unit")


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
            if separator and key in {"INVENTORY_SERVICE_URL", "BRIX_INVENTORY_READ_TOKEN"}:
                os.environ.setdefault(key, value.strip().strip('"').strip("'"))
        return


def _config():
    _profile_env()
    base = os.environ.get("INVENTORY_SERVICE_URL", "").rstrip("/")
    token = os.environ.get("BRIX_INVENTORY_READ_TOKEN", "").strip()
    parsed = urllib.parse.urlparse(base)
    local = parsed.hostname in {"localhost", "127.0.0.1"}
    if parsed.scheme != "https" and not (parsed.scheme == "http" and local):
        raise ValueError("Inventory service URL must use HTTPS")
    if not parsed.hostname or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment:
        raise ValueError("Inventory service URL must be an origin only")
    if not token:
        raise ValueError("Brix inventory read credential is not configured")
    return base, token


def _get(path):
    base, token = _config()
    request = urllib.request.Request(
        base + path,
        headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
        method="GET",
    )
    try:
        with _open(request) as response:
            result = json.load(response)
    except urllib.error.HTTPError as error:
        raise ValueError(f"Inventory service refused the read (HTTP {error.code})") from None
    except (urllib.error.URLError, TimeoutError):
        raise ValueError("Inventory service is unreachable") from None
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise ValueError("Inventory service returned an invalid response") from None
    if not isinstance(result, dict) or result.get("success") is not True:
        raise ValueError("Inventory service did not confirm the read")
    return result


def _safe_rows(rows):
    if not isinstance(rows, list):
        raise ValueError("Inventory service returned invalid rows")
    if any(not isinstance(row, dict) for row in rows):
        raise ValueError("Inventory service returned invalid rows")
    return [{key: row[key] for key in CATALOG_FIELDS if key in row} for row in rows]


def run(command, category=None, search=None):
    if command == "status":
        result = _get("/api/hermes/status")
        return {
            "ok": True,
            "enabled": result.get("enabled"),
            "configured": result.get("brix_read_configured"),
            "workbook": result.get("active_workbook_title"),
            "quantity_status": "unverified",
        }
    if command == "inventory":
        suffix = "?" + urllib.parse.urlencode({"category": category}) if category else ""
        rows = _safe_rows(_get("/api/hermes/inventory" + suffix).get("items"))
        if search:
            term = search.casefold()
            rows = [row for row in rows if term in str(row.get("name") or row.get("item") or "").casefold()]
        return {
            "ok": True,
            "source": "inventory_sheet_catalogue",
            "quantity_status": "unverified",
            "item_count": len(rows),
            "items": rows,
        }
    if command == "pickup":
        raise ValueError("The inventory app's pickup list is not maintained; use the CRM packing/prep list instead")
    raise ValueError("Unsupported inventory command")


def main():
    parser = argparse.ArgumentParser(description="Read item catalogue only; quantities are unverified")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("status")
    inventory = sub.add_parser("inventory")
    inventory.add_argument("--category")
    inventory.add_argument("--search")
    sub.add_parser("pickup")
    args = parser.parse_args()
    try:
        output = run(args.command, getattr(args, "category", None), getattr(args, "search", None))
        print(json.dumps(output, ensure_ascii=False))
    except ValueError as error:
        print(json.dumps({"ok": False, "error": str(error)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
