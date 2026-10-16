# Domain Docs

## Before exploring, read these

This repo uses a single-context layout:

- `GLOSSARY.md` at the repo root: read the domain vocabulary.
- `docs/adr/`: read ADRs relevant to the area you are about to work in.

If these files do not exist, proceed silently. The `domain-modeling` skill creates them lazily when terms or decisions get resolved.

## Use the glossary's vocabulary

Use the terms defined in `GLOSSARY.md` when naming domain concepts in issue titles, proposals, hypotheses, and tests. If a concept is missing, reconsider whether it belongs to the domain or note the gap for `domain-modeling`.

## Flag ADR conflicts

If a proposal contradicts an existing ADR, identify the ADR and explain why the decision should be revisited.
