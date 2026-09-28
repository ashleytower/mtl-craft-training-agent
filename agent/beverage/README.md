# Brix — the beverage agent

The live copies of these files are **not** here. They are read from the Hermes
profile at runtime:

    ~/.hermes/profiles/beverage/SOUL.md
    ~/.hermes/profiles/beverage/skills/beverage/formula-scaling/
    ~/.hermes/profiles/beverage/skills/beverage/solid-wiggles/
    ~/.hermes/profiles/beverage/skills/beverage/inventory-read/

Nothing under `~/.hermes` is version controlled, so this directory is the
committed mirror. It is the record of what Brix was told, alongside the API it
was told to call — a change to `hermesRoutes.ts` that is not reflected in
`SKILL.md` is the failure mode this directory exists to make visible.

Copy by hand; there is deliberately no sync script, because an automatic copy
would let an unreviewed live edit overwrite a reviewed one.

    cp ~/.hermes/profiles/beverage/SOUL.md agent/beverage/SOUL.md
    cp ~/.hermes/profiles/beverage/skills/beverage/formula-scaling/SKILL.md \
       agent/beverage/skills/formula-scaling/SKILL.md
    cp ~/.hermes/profiles/beverage/skills/beverage/formula-scaling/scripts/beverage.py \
       agent/beverage/skills/formula-scaling/scripts/beverage.py
    cp ~/.hermes/profiles/beverage/skills/beverage/solid-wiggles/SKILL.md \
       agent/beverage/skills/solid-wiggles/SKILL.md
    cp ~/.hermes/profiles/beverage/skills/beverage/solid-wiggles/scripts/book.py \
       agent/beverage/skills/solid-wiggles/scripts/book.py

The inventory-read skill calls the Railway REST bridge, not an MCP server.
`BRIX_INVENTORY_READ_TOKEN` reads the catalogue, and the distinct
`BRIX_INVENTORY_WRITE_TOKEN` can only call the exact-row count/add/remove and
verified-item-create endpoints. Put both tokens and `INVENTORY_SERVICE_URL` in
the profile's private `.env`, never in this repository. Copy the reviewed skill
to the live profile after tests, then reload the beverage gateway. Old Sheet
counts remain unverified until a physical count is recorded item by item; do
not reset all counts to zero or substitute the broad Hermes service token.
The old pickup list is still not maintained.
The action journal is the private `state/brix-inventory-actions.sqlite3` in the
live profile. It must survive restarts and be backed up with that profile. A
pending or uncertain action blocks further writes until the Sheet is checked;
do not remove or reset the journal to make an action retry. This guarantee
depends on the current single Brix writer and one Railway replica/process;
adding writers or replicas requires server-side idempotency first.
The profile-root `.brix-inventory-journal-initialized` marker prevents silent
recreation after journal loss. Resolve a stuck action with `journal-status`
and, after canonical Sheet readback and Ashley approval, `reconcile`; never
delete the SQLite file or marker as a shortcut.

`solid-wiggles/scripts/test_book.py` lives only here, not in the profile. Run it
with `python3 -m unittest agent/beverage/skills/solid-wiggles/scripts/test_book.py`.

A running gateway caches its skills list in memory, so a NEW skill is not seen
until the gateway restarts (`launchctl kickstart -k
gui/$(id -u)/ai.hermes.gateway-beverage`). A new chat session is not enough: the
cache is per process, not per session.
`scripts/brix-status.sh` checks the mirror for both skills.

Note the path shape differs: the live skill sits under `skills/beverage/`
(category folder), the mirror flattens that to `skills/`.

Telegram: https://t.me/Brix_recipe_bot — a bot cannot appear in a chat list
until the user messages it first.
