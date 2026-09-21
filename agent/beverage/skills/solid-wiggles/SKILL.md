---
name: solid-wiggles
description: "Use when asked about the cookbook Solid Wiggles by Jena Derman and Jack Schramm: jelly shots and jelly cakes, sheet gelatin, clarifying juice (Pectinex, kieselsol, chitosan), the tools, brands and ingredients the book names, or what the book recommends or warns against. Searches the summaries held for that book and cites them. Never supplies a house recipe or a quantity to weigh out."
metadata:
  version: "1.0.0"
  created_from_session: "2026-09-21 Solid Wiggles book sources"
---

# Solid Wiggles

Answer questions about one cookbook, from the summaries held for it.

## Trigger

- "What gelatin does the Solid Wiggles book use?"
- "Why won't my pineapple jelly set?"
- "What does the book say about clarifying juice?"
- "Which olive brine do they recommend?"
- "What tools do I need for the jelly cakes?"
- "How do I bloom the sheet gelatin?"
- "How do I get a jelly cake out of the pan?"

A question about a house recipe is not this skill: "how much sugar is in our jalapeño syrup" is `formula-scaling` `list`. A technique question that is not about this book ("why did my emulsion separate") is `formula-scaling` `knowledge`.

## What is held, and what it is not

Two kinds of source, and each result tells you which:

- **Summaries another tool compiled from the book.** They are **not the authors' words**, and nobody has checked them against the book. Every passage carries `provenance` and comes back `quotable: false`. Page numbers are Kindle pages, and one source has none and says so in its citation.
- **The authors' own words**, pasted by the owner from the Kindle edition (the technique sections). They come back `quotable: true` with no `provenance`. Their page numbers were not recorded, so the citation names the section instead.

They cover part of the book only. **`coverage_note` on every response is the authority on what is held and what is not.** Read it; do not recite it from memory.

## Run it

```bash
python3 skills/beverage/solid-wiggles/scripts/book.py query --query "why won't pineapple jelly set"
```

Optional `--limit` (default 5, max 10). Use the question in the person's own words; there is no filter to set. The script keeps only this book's passages, so course material never appears here.

## Reading the result

- `citation`: already composed. **Use it exactly as given.** Do not shorten it, restyle it, or attach it to a claim it does not support.
- `provenance`: on every passage that is a summary. The first time a summary comes up in an answer, say it in plain words: "a summary of the book says...". Never "the book says" on its own for a summary, and never in quotation marks as though it were the authors' sentence.
- `quotable` is `false` for a summary: do not read it out as a quotation. Relay what it says in your own words and give the citation.
- A passage with `quotable: true` and no `provenance` is the authors' own words. Say "the book says", attributed. Quote a sentence or two at most; for anything longer, put it in your own words and give the citation. Do not paste a whole section into a chat message.
- `search_mode`: `text_only` means the embedding service was down and the results are narrower. If they look thin, say so; do not conclude the book has nothing.
- `boundary`: the same sentence every time. Nothing here changes a formula.

## When it comes back empty, or the topic is not held

Say the Solid Wiggles sources do not answer it. Do **not** answer from general baking or bartending knowledge, and never present your own knowledge as what the book says. If it is something the book surely covers but `coverage_note` says is not held, say the book itself would have it and that Ashley can paste the passage so it can be added. You cannot add it yourself.

## Never a house measure

Amounts in these sources are the book's (and, for a summary, unchecked). They are not MTL Craft formulas and not something to weigh out for an event. Scaling, batching or costing anything is `formula-scaling`, and only approved formulas scale. Do not do arithmetic on a number from this book.

## Where to buy is not held

Retail suggestions were left out of these sources on purpose. Brands and specs the book names are held; stores and prices are not. Do not offer a store as though the book said it.

## Hindi and English

Same as `formula-scaling`: answer in the language of the message. Numbers, units and product names are never translated or converted. If you translate a passage into Hindi, say so in one short line.

## Answer shape

Phone-readable: the answer first, then the citation.

> Use canned pineapple juice. A summary of the book says the enzyme in fresh pineapple keeps gelatin from setting.
> [the `citation` string, exactly as returned]
