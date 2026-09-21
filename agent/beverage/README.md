# Brix — the beverage agent

The live copies of these files are **not** here. They are read from the Hermes
profile at runtime:

    ~/.hermes/profiles/beverage/SOUL.md
    ~/.hermes/profiles/beverage/skills/beverage/formula-scaling/
    ~/.hermes/profiles/beverage/skills/beverage/solid-wiggles/

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
