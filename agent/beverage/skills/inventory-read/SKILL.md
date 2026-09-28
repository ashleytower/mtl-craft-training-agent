---
name: inventory-read
description: "Read current MTL Craft bar inventory or pickup/shopping list for Brix. Use for stock counts, bottle sizes, availability, and pickup-list questions. Never use a formula or chat history as stock truth."
---

# Inventory Read

The existing Google Sheet, via the inventory service, is stock truth. This skill is read-only. It does not change quantities, prices, costs, pickup status, or orders. Do not say a change was made. For a stock write request, state that it needs an owner-confirmed inventory action; do not call another tool as a shortcut.

Run `python3 skills/beverage/inventory-read/scripts/inventory.py` with exactly one command:

- `status` — check the configured live workbook.
- `inventory` — list stock. `--category syrups` narrows the backend query; `--search "butterfly pea"` filters returned item names.
- `pickup` — read the current pickup list.

Use the returned `name`, `size`, `quantity`, and `unit` exactly. Similar names or different bottle sizes are separate rows; never silently sum them. If the requested item matches multiple rows, list the candidates and ask which one. If the service is unreachable or refuses authentication, say that live stock cannot be verified; do not answer from memory. Never include the credential or service headers in chat.
