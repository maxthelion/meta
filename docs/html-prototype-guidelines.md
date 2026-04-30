# HTML Prototype Guidelines

Use these guidelines for Balsamiq-style HTML prototypes created during roadmap and feature-design work.

## Purpose

- Prioritise information architecture, interaction design, and behavioral fidelity.
- Make it obvious that the artifact is not a production visual proposal.
- Keep variants easy to fork, compare, and discard.

## Aesthetic

- Use a monochrome base: greyscale for structural text, borders, backgrounds, dividers, and placeholder regions.
- Use the system font stack only.
- A hand-drawn or sketchy feel is optional and useful when it helps signal "not production."
- Avoid shadows, gradients, decorative flourishes, and rounded corners beyond a minimal radius.
- Use generous whitespace. Do not compress the interface to make it look more designed.

## Semantic Color

- Use color only to encode state, not brand or visual hierarchy.
- Use one accent color for primary or interactive elements.
- Reserve consistent roles for hover, focus, selected, disabled, error, success, and new/changed states.
- Use six or seven semantic colors maximum across a prototype.

## Stub Treatment

- Mark anything off the path under test with dashed borders, hatched fills, or greyed-out text.
- Use placeholder labels such as `-> [settings]` or `[user menu]` instead of fully realized off-path UI.
- Make stubs unmistakable so reviewers do not spend attention on them.
- Stub click handlers may log to the console or show a small "stubbed" message.

## Information Architecture

- Decide screens, regions, transitions, and hierarchy before drawing details.
- Keep one primary action per screen; secondary actions should be visibly subordinate.
- Keep navigation, status, and primary action locations consistent across screens.
- Use progressive disclosure. Do not show controls or metadata before they are needed.
- Group related interactions by proximity and separate unrelated groups.

## Behavior

- Implement real interactions on the path under test: clicks change state, forms validate, and transitions happen.
- Make loading, empty, error, and partial states reachable.
- Provide reversibility where it matters, such as undo, cancel, or back.
- Stub off-path behavior instead of faking interactivity that has not been designed.

## Fixture Data

- Use opinionated, adversarial fixtures: long names, empty lists, large lists, weird states, diacritics, and edge cases.
- Avoid bland placeholder text.
- Reuse the same fixtures across prototype variants so comparisons stay fair.

## Interaction Budget

- State the budget explicitly, for example "primary goal in <=2 interactions."
- Annotate the actual click-path so the budget can be verified.
- Do not hide complexity behind misleading affordances to satisfy the budget.

## Scope Discipline

- Add detail only on the path under test.
- Show adjacent entry and exit screens just enough to ground the flow.
- Leave off-path areas incomplete on purpose.

## Technical Constraints

- Prefer a single HTML file with inline CSS and JavaScript.
- Avoid build steps, frameworks, and design-system imports.
- Tailwind via CDN is acceptable, but vanilla CSS is preferred.
- Keep files forkable so a variant can be copied and changed quickly.

## Prototype Test

- If a reviewer could mistake it for a production proposal, it is too polished.
- If differences between variants are cosmetic rather than strategic, the variants are not useful.
- Reviewers should be able to tell what is stubbed without being told.
