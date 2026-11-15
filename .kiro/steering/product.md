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

## Hackathon Context

**Event**: Kiroween 2026, Frankenstein category

**Judging criteria**:
- Potential impact
- Quality of implementation
- Design
- Creativity
- Presentation

**Requirement**: All submission material must be in English
