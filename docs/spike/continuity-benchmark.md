# Continuity benchmark — structured story plus approved references

27 September 2026. Replaces the old OpenArt-only experiment as the production-continuity release gate. Reuse the existing Milo/Griggs/Scraps fixture and Biscuit Robbery story; do not discard older results. No paid benchmark has been run for this plan.

## Question

Which combination of structured story instructions, approved visual references and model produces acceptable continuity at a usable cost? Evaluate character identity and shot execution together; a recognisable character that ignores the action is not an accepted take.

## Comparison arms

1. Prompt only.
2. Approved starting frame plus prompt.
3. Approved character references with minimal action wording.
4. The same reference pack plus full compiled shot instructions.
5. Repeat supported arms across Seedance, Wan and H3/H3 Max. Keep model variants and output settings explicit; mark unavailable arms unsupported rather than silently substituting another workflow.

Use the same approved cast revision and scene brief across comparisons. Freeze reference hashes, prompt/compiler version, endpoint/settings and seeds when exposed. A seed value is not comparable randomness across different providers.

## Small first pass

Proposed starting matrix: six shots, two independent takes per supported arm/model, one fixed output configuration and one visual style. First run the payload/control tests for free; quote the supported live matrix before execution. Obtain a bounded spend allowance and stop at its cap. Expand to a second style only if the first pass warrants it.

The six shots cover front/profile, back/three-quarter, two-character interaction, occlusion/re-entry, motion across the frame, and a linked follow-on shot. Repeat an intentional outfit change separately to distinguish supported change from identity drift. Include a rabbit and another non-human character so human face matching is not the sole measure.

## Record and review

For every take record: job/group ID, frozen inputs, reference version/hash, endpoint, task, size/FPS, requested/generated duration, quoted/actual-or-unknown cost, wait time, attempts and reviewer decision. Score face/ears/markings, silhouette/proportions, colours, costume, style, action adherence and transition continuity. Record extra/missing/swapped characters as critical defects.

Use a simple 0–2 scale per trait: wrong, noticeable drift, consistent. A human must accept the complete take; automated similarity scores are supplementary. Report accepted takes divided by all attempts, total spend per accepted second, median/tail latency and critical-defect count. Retain failures and retries in cost calculations.

## Release gate

An initial candidate gate is at least 80% human-accepted takes in the chosen supported configuration, with zero critical identity swaps/extra principal characters among accepted takes. This is a proposed product threshold, not a measured result; ratify it before the paid run. A small sample supports a limited rollout, not a claim of universal consistency. Run the teen/tablet usability check separately.

Store results under `docs/spike/results/continuity/` when produced, including the frozen matrix, decisions and remaining limitations. Do not pre-fill outcomes or mark this gate passed because provider marketing claims consistency.
