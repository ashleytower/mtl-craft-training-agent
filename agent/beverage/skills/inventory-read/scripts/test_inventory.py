import importlib.util
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import urllib.error


SPEC = importlib.util.spec_from_file_location("brix_inventory", Path(__file__).with_name("inventory.py"))
inventory = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(inventory)


class InventoryReadTests(unittest.TestCase):
    def test_missing_credential_fails_closed(self):
        with patch.dict("os.environ", {"INVENTORY_SERVICE_URL": "https://inventory.example", "BRIX_INVENTORY_READ_TOKEN": ""}):
            with self.assertRaisesRegex(ValueError, "credential"):
                inventory._config()

    def test_url_must_be_origin_and_https(self):
        with patch.dict("os.environ", {"INVENTORY_SERVICE_URL": "http://inventory.example", "BRIX_INVENTORY_READ_TOKEN": "test"}):
            with self.assertRaisesRegex(ValueError, "HTTPS"):
                inventory._config()
        with patch.dict("os.environ", {"INVENTORY_SERVICE_URL": "https://inventory.example/redirect", "BRIX_INVENTORY_READ_TOKEN": "test"}):
            with self.assertRaisesRegex(ValueError, "origin"):
                inventory._config()

    def test_reads_filtered_catalogue_without_unverified_counts_costs_or_write(self):
        calls = []

        def fake_open(request, timeout):
            calls.append(request)
            self.assertEqual(request.get_method(), "GET")
            self.assertEqual(request.get_header("Authorization"), "Bearer test-token")
            return io.BytesIO(b'{"success":true,"items":[{"name":"Butterfly Pea Syrup 4oz","quantity":3,"unit":"bottles","cost":12},{"name":"Lemon Juice","quantity":2}]}')

        with patch.dict("os.environ", {"INVENTORY_SERVICE_URL": "https://inventory.example", "BRIX_INVENTORY_READ_TOKEN": "test-token"}):
            with patch.object(inventory, "_open", side_effect=lambda request: fake_open(request, 15)):
                result = inventory.run("inventory", category="syrups", search="butterfly")
        self.assertEqual(result["item_count"], 1)
        self.assertEqual(result["quantity_status"], "per_item")
        self.assertEqual(result["source"], "inventory_sheet")
        self.assertNotIn("quantity", result["items"][0])
        self.assertNotIn("cost", result["items"][0])
        self.assertIn("category=syrups", calls[0].full_url)

    def test_unmaintained_pickup_and_unknown_command_refuse_without_network_call(self):
        with patch.object(inventory, "_get") as get:
            with self.assertRaisesRegex(ValueError, "not maintained"):
                inventory.run("pickup")
            with self.assertRaisesRegex(ValueError, "Unsupported"):
                inventory.run("restock")
            get.assert_not_called()

    def test_status_reports_brix_credential_not_master_credential(self):
        with patch.object(inventory, "_get", return_value={"success": True, "configured": True, "brix_read_configured": False, "active_workbook_title": "MTL Inventory"}):
            result = inventory.run("status")
            self.assertIs(result["configured"], False)
            self.assertEqual(result["quantity_status"], "per_item")

    def test_redirect_is_refused_before_bearer_can_be_forwarded(self):
        request = inventory.urllib.request.Request(
            "https://inventory.example/api/hermes/inventory",
            headers={"Authorization": "Bearer secret-value"},
        )
        handler = inventory._NoRedirect()
        redirected = handler.redirect_request(
            request, None, 302, "Found", {}, "https://other.example/steal"
        )
        self.assertIsNone(redirected)

    def test_auth_failure_does_not_echo_secret(self):
        error = urllib.error.HTTPError("https://inventory.example/api/hermes/inventory", 401, "bad", {}, None)
        with patch.dict("os.environ", {"INVENTORY_SERVICE_URL": "https://inventory.example", "BRIX_INVENTORY_READ_TOKEN": "secret-value"}):
            with patch.object(inventory, "_open", side_effect=error):
                with self.assertRaisesRegex(ValueError, "HTTP 401") as caught:
                    inventory.run("inventory")
        self.assertNotIn("secret-value", str(caught.exception))

    def test_verified_count_only_and_exact_size(self):
        rows = [
            {"name": "Syrup 4oz", "item_name": "Syrup", "category": "syrups", "size": "4oz", "quantity_status": "verified", "quantity": 5, "_row_index": 2, "raw_quantity": "5", "raw_count_verified_at": "t1"},
            {"name": "Syrup 8oz", "item_name": "Syrup", "category": "syrups", "size": "8oz", "quantity_status": "unverified", "quantity": 99, "_row_index": 3, "raw_quantity": "99", "raw_count_verified_at": ""},
        ]
        safe = inventory._safe_rows(rows)
        self.assertEqual(safe[0]["quantity"], 5)
        self.assertNotIn("quantity", safe[1])
        self.assertEqual(inventory._exact_target(rows, "syrups", "Syrup", "4oz")["_row_index"], 2)
        with self.assertRaisesRegex(ValueError, "exact row"):
            inventory._exact_target(rows, "syrups", "Syrup", None)

    def test_change_previews_then_applies_same_snapshot(self):
        row = {"item_name": "Syrup", "category": "syrups", "size": "4oz", "quantity_status": "verified", "_row_index": 2, "raw_quantity": "5", "raw_count_verified_at": "t1"}
        posts = []

        def post(path, payload):
            posts.append((path, dict(payload)))
            return {"success": True, "new_quantity": 7}

        with tempfile.TemporaryDirectory() as tmp, patch.dict("os.environ", {"BRIX_INVENTORY_ACTION_DB": str(Path(tmp) / "actions.db")}), patch.object(inventory, "_get", return_value={"items": [row]}), patch.object(inventory, "_post", side_effect=post):
            preview = inventory.run("change", "syrups", name="Syrup", size="4oz", operation="add", quantity=2)
            self.assertFalse(preview["applied"])
            self.assertEqual(len(posts), 1)
            self.assertTrue(posts[0][1]["dry_run"])
            result = inventory.run("apply", action_id=preview["action_id"])
            replay = inventory.run("apply", action_id=preview["action_id"])
        self.assertTrue(result["applied"])
        self.assertTrue(replay["replayed"])
        self.assertEqual([entry[1]["dry_run"] for entry in posts], [True, False])
        self.assertEqual(posts[-1][1]["expected_verified_at"], "t1")

    def test_unverified_delta_and_failed_preview_never_write(self):
        row = {"item_name": "Syrup", "category": "syrups", "size": "4oz", "quantity_status": "unverified", "_row_index": 2, "raw_quantity": "5", "raw_count_verified_at": ""}
        with tempfile.TemporaryDirectory() as tmp, patch.dict("os.environ", {"BRIX_INVENTORY_ACTION_DB": str(Path(tmp) / "actions.db")}), patch.object(inventory, "_get", return_value={"items": [row]}), patch.object(inventory, "_post") as post:
            with self.assertRaisesRegex(ValueError, "physical count"):
                inventory.run("change", "syrups", name="Syrup", size="4oz", operation="remove", quantity=1)
            post.assert_not_called()
            post.side_effect = ValueError("preview refused")
            with self.assertRaisesRegex(ValueError, "preview refused"):
                inventory.run("change", "syrups", name="Syrup", size="4oz", operation="count", quantity=3)
            self.assertEqual(post.call_count, 1)

    def test_new_item_preview_then_apply_and_separate_write_token(self):
        calls = []

        def post_request(path, payload):
            calls.append(dict(payload))
            return {"success": True, "new_quantity": 3}

        with tempfile.TemporaryDirectory() as tmp, patch.dict("os.environ", {"BRIX_INVENTORY_ACTION_DB": str(Path(tmp) / "actions.db")}), patch.object(inventory, "_post", side_effect=post_request):
            preview = inventory.run("create", "syrups", name="New Syrup", size="4oz", quantity=3)
            self.assertFalse(preview["applied"])
            self.assertTrue(inventory.run("apply", action_id=preview["action_id"])["applied"])
            self.assertEqual([call["dry_run"] for call in calls], [True, False])
        with patch.dict("os.environ", {"INVENTORY_SERVICE_URL": "https://inventory.example", "BRIX_INVENTORY_READ_TOKEN": "read", "BRIX_INVENTORY_WRITE_TOKEN": "write"}):
            self.assertEqual(inventory._config()[1], "read")
            self.assertEqual(inventory._config(write=True)[1], "write")

    def test_uncertain_apply_is_never_resent_and_blocks_other_actions(self):
        with tempfile.TemporaryDirectory() as tmp, patch.dict("os.environ", {"BRIX_INVENTORY_ACTION_DB": str(Path(tmp) / "actions.db")}), patch.object(inventory, "_post", side_effect=[{"success": True}, ValueError("timeout"), {"success": True}]) as post:
            preview = inventory.run("create", "syrups", name="New Syrup", size="4oz", quantity=3)
            with self.assertRaisesRegex(ValueError, "uncertain"):
                inventory.run("apply", action_id=preview["action_id"])
            with self.assertRaisesRegex(ValueError, "uncertain"):
                inventory.run("apply", action_id=preview["action_id"])
            second = inventory.run("create", "syrups", name="Another Syrup", size="4oz", quantity=1)
            with self.assertRaisesRegex(ValueError, "pending or uncertain"):
                inventory.run("apply", action_id=second["action_id"])
            self.assertEqual(post.call_count, 3)

    def test_owner_reconciles_uncertain_create_from_sheet_readback(self):
        with tempfile.TemporaryDirectory() as tmp, patch.dict("os.environ", {"BRIX_INVENTORY_ACTION_DB": str(Path(tmp) / "actions.db")}):
            with patch.object(inventory, "_post", side_effect=[{"success": True}, ValueError("timeout")]):
                preview = inventory.run("create", "syrups", name="New Syrup", size="4oz", quantity=3)
                with self.assertRaisesRegex(ValueError, "uncertain"):
                    inventory.run("apply", action_id=preview["action_id"])
            # Reopen the same durable journal, as after a process restart.
            with patch.object(inventory, "_get", return_value={"items": [
                {"category": "syrups", "item_name": "New Syrup", "size": "4oz", "quantity": 3,
                 "quantity_status": "verified", "raw_quantity": "3", "raw_count_verified_at": "saved"}
            ]}):
                with self.assertRaisesRegex(ValueError, "Ashley approval"):
                    inventory.run("reconcile", action_id=preview["action_id"], outcome="applied", note="Sheet row checked")
                resolved = inventory.run("reconcile", action_id=preview["action_id"], outcome="applied", note="Sheet row checked", owner_approved=True)
                self.assertEqual(resolved["outcome"], "applied")
                self.assertEqual(inventory.run("journal-status")["actions"][0]["status"], "confirmed")

    def test_missing_journal_after_initialization_fails_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            db = Path(tmp) / "actions.db"
            with patch.dict("os.environ", {"BRIX_INVENTORY_ACTION_DB": str(db)}):
                inventory.run("journal-status")
                self.assertTrue(db.with_suffix(".initialized").exists())
                db.unlink()
                with self.assertRaisesRegex(ValueError, "missing"):
                    inventory.run("journal-status")

    def test_unverified_legacy_count_is_not_shown_to_brix(self):
        for raw, stamp in (("99", ""), ("99", "invalid-stamp"), ("nonsense", "2026-09-28T00:00:00Z")):
            with self.subTest(raw=raw, stamp=stamp):
                row = {"item_name": "Syrup", "category": "syrups", "size": "4oz", "quantity_status": "unverified", "_row_index": 2, "raw_quantity": raw, "raw_count_verified_at": stamp}
                with tempfile.TemporaryDirectory() as tmp, patch.dict("os.environ", {"BRIX_INVENTORY_ACTION_DB": str(Path(tmp) / "actions.db")}), patch.object(inventory, "_get", return_value={"items": [row]}), patch.object(inventory, "_post", return_value={"success": True, "previous_raw_quantity": raw, "new_quantity": 3}):
                    preview = inventory.run("change", "syrups", name="Syrup", size="4oz", operation="count", quantity=3)
                    self.assertNotIn("previous_raw_quantity", preview["preview"])
                    self.assertNotIn("expected_raw_quantity", inventory.run("journal-status")["actions"][0]["request"])
                    result = inventory.run("apply", action_id=preview["action_id"])
                    self.assertNotIn("previous_raw_quantity", result["result"])


if __name__ == "__main__":
    unittest.main()
