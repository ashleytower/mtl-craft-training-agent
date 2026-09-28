import importlib.util
import io
from pathlib import Path
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

    def test_reads_filtered_rows_without_costs_or_write(self):
        calls = []

        def fake_open(request, timeout):
            calls.append(request)
            self.assertEqual(request.get_method(), "GET")
            self.assertEqual(request.get_header("Authorization"), "Bearer test-token")
            return io.BytesIO(b'{"success":true,"items":[{"name":"Butterfly Pea Syrup 4oz","quantity":3,"unit":"bottles","cost":12},{"name":"Lemon Juice","quantity":2}]}')

        with patch.dict("os.environ", {"INVENTORY_SERVICE_URL": "https://inventory.example", "BRIX_INVENTORY_READ_TOKEN": "test-token"}):
            with patch.object(inventory, "_open", side_effect=lambda request: fake_open(request, 15)):
                result = inventory.run("inventory", category="syrups", search="butterfly")
        self.assertEqual(result["count"], 1)
        self.assertEqual(result["items"][0]["quantity"], 3)
        self.assertNotIn("cost", result["items"][0])
        self.assertIn("category=syrups", calls[0].full_url)

    def test_pickup_is_read_only_and_unknown_command_refuses(self):
        with patch.object(inventory, "_get", return_value={"success": True, "items": [{"item": "Vodka", "quantity": 2}]}):
            self.assertEqual(inventory.run("pickup")["count"], 1)
            with self.assertRaisesRegex(ValueError, "Unsupported"):
                inventory.run("restock")

    def test_status_reports_brix_credential_not_master_credential(self):
        with patch.object(inventory, "_get", return_value={"success": True, "configured": True, "brix_read_configured": False, "active_workbook_title": "MTL Inventory"}):
            self.assertIs(inventory.run("status")["configured"], False)

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


if __name__ == "__main__":
    unittest.main()
