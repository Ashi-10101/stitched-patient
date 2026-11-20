# Product: Stitched Patient

## Summary

Stitched Patient is a virtual patient for medical training that combines two components:

- **Body**: the open-source Pulse Physiology Engine (Kitware, Apache-2.0), which computes vital signs and responds to injuries and treatments in real time
- **Mind**: a large language model that role-plays the patient, speaking in character and reacting to the body's current physiological state

## Target Users

- Medical students
- Residents
- Nurses
- Other healthcare learners in emergency medicine training

### Anyone can play

Play mode opens the same simulation to people with no medical training:

- Hackathon judges
- Curious non-medical visitors

They must understand what is happening within a minute, without reading numbers.

## Two Views of One Session

- **Play** (default): a cartoon stitched patient avatar whose look follows the live vitals, a one-sentence plain-language status, a goal with an ending (rescued or lost), up to three hints, plain intervention labels, and a Rewind button
- **Clinician**: the full bedside monitor for medical learners

Both views run on the same session, the same branches, and the same physiology engine. Switching views never restarts or changes the session. Play mode changes presentation only and adds a per-case goal. Its goals, hints, and status sentences live in the case file and follow the clinical-safety rules (citation or `TODO(author)`).

## Core Loop

1. **Talk**: interact with the patient through natural conversation
2. **Examine**: assess the patient's condition
3. **Treat**: administer interventions (medications, procedures)
4. **Watch vitals**: observe the bedside monitor responding to treatments
5. **Rewind/fork**: branch the timeline at any earlier moment to explore alternative decisions
6. **Debrief**: receive performance scoring against a clinical rubric with explanations

## First Case

Adult tension pneumothorax

## Non-Goals

- **Not a diagnostic tool**: this is for training only
- **Not for real patient care**: no clinical decision support
- **No real patient data**: all scenarios are synthetic
- **Not health advice for the public**: Play mode's plain-language cues and hints simplify the simulation so it is easy to follow. They are not guidance for real situations

## Hackathon Context

**Event**: Kiroween 2026, Frankenstein category

**Judging criteria**:
- Potential impact
- Quality of implementation
- Design
- Creativity
- Presentation

**Requirement**: All submission material must be in English
