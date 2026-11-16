# Requirements Document

## Introduction

This specification formalizes the core simulation loop for Stitched Patient, a virtual patient training system that combines real-time physiology simulation with timeline branching for clinical decision exploration. The system runs emergency cases in the browser, displaying vital signs that change in real time as a virtual patient deteriorates and responds to treatment. Learners can rewind to earlier decision points and explore alternative treatment paths through timeline branching.

This requirements document is based on an existing prototype implementation in `services/physiology/`, `apps/web/`, and `cases/`. The requirements capture what the feature must do to meet educational and technical goals, and later phases will identify gaps between the prototype and these requirements.

The primary users are medical students and residents practicing emergency case management. Every later feature (LLM patient dialogue, physical exam findings, scoring and debrief) depends on this simulation loop.

## Glossary

- **Case**: A clinical scenario definition stored in a YAML file, including patient demographics, scheduled pathological events, alarm thresholds, available interventions, and clinical references
- **Case_Definition**: The complete structured data loaded from a Case YAML file
- **Case_Loader**: The software component that reads and validates Case files
- **Session**: An active simulation instance created from a Case, managing one or more Branches
- **Branch**: An independent simulation timeline with its own Pulse_Engine, event log, vitals history, and Checkpoints
- **Checkpoint**: A saved snapshot of engine state at a specific simulation time, enabling timeline forking
- **Pulse_Engine**: The Pulse Physiology Engine, a C++ library that computes physiological vital signs in real time
- **Engine_Time_Step**: The fixed time interval at which the Pulse_Engine advances simulation, 0.02 seconds by default
- **Physiology_Service**: The FastAPI backend service that manages Sessions, Branches, and Pulse_Engine instances
- **Web_App**: The Next.js browser application that displays the bedside monitor UI and controls playback
- **Intervention**: A clinical action (such as needle decompression, oxygen administration, or fluid bolus) that the learner can apply to affect physiology
- **Scheduled_Insult**: A pathological event (such as tension pneumothorax or hemorrhage) that occurs automatically at a specified simulation time according to the Case definition
- **Simulation_Time**: The virtual time in seconds since the start of the Case, independent of wall-clock time
- **Wall_Clock_Time**: Real-world time as measured by the system clock
- **Playback_Speed**: A multiplier (1x, 2x, or 4x) that controls how fast Simulation_Time advances relative to Wall_Clock_Time
- **Monitor_UI**: The bedside monitor display showing vital sign readouts, trend charts, alarms, and controls
- **Vitals_Stream**: A WebSocket connection that pushes VitalSigns updates from Physiology_Service to Web_App
- **VitalSigns**: A data structure containing current physiological measurements and simulation time
- **Alarm_State**: The color-coded status of a vital sign (normal, warning, or critical) based on thresholds defined in the Case
- **Event_Log**: A chronological record of all Interventions applied to a Branch, with timestamps and parameters
- **Timeline**: A visual representation of Branches and Checkpoints, allowing learners to navigate and fork the simulation

## Requirements

### Requirement 1: Case File Definition

**User Story:** As a case author, I want to define clinical scenarios in structured YAML files, so that I can create new training cases without modifying application code.

#### Acceptance Criteria

1. THE Case_Loader SHALL load a Case from a YAML file in the `cases/` directory
2. THE Case_Loader SHALL validate the Case against the JSON Schema at `cases/case-schema.json`
3. WHEN the Case file contains invalid YAML syntax, THE Case_Loader SHALL return an error message indicating the syntax error type and location
4. WHEN the Case fails schema validation, THE Case_Loader SHALL return an error message indicating the validation failure reason and the field path that failed validation
5. THE Case SHALL include a unique identifier in kebab-case format matching the pattern `^[a-z0-9-]+$`
6. THE Case SHALL include a human-readable title
7. THE Case SHALL include patient demographics: age as a non-negative integer, sex as one of the values "male", "female", or "other", and summary as a one-line string
8. THE Case SHALL include the path to a Pulse engine starting state file as a string value
9. THE Case SHALL include a list of zero or more Scheduled_Insults, where each Scheduled_Insult specifies: timeSeconds as a non-negative number, action as a Pulse action name string, and parameters as an action-specific object
10. THE Case SHALL include Alarm_State thresholds for heart rate, respiratory rate, SpO2, and mean arterial pressure, where each threshold set includes critical, warning, and normal ranges with either a low boundary value, a high boundary value, or both
11. WHERE EtCO2 and tidal volume alarms are clinically relevant to the case, THE Case SHALL include threshold definitions for those vitals following the same structure as other alarm thresholds
12. THE Case SHALL include a list of one or more available Interventions, where each Intervention specifies: id as a unique string identifier, label as a display string, action as a Pulse action name string, and parameters as an optional object containing default parameter values
13. THE Case SHALL include a references list containing one or more items, where each reference includes a citation string and an optional URL string
14. WHEN a clinical value or alarm threshold within the Case lacks a specific clinical source citation, THE Case SHALL mark that value with a comment containing "TODO(author)" followed by a description of what citation is needed
15. THE Case SHALL use `cases/adult-tension-pneumothorax.yaml` as the reference implementation demonstrating the required structure

### Requirement 2: Session Management

**User Story:** As a learner, I want to start a simulation session from a case, so that I can practice emergency management in a controlled environment.

#### Acceptance Criteria

1. WHEN the Web_App requests session creation with a case_id, THE Physiology_Service SHALL validate that the case_id exists in the available cases
2. WHEN the Physiology_Service validates a session creation request, THE Physiology_Service SHALL load the Case definition using the Case_Loader
3. WHEN the Physiology_Service loads a Case definition, THE Physiology_Service SHALL initialize a Pulse_Engine from the starting state file specified in the Case
4. WHEN the Physiology_Service initializes a Pulse_Engine, THE Physiology_Service SHALL create an initial Branch for the Session
5. WHEN the Physiology_Service creates an initial Branch, THE Physiology_Service SHALL create an initial Checkpoint at Simulation_Time zero seconds
6. WHEN the Physiology_Service creates a Session, THE Physiology_Service SHALL assign a unique session_id in UUID version 4 format
7. WHEN the Physiology_Service creates a Session, THE Physiology_Service SHALL initialize a Simulation_Time clock at zero seconds with millisecond precision
8. WHEN session creation completes successfully, THE Physiology_Service SHALL return session metadata including session_id, case_id, current_branch_id, branch list, initial Simulation_Time, and creation timestamp
9. IF a case_id does not exist in available cases, THEN THE Physiology_Service SHALL return an error response indicating the case was not found
10. IF the starting state file specified in the Case cannot be loaded, THEN THE Physiology_Service SHALL return an error response indicating state file loading failure and SHALL NOT create the Session
11. IF Pulse_Engine initialization fails for any reason, THEN THE Physiology_Service SHALL return an error response indicating engine initialization failure and SHALL NOT crash the service
12. IF session creation does not complete within 30 seconds, THEN THE Physiology_Service SHALL terminate the creation attempt and return an error response indicating timeout, verified through manual inspection during acceptance testing

### Requirement 3: Playback Control

**User Story:** As a learner, I want to control simulation playback speed and pause/resume the simulation, so that I can manage my learning pace and take time to think between decisions.

#### Acceptance Criteria

1. THE Web_App SHALL display play and pause buttons for simulation control
2. THE Web_App SHALL display speed selection buttons for 1x, 2x, and 4x Playback_Speed
3. WHEN a new session starts, THE Physiology_Service SHALL set the playback state to paused and Playback_Speed to 1x
4. WHEN the learner clicks play while the simulation is paused, THE Physiology_Service SHALL transition to playing state and begin advancing Simulation_Time
5. WHEN the learner clicks play while the simulation is already playing, THE Physiology_Service SHALL remain in playing state
6. WHEN the learner clicks pause while the simulation is playing, THE Physiology_Service SHALL transition to paused state and stop advancing Simulation_Time
7. WHEN the learner clicks pause while the simulation is already paused, THE Physiology_Service SHALL remain in paused state
8. WHEN the learner selects a different Playback_Speed, THE Physiology_Service SHALL apply the new speed immediately without requiring pause
9. AT Playback_Speed 1x, THE Physiology_Service SHALL advance Simulation_Time at the same rate as Wall_Clock_Time
10. AT Playback_Speed 2x, THE Physiology_Service SHALL advance Simulation_Time at twice the rate of Wall_Clock_Time
11. AT Playback_Speed 4x, THE Physiology_Service SHALL advance Simulation_Time at four times the rate of Wall_Clock_Time
12. THE Web_App SHALL display Simulation_Time in minutes and seconds format
13. THE Web_App SHALL update the displayed Simulation_Time at least once per Wall_Clock_Time second
14. THE Web_App SHALL display the current playback state as either "Playing" or "Paused"
15. THE Web_App SHALL display the current Playback_Speed value

### Requirement 4: Vital Signs Streaming

**User Story:** As a learner, I want to see vital signs update in real time, so that I can monitor the patient's physiological response to pathology and treatment.

#### Acceptance Criteria

1. WHILE a Session playback state is playing, THE Physiology_Service SHALL stream VitalSigns to the Web_App over a Vitals_Stream WebSocket connection with updates at least once per simulated second and at least once per Wall_Clock_Time second
2. WHILE a Session playback state is paused, THE Physiology_Service SHALL stream the current VitalSigns to the Web_App over a Vitals_Stream WebSocket connection at 1 Hz Wall_Clock_Time
3. THE VitalSigns update SHALL include the following fields: Simulation_Time in seconds, heart rate in beats per minute, respiratory rate in breaths per minute, SpO2 as a fraction between 0 and 1, mean arterial pressure in mmHg, EtCO2 in mmHg, and tidal volume in milliliters
4. WHERE the Pulse_Engine provides systolic and diastolic blood pressure, THE VitalSigns update SHALL include those values in mmHg
5. THE Physiology_Service SHALL encode VitalSigns updates in JSON format with field names documented in docs/api.md and covered by a test
6. THE Web_App SHALL display VitalSigns updates, with display timing verified through manual inspection during acceptance testing
7. THE Web_App SHALL display SpO2 as a percentage by multiplying the fraction value by 100
8. WHEN the WebSocket connection is lost, THE Web_App SHALL display an error message indicating connection loss and SHALL attempt to reconnect every 2 seconds for up to 30 seconds
9. WHEN the Physiology_Service is unreachable, THE Web_App SHALL display an error message indicating the service is unavailable

### Requirement 5: Scheduled Insult Application

**User Story:** As a case author, I want pathological events to occur automatically at specified times, so that cases progress realistically without manual triggering.

#### Acceptance Criteria

1. WHEN Simulation_Time becomes greater than or equal to the scheduled time of a Scheduled_Insult that has not yet been applied in the current Branch, THE Physiology_Service SHALL apply that insult to the Pulse_Engine
2. WHEN a Scheduled_Insult is applied, THE Physiology_Service SHALL update the Pulse_Engine state such that subsequent vital sign queries reflect the insult's physiological effects
3. THE Physiology_Service SHALL apply each Scheduled_Insult within one Engine_Time_Step of its scheduled Simulation_Time
4. WHEN multiple Scheduled_Insults have scheduled times within the same simulation tick, THE Physiology_Service SHALL apply them in ascending order by their scheduled time
5. WHEN multiple Scheduled_Insults have identical scheduled times, THE Physiology_Service SHALL apply them in the order they appear in the Case_Definition
6. THE Physiology_Service SHALL apply each Scheduled_Insult exactly once per Branch
7. WHEN a Branch is forked from a Checkpoint, THE new Branch SHALL NOT apply again any Scheduled_Insult that the Checkpoint records as applied
8. WHEN a Branch is forked from a Checkpoint, THE new Branch SHALL apply each Scheduled_Insult that the Checkpoint does not record as applied when Simulation_Time reaches that insult's scheduled time
9. IF a Case_Definition contains a Scheduled_Insult with scheduled time less than 0, THEN THE Physiology_Service SHALL reject the session creation with error message indicating invalid scheduled insult time
10. THE Physiology_Service SHALL advance Simulation_Time exactly once per tick, regardless of the number of Scheduled_Insults processed in that tick

### Requirement 6: Intervention Application

**User Story:** As a learner, I want to apply clinical interventions and see their physiological effects, so that I can practice treatment decisions and observe outcomes.

#### Acceptance Criteria

1. WHEN the Case is loaded, THE Web_App SHALL display one button per intervention defined in the Case's Interventions list
2. IF the Case contains zero interventions, THEN THE Web_App SHALL display no intervention buttons
3. WHILE the Web_App is not connected to the Vitals_Stream, THE Web_App SHALL disable all intervention buttons
4. WHEN the learner clicks an enabled intervention button, THE Web_App SHALL send an intervention request containing the intervention_id and any runtime parameters to the Physiology_Service
5. WHEN the Physiology_Service receives an intervention request with a valid intervention_id, THE Physiology_Service SHALL apply the intervention to the current Branch's Pulse_Engine at the current Simulation_Time before the next clock tick
6. WHEN applying an intervention, THE Physiology_Service SHALL use runtime parameters if provided, and SHALL use the intervention's default parameters from the Case for any parameters not provided at runtime
7. WHEN the Physiology_Service successfully applies an intervention, THE Physiology_Service SHALL record the intervention in the Branch's Event_Log with Simulation_Time, Wall_Clock_Time, intervention_id, and parameters
8. WHEN the Physiology_Service successfully applies an intervention, THE Physiology_Service SHALL save a manual Checkpoint immediately after applying the intervention
9. WHEN the Physiology_Service successfully applies an intervention, THE Physiology_Service SHALL return a success response to the Web_App
10. WHEN the Web_App receives a success response from an intervention request, THE Web_App SHALL display visual confirmation to the learner
11. WHEN an intervention request contains an intervention_id not defined in the Case, THE Physiology_Service SHALL return a 400 error response containing an error message indicating the intervention_id is unknown and listing valid intervention_id values
12. WHEN a Pulse_Engine action fails during intervention application, THE Physiology_Service SHALL return a 500 error response and SHALL NOT crash the service
13. WHERE the Case is adult-tension-pneumothorax, THE available Interventions SHALL include needle decompression for left hemithorax and needle decompression for right hemithorax

### Requirement 7: Checkpoint and Timeline Fork

**User Story:** As a learner, I want to save progress checkpoints and create alternate timelines from any checkpoint, so that I can explore different clinical decisions without losing previous work.

#### Acceptance Criteria

1. WHILE a Session is in running or paused state, THE Physiology_Service SHALL save an automatic Checkpoint every 30 simulated seconds
2. WHEN an Intervention is successfully applied, THE Physiology_Service SHALL save a manual Checkpoint within 1 second
3. THE Checkpoint SHALL capture complete Pulse_Engine state sufficient to restore the simulation to the exact physiological conditions at the Checkpoint's Simulation_Time
4. THE Checkpoint SHALL include: unique checkpoint_id, Simulation_Time in seconds, creation timestamp in ISO 8601 format, automatic/manual flag, and optional description limited to 500 characters
5. WHEN the learner requests a fork from a Checkpoint that exists, THE Physiology_Service SHALL create a new Branch starting from that Checkpoint state within 5 seconds
6. THE new Branch SHALL initialize a Pulse_Engine instance loaded from the Checkpoint state such that vital signs match the Checkpoint's recorded values
7. THE new Branch SHALL have a unique branch_id and SHALL store references to the parent Branch identifier and the forked Checkpoint identifier
8. THE new Branch SHALL inherit exactly the parent Branch Event_Log entries that the Checkpoint records as applied Interventions
9. WHEN a Branch is forked, THE original Branch SHALL remain unchanged with all its Checkpoints and Event_Log entries accessible
10. WHEN a Branch is successfully created, THE Physiology_Service SHALL update the Session's current Branch reference to the newly forked Branch identifier
11. THE Physiology_Service SHALL limit stored Checkpoints per Branch to a configurable maximum count between 10 and 1000, with default value 100
12. WHEN saving a new Checkpoint would exceed the Branch Checkpoint cap, THE Physiology_Service SHALL delete the oldest automatic Checkpoint if any exist, otherwise THE Physiology_Service SHALL delete the oldest manual Checkpoint excluding the initial Checkpoint at Simulation_Time zero
13. WHEN a fork request references a checkpoint_id that does not exist in any Branch of that Session, THE Physiology_Service SHALL return HTTP 404 status with an error message indicating the checkpoint_id was not found
14. THE Physiology_Service SHALL read the maximum number of Checkpoints per Branch from the environment variable MAX_CHECKPOINTS_PER_BRANCH, defaulting to 100 if not set

### Requirement 8: Bedside Monitor User Interface

**User Story:** As a learner, I want a clear bedside monitor display with vital signs, alarms, trends, and controls, so that I can quickly assess the patient's condition and make decisions.

#### Acceptance Criteria

1. THE Monitor_UI SHALL display numeric readouts for heart rate, respiratory rate, SpO2, mean arterial pressure, EtCO2, and tidal volume, with font sizes verified through manual inspection during acceptance testing
2. THE Monitor_UI SHALL display units for each vital sign (bpm, %, mmHg, mL, br/min)
3. THE Monitor_UI SHALL color-code each vital sign based on Alarm_State: green for normal, yellow for warning, red for critical
4. THE Monitor_UI SHALL determine Alarm_State by comparing current vital value against thresholds from the Case
5. THE Monitor_UI SHALL display a trend chart showing the last 5 simulated minutes of vital signs history with minimum 60 data points per vital sign
6. THE trend chart SHALL update as new VitalSigns are received, with update timing verified through manual inspection during acceptance testing
7. THE Monitor_UI SHALL display the current Simulation_Time in a clock, with font size verified through manual inspection during acceptance testing
8. THE Monitor_UI SHALL display play/pause and speed controls
9. WHEN an intervention button is activated, THE Monitor_UI SHALL display visual confirmation and the button SHALL display the label from the Case, with confirmation timing verified through manual inspection during acceptance testing
10. THE Monitor_UI SHALL display a Timeline showing Branches and Checkpoints
11. THE Timeline SHALL allow the learner to select a Checkpoint and fork a new Branch
12. THE Monitor_UI SHALL display patient demographics from the Case: age, sex, and summary
13. THE Monitor_UI SHALL display an "Educational simulation, not for clinical use" notice at the top of the viewport, with font size and placement verified through manual inspection during acceptance testing
14. THE Monitor_UI readability in a 1280x720 screen recording SHALL be verified through manual inspection during acceptance testing
15. WHEN the Physiology_Service is unavailable, THE Monitor_UI SHALL display connection status indicator and an error message stating the service name and that reconnection is being attempted
16. WHEN Alarm_State changes for any vital sign, THE Monitor_UI SHALL update the color-coding, with update timing verified through manual inspection during acceptance testing

### Requirement 9: Simulation Determinism

**User Story:** As a system maintainer, I want the simulation to be deterministic, so that learners can reproduce outcomes, bugs can be debugged reliably, and assessment scoring is fair.

#### Acceptance Criteria

1. WHEN starting from the same Checkpoint and applying the same Interventions at the same Simulation_Time values, THE Pulse_Engine SHALL produce VitalSigns where each field differs by no more than 0.001 from the expected value
2. THE Physiology_Service SHALL apply Scheduled_Insults at their defined Simulation_Time values within one Engine_Time_Step, independent of Wall_Clock_Time or system load
3. THE Physiology_Service SHALL apply Interventions at the current Simulation_Time when the request is received, independent of Wall_Clock_Time or system load
4. THE Checkpoint SHALL capture Pulse_Engine state, simulation clock value, applied Scheduled_Insults list, applied Interventions list, and playback state
5. WHEN a Branch is forked from a Checkpoint, THE new Branch SHALL produce VitalSigns where each field differs by no more than 0.001 from the original Branch when no new Interventions are applied and both advance the same Simulation_Time duration
6. THE automated test suite SHALL include a determinism test that compares heart_rate, respiratory_rate, spo2, mean_arterial_pressure, etco2, and tidal_volume fields across repeated runs using 0.001 tolerance
7. WHEN the determinism test is loaded from a Checkpoint and advances Simulation_Time, THE resulting VitalSigns SHALL match the non-checkpoint run within 0.001 tolerance for all compared fields
8. IF the determinism test detects a difference exceeding 0.001 tolerance in any compared vital sign field, THEN THE test SHALL fail with an error message indicating the field name, expected value, actual value, and Simulation_Time

### Requirement 10: Error Recovery and Resource Management

**User Story:** As a system operator, I want the service to handle errors gracefully and manage resources efficiently, so that one failed session does not affect other users and the system remains available.

#### Acceptance Criteria

1. WHEN a Pulse_Engine call fails, THE Physiology_Service SHALL log the error with the Session identifier and error details, and return an HTTP 500 response to the client within 5 seconds
2. IF a Pulse_Engine call fails, THEN THE Physiology_Service SHALL isolate the failure to the affected Session and continue processing requests for all other Sessions without interruption
3. WHEN a Session encounters an error during simulation, THE Physiology_Service SHALL preserve the most recent Checkpoint for that Session
4. IF a Session with a preserved Checkpoint is resumed, THEN THE Physiology_Service SHALL restore simulation state from that Checkpoint
5. THE Physiology_Service SHALL maintain exactly one Pulse_Engine instance per active Branch, where an active Branch is one associated with a Session that has not exceeded the idle timeout
6. THE Physiology_Service SHALL release a Session when no WebSocket client is connected to that Session and no API request has been made for that Session within the idle timeout duration
7. WHEN the last WebSocket client disconnects from a Session, THE Physiology_Service SHALL pause that Session
8. WHEN releasing a Session due to idle timeout, THE Physiology_Service SHALL delete all temporary Checkpoint files created for that Session from the filesystem
9. WHEN releasing a Session due to idle timeout, THE Physiology_Service SHALL terminate the associated Pulse_Engine instance and free all memory allocated to that Session's simulation state
10. THE Physiology_Service SHALL execute all Pulse_Engine operations in a thread pool separate from the asyncio event loop
11. IF one Session's Pulse_Engine operation takes longer than 10 seconds, THEN THE Physiology_Service SHALL continue to accept and process requests for all other Sessions without delay
12. THE Physiology_Service SHALL store Session state in a shared data structure that is accessed atomically during state updates
13. IF multiple WebSocket connections subscribe to the same Session, THEN THE Physiology_Service SHALL advance simulation time exactly once per clock tick for that Session
14. THE Physiology_Service SHALL drive each Session from a single internal clock task that advances time at the configured simulation speed, independent of the number or timing of WebSocket connections to that Session
15. THE Physiology_Service SHALL read the idle timeout duration in seconds from the environment variable SESSION_IDLE_TIMEOUT, defaulting to 3600 if not set

### Requirement 11: Acceptance Demonstration

**User Story:** As a stakeholder, I want to see the complete simulation workflow demonstrated, so that I can verify the system meets its educational goals.

#### Acceptance Criteria

1. WHEN starting the adult-tension-pneumothorax Case, THE Monitor_UI SHALL display VitalSigns within tolerance for the first 30 simulated seconds: heart rate 67-77 bpm, SpO2 0.95-0.99, mean arterial pressure 90-100 mmHg
2. WHEN Simulation_Time reaches 30 seconds, THE Physiology_Service SHALL apply the Scheduled_Insult (left closed tension pneumothorax, severity 0.75)
3. WHEN Simulation_Time reaches 150 seconds (2 minutes after insult), IF no Intervention has been applied, THEN THE VitalSigns SHALL show deterioration from baseline: heart rate SHALL be at least 115 bpm, SpO2 SHALL be at most 0.93, and mean arterial pressure SHALL be at most 88 mmHg
4. WHEN the learner applies the "Needle decompression - left" Intervention, THE Physiology_Service SHALL register the Intervention within 1 simulated second
5. WHEN 60 simulated seconds have elapsed after applying the "Needle decompression - left" Intervention, THE VitalSigns SHALL show improvement from pre-intervention values, with specific thresholds determined by running the scenario once and recording actual values with a safety margin
6. WHEN the learner forks from the last Checkpoint before the needle decompression and lets the new Branch run for 120 simulated seconds without any Intervention, THE new Branch SHALL show SpO2 lower than at the fork point, AND at the same Simulation_Time SHALL show lower SpO2 and higher heart rate than the Branch in which the needle decompression was applied
7. WHEN comparing two Branches at 300 simulated seconds (one with needle decompression applied, one without any Intervention), THE Branch with Intervention SHALL show better vital signs than the Branch without Intervention, with specific thresholds determined by running the scenario once and recording actual values with a safety margin
8. THE automated test suite SHALL include a test that executes this acceptance demonstration scenario and verifies all criteria 1-7, where criteria 5 and 7 use thresholds derived from an initial test run with appropriate safety margins
