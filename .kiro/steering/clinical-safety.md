# Clinical Safety Rules

## Citation Requirement

Every clinical claim in case files, rubrics, and debrief text **must** cite a source in a `references` field.

**Acceptable sources**:
- Clinical practice guidelines (e.g., AHA, ERC, ATLS)
- Medical textbooks (standard references in the field)

**Not acceptable**:
- General web searches
- Non-peer-reviewed content
- AI-generated medical content without verification

## Disclaimers

### In Code and Documentation
Never present the simulator as medical advice. Always clarify educational intent.

### In UI
Show a visible **"Educational simulation, not for clinical use"** notice in the user interface.

## Engine Limitations

Only use conditions and treatments that the Pulse Physiology Engine actually models.

**Reference**: see `tech.md` for verified actions and modeling limits.

**Prefer**: conditions with strong mechanical models (tension pneumothorax, hemorrhage, asthma, airway obstruction, sepsis)

**Avoid or note limitations**: conditions with weak models (opioid overdose, anaphylaxis)

## When Unsure

**Never guess clinical details.**

If uncertain about:
- Pathophysiology
- Treatment protocols
- Normal ranges
- Clinical decision criteria

Leave a `TODO` comment for the author (who is a clinical medicine student) instead of inventing content.

Example:
```yaml
# TODO(author): verify normal pediatric heart rate range and add citation
```
