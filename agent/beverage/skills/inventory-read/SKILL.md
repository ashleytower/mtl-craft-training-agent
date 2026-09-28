---
name: inventory-read
description: "Read MTL Craft's inventory item catalogue for Brix. Item names and sizes are useful, but stock quantities and pickup status are not verified."
---

# Inventory Read

Ashley confirmed that the inventory Sheet lists real items, but its numeric quantities are wrong and she does not maintain the app. Treat this as an item catalogue, **not stock truth**. This skill is read-only and deliberately hides the Sheet's quantities. Do not infer stock on hand, availability, shortages, or a shopping quantity from a listed item, an old pickup row, a formula, or chat history. An item appearing here means only that it is in the catalogue. Exact stock counts require a new physical count supplied by Ashley or her staff and an owner-confirmed inventory action; do not claim a count has been saved.

Run `python3 skills/beverage/inventory-read/scripts/inventory.py` with exactly one command:

- `status` — check the configured live workbook.
- `inventory` — list catalogue items. `--category syrups` narrows the backend query; `--search "butterfly pea"` filters returned item names.
- `pickup` — refuses because the app's pickup list is not maintained. Use the CRM packing/prep list for event needs; do not use this old list as purchase truth.

Use the returned `name`, `size`, and `unit` as catalogue metadata. `quantity_status: unverified` means no stock count is available through this skill. Similar names or different bottle sizes are separate rows; never silently combine them. If the requested item matches multiple rows, list the candidates and ask which one. If the service is unreachable or refuses authentication, say that the catalogue could not be read; do not answer from memory. Never include the credential or service headers in chat.
