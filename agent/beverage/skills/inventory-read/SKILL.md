---
name: inventory-read
description: "Read MTL Craft's inventory and, on Ashley's explicit instruction, count, add, or remove stock through the scoped Inventory API."
---

# Inventory Operations

The inventory Sheet lists real items, but its older quantities are not trustworthy. Only a row marked `quantity_status: verified` has a usable on-hand count. Do not infer stock, shortages, or purchases from an unverified row, pickup list, formula, or chat history. A fresh count must come from Ashley or staff, not from the old Sheet value.

Run `python3 skills/beverage/inventory-read/scripts/inventory.py` with one command:

- `status` — check the configured live workbook.
- `inventory` — list items. `--category syrups` narrows the backend query; `--search "butterfly pea"` filters returned item names. Only verified rows expose `quantity`.
- `change --category syrups --name "Butterfly Pea" --size 4oz --operation count --quantity 7` — preview a physical count of 7.
- `change --category syrups --name "Butterfly Pea" --size 4oz --operation add --quantity 2` — preview adding 2 to an already-verified count. `remove` reduces on-hand stock, never deletes the catalogue item.
- `create --category syrups --name "New Syrup" --size 4oz --quantity 3` — preview a new, physically counted item. Syrup size is required; exact duplicate item+size is refused.
- `apply --action-id <ID returned by preview>` — only when Ashley explicitly instructed that specific stock change. This is the only write command. Never invent a new action ID for a retry.
- `journal-status` — inspect recent action IDs and any `pending` or `uncertain` action after a timeout/restart.
- `reconcile --action-id <ID> --outcome applied|not-applied --note "..." --owner-approved` — only after Ashley approves the resolution. This re-reads the canonical Sheet and refuses an outcome it cannot prove. Never delete the journal or guess an outcome.
- `pickup` — refuses because the app's pickup list is not maintained. Use the CRM packing/prep list for event needs; do not use this old list as purchase truth.

Resolve an exact category, `item_name`, and size before changing stock. Similar names and bottle sizes are different rows. If ambiguous, show candidates and ask which; never guess. Preview creates a durable action ID; apply reuses its saved payload and the API checks the exact row and count snapshot again. Do not start a second preview for the same Ashley instruction after an uncertain result. The local journal blocks further writes until an uncertain outcome is reconciled against the Sheet; never auto-retry. Show Ashley the action, observed Sheet state, and proposed resolution before using `--owner-approved`. If readback is ambiguous, leave it blocked and escalate to an operator. Report saved changes only from confirmed API readback. Never expose credentials or service headers. This scoped path does not change costs, pricing, orders, the old pickup list, or delete catalogue items.
