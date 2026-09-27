# Phase −1 Spike — Validate the Core Bet

**Historical experiment.** The current production-continuity gate is
[continuity-benchmark.md](continuity-benchmark.md), comparing prompt-only, start frames and
approved references across compatible endpoints. The original prompts below remain useful
fixtures; the former “no app code” gate is superseded by the Character Studio build plan.

## What we are testing

Storyboard Studio's entire value rests on one unproven assumption:

> A dense compiled paragraph, assembled in the §5.2 order, produces **the same character** across
> many panels.

That assumption may be wrong. Character consistency in image generation typically comes from
**reference-based systems** — OpenArt's Character Builder — far more than from prompt text. If that
turns out to be true here, the product's centre of gravity moves: the elaborate compiler becomes
secondary, and *managing Character Builder references and panel order* becomes the main job. Better
to learn that now than after Phase 2.

We also produce the 17 `art_style` preset images the visual picker needs, in the same sitting.

## The three questions

1. **Does prompt text alone hold a character?** Milo appears in 7 of the 10 panels. Do those seven
   Milos look like the same boy?
2. **How much does Character Builder add?** Variant B is the same ten prompts with the inline
   character description replaced by a Character Builder reference. The difference between A and B
   is the answer.
3. **What is the real prompt-length ceiling?** PC-5's 2500 characters is *our own invention* — no
   external API enforces it in Phase 1. Find the number OpenArt actually handles well.

## How to run it

### Part 1 — Consistency (the important part)

1. Open `variant-a-inline.md`. Paste each of the 10 prompts into OpenArt's storyboard/Smart Shot
   tool, one panel at a time, in order. Use the negative prompt at the top of the file for all ten.
   Set aspect ratio 16:9.
2. Save the ten images into `results/variant-a/` named `01.png` … `10.png`.
3. In OpenArt's **Character Builder**, create two characters — `MILO` and `GRIGGS` — using the
   descriptions in `variant-b-charbuilder.md`.
4. Run the ten prompts from `variant-b-charbuilder.md`, attaching those Character Builder references.
   Save into `results/variant-b/`.
5. Fill in `results/findings.md`. Be blunt; a negative result here is worth more than a positive one.

### Part 2 — Prompt length

Take prompt 08 (the longest, three characters) and pad `user_prompt_addendum` with extra descriptive
detail until output quality visibly degrades or OpenArt truncates. Record the character count at
which that happens. That number becomes `ManualExportProvider.max_prompt_length`, replacing the
placeholder 2500.

### Part 3 — Art style images

Run all 17 prompts in `art-styles.md`. Same subject, same framing, only the style phrase changes.
Save as `results/art-styles/<value>.png` — e.g. `results/art-styles/rubber_hose_1930s.png`.
These become the `art_style` picker cards in Phase 1, so the child picking a style sees what it
actually looks like rather than reading "1930s rubber hose animation, bouncing curves".

## What the outcome changes

| If… | Then |
|---|---|
| Variant A holds character well | Spec stands. §5.2 is validated. Build as planned. |
| Only Variant B holds character | **`openart_character_ref` is promoted to a first-class workflow object**, not a nullable footnote on Character. The handoff sheet (EX-8) becomes a primary export, not an appendix. Character reference images (`reference_asset_ids`) get a real management UI in Phase 1. |
| Neither holds character | The continuity promise (P2) cannot be met through OpenArt. Re-open the provider decision before writing the compiler. |
| Ordering of prompt sections visibly matters | Retune §5.2 before Phase 2 and record why. |
