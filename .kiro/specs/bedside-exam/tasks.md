# Implementation Plan: Bedside exam

## Overview

This plan implements the bedside exam: side Variants of the case resolved and picked by the Physiology_Service, a client-only exam group with a Findings_List and an Exam_Record in the Play_View, and the "no giveaway" rules for the Avatar, the Hints and the Ending_Screen. It follows `requirements.md` (commit `7f974eb`) and `design.md` (commit `ac5bc68`). Property numbers refer to the design's "Correctness Properties" section.

The order is: Python test markers and the Case_Resolver → schema, case file and `scripts/validate-case.py` → Case_Loader → Session_API → existing slow-test setup → the right-Variant engine test (the only `-m pulse` run) → web types and fixtures → lineage, sides and status helpers → Exam_Finding_Selector → Exam_Record storage → Avatar_Mapper gate → reducer and hook → ExamPanel and FindingsList → EndingScreen and PlayView → case-content checks → screen symmetry → final checkpoint → manual acceptance (author and user only). The Notes explain each change from the order the user gave.

Every task is small (about one module and its tests) and ends with a passing suite in its own language. Every task and sub-task is required; none is optional.

## Tasks

- [x] 1. Python test markers and the Case_Resolver
  - [x] 1.1 Register the `pulse` marker and mark the nine slow tests
    - Files: `services/physiology/pytest.ini`, `test_case_actions.py`, `test_fork.py`, `test_checkpoints_interventions.py`, `test_vitals_socket.py`, `test_determinism.py` (all under `services/physiology/`). No other file changes
    - In `pytest.ini`, add `markers = pulse: starts a real Pulse engine` (design D9)
    - Add `@pytest.mark.pulse` (and `import pytest` where missing) to exactly the nine tests of the design table "Tests that need a Pulse engine": `test_case_needle_decompression_beats_untreated_fork`; `test_real_fork_vitals_match_parent_at_checkpoint`, `test_http_fork_unknown_checkpoint_returns_404`, `test_http_fork_valid_checkpoint_returns_new_branch`; `test_unknown_intervention_and_bad_parameter_return_400`, `test_engine_action_failure_returns_500_and_service_survives`, `test_successful_intervention_saves_manual_checkpoint`; `test_pause_only_on_last_disconnect`; `test_determinism`
    - Existing tests whose setup changes: these nine, marker only. No assertion, body or helper changes here; the `variant_id: "left"` changes come in task 5
    - From the repository root (never `docker compose up`, `down`, `stop` or `restart`; do not touch the container on port 8000, which belongs to another session):
      - `docker compose build physiology`
      - `docker compose run --rm --no-deps physiology python3 -m pytest -m pulse --collect-only -q` must list exactly the nine tests above. Collection starts no Pulse engine
      - `docker compose run --rm --no-deps physiology python3 -m pytest -m "not pulse"`
    - Use execute_bash with a timeout of 900000 ms for the build and the test run. If it reports a timeout, read the output before retrying
    - Quote the collected test list and the pytest summary line in the task report
    - _Requirements: 14.13_

  - [x] 1.2 Implement `services/physiology/case_resolver.py` with its tests
    - Files: `services/physiology/case_resolver.py` (new), `services/physiology/test_case_resolver.py` (new), `services/physiology/requirements.txt`. No other file changes
    - Add `hypothesis==6.100.0` to `requirements.txt` (requirements decision 16, design "Property test settings"). The image build must install it on the image's Python 3.9; if `pip3 install` fails during the build, stop and report the error instead of choosing another version
    - Implement the module exactly as the design section "Case_Resolver" states: imports only `bisect`, `copy`, `dataclasses`, `typing` and `jsonschema`; `OVERRIDE_KEYS`, `TENSION_PNEUMOTHORAX_ACTION`, `CaseProblem` (with `__str__` per "Error messages"), `CaseVariantError`, `VariantSelectionError`, `resolve_variant`, `check_case` (steps 1 to 7 in order, each later step only when the earlier ones found nothing), `resolve_all`, `variant_index` (`bisect_right` over `k / n`, D5) and `choose_variant` (the table of five rows)
    - In `test_case_resolver.py`:
      - `HYPOTHESIS_SETTINGS = settings(max_examples=100, derandomize=True, deadline=None)`, applied to every property
      - one example per row of the design table "Error messages", asserting the exact `str(problem)`. For the "Resolved schema" row, pass a schema defined in the test that checks `play.hints[*].text` length but has no `variants` definition, because from task 2 the shipped schema already rejects the empty text at the base step
      - `resolve_variant` on the shipped case: read `adult-tension-pneumothorax.yaml` from the loader's cases directory, remove any `variants` key, and resolve a Variant written in the test, so the test passes before and after task 2 adds Variants to the file
      - **Property 1: The Case_Resolver changes only the Override_Targets**. Base_Cases built from the shipped case (with `variants` removed) plus random extra fields, zero to three Scheduled_Insults of random actions and sides, with or without a Play_Section. Tag: `# Feature: bedside-exam, Property 1: The Case_Resolver changes only the Override_Targets`
      - **Property 2: The Case_Resolver rejects bad Variants by id and path**, with `schema=None` and with a schema; for the `document="resolved"` fault use a fault the base schema cannot see or the test-local schema above. Tag: `# Feature: bedside-exam, Property 2: The Case_Resolver rejects bad Variants by id and path`
      - **Property 4: The Variant pick is floor(u × n), and each Variant owns an interval of width 1/n**, including `k / n`, `math.nextafter(k / n, 0)`, 0 and the largest float below 1. Tag: `# Feature: bedside-exam, Property 4: The Variant pick is floor(u × n), and each Variant owns an interval of width 1/n`
      - **Property 5: A named `variant_id` is used as given, and a bad one is refused**, with a source stub that fails the test when called. Tag: `# Feature: bedside-exam, Property 5: A named variant_id is used as given, and a bad one is refused`
    - From the repository root (never `docker compose up`, `down`, `stop` or `restart`; do not touch the container on port 8000):
      - `docker compose build physiology`
      - `docker compose run --rm --no-deps physiology python3 -m pytest test_case_resolver.py -m "not pulse"`
      - `docker compose run --rm --no-deps physiology python3 -m pytest -m "not pulse"`
    - Use execute_bash with a timeout of 900000 ms for the build and each test run. If it reports a timeout, read the output before retrying
    - Quote both pytest summary lines in the task report
    - _Requirements: 1.4, 1.5, 1.6, 1.7, 1.9, 1.10, 1.13, 3.2, 3.3, 3.4, 3.5, 3.11, 3.12, 10.3, 14.9, 14.10_
    - _Properties: 1, 2, 4, 5_

- [x] 2. Schema, case file and case validation script
  - [x] 2.1 Extend `cases/case-schema.json`, `cases/adult-tension-pneumothorax.yaml` and `scripts/validate-case.py`, and update the case-content marker rule
    - Files: `cases/case-schema.json`, `cases/adult-tension-pneumothorax.yaml`, `scripts/validate-case.py`, `apps/web/src/lib/caseContent.test.ts` (the `checkTodoMarkers` rule only). No other file changes
    - Schema: apply the design section "JSON Schema changes" exactly: move `play.hints` and `endings.rescued.requiredInterventions` into `definitions` (`hintList`, `requiredInterventionList`) behind standalone `$ref`s; add `variants` at the root; add `exam` and `sideRevealText` under `play.properties`; add the `definitions` entries `sideRevealText`, `kebabId`, `variant`, `variantOverrides`, `examSection`, `examLabel`, `examAction` (with the `oneOf` and the `if`/`then`), `examRule` and `examWhen`. Add no `additionalProperties: false` at the root
    - Case file: apply the design section "Case file additions" exactly: replace the three `play.hints` with the three drafts shown there; add `play.sideRevealText` and `play.exam` after `status`; add the top-level `variants` after `play` and before `references`, with the decision comment directly above `variants:`. Copy every `TODO(author)` comment as written in the design. Every other line of the file stays unchanged, including the Base_Case insult `side: Left`, `requiredInterventions: ["needle-decompression-left"]` and its 2026-11-20 decision comment
    - Clinical safety: the texts are drafts from the requirements table "Draft content for the author". Do not change any wording, do not add a citation, and keep the windpipe `vitals` item as the marked placeholder
    - Script: apply the design section "`scripts/validate-case.py`": insert `<repo>/services/physiology` at the front of `sys.path` and import `case_resolver`; a Base_Case without Variants keeps today's output and exit codes; with Variants print one `✗ <problem>` line per `check_case` problem and exit 1, or `✓ Base case is valid` and one `✓ Resolved case of variant '<id>' is valid` line per Variant and exit 0. The schema path stays `cases/case-schema.json` relative to the working directory
    - `caseContent.test.ts`, assertion change in `checkTodoMarkers` and its test "every number, Hint text, sentence and draft text has a TODO(author) marker ending with the draft suffix" (rename the test to match the new rule). Reason: the new Hint markers name the bedside-exam spec and do not end with `DRAFT_SUFFIX`, so today's rule fails as soon as the case file changes. The new rule, from the design list "Web tests whose assertions change":
      - items added by this spec need a `TODO(author)` marker that contains `bedside-exam spec`: `play.hints[*].text`, `play.sideRevealText`, the `play.exam` labels (`label`, `labels.Left`, `labels.Right`), Exam_Rule sentences, exam `defaultSentence`s and `when.vitals` lists, `variants[*].overrides.hints[*].text` and `variants[*].overrides.sideRevealText`
      - every other item keeps the `DRAFT_SUFFIX` rule
      - `TEXT_ITEM_PATTERNS` gains these paths, the walk also covers the top-level `variants`, and the covering-`references` exemption extends to `play.exam.references` and `play.exam.actions[i].references` (8.5)
      - `insultSide` and `requiredInterventions` inside `variants` need no marker (2.6)
      - add broken-copy tests on a modified copy of the case text: a Variant Hint without its marker, and a new-item marker without `bedside-exam spec`, each failing with its field path. The existing broken-copy test "names the field path whose TODO(author) marker is missing, and honours covering references" keeps its expected strings
    - `checkHints` is not changed here: the Base_Case Hints still pass it (only the last Hint names an Intervention, the left Play_Label). Task 15.1 changes it
    - With the file tools only (never execute_bash), create these copies of the updated case file under `/tmp/sp-cases/`. They are outside the repository and are not committed:
      - `unknown-key.yaml`: the `right` Variant's `overrides` gains `goalText: "x"`
      - `duplicate-id.yaml`: the second Variant's `id` is `left`
      - `empty-reveal.yaml`: the `right` Variant's `sideRevealText` is `""`
      - `no-variants.yaml`: the `variants` key and its decision comment removed
    - From the repository root (never `docker compose up`, `down`, `stop` or `restart`; do not touch the container on port 8000):
      - `docker compose build physiology` (cached: nothing under `services/physiology/` changed; the script runs from the mounted repository)
      - real case: `docker compose run --rm --no-deps -v "$PWD:/repo:ro" -w /repo physiology python3 scripts/validate-case.py cases/adult-tension-pneumothorax.yaml` must print `✓ Base case is valid` and one `✓ Resolved case of variant` line for `left` and for `right`, and exit 0
      - each copy: `docker compose run --rm --no-deps -v "$PWD:/repo:ro" -v /tmp/sp-cases:/sp-cases:ro -w /repo physiology python3 scripts/validate-case.py /sp-cases/<file>.yaml`. The working directory is `/repo`, so the real schema is read. `unknown-key.yaml`, `duplicate-id.yaml` and `empty-reveal.yaml` must exit 1 and print a `✗` line that names the Variant_Id and the field path (`variants.1.overrides`, `variants.1.id`, `variants.1.overrides.sideRevealText`). `no-variants.yaml` must print today's `✓ Case file is valid` and exit 0 (1.13)
      - `docker compose run --rm --no-deps physiology python3 -m pytest -m "not pulse"` (Property 1 now reads a case file that has Variants)
    - From `apps/web/`:
      - `npx tsc --noEmit > /tmp/sp-tsc.log 2>&1; echo "exit $?"`. Record this result as the baseline for the later web tasks; report any errors that existed before this task and do not fix them here
      - `npx vitest --run 2>&1 | tee /tmp/sp-vitest.log`
    - Quote the output of each validation command, the pytest summary line, the tsc result and the Vitest summary line in the task report
    - _Requirements: 1.1, 1.2, 1.3, 1.11, 1.12, 1.13, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 4.1, 4.2, 4.3, 4.4, 4.5, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.9, 8.10, 8.11, 11.4, 12.1, 12.4_

- [x] 3. Case_Loader
  - [x] 3.1 Add Variant loading to `services/physiology/case_loader.py`
    - Files: `services/physiology/case_loader.py`, `services/physiology/test_case_loader_variants.py` (new). No other file changes
    - Implement `LoadedCase` (with `variant_ids`), `load_case_with_variants`, `load_resolved_case`, and `load_case` returning `load_case_with_variants(case_id).base`, as the design section "Case_Loader" states. A Base_Case without `variants` keeps today's validation code and message exactly (1.13). With `variants`, any `check_case` problem raises `CaseLoadError("Case validation failed for <case_id>: " + "; ".join(...))`. A missing schema file still gives `schema = None`, and steps 3 to 6 still run (1.10)
    - In `test_case_loader_variants.py` (all fast, no Pulse engine):
      - loader rejections through `load_case_with_variants` with `monkeypatch.setattr(case_loader, "CASES_DIR", tmp_path)` and broken copies of the shipped case written by the test into `tmp_path`, with and without a copied `case-schema.json`: duplicate id, unknown override key, `insultSide` without a `SETensionPneumothorax` insult, a play key without a `play` object, and a Resolved_Case that fails the schema. Each message names the Variant_Id and the field path or key (1.6, 1.7, 1.9, 1.10)
      - a Base_Case without Variants that fails the schema gives today's exact message (1.13)
      - `load_resolved_case` returns each Resolved_Case and raises `CaseLoadError` for an unknown id
      - schema broken copies validated with `Draft7Validator` against `cases/case-schema.json`, each failing at the expected path: both `label` and `labels`; `when.side` in a Side_Neutral_Action; an empty `when`; an `overrides` key `goalText`; one Variant; 11 Variants; a `sideRevealText` of 121 characters; an Exam_Action id with an uppercase letter (design "Case-content and schema checks")
      - **Property 3: Both shipped Variants resolve and validate, and the left Variant equals the Base_Case** (pytest half, example-based): the shipped Base_Case and both Resolved_Cases validate; the Variants are `left` and `right` in that order and set all four keys; the `left` Resolved_Case deep-equals the Base_Case without `variants`; each needle Required_Intervention's `side` equals the Variant's `insultSide`. Tag: `# Feature: bedside-exam, Property 3: Both shipped Variants resolve and validate, and the left Variant equals the Base_Case`
    - From the repository root (never `docker compose up`, `down`, `stop` or `restart`; do not touch the container on port 8000):
      - `docker compose build physiology`
      - `docker compose run --rm --no-deps physiology python3 -m pytest test_case_resolver.py test_case_loader_variants.py -m "not pulse"`
      - `docker compose run --rm --no-deps physiology python3 -m pytest -m "not pulse"`
    - Use execute_bash with a timeout of 900000 ms for the build and each test run. If it reports a timeout, read the output before retrying
    - Quote both pytest summary lines in the task report
    - _Requirements: 1.1, 1.2, 1.3, 1.6, 1.7, 1.8, 1.9, 1.10, 1.12, 1.13, 2.1, 2.2, 2.3, 2.4, 2.5, 2.8, 4.1, 4.2, 4.3, 4.4, 4.5, 12.1, 14.9_
    - _Properties: 3_

- [x] 4. Session_API, Session metadata and the Variant_Source
  - [x] 4.1 Select the Variant at session creation in `models.py`, `main.py` and `session_manager.py`
    - Files: `services/physiology/models.py`, `services/physiology/main.py`, `services/physiology/session_manager.py`, `services/physiology/test_session_variants.py` (new). No other file changes
    - `models.py`: `SessionRequest.variant_id: Optional[str] = None` (no pattern) and `SessionMetadata.variant_id: Optional[str] = None`, as in the design section "Request, metadata and the create flow"
    - `session_manager.py`: `Session.variant_id: Optional[str] = None`; `create_session(self, case_id, case_data, variant_id=None)` stores both and otherwise works as today. Existing two-argument callers keep working
    - `main.py`: `VariantSource` and `get_variant_source()` returning `random.random` (D4); `create_session` takes `variant_source: VariantSource = Depends(get_variant_source)`, loads with `load_case_with_variants` (404 first, 3.6), calls `choose_variant` (400 on `VariantSelectionError`, before any engine starts), and maps any other `ValueError` from `choose_variant` to `HTTPException(500, f"Failed to create session: {e}")` as the design's "Error Handling" note says; one `session_metadata(session)` helper serves `POST /sessions` and `GET /sessions/{id}`
    - The Web_App's `createSession` already sends only `{ case_id }` (3.15); no web file changes
    - In `test_session_variants.py` (all fast): engines replaced by a fake as design D8 states (patch `session_manager.PulseEngineWrapper`, as `test_fork.py` does); the Variant_Source replaced only through `main.app.dependency_overrides[main.get_variant_source]` with the design's `StubSource`, never by patching a module global (3.11)
      - stub values 0, just below and at each `k/n`, and just below 1 select `floor(u × n)` on `adult-tension-pneumothorax` (14.8)
      - a named `variant_id` selects that Variant and `stub.reads == 0` (3.3)
      - an unknown `variant_id` returns 400 with `Unknown variant_id: '<id>'. Valid variant ids: left, right`; a `variant_id` for a Case without Variants (a case written to `tmp_path` with `CASES_DIR` patched) returns 400 with the no-variants message; `""` returns 400; a non-string `variant_id` returns 422; an unknown `case_id` returns 404 whatever the `variant_id`; each 4xx leaves the Session count unchanged and starts no engine
      - Session_Metadata includes `variant_id` in `POST /sessions` and `GET /sessions/{id}`; `null` for a Case without Variants, whose Base_Case is stored unchanged and which reads no source (3.12)
      - at least 200 calls of `choose_variant` with `main.get_variant_source()` and the ids from `load_case_with_variants("adult-tension-pneumothorax")`, starting no engine, select both Variants (14.11)
      - **Property 6: The Variant stays fixed for the life of the Session** (example-based): equal `variant_id` from create and `GET /sessions/{id}`; `GET /sessions/{id}/case` returns the same Resolved_Case without `variants` on repeated calls and after a fork; the Session's `scheduled_insults` come from that Resolved_Case. Tag: `# Feature: bedside-exam, Property 6: The Variant stays fixed for the life of the Session`
    - From the repository root (never `docker compose up`, `down`, `stop` or `restart`; do not touch the container on port 8000):
      - `docker compose build physiology`
      - `docker compose run --rm --no-deps physiology python3 -m pytest test_case_resolver.py test_case_loader_variants.py test_session_variants.py`
      - `docker compose run --rm --no-deps physiology python3 -m pytest -m "not pulse"`
    - Use execute_bash with a timeout of 900000 ms for the build and each test run. If it reports a timeout, read the output before retrying
    - Quote both pytest summary lines in the task report
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12, 3.15, 10.5, 14.8, 14.11_
    - _Properties: 6_

- [x] 5. Existing physiology tests request the left Variant
  - [x] 5.1 Update the setup of the slow tests that depend on the left insult
    - Files: `services/physiology/test_case_actions.py`, `test_fork.py`, `test_checkpoints_interventions.py`, `test_vitals_socket.py` (under `services/physiology/`). No other file changes
    - Existing tests whose setup changes, from the design list "Physiology tests whose setup changes" (the `pulse` markers are already in place from task 1.1):
      - `test_case_actions.py`, `test_case_needle_decompression_beats_untreated_fork`: `case_loader.load_case(...)` becomes `case_loader.load_resolved_case("adult-tension-pneumothorax", "left")`
      - `test_fork.py`: `test_real_fork_vitals_match_parent_at_checkpoint` uses `load_resolved_case(CASE_ID, "left")`; the `_create_http_session` helper posts `{"case_id": CASE_ID, "variant_id": "left"}`
      - `test_checkpoints_interventions.py`: the `advanced_session` helper posts `variant_id: "left"`
      - `test_vitals_socket.py`, `test_pause_only_on_last_disconnect`: posts `variant_id: "left"`
    - No physiology assertion changes. `test_unknown_intervention_and_bad_parameter_return_400`, the fake-engine tests in `test_fork.py`, the checkpoint-cap tests, `test_unknown_session_closed_with_1008`, `test_config.py`, `test_insult_algorithm.py` and `test_clock_task.py` stay unchanged
    - Do not run `-m pulse` here; task 6 runs the slow suite once
    - From the repository root (never `docker compose up`, `down`, `stop` or `restart`; do not touch the container on port 8000):
      - `docker compose build physiology`
      - `docker compose run --rm --no-deps physiology python3 -m pytest -m pulse --collect-only -q` must still list the nine tests of task 1.1
      - `docker compose run --rm --no-deps physiology python3 -m pytest -m "not pulse"`
    - Use execute_bash with a timeout of 900000 ms for the build and each run. If it reports a timeout, read the output before retrying
    - Quote the collected test list and the pytest summary line in the task report
    - _Requirements: 3.14, 14.8_

- [x] 6. Right-Variant engine determinism (the only slow-suite run)
  - [x] 6.1 Add `services/physiology/test_variant_engine.py` and run the slow suite
    - Files: `services/physiology/test_variant_engine.py` (new). No other file changes
    - Every test in the file carries `@pytest.mark.pulse`. Start from `case_loader.load_resolved_case("adult-tension-pneumothorax", "right")`, create two Branches from the same Checkpoint, apply `needle-decompression-right` at the same Simulation_Time on both, and compare the VitalSigns fields with the tolerance (0.001) and the failure message of `test_determinism.py` (core-simulation-loop 9.6 to 9.8)
      - **Property 7: Each Variant is deterministic in the Pulse engine** (example-based). Tag: `# Feature: bedside-exam, Property 7: Each Variant is deterministic in the Pulse engine`
    - Pulse has not run a right-sided case before (requirements "Known limitations"). If the engine fails on the right insult or the tolerance is exceeded, stop and report; do not change the tolerance, the case or the test to make it pass
    - From the repository root (never `docker compose up`, `down`, `stop` or `restart`; do not touch the container on port 8000):
      - `docker compose build physiology`
      - `docker compose run --rm --no-deps physiology python3 -m pytest test_variant_engine.py -m pulse`
      - `docker compose run --rm --no-deps physiology python3 -m pytest -m pulse` (the nine existing slow tests, now on the `left` Variant, and the new test)
      - `docker compose run --rm --no-deps physiology python3 -m pytest -m "not pulse"`
    - The slow runs are slow under amd64 emulation. Use execute_bash with a timeout of 1800000 ms. If it reports a timeout, read the output before retrying, and report which tests had finished
    - Quote each pytest summary line in the task report
    - _Requirements: 3.13, 3.14, 14.12_
    - _Properties: 7_

- [x] 7. Web types and test fixtures
  - [x] 7.1 Add the exam types, the test-only case resolver and the exam generators
    - Files: `apps/web/src/types/index.ts`, `apps/web/src/test/caseFixtures.ts`, `apps/web/src/test/generators.ts`. No other file changes
    - `types/index.ts`: add the types of the design section "TypeScript types": `ExamSideRole`, `ExamWhen`, `ExamRule`, `SideNeutralExamAction`, `SidedExamAction`, `ExamAction`, `ExamSection`, `ExamFinding`, `ExamRecordEntry`; `PlaySection` gains optional `exam` and `sideRevealText`; `SessionMetadata` gains optional `variant_id?: string | null`. `CaseData` stays the Resolved_Case type, with no `variants`
    - `caseFixtures.ts` (shared fixture, setup change from the design list "Shared fixture"): export `BASE_CASE` (the parsed file), the test-only types `CaseVariant` and `VariantOverrides`, `resolveCaseForTest(base, variantId)` (each Override_Target from the Variant_Overrides, or from the Base_Case when absent; `variants` removed; independent of `case_resolver.py`), `CASE_LEFT` and `CASE_RIGHT`. `CASE` becomes `CASE_LEFT`, so every test that imports `CASE` keeps a valid `CaseData`. `CASE_TEXT`, `CASE_PATH` and `VITAL_OFFSETS` stay
    - `generators.ts`: add `arbExamAction` (0 to 10 rules with every combination of `side`, `insult`, `decompressed` and `vitals` conditions; sided or side-neutral, with no `side` condition on a side-neutral action; distinct sentence strings) and `arbExamRecordEntry` (with and without `side`, times including 0 and repeated values, branch ids from a small pool), as the design's "Property test settings" says. Existing generators stay unchanged
    - No app module changes in this task, so no behaviour changes; the new code is used from task 8 on
    - From `apps/web/`:
      - `npx tsc --noEmit > /tmp/sp-tsc.log 2>&1; echo "exit $?"`; no new errors compared with the task 2.1 baseline
      - `npx vitest --run 2>&1 | tee /tmp/sp-vitest.log`
    - Quote the tsc result and the Vitest summary line (passed/failed/skipped) in the task report
    - _Requirements: 3.9, 4.1, 4.2, 4.3, 7.1, 12.1, 14.6_

- [x] 8. Lineage, side and status helpers
  - [x] 8.1 Add `activeEntries` and `activeExamEntries` to `apps/web/src/lib/branchLineage.ts`
    - Files: `apps/web/src/lib/branchLineage.ts`, `apps/web/src/lib/branchLineage.test.ts`. No other file changes
    - Move the body of `activeInterventions` unchanged into the generic `activeEntries<T extends { branchId: string; simulationTime: number }>`; `activeInterventions` and `activeExamEntries` call it (design "Active_Exam_Entries, Found_Sides and Shown_Swollen_Sides")
    - Existing tests: no change; `activeInterventions` behaves as before
    - Add to `branchLineage.test.ts`:
      - `activeEntries` gives the same result as `activeInterventions` for Intervention entries
      - **Property 12: Active_Exam_Entries follow the Branch_Lineage like the Intervention_Record** (`arbLineage` and `arbExamRecordEntry` with times at, below and above each fork time; reference filter; record order kept; same indexes as `activeInterventions` on mapped entries). Tag: `// Feature: bedside-exam, Property 12: Active_Exam_Entries follow the Branch_Lineage like the Intervention_Record`
    - From `apps/web/`: `npx tsc --noEmit > /tmp/sp-tsc.log 2>&1; echo "exit $?"` (no new errors compared with the baseline) and `npx vitest --run 2>&1 | tee /tmp/sp-vitest.log`
    - Quote the tsc result and the Vitest summary line in the task report
    - _Requirements: 7.3, 14.2_
    - _Properties: 12_

  - [x] 8.2 Add `affectedInsult`, `foundSides` and `shownSwollenSides` to `apps/web/src/lib/sides.ts`
    - Files: `apps/web/src/lib/sides.ts`, `apps/web/src/lib/sides.test.ts`. No other file changes
    - Add `RevealedSides`, `affectedInsult` (first `SETensionPneumothorax` insult in list order with a valid side and a finite time, else `null`), `foundSides` (sides of entries with `abnormal === true` and a side, in `['Left', 'Right']` order) and `shownSwollenSides` (`swollen` for `'all'`, else the sides in both lists in `swollen` order). `computeSides` stays unchanged
    - Existing tests: no change
    - Add to `sides.test.ts`: `affectedInsult` with no insult, an invalid side, a non-finite time and two insults (first wins); `foundSides` ignores side-neutral and non-abnormal entries; `shownSwollenSides` for `'all'`, `[]`, one side and both; the play-mode 12.2 side cases repeated with a `Right` insult and mirrored Decompressions (14.12)
    - From `apps/web/`: `npx tsc --noEmit > /tmp/sp-tsc.log 2>&1; echo "exit $?"` (no new errors compared with the baseline) and `npx vitest --run 2>&1 | tee /tmp/sp-vitest.log`
    - Quote the tsc result and the Vitest summary line in the task report
    - _Requirements: 8.9, 9.1, 14.12_

  - [x] 8.3 Export `statusItemMatches` from `apps/web/src/lib/statusSelector.ts`
    - Files: `apps/web/src/lib/statusSelector.ts`, `apps/web/src/lib/statusSelector.test.ts`. No other file changes
    - Rename the private `itemMatches` to `statusItemMatches` and export it, with no change to its body; `selectStatus` uses it as before
    - Existing tests: no change
    - Add to `statusSelector.test.ts`: for generated samples, thresholds and items (`PBT_PARAMS`), `statusItemMatches` agrees with the file's existing `refItemMatches`
    - From `apps/web/`: `npx tsc --noEmit > /tmp/sp-tsc.log 2>&1; echo "exit $?"` (no new errors compared with the baseline) and `npx vitest --run 2>&1 | tee /tmp/sp-vitest.log`
    - Quote the tsc result and the Vitest summary line in the task report
    - _Requirements: 5.7_

- [x] 9. Exam_Finding_Selector
  - [x] 9.1 Implement `apps/web/src/lib/examFinding.ts` with unit tests and Property 8
    - Files: `apps/web/src/lib/examFinding.ts` (new), `apps/web/src/lib/examFinding.test.ts` (new). No other file changes
    - Implement `ExamContext`, `ExamFindingInput`, `examContext`, `examWhenMatches`, `selectExamFinding`, `examFinding`, `isSidedAction`, `ExamButtonSpec`, `examButtons` and `examButtonText` as the design section "`examFinding.ts`" states. The module reads no `Date`, `window`, `fetch`, storage, randomness or Variant_Id, and returns the case's sentence string unchanged
    - In `examFinding.test.ts`:
      - the fixed cases of Requirement 14.1: `side: affected` and `side: other` with both Affected_Sides and with no Affected_Side; `insult` at, just before and just after `timeSeconds`; `decompressed` true and false, including a Decompression on the Other_Side and one before the insult time; `vitals` items with and without `direction`; a `null` sample; two matching rules, where the first wins; the `defaultSentence` when nothing matches and for empty `rules`
      - `examButtons` for the shipped Exam_Section (from `CASE_LEFT`): five buttons in the order of 8.1, Left before Right, texts equal to `label`, `labels.Left` and `labels.Right` (6.1, 6.2); `examButtonText` falls back to the action id for an unknown action
      - **Property 8: The Exam_Finding_Selector returns the first matching rule, else the default** (`arbExamAction`, `arbInsults`, `arbSample`, `arbThreshold`, `arbActiveInterventions`; Simulation_Times often at or next to an insult time; a reference matcher built from the glossary definitions and the play-mode reference item matcher). Tag: `// Feature: bedside-exam, Property 8: The Exam_Finding_Selector returns the first matching rule, else the default`
    - From `apps/web/`: `npx tsc --noEmit > /tmp/sp-tsc.log 2>&1; echo "exit $?"` (no new errors compared with the baseline) and `npx vitest --run 2>&1 | tee /tmp/sp-vitest.log`
    - Quote the tsc result and the Vitest summary line in the task report
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 6.1, 6.2, 14.1, 14.2_
    - _Properties: 8_

  - [x] 9.2 Add Properties 9 and 10 to `apps/web/src/lib/examFinding.test.ts`
    - Files: `apps/web/src/lib/examFinding.test.ts`. No other file changes
    - **Property 9: The Exam_Finding_Selector is deterministic and pure** (deep-frozen input and a structured clone give deep-equal results; the clone is unchanged; `globalThis.fetch` and `Date.now` replaced by throwing functions and restored afterwards). Tag: `// Feature: bedside-exam, Property 9: The Exam_Finding_Selector is deterministic and pure`
    - **Property 10: Findings are side-relative** (actions from the shipped Exam_Section and from `arbExamAction`; `CASE_LEFT` with side S against `CASE_RIGHT` with the mirrored side and mirrored Active_Interventions; `null` side for side-neutral actions; a second check that mirrors every side of generated insult lists). Tag: `// Feature: bedside-exam, Property 10: Findings are side-relative`
    - From `apps/web/`: `npx tsc --noEmit > /tmp/sp-tsc.log 2>&1; echo "exit $?"` (no new errors compared with the baseline) and `npx vitest --run 2>&1 | tee /tmp/sp-vitest.log`
    - Quote the tsc result and the Vitest summary line in the task report
    - _Requirements: 5.1, 5.4, 5.6, 5.9, 14.2, 14.3_
    - _Properties: 9, 10_

- [x] 10. Exam_Record storage
  - [x] 10.1 Implement `apps/web/src/lib/examRecord.ts`
    - Files: `apps/web/src/lib/examRecord.ts` (new), `apps/web/src/lib/examRecord.test.ts` (new). No other file changes
    - Implement `examRecordKey`, `buildExamEntry` (leaves `side` out when `null`), `serializeExamRecord` (`{"v":1,"entries":[...]}` with only the seven fields), `parseExamRecord` (strict, never throws, one bad entry gives `[]`), `loadExamRecord` (`[]` when `getItem` throws), `saveExamRecord` (swallows `setItem` errors) and `findingsNewestFirst` (`simulationTime` descending, then record index descending), as the design section "`examRecord.ts`" states. The module mirrors `interventionRecord.ts`
    - In `examRecord.test.ts`:
      - `examRecordKey('abc')` is `stitched-patient:exam-record:abc` and contains nothing else that varies (10.6)
      - the stored example of the design's "Data Models" parses to its two entries
      - each Web_App row of "Error Handling" that concerns storage: missing value, bad JSON, wrong `v`, an invalid entry, `getItem` and `setItem` throwing
      - **Property 13: The Exam_Record storage round trip, and malformed data gives an empty record**. Tag: `// Feature: bedside-exam, Property 13: The Exam_Record storage round trip, and malformed data gives an empty record`
      - **Property 14: The Findings_List is newest first**. Tag: `// Feature: bedside-exam, Property 14: The Findings_List is newest first`
    - From `apps/web/`: `npx tsc --noEmit > /tmp/sp-tsc.log 2>&1; echo "exit $?"` (no new errors compared with the baseline) and `npx vitest --run 2>&1 | tee /tmp/sp-vitest.log`
    - Quote the tsc result and the Vitest summary line in the task report
    - _Requirements: 6.6, 7.1, 7.4, 7.5, 7.6, 7.7, 10.6, 14.2_
    - _Properties: 13, 14_

- [x] 11. Avatar_Mapper side gate
  - [x] 11.1 Add `revealedSides` to `AvatarInput` in `apps/web/src/lib/avatarMapper.ts`
    - Files: `apps/web/src/lib/avatarMapper.ts`, `apps/web/src/lib/avatarMapper.test.ts`, `apps/web/src/lib/sessionState.ts` (only the two `mapAvatar` calls), `apps/web/src/lib/sessionState.test.ts` (only the two literal `mapAvatar` calls). No other file changes
    - `AvatarInput` gains the required `revealedSides: RevealedSides`; `mapAvatar` sets `swollenSides: shownSwollenSides(sides.swollenSides, input.revealedSides)` and leaves `decompressedSides` and every other field as before (design "`avatarMapper.ts`")
    - `sessionState.ts`: pass `revealedSides: 'all'` in its two `mapAvatar` calls (`onFork` and `onSample`), so the reducer behaves exactly as before and `tsc` passes. Task 12.1 replaces `'all'` with `revealedSidesFor(...)`
    - Existing tests whose setup changes (design list "Web tests whose setup changes"):
      - `avatarMapper.test.ts`: `makeInput` gets the default `revealedSides: 'all'`; the `arbInput` record gets `revealedSides: fc.constant('all')`; the two literal `mapAvatar({ ... })` inputs in the property tests get `revealedSides: 'all'`. "takes Swollen_Sides and Decompressed_Sides from the case insult…" keeps expecting `['Left']`
      - `sessionState.test.ts`: the two literal `mapAvatar({ ... })` calls (the Avatar sequence for the Ending snapshot and the Lost snapshot test) get `revealedSides: 'all'`
    - Add to `avatarMapper.test.ts`:
      - `revealedSides` gates only `swollenSides`: with a found side, with `[]` and with `'all'`, every other field is equal and `decompressedSides` is ungated
      - **Property 16: The Avatar is the same in both Variants until a side is found or a needle is used** (mapper half: `CASE_LEFT` and `CASE_RIGHT` insults, an Exam_Record with side-neutral entries only, no Decompression, `revealedSides` from `foundSides`). Tag: `// Feature: bedside-exam, Property 16: The Avatar is the same in both Variants until a side is found or a needle is used`. Task 12.2 adds the reducer half under the same tag
    - From `apps/web/`: `npx tsc --noEmit > /tmp/sp-tsc.log 2>&1; echo "exit $?"` (no new errors compared with the baseline) and `npx vitest --run 2>&1 | tee /tmp/sp-vitest.log`
    - Quote the tsc result and the Vitest summary line in the task report
    - _Requirements: 9.1, 9.3, 9.6, 9.7, 14.2_
    - _Properties: 16_

- [x] 12. Session state and the session hook
  - [x] 12.1 Add the Exam_Record and the side gate to `apps/web/src/lib/sessionState.ts`
    - Files: `apps/web/src/lib/sessionState.ts`, `apps/web/src/lib/sessionState.test.ts`, `apps/web/src/lib/examFlow.test.ts` (new). No other file changes
    - Implement the design section "`sessionState.ts`": `examRecord` and `examRecordLoaded` in `SessionUiState` and `initialSessionState()`; the actions `examRecordRestored` (replaces, sets `examRecordLoaded`, then `withSides`) and `examPerformed` (the refusals and the four steps); `revealedSidesFor`; `withSides(state)` without the record argument, applying the gate and returning the same state when both side lists are unchanged; `sessionLoaded` and `checkpointsLoaded` also call `withSides`; `onSample` maps the Avatar with `revealedSidesFor(caseData, ending.ending, ...)` after stepping the Ending; `onFork` uses `revealedSidesFor(caseData, 'none', examRecord, newLineage)` and keeps `examRecord` whole. Replace the temporary `'all'` from task 11.1. The reducer stays pure
    - Existing tests whose setup changes: `sessionState.test.ts`, `CASE_WITH_PLAY` becomes `structuredClone(CASE)` with `play.exam` deleted. Reason (design): the shipped Exam_Section turns the gate on, and the existing swollen-side assertions expect `['Left']` before a Decompression; without the Exam_Section they keep testing play-mode behaviour, which 4.6 keeps. `CASE_LOST`, `CASE_P20`, the Property 21 case and the `viewSelected` key-by-key test stay unchanged. No assertion changes
    - If any other existing test fails because the gate is now on for `CASE`, stop and report it; do not change its assertions
    - Add to `sessionState.test.ts`: `examRecordRestored` replaces rather than merges (a second dispatch gives the same record); each `examPerformed` refusal returns the same state object (no Exam_Section, no current Branch, an Ending, an unknown id, a side for a Side_Neutral_Action, no side for a Sided_Action); a sided abnormal finding on the Affected_Side makes the Avatar draw that side swollen in the same step; a side found only after a fork time is no longer drawn after the fork (9.4)
      - **Property 11: An exam changes only the Exam_Record and the drawn sides**. Tag: `// Feature: bedside-exam, Property 11: An exam changes only the Exam_Record and the drawn sides`
    - Create `examFlow.test.ts` with `vi.mock('@/lib/api')`, as in `useSimulationSession.test.ts`: drive `sessionReducer` with `examPerformed`, `forkSucceeded` and `viewSelected`, and call `saveExamRecord` and `loadExamRecord` on a memory storage. Assert that no `api` function was called (6.4), exactly one entry was added, the fields of 6.5 are `===`, and the record survives a fork and a view switch (6.14, 7.2, 14.4). Task 14.2 adds the `examButtonsDisabled` checks to this file
    - From `apps/web/`: `npx tsc --noEmit > /tmp/sp-tsc.log 2>&1; echo "exit $?"` (no new errors compared with the baseline) and `npx vitest --run 2>&1 | tee /tmp/sp-vitest.log`
    - Quote the tsc result and the Vitest summary line in the task report
    - _Requirements: 4.6, 6.3, 6.4, 6.5, 6.8, 6.9, 6.14, 7.1, 7.2, 7.5, 9.2, 9.4, 9.5, 14.2, 14.4_
    - _Properties: 11_

  - [x] 12.2 Add Properties 15 and 16 (reducer half) to `apps/web/src/lib/sessionState.test.ts`
    - Files: `apps/web/src/lib/sessionState.test.ts`. No other file changes
    - **Property 15: Before an Ending, only found sides are drawn swollen** (generated sequences as in Property 11 plus `examRecordRestored` and `checkpointsLoaded`, on `CASE_LEFT` and `CASE_RIGHT`; the ungated reference from `computeSides`; `hintRevealed`, including the last Hint, never changes `avatar.swollenSides`; the `endingSnapshot` holds the ungated sides; a case without `exam` is never gated). Tag: `// Feature: bedside-exam, Property 15: Before an Ending, only found sides are drawn swollen`
    - **Property 16** reducer half: the same generated sequence without `interventionSucceeded` and without sided exams gives equal `avatar` on `CASE_LEFT` and `CASE_RIGHT`. Tag: `// Feature: bedside-exam, Property 16: The Avatar is the same in both Variants until a side is found or a needle is used`
    - From `apps/web/`: `npx tsc --noEmit > /tmp/sp-tsc.log 2>&1; echo "exit $?"` (no new errors compared with the baseline) and `npx vitest --run 2>&1 | tee /tmp/sp-vitest.log`
    - Quote the tsc result and the Vitest summary line in the task report
    - _Requirements: 4.6, 8.9, 9.1, 9.2, 9.3, 9.4, 9.5, 9.7, 14.2_
    - _Properties: 15, 16_

  - [x] 12.3 Restore, persist and perform exams in `apps/web/src/hooks/useSimulationSession.ts`
    - Files: `apps/web/src/hooks/useSimulationSession.ts`, `apps/web/src/components/PlayView.test.tsx`, `apps/web/src/components/ClinicianView.test.tsx`, `apps/web/src/components/SessionScreen.test.tsx` (the three test files: `stubActions()` only). No other file changes
    - Implement the design section "`useSimulationSession.ts`": the restore effect dispatching `examRecordRestored` (`[]` when storage is `null`); the persist effect on `[state.examRecord, state.examRecordLoaded, sessionId]` guarded by `examRecordLoaded`; `performExam(actionId, side)` as a new required member of `SimulationSessionActions` (returns early while `forkPendingRef.current` is true or there is no current Branch; dispatches `examPerformed` with `new Date().toISOString()`; calls no `api` function and does not touch `pendingRef`); `forkPendingRef`, set and cleared by `fork` with `pendingRef`. `variant_id` stays in `state.session` and nothing reads it
    - Existing tests whose setup changes: `stubActions()` in `PlayView.test.tsx`, `ClinicianView.test.tsx` and `SessionScreen.test.tsx` gains `performExam: vi.fn()`. Reason: `performExam` is a required member, so `tsc` fails without it. The `PlayView.test.tsx` slice helpers change in task 14.2, when the findings column appears. No assertion changes
    - The hook is not rendered in the node tests; its guard against a pending fork is checked manually (task 18.1)
    - From `apps/web/`: `npx tsc --noEmit > /tmp/sp-tsc.log 2>&1; echo "exit $?"` (no new errors compared with the baseline) and `npx vitest --run 2>&1 | tee /tmp/sp-vitest.log`
    - Quote the tsc result and the Vitest summary line in the task report
    - _Requirements: 6.3, 6.4, 6.9, 7.4, 7.5, 7.6, 10.6_

- [x] 13. Exam components
  - [x] 13.1 Create `apps/web/src/components/ExamPanel.tsx`
    - Files: `apps/web/src/components/ExamPanel.tsx` (new), `apps/web/src/components/ExamPanel.test.tsx` (new), `apps/web/src/components/InterventionPanel.tsx` (exports only). No other file changes
    - `InterventionPanel.tsx` exports `PlayLockIcon` and the play button classes, with no behaviour or markup change
    - `ExamPanel` as the design section "`ExamPanel.tsx`" states: `EXAM_HEADING_TEXT = 'Check on him'`; `<section data-part="exam-panel">` with an `h2` styled like "What can you do?"; one `data-part="exam-row"` per `examButtons(exam)` group (Sided_Action rows `grid grid-cols-1 gap-2 sm:grid-cols-2`, Left before Right); `<button type="button" data-control="exam">` with the play button classes plus `min-w-0`; native `disabled`, `border-dashed` and the `aria-hidden` lock icon when disabled; no `tabindex`; no `data-*` attribute naming the Affected_Side or the Variant
    - `ExamPanel.test.tsx` (`renderToStaticMarkup`): the heading text in an `h2`; five buttons for the shipped case in the order of 8.1, Left before Right, with the exact texts; `data-control="exam"`; disabled markup with `disabled=""`, `border-dashed` and the lock icon; no `tabindex`; no `data-*` attribute containing `left`, `right` or a Variant_Id; `onExamine` receives the action id and side (6.1, 6.2, 6.11, 6.12)
    - Existing tests: `sharedControls.test.tsx` and the InterventionPanel tests stay unchanged and must pass
    - From `apps/web/`: `npx tsc --noEmit > /tmp/sp-tsc.log 2>&1; echo "exit $?"` (no new errors compared with the baseline) and `npx vitest --run 2>&1 | tee /tmp/sp-vitest.log`
    - Quote the tsc result and the Vitest summary line in the task report
    - _Requirements: 6.1, 6.2, 6.9, 6.11, 6.12, 10.6, 14.5_

  - [x] 13.2 Create `apps/web/src/components/FindingsList.tsx`
    - Files: `apps/web/src/components/FindingsList.tsx` (new), `apps/web/src/components/FindingsList.test.tsx` (new). No other file changes
    - `FindingsList` as the design section "`FindingsList.tsx`" states: `FINDINGS_EMPTY_TEXT = "You haven't checked anything yet."`; the box classes with the height caps from "Layout"; the empty `<p>`; `<ol aria-label="Your findings">` with `formatMSS(entry.simulationTime)` and `examButtonText(...)` in semibold, then `entry.sentence`; `text-base` and `break-words` on all text; the instant `scrollIntoView` on the first item only when the entry count grows after mount
    - `FindingsList.test.tsx`: the empty text (6.7); items in the given (newest-first) order with `M:SS` times, button texts and sentences (6.6); the `examButtonText` fallback for an unknown action id; `text-base` on all text (6.12); a restored entry shows its stored sentence (7.7)
    - From `apps/web/`: `npx tsc --noEmit > /tmp/sp-tsc.log 2>&1; echo "exit $?"` (no new errors compared with the baseline) and `npx vitest --run 2>&1 | tee /tmp/sp-vitest.log`
    - Quote the tsc result and the Vitest summary line in the task report
    - _Requirements: 6.6, 6.7, 6.12, 7.7, 14.5_

- [ ] 14. Ending_Screen and Play_View
  - [x] 14.1 Show the Side_Reveal_Text in `apps/web/src/components/EndingScreen.tsx`
    - Files: `apps/web/src/components/EndingScreen.tsx`, `apps/web/src/components/EndingScreen.test.tsx`. No other file changes
    - Add the optional `sideRevealText` prop and `ENDING_OVERHEAD_WITH_SIDE = '14.75rem'`, as the design section "`EndingScreen.tsx`" states: a non-blank text renders `<p data-part="side-reveal" className="text-base">` after the heading and the rescued sentence and before the Avatar, with no `line-clamp` or `overflow-hidden`; without it, the markup and overhead are today's
    - Existing tests: no change; they pass `params` directly and omit the optional prop
    - Add to `EndingScreen.test.tsx`:
      - **Property 19: The Side_Reveal_Text appears only on the Ending_Screen, in full** (EndingScreen half: any non-blank string of 1 to 120 characters appears HTML-escaped exactly once inside `data-part="side-reveal"` for `rescued` and `lost`; a blank or absent text renders no `side-reveal` element and today's markup). Tag: `// Feature: bedside-exam, Property 19: The Side_Reveal_Text appears only on the Ending_Screen, in full`. Task 14.2 adds the PlayView half under the same tag
    - From `apps/web/`: `npx tsc --noEmit > /tmp/sp-tsc.log 2>&1; echo "exit $?"` (no new errors compared with the baseline) and `npx vitest --run 2>&1 | tee /tmp/sp-vitest.log`
    - Quote the tsc result and the Vitest summary line in the task report
    - _Requirements: 9.5, 12.2, 12.3, 14.5_
    - _Properties: 19_

  - [x] 14.2 Add the exam layout to `apps/web/src/components/PlayView.tsx`
    - Files: `apps/web/src/components/PlayView.tsx`, `apps/web/src/components/PlayView.test.tsx`, `apps/web/src/components/ClinicianView.test.tsx`, `apps/web/src/lib/examFlow.test.ts`. No other file changes
    - Implement the design sections "`PlayView.tsx`" and "Layout": with `play.exam === undefined` the markup is exactly today's (4.6); otherwise the three-column grid at 1280 px and wider (`patient-column`, `action-column` with GoalBar, `ExamPanel`, "What can you do?" and InterventionPanel, and the new `findings-column` with `FindingsList` and today's Hint and Rewind row), the root and Avatar wrapper classes from "Layout", the `useMemo` for `findingsNewestFirst(activeExamEntries(...))` before the early `return null`, the exported `examButtonsDisabled({ ending, forkPending })`, `onExamine` calling `actions.performExam`, the `data-part="exam-live"` polite live region keyed by the record length and empty for restored entries, and `sideRevealText={play.sideRevealText}` on the Ending_Screen
    - Existing tests whose setup changes: in `PlayView.test.tsx`, the `interventionButtons` helper and the wrapper slice in "Intervention variant…" end at `data-part="findings-column"` when it is present, instead of `data-part="hint-panel"`. Reason: `CASE` now renders the exam layout, where the findings column sits between the Intervention buttons and the Hint panel; the slice must hold only the Intervention wrapper, as before. No assertion changes
    - Add to `PlayView.test.tsx`: the exam group appears above "What can you do?" with five Exam_Buttons in order; three columns only with an Exam_Section and today's markup without one; the exam live region is separate from the StatusLine region and empty for restored entries; the Exam_Buttons are disabled during an Ending and during a pending fork
      - **Property 19** PlayView half: while the Ending is `none` the markup has no `data-part="side-reveal"`, for generated `sideRevealText`. Tag: `// Feature: bedside-exam, Property 19: The Side_Reveal_Text appears only on the Ending_Screen, in full`
    - Add to `ClinicianView.test.tsx`: for the shipped case there is no `data-control="exam"`, no Findings_List and no `side-reveal` element in the Ending banner (decision 9, 12.6)
    - Add to `examFlow.test.ts`: `examButtonsDisabled` for every Ending and `forkPending` value, with `connected`, `playing` and `interventionPending` varied (6.9)
    - From `apps/web/`: `npx tsc --noEmit > /tmp/sp-tsc.log 2>&1; echo "exit $?"` (no new errors compared with the baseline) and `npx vitest --run 2>&1 | tee /tmp/sp-vitest.log`
    - Quote the tsc result and the Vitest summary line in the task report
    - _Requirements: 4.6, 6.1, 6.3, 6.4, 6.5, 6.9, 6.10, 6.11, 6.12, 6.13, 6.14, 6.15, 12.2, 12.6, 14.5_
    - _Properties: 19_

- [ ] 15. Case-content checks per Resolved_Case
  - [ ] 15.1 Check the Variants, Hints and Side_Reveal_Texts per Resolved_Case in `apps/web/src/lib/caseContent.test.ts`
    - Files: `apps/web/src/lib/caseContent.test.ts`. No other file changes
    - Build the Base_Case and both Resolved_Cases with `BASE_CASE` and `resolveCaseForTest` from `src/test/caseFixtures.ts` (14.6). A per-Variant wrapper runs each check once per Resolved_Case and prefixes each failure with `variant '<id>': `, then the field path and the text
    - Assertion change in `checkHints` and its test "has exactly 3 Hints; only the last names an Intervention, and it names the left Play_Label" (rename it). Reason: the last-Hint rule changes from "contains the Play_Label of the left Intervention" to "contains the Play_Label of this Resolved_Case's single Required_Intervention" (11.3), because the `right` Variant's last Hint names the right needle and 14.6 replaces the left-only check. Add the Side_Word check for Hints 1 and 2 (11.1). The broken-copy test "names the Hint text that gives the answer early" keeps its expected string, because `checkHints` keeps its message format
    - No assertion change in the 2.23 tests and "every requiredInterventions entry is the id of an Intervention": they check the Base_Case, which keeps its value and its 2026-11-20 decision comment
    - New checks: Variants `left` and `right` in that order with all four keys (2.1 to 2.4); the `left` Resolved_Case deep-equals the Base_Case without `variants` (2.5); the decision comment on or directly above `variants:` and no `TODO(author)` marker on `insultSide` and `requiredInterventions` (2.6); needle Required_Intervention side equals `insultSide`, and every `requiredInterventions` id names an Intervention, per Resolved_Case (2.8); no Side_Word in Status_Rule sentences, the status `defaultSentence` and the Goal_Text (10.1, 10.2); fields outside the four Override_Targets equal across the Resolved_Cases (10.3); Hints 1 and 2 equal in both Variants (11.4); `sideRevealText` holds only its own Side_Word and no Diagnosis_Term (12.4, 12.5)
    - No empty pass (14.7): the first test asserts two `variants` and a non-empty `play.exam.actions`; each per-Variant check fails with `no variants to check` or `no exam section to check` on an empty list
    - Each new checker gets one broken-copy test on a `structuredClone` that breaks exactly its rule (for example the `right` Variant's last Hint naming the left Play_Label), asserting the exact failure text
    - Start the Property 18 group here (Hints, Status, Goal and Side_Reveal_Text rules) and the Property 3 Vitest half:
      - **Property 3: Both shipped Variants resolve and validate, and the left Variant equals the Base_Case** (Vitest half, example-based, through the independent test resolver; schema validation stays in pytest). Tag: `// Feature: bedside-exam, Property 3: Both shipped Variants resolve and validate, and the left Variant equals the Base_Case`
      - **Property 18: The shipped case names no side early and no diagnosis in its exam and reveal text** (example-based). Tag: `// Feature: bedside-exam, Property 18: The shipped case names no side early and no diagnosis in its exam and reveal text`
    - From `apps/web/`: `npx tsc --noEmit > /tmp/sp-tsc.log 2>&1; echo "exit $?"` (no new errors compared with the baseline) and `npx vitest --run 2>&1 | tee /tmp/sp-vitest.log`
    - Quote the tsc result and the Vitest summary line in the task report
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 10.1, 10.2, 10.3, 11.1, 11.2, 11.3, 11.4, 12.4, 12.5, 14.6, 14.7_
    - _Properties: 3, 18_

  - [ ] 15.2 Check the Exam_Section content in `apps/web/src/lib/caseContent.test.ts`
    - Files: `apps/web/src/lib/caseContent.test.ts`. No other file changes
    - Add to the Property 18 group (same tag as in 15.1), per Resolved_Case: Exam_Action ids `look-chest`, `listen`, `windpipe`, `neck-veins` in that order and unique (8.1, 8.10); the required rules of `listen`, `look-chest`, `neck-veins` and `windpipe` (8.2 to 8.4); no Side_Word in Exam_Rule sentences, exam `defaultSentence`s and side-neutral labels (8.6); `labels.Left` and `labels.Right` hold only their own Side_Word (8.7); no Diagnosis_Term in exam labels and sentences (8.8); `abnormal: true` only with `insult: started`, and on a Sided_Action also with `side: affected` (8.9); `when.vitals` names only vitals with thresholds in `alarms` (8.10). The `TODO(author)` markers of 8.5 are already checked by `checkTodoMarkers` (task 2.1)
    - Each checker gets one broken-copy test that breaks exactly its rule (for example a Side_Word in a `defaultSentence`, `abnormal: true` without `insult: started`), asserting the exact failure text
    - From `apps/web/`: `npx tsc --noEmit > /tmp/sp-tsc.log 2>&1; echo "exit $?"` (no new errors compared with the baseline) and `npx vitest --run 2>&1 | tee /tmp/sp-vitest.log`
    - Quote the tsc result and the Vitest summary line in the task report
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10, 14.6, 14.7_
    - _Properties: 18_

- [ ] 16. Screen symmetry
  - [ ] 16.1 Add `apps/web/src/components/sideSymmetry.test.tsx`
    - Files: `apps/web/src/components/sideSymmetry.test.tsx` (new). No other file changes
    - Drive `sessionReducer` on `CASE_LEFT` and `CASE_RIGHT` with the same generated sequence (at most 12 actions: samples, side-neutral exams, view switches, playback changes, forks, and fewer Hint reveals than the Play_Section defines; no Ending, no Intervention), with Session_Metadata that differs only in `variant_id` (`'left'` and `'right'`). Render `PlayView` and `ClinicianView` with `renderToStaticMarkup` and a `stubActions()` that includes `performExam`
      - **Property 17: Both views render the same markup in both Variants before the side is found**: equal markup strings; no Variant_Id and no Side_Reveal_Text in the markup; Side_Words only in the Exam_Button and Intervention texts. Tag: `// Feature: bedside-exam, Property 17: Both views render the same markup in both Variants before the side is found`
    - If the property fails, stop and report the first differing markup; do not change app code in this task
    - From `apps/web/`: `npx tsc --noEmit > /tmp/sp-tsc.log 2>&1; echo "exit $?"` (no new errors compared with the baseline) and `npx vitest --run 2>&1 | tee /tmp/sp-vitest.log`
    - Quote the tsc result and the Vitest summary line in the task report
    - _Requirements: 9.6, 10.4, 10.6, 10.7, 10.8, 10.9, 11.5, 12.6, 14.2_
    - _Properties: 17_

- [ ] 17. Final checkpoint
  - [ ] 17.1 Run the full web and fast Python suites and the case validation
    - Ensure all tests pass, ask the user if questions arise
    - No file changes in this task
    - From `apps/web/`: `npx tsc --noEmit > /tmp/sp-tsc.log 2>&1; echo "exit $?"` and `npx vitest --run 2>&1 | tee /tmp/sp-vitest.log`
    - From the repository root (never `docker compose up`, `down`, `stop` or `restart`; do not touch the container on port 8000):
      - `docker compose build physiology`
      - `docker compose run --rm --no-deps physiology python3 -m pytest -m "not pulse"`
      - `docker compose run --rm --no-deps -v "$PWD:/repo:ro" -w /repo physiology python3 scripts/validate-case.py cases/adult-tension-pneumothorax.yaml`
    - Do not run `-m pulse` here; task 6.1 ran it, and its result stands unless a later task changed `services/physiology/` (none does)
    - Quote the tsc result, the Vitest summary line, the pytest summary line and the validation output in the task report. A skipped test is a problem to investigate
    - Confirm from the task reports that no task changed `docker-compose.yml`, the physiology Dockerfile, `pulse_wrapper.py`, `.kiro/specs/play-mode/` or `.kiro/specs/core-simulation-loop/`
    - _Requirements: 1.12, 14.13_

- [ ] 18. Manual acceptance checks (author and user only)
  - [ ] 18.1 Run the design's manual checks by hand
    - This task is for the author and the user, not for an agent. An agent must not run it, must not tick its checkbox and must not mark it done
    - The Physiology_Service and the web app are started by the user in their own terminal
    - The checks, from the design section "Manual checks during acceptance":
      - 1280 × 720 at 100% zoom (6.13): on the shipped case, with zero, one, two and three Hints revealed and more findings than the Findings_List shows, the page does not scroll; the Goal, the exam heading, all five Exam_Buttons, "What can you do?", both Intervention buttons, the newest finding in full, the Hint row and the Rewind button are visible; older findings scroll inside the list only
      - 320 px wide (6.15): every Exam_Button and the newest finding wrap without horizontal scrolling; vertical page scrolling is allowed
      - Live region (6.10): with VoiceOver on macOS, each exam announces its sentence once, politely, separately from the Status_Sentence; a repeated identical sentence is announced again; reloading the page announces nothing
      - Keyboard (6.11): Tab reaches the Exam_Buttons after the Goal_Text and before the Intervention buttons; Enter and Space activate them; the focus ring is visible
      - No side visible before an Ending (Requirement 10): create Sessions from the case selection page until both Variants have appeared (check with `GET /sessions/{id}`); before any exam on a side and before the last Hint, the Avatar's chest, the Status_Sentence, the Goal, Hints 1 and 2, the page title and the URL do not differ; after listening, the swelling appears on the found side only; after an Ending, the Side_Reveal_Text names the right side (12.2)
      - Fork while pending (6.9): with network throttling, start a rewind and click an Exam_Button before the fork returns; the button is disabled and no finding is added
    - _Requirements: 6.9, 6.10, 6.11, 6.13, 6.15, 10.1, 10.2, 10.4, 10.6, 10.7, 10.8, 10.9, 12.2_

## Notes

- Tasks run one at a time, only when the user sends "Start task N". Do not start the next task on your own
- These tasks run before play-mode task group 12 (calibration). Play-mode tasks 12.1 to 12.3 assume a left-only case. After this plan, the user will update play-mode Requirement 13 and tasks 12.1 to 12.3 from bedside-exam Requirement 13. No task here implements Requirement 13 or edits `.kiro/specs/play-mode/` or `.kiro/specs/core-simulation-loop/`
- This spec lifts the play-mode boundary on `services/physiology/` only as its Requirements say: session creation, case loading and validation, Session metadata, and their pytest tests. `pulse_wrapper.py`, every Pulse action, every Intervention, the insult time, type and severity, `docker-compose.yml` and the Dockerfile stay unchanged
- Existing tests whose assertions change are listed in their task with the reason. There are two, both in `apps/web/src/lib/caseContent.test.ts`: `checkTodoMarkers` (task 2.1) and `checkHints` (task 15.1). No physiology assertion changes. Every other existing-test change is a setup change named in its task
- Every task and sub-task is required. There are no optional tasks and no `*` markers
- Property test tags use the property title from `design.md`, with Markdown backticks removed, as the design's own Property 4 tag example does: `// Feature: bedside-exam, Property N: <title>` in TypeScript, `# Feature: bedside-exam, Property N: <title>` in Python. Example-based properties (3, 6, 7, 18) carry the tag on their test group
- Clinical safety: every exam label, finding, Hint and Side_Reveal_Text is a draft with a `TODO(author)` marker. No task invents clinical content, adds a citation, changes a draft text or removes a marker. The windpipe `vitals` item is a marked placeholder, not a clinical decision

### Order adjustments

The user's order is kept except where the code needs a change:

- **`pulse` marker moved from the slow-test task into task 1.1.** `-m "not pulse"` only excludes engine tests once they are marked. Without the markers, every Python task's fast run would start real Pulse engines, and from task 4 on, the HTTP slow tests that do not name a Variant would get a random side. The `variant_id: "left"` setup changes stay in task 5
- **Schema, case file and `validate-case.py` (user item 4) moved to task 2, before the Case_Loader (task 3) and the Session_API (task 4).** The loader tests read the shipped Variants and the new schema (Property 3, the schema broken copies), and the Session_API tests make 200 picks on `adult-tension-pneumothorax` and use its two Variants for the boundary values (14.8, 14.11). The script needs only `case_resolver.py` from task 1. Between tasks 2 and 4, the old create flow loads the Base_Case, which equals the `left` Variant, so the service behaves as before
- **The `checkTodoMarkers` assertion change (user item 15) moved into task 2.1.** The new Hint markers name the bedside-exam spec and do not end with `DRAFT_SUFFIX`, so today's rule fails as soon as the case file changes. Moving it keeps the web suite green after task 2. `checkHints` stays in task 15.1, because the Base_Case Hints still pass it
- **Lineage, side and status helpers (user item 10) moved to task 8, before `examFinding.ts` (task 9) and `examRecord.ts` (task 10).** `examFinding.ts` imports `statusItemMatches` and `affectedInsult`, and Property 12 uses only the types from task 7
- **Task 11.1 also edits `sessionState.ts` and `sessionState.test.ts`.** `AvatarInput.revealedSides` is required, so the reducer's two `mapAvatar` calls pass `'all'` (no behaviour change) and the two literal calls in `sessionState.test.ts` get `revealedSides: 'all'` (a design-listed setup change). Task 12.1 replaces `'all'` with `revealedSidesFor(...)`
- **The `performExam` stubs are added in task 12.3 (the hook).** `SimulationSessionActions.performExam` is required, so `tsc` fails in `PlayView.test.tsx`, `ClinicianView.test.tsx` and `SessionScreen.test.tsx` without them. The `PlayView.test.tsx` slice helpers change in task 14.2, when the findings column appears
- **`examFlow.test.ts` is created in task 12.1 and extended in task 14.2.** Its `examButtonsDisabled` checks need the helper that `PlayView.tsx` exports
- **EndingScreen (14.1) comes before PlayView (14.2),** because PlayView passes the new `sideRevealText` prop

### Coordination and safety

- Another session owns the physiology container on port 8000. Never run `docker compose up`, `down`, `stop` or `restart`, and do not touch that container. Use only `docker compose build physiology` and `docker compose run --rm --no-deps ...`, which publish no ports. Rebuilding the image does not change the running container
- Edit files only with the file tools, never with execute_bash. This includes the temporary copies under `/tmp/sp-cases/`
- The agent does not commit. The user reviews and commits each task
- Never start long-running processes (dev servers, watchers). Ask the user to start them in their own terminal

### Test execution rules

- Python commands run from the repository root. Any change under `services/physiology/` needs `docker compose build physiology` before the tests, because the code is baked into the image. Case-file changes need no rebuild (`./cases` is mounted). `scripts/validate-case.py` runs with the repository mounted at `/repo`
- The fast suite is `docker compose run --rm --no-deps physiology python3 -m pytest -m "not pulse"`. The slow suite (`-m pulse`) runs only in task 6.1
- Web commands run from `apps/web/`: `npx tsc --noEmit > /tmp/sp-tsc.log 2>&1; echo "exit $?"` and `npx vitest --run 2>&1 | tee /tmp/sp-vitest.log`. Vitest does not type-check, and `revealedSides` and `performExam` are required, so `tsc` runs in every web task. Task 2.1 records the `tsc` baseline
- Every task report quotes the pytest summary line, or the `tsc` result and the Vitest summary line (passed/failed/skipped). A skipped test is a problem to investigate
- Web property tests use `PBT_PARAMS` from `src/test/pbt.ts` (seed 20261031, 100 runs). Python property tests use `HYPOTHESIS_SETTINGS` (100 examples, `derandomize=True`, `deadline=None`)
- The web suite opens no HTTP or WebSocket connection and needs neither the Physiology_Service nor Pulse (14.13)
- If execute_bash reports a timeout, read the output or log before retrying. The command may have finished

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["2.1"] },
    { "id": 3, "tasks": ["3.1"] },
    { "id": 4, "tasks": ["4.1"] },
    { "id": 5, "tasks": ["5.1"] },
    { "id": 6, "tasks": ["6.1"] },
    { "id": 7, "tasks": ["7.1"] },
    { "id": 8, "tasks": ["8.1"] },
    { "id": 9, "tasks": ["8.2"] },
    { "id": 10, "tasks": ["8.3"] },
    { "id": 11, "tasks": ["9.1"] },
    { "id": 12, "tasks": ["9.2"] },
    { "id": 13, "tasks": ["10.1"] },
    { "id": 14, "tasks": ["11.1"] },
    { "id": 15, "tasks": ["12.1"] },
    { "id": 16, "tasks": ["12.2"] },
    { "id": 17, "tasks": ["12.3"] },
    { "id": 18, "tasks": ["13.1"] },
    { "id": 19, "tasks": ["13.2"] },
    { "id": 20, "tasks": ["14.1"] },
    { "id": 21, "tasks": ["14.2"] },
    { "id": 22, "tasks": ["15.1"] },
    { "id": 23, "tasks": ["15.2"] },
    { "id": 24, "tasks": ["16.1"] },
    { "id": 25, "tasks": ["17.1"] },
    { "id": 26, "tasks": ["18.1"] }
  ]
}
```
