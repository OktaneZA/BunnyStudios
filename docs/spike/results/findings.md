# Phase −1 Findings

Fill this in after running the spike. Be blunt — a negative result is worth more than a positive
one, because it saves building the wrong thing.

**Run date:**
**OpenArt model / tool used:**

---

## Q1 — Does prompt text alone hold a character? (Variant A)

Milo appears in panels 02, 03, 05, 08, 09, 10. Look at those six side by side.

| Trait | Consistent across all six? | Notes |
|---|---|---|
| Red knitted scarf | ☐ yes ☐ mostly ☐ no | |
| Round glasses | ☐ yes ☐ mostly ☐ no | |
| Green dungarees | ☐ yes ☐ mostly ☐ no | |
| Barefoot | ☐ yes ☐ mostly ☐ no | |
| Hair colour / shape | ☐ yes ☐ mostly ☐ no | |
| **Reads as the same boy** | ☐ yes ☐ mostly ☐ no | |

Griggs appears in 02, 04, 05, 08, 10:

| Trait | Consistent? | Notes |
|---|---|---|
| Navy uniform, brass buttons | ☐ yes ☐ mostly ☐ no | |
| Oversized peaked cap | ☐ yes ☐ mostly ☐ no | |
| Grey moustache | ☐ yes ☐ mostly ☐ no | |
| **Reads as the same man** | ☐ yes ☐ mostly ☐ no | |

**Overall verdict on Variant A:**

---

## Q2 — How much does Character Builder add? (Variant B)

Same tables, same panels, with references attached.

| | Variant A | Variant B |
|---|---|---|
| Milo reads as the same boy | | |
| Griggs reads as the same man | | |
| Style consistency across panels | | |
| Composition followed the shot grammar | | |

**Which one is doing the work — the prompt text, or the references?**

**Did the shot-grammar instructions (angle, framing, lens) survive when references were attached, or
did the references override the composition?** *(This matters: if references fight the framing, the
compiler's step 2 is weakened and §5.2 needs retuning.)*

---

## Q3 — Real prompt-length ceiling

Prompt 08 as written is **1,471 characters** — the longest of the ten. Variant A prompts run
804–1,471; the same panels in Variant B run 916–1,106, because a Character Builder reference
replaces ~200 characters of inline description per character. **If Variant B wins on consistency it
also wins ~25% of the prompt budget**, which is a second, independent argument for promoting
`openart_character_ref`.

| | Value |
|---|---|
| Length at which quality visibly degraded | |
| Length at which OpenArt truncated or errored | |
| **Recommended `ManualExportProvider.max_prompt_length`** | |

This replaces the placeholder 2500 in PC-5, which was our own invention and not externally enforced.

---

## Assembly-order observations

Did anything about the §5.2 ordering look wrong in practice?

- Did the style prefix at position 1 dominate, or get lost? →
- Did the palette line (step 11) actually influence colour, or was it wasted characters? →
- Did prop tokens inside the setting sentence (step 6) read as present in frame? →
- Did the mood phrase (step 9) do anything measurable? →
- Anything that should move, or be dropped entirely? →

*(Any section that demonstrably does nothing is characters we're spending against the budget for
free — worth cutting before the compiler is written.)*

---

## Art-style presets

- Presets whose image was **too similar** to a neighbour (phrase needs strengthening): →
- Presets that failed to produce anything usable: →
- Presets unsuitable for a young audience (flag, don't remove): →

---

## Decision

☐ **Spec stands.** §5.2 validated, build as planned.

☐ **Promote Character Builder.** `openart_character_ref` becomes a first-class workflow object;
reference management gets real UI in Phase 1; EX-8's handoff sheet becomes a primary export.

☐ **Retune §5.2** before Phase 2. Changes needed: →

☐ **Re-open the provider decision.** Neither variant held character; P2's continuity promise can't
be met this way.

**Notes:**
