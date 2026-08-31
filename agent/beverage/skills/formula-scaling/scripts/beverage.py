#!/usr/bin/env python3
"""Deterministic client for the MTL Craft beverage API.

The agent never does formula arithmetic. This script calls the beverage
service, which scales using exact rational arithmetic, and prints the result as
JSON. It has no write capability: there is no route here to create or approve a
formula version, because that is a signed-in person's decision.

Usage:
  beverage.py list
  beverage.py drafts --search strawberry
  beverage.py knowledge --query "why did my syrup go cloudy"
  beverage.py coverage
  beverage.py scale --formula "Blood Orange Cordial" --mode multiplier --value 2.5
  beverage.py scale --formula "Jalapeno Syrup" --mode target-yield --value 25
  beverage.py scale --formula "Jalapeno Syrup" --mode have \
      --ingredient Jalapeno --quantity 3700 --unit gr
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request

DEFAULT_BASE_URL = "http://localhost:3000"


def _config():
    base = os.environ.get("BEVERAGE_API_URL", DEFAULT_BASE_URL).rstrip("/")
    token = os.environ.get("BEVERAGE_HERMES_TOKEN", "").strip()
    if not token:
        _fail(
            "BEVERAGE_HERMES_TOKEN is not set. The beverage API cannot be reached "
            "without it. Do not answer from memory."
        )
    return base, token


def _fail(message, payload=None):
    out = {"ok": False, "error": message}
    if payload is not None:
        out["detail"] = payload
    print(json.dumps(out, indent=2))
    sys.exit(1)


def _call(path, token, body=None):
    url = f"{path}"
    data = None
    headers = {"x-hermes-service-token": token}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["content-type"] = "application/json"

    req = urllib.request.Request(url, data=data, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        try:
            detail = json.loads(detail)
        except json.JSONDecodeError:
            pass
        _fail(f"beverage API returned HTTP {exc.code}", detail)
    except urllib.error.URLError as exc:
        _fail(
            "beverage API is unreachable. Say so rather than reconstructing a "
            f"formula from memory. ({exc.reason})"
        )


def cmd_list(_args):
    base, token = _config()
    result = _call(f"{base}/api/hermes/formulas", token)
    print(json.dumps({"ok": True, **result}, indent=2))


def cmd_drafts(args):
    """What exists but is not approved. Names only — never quantities."""
    base, token = _config()
    path = f"{base}/api/hermes/drafts"
    if args.search:
        import urllib.parse
        path += "?search=" + urllib.parse.quote(args.search)
    result = _call(path, token)
    print(json.dumps({"ok": True, **result}, indent=2))


def cmd_method(args):
    """How an approved formula is made. Never invents steps when none exist."""
    base, token = _config()
    result = _call(f"{base}/api/hermes/formulas", token)
    wanted = args.formula.strip().lower()
    matches = [
        f for f in result.get("formulas", [])
        if f.get("id") == args.formula.strip() or (f.get("name") or "").strip().lower() == wanted
    ]
    if not matches:
        _fail(
            f'No approved formula matches "{args.formula}".',
            {"approved_names": [f.get("name") for f in result.get("formulas", [])]},
        )
    if len(matches) > 1:
        _fail(
            f'"{args.formula}" matches {len(matches)} approved formulas. Use the id.',
            {"candidates": [{"id": f.get("id"), "name": f.get("name")} for f in matches]},
        )
    formula = matches[0]
    print(json.dumps({
        "ok": True,
        "name": formula.get("name"),
        "product_category": formula.get("product_category"),
        "method": formula.get("method"),
    }, indent=2))


def cmd_knowledge(args):
    """Technique and theory from the governed corpus. Never a formula.

    Every result arrives with a finished `citation` built by the service from
    the stored lesson and timestamp. Read it as given — do not compose your own
    and do not adjust a timestamp to look tidier.
    """
    base, token = _config()
    import urllib.parse
    path = f"{base}/api/hermes/knowledge?q=" + urllib.parse.quote(args.query)
    if args.limit:
        path += f"&limit={int(args.limit)}"
    result = _call(path, token)
    print(json.dumps({"ok": True, **result}, indent=2))


def cmd_coverage(_args):
    """What the corpus actually holds, per source and per course lesson."""
    base, token = _config()
    result = _call(f"{base}/api/hermes/knowledge/coverage", token)
    print(json.dumps({"ok": True, **result}, indent=2))


def cmd_scale(args):
    base, token = _config()

    if args.mode == "multiplier":
        if args.value is None:
            _fail("--value is required for --mode multiplier")
        request = {"mode": "multiplier", "multiplier": str(args.value)}
    elif args.mode == "target-yield":
        if args.value is None:
            _fail("--value is required for --mode target-yield")
        request = {"mode": "targetYield", "targetYieldValue": str(args.value)}
    else:
        missing = [
            name
            for name, value in (
                ("--ingredient", args.ingredient),
                ("--quantity", args.quantity),
                ("--unit", args.unit),
            )
            if not value
        ]
        if missing:
            _fail(f"--mode have requires {', '.join(missing)}")
        request = {
            "mode": "limitingIngredient",
            "ingredientName": args.ingredient,
            "availableQuantity": str(args.quantity),
            "unit": args.unit,
        }

    result = _call(
        f"{base}/api/hermes/scale",
        token,
        {"formula": args.formula, "request": request},
    )
    print(json.dumps({"ok": True, **result}, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("list", help="List approved formulas").set_defaults(func=cmd_list)

    drafts = sub.add_parser(
        "drafts", help="List UNAPPROVED drafts by name (no quantities)")
    drafts.add_argument("--search", help="Filter draft names")
    drafts.set_defaults(func=cmd_drafts)

    knowledge = sub.add_parser(
        "knowledge", help="Search the governed knowledge corpus (technique, not formulas)")
    knowledge.add_argument("--query", required=True, help="A plain-language question")
    knowledge.add_argument("--limit", help="Passages to return (default 6, max 25)")
    knowledge.set_defaults(func=cmd_knowledge)

    sub.add_parser(
        "coverage", help="What the corpus holds, and which course lessons are missing"
    ).set_defaults(func=cmd_coverage)

    scale = sub.add_parser("scale", help="Scale an approved formula")
    method = sub.add_parser("method", help="How an approved formula is made")
    method.add_argument("--formula", required=True, help="Formula name or id")
    method.set_defaults(func=cmd_method)

    scale.add_argument("--formula", required=True, help="Formula name or id")
    scale.add_argument(
        "--mode",
        required=True,
        choices=["multiplier", "target-yield", "have"],
        help="have = scale to the quantity of a limiting ingredient on hand",
    )
    scale.add_argument("--value", help="Multiplier or target yield")
    scale.add_argument("--ingredient", help="Limiting ingredient (--mode have)")
    scale.add_argument("--quantity", help="Quantity on hand (--mode have)")
    scale.add_argument("--unit", help="Unit, must match the formula (--mode have)")
    scale.set_defaults(func=cmd_scale)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
