# Calibration record: adult-tension-pneumothorax

> Educational simulation, not for clinical use

Engine results for draft case values. Not clinical advice.

- Date: 2026-11-26
- Commit: 4489c94
- Files under cases/ differ from the commit: no
- Files under apps/web/src/lib/ differ from the commit: no
- Commit 1e71454 is an ancestor of the commit: yes
- Service_URL: http://localhost:8000
- Playback speed: 4x, 1x within 4 s before each Decompression; the speed affects wall-clock time only
- Session_Cap: 4
- Demo_Decompression_Time: 150 s
- Early_Decompression_Time: 20 s

## Result

All calibration checks passed. The author reviews the values and their citations before removing any TODO(author) marker.

Requirement 4.18 flag: not raised

## Variant `left` (Affected_Side: Left)

### Play_Section values used

| Item | Value |
| --- | --- |
| Rescue_Conditions | spO2 >= 0.95; heartRate <= 110 |
| Rescue Hold_Duration | 30 s |
| Lost_Condition group 1 | spO2 < 0.85 |
| Lost_Condition group 1 Hold_Duration | 30 s |
| Time_Limit | 600 s |
| Required_Interventions | needle-decompression-left |

### Calibration_Checks

| Check | Scenario | Result | Basis |
| --- | --- | --- | --- |
| affected-side-rescued | `left` / affected-side | pass | rescued at 230 s; gate 150 s + hold 30 s = 180 s ≤ 230 s ≤ 300 s |
| other-side-only-lost | `left` / other-side-only | pass | lost at 340 s (cause: Lost_Condition group 1); 340 s ≤ limit 600 s (Time_Limit); gate closed; rescue held without the gate at: 0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100 s; answers open question 1, item c |
| no-intervention-lost | `left` / no-intervention | pass | lost at 340 s (cause: Lost_Condition group 1); 340 s ≤ limit 600 s (Time_Limit); gate closed; rescue held without the gate at: 0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100 s |

### Scenario `left` / no-intervention

Interventions: none

Rescue_Gate_Time: closed

Ending: lost at 340 s (cause: Lost_Condition group 1)

#### Vital signs

| Time (s) | Substituted | heartRate | spO2 | Overall_Status | Ending |
| --- | --- | --- | --- | --- | --- |
| 0 | no | 72.0 | 0.974 | normal | none |
| 10 | no | 72.0 | 0.974 | normal | none |
| 20 | no | 72.0 | 0.974 | normal | none |
| 30 | no | 72.0 | 0.974 | normal | none |
| 40 | no | 72.1 | 0.974 | normal | none |
| 50 | no | 73.2 | 0.975 | normal | none |
| 60 | no | 76.7 | 0.975 | normal | none |
| 70 | no | 82.1 | 0.973 | normal | none |
| 80 | no | 88.6 | 0.969 | warning | none |
| 90 | no | 94.2 | 0.962 | warning | none |
| 100 | no | 98.0 | 0.955 | warning | none |
| 110 | no | 101.2 | 0.948 | warning | none |
| 120 | no | 105.0 | 0.940 | warning | none |
| 130 | no | 110.9 | 0.932 | warning | none |
| 140 | no | 118.8 | 0.925 | warning | none |
| 150 | no | 127.5 | 0.919 | warning | none |
| 160 | no | 136.2 | 0.913 | warning | none |
| 170 | no | 144.0 | 0.909 | critical | none |
| 180 | no | 150.0 | 0.905 | critical | none |
| 190 | no | 154.6 | 0.902 | critical | none |
| 200 | no | 158.0 | 0.900 | critical | none |
| 210 | no | 160.4 | 0.898 | critical | none |
| 220 | no | 162.8 | 0.895 | critical | none |
| 230 | no | 165.0 | 0.892 | critical | none |
| 240 | no | 167.5 | 0.887 | critical | none |
| 250 | no | 170.1 | 0.883 | critical | none |
| 260 | no | 172.3 | 0.878 | critical | none |
| 270 | no | 174.2 | 0.875 | critical | none |
| 280 | no | 175.7 | 0.869 | critical | none |
| 290 | no | 176.7 | 0.861 | critical | none |
| 300 | no | 177.0 | 0.855 | critical | none |
| 310 | no | 177.2 | 0.849 | critical | none |
| 320 | no | 177.2 | 0.839 | critical | none |
| 330 | no | 177.2 | 0.836 | critical | none |
| 340 | no | 177.2 | 0.834 | critical | lost |

#### Vital_Bands at Simulation_Time 0

| Vital | Alarm_State | Direction |
| --- | --- | --- |
| heartRate | normal | none |
| respiratoryRate | normal | none |
| spO2 | normal | none |
| meanArterialPressure | normal | none |
| etCO2 | normal | none |
| tidalVolume | normal | none |

#### Status_Rules

| Rule | Sentence | Matched at (s) | Returned at (s) |
| --- | --- | --- | --- |
| play.status.rules[0] | His lips are turning blue and he is fighting for breath. | 260, 270, 280, 290, 300, 310, 320, 330, 340 | 260, 270, 280, 290, 300, 310, 320, 330, 340 |
| play.status.rules[1] | He looks pale and is struggling to breathe. | 110, 120, 130, 140, 150, 160, 170, 180, 190, 200, 210, 220, 230, 240, 250 | 110, 120, 130, 140, 150, 160, 170, 180, 190, 200, 210, 220, 230, 240, 250 |
| play.status.rules[2] | His heart is racing and he looks frightened. | 170, 180, 190, 200, 210, 220, 230, 240, 250, 260, 270, 280, 290, 300, 310, 320, 330, 340 | never |
| play.status.rules[3] | His heart is beating fast and he looks uneasy. | 110, 120, 130, 140, 150, 160 | never |

#### Speech

| Time (s) | Speech_Key | Line |
| --- | --- | --- |
| 0 | silent | silent |
| 30 | early | I... can't... get a breath in. My chest- |
| 60 | early | It hurts... when I try to breathe in. |
| 90 | early | I... can't... get a breath in. My chest- |
| 110 | play.status.rules[1] | It's getting worse... I can't catch my breath. |
| 140 | play.status.rules[1] | Why can't I breathe properly? |
| 170 | play.status.rules[1] | It's getting worse... I can't catch my breath. |
| 200 | play.status.rules[1] | Why can't I breathe properly? |
| 230 | play.status.rules[1] | It's getting worse... I can't catch my breath. |
| 260 | play.status.rules[0] | Can't... breathe... |
| 290 | play.status.rules[0] | Help... me... |
| 320 | play.status.rules[0] | Can't... breathe... |
| 340 | silent | silent |

Speech lines are computed on the Mark_Samples; the Web_App computes them on every received sample, so its line changes can come up to one Sample_Interval earlier or later.

#### Exam_Findings

| Exam_Button | Side | First Abnormal_Finding (s) |
| --- | --- | --- |
| look-chest | n/a | 30 |
| listen | affected side | 30 |
| listen | other side | never |
| windpipe | n/a | 260 |
| neck-veins | n/a | 30 |

| Time (s) | look-chest | listen (affected side) | listen (other side) | windpipe | neck-veins |
| --- | --- | --- | --- | --- | --- |
| 0 | Both sides of his chest rise and fall evenly. | You hear clear breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | His neck veins look normal. |
| 10 | Both sides of his chest rise and fall evenly. | You hear clear breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | His neck veins look normal. |
| 20 | Both sides of his chest rise and fall evenly. | You hear clear breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | His neck veins look normal. |
| 30 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 40 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 50 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 60 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 70 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 80 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 90 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 100 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 110 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 120 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 130 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 140 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 150 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 160 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 170 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 180 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 190 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 200 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 210 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 220 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 230 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 240 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 250 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 260 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 270 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 280 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 290 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 300 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 310 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 320 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 330 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 340 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |

### Scenario `left` / affected-side

Interventions:

| Intervention | Side | Requested_Time (s) | Actual_Time (s) | Late |
| --- | --- | --- | --- | --- |
| needle-decompression-left | affected side | 150 | 150 | no |

Rescue_Gate_Time: 150 s

Ending: rescued at 230 s

#### Vital signs

| Time (s) | Substituted | heartRate | spO2 | Overall_Status | Ending |
| --- | --- | --- | --- | --- | --- |
| 0 | no | 72.0 | 0.974 | normal | none |
| 10 | no | 72.0 | 0.974 | normal | none |
| 20 | no | 72.0 | 0.974 | normal | none |
| 30 | no | 72.0 | 0.974 | normal | none |
| 40 | no | 72.1 | 0.974 | normal | none |
| 50 | no | 73.2 | 0.975 | normal | none |
| 60 | no | 76.7 | 0.975 | normal | none |
| 70 | no | 82.1 | 0.973 | normal | none |
| 80 | no | 88.6 | 0.969 | warning | none |
| 90 | no | 94.2 | 0.962 | warning | none |
| 100 | no | 98.0 | 0.955 | warning | none |
| 110 | no | 101.2 | 0.948 | warning | none |
| 120 | no | 105.0 | 0.940 | warning | none |
| 130 | no | 110.9 | 0.932 | warning | none |
| 140 | no | 118.8 | 0.925 | warning | none |
| 150 | no | 127.5 | 0.919 | warning | none |
| 160 | no | 135.2 | 0.918 | warning | none |
| 170 | no | 132.9 | 0.933 | warning | none |
| 180 | no | 120.8 | 0.953 | warning | none |
| 190 | no | 111.1 | 0.963 | warning | none |
| 200 | no | 105.9 | 0.966 | warning | none |
| 210 | no | 102.5 | 0.967 | warning | none |
| 220 | no | 99.5 | 0.968 | warning | none |
| 230 | no | 97.2 | 0.968 | warning | rescued |

#### Vital_Bands at Simulation_Time 0

| Vital | Alarm_State | Direction |
| --- | --- | --- |
| heartRate | normal | none |
| respiratoryRate | normal | none |
| spO2 | normal | none |
| meanArterialPressure | normal | none |
| etCO2 | normal | none |
| tidalVolume | normal | none |

#### Status_Rules

| Rule | Sentence | Matched at (s) | Returned at (s) |
| --- | --- | --- | --- |
| play.status.rules[1] | He looks pale and is struggling to breathe. | 110, 120, 130, 140, 150, 160, 170 | 110, 120, 130, 140, 150, 160, 170 |
| play.status.rules[3] | His heart is beating fast and he looks uneasy. | 110, 120, 130, 140, 150, 160, 170, 180, 190, 200, 210 | 180, 190, 200, 210 |

#### Speech

| Time (s) | Speech_Key | Line |
| --- | --- | --- |
| 0 | silent | silent |
| 30 | early | I... can't... get a breath in. My chest- |
| 60 | early | It hurts... when I try to breathe in. |
| 90 | early | I... can't... get a breath in. My chest- |
| 110 | play.status.rules[1] | It's getting worse... I can't catch my breath. |
| 140 | play.status.rules[1] | Why can't I breathe properly? |
| 170 | play.status.rules[1] | It's getting worse... I can't catch my breath. |
| 180 | play.status.rules[3] | My heart's racing. What's happening to me? |
| 220 | silent | silent |
| 230 | rescued | Oh... I can breathe again. Thank you. |

Speech lines are computed on the Mark_Samples; the Web_App computes them on every received sample, so its line changes can come up to one Sample_Interval earlier or later.

#### Exam_Findings

| Exam_Button | Side | First Abnormal_Finding (s) |
| --- | --- | --- |
| look-chest | n/a | 30 |
| listen | affected side | 30 |
| listen | other side | never |
| windpipe | n/a | never |
| neck-veins | n/a | 30 |

| Time (s) | look-chest | listen (affected side) | listen (other side) | windpipe | neck-veins |
| --- | --- | --- | --- | --- | --- |
| 0 | Both sides of his chest rise and fall evenly. | You hear clear breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | His neck veins look normal. |
| 10 | Both sides of his chest rise and fall evenly. | You hear clear breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | His neck veins look normal. |
| 20 | Both sides of his chest rise and fall evenly. | You hear clear breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | His neck veins look normal. |
| 30 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 40 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 50 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 60 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 70 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 80 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 90 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 100 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 110 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 120 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 130 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 140 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 150 | Both sides of his chest rise and fall evenly. | Breathing sounds are coming back on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | His neck veins look normal. |
| 160 | Both sides of his chest rise and fall evenly. | Breathing sounds are coming back on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | His neck veins look normal. |
| 170 | Both sides of his chest rise and fall evenly. | Breathing sounds are coming back on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | His neck veins look normal. |
| 180 | Both sides of his chest rise and fall evenly. | Breathing sounds are coming back on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | His neck veins look normal. |
| 190 | Both sides of his chest rise and fall evenly. | Breathing sounds are coming back on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | His neck veins look normal. |
| 200 | Both sides of his chest rise and fall evenly. | Breathing sounds are coming back on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | His neck veins look normal. |
| 210 | Both sides of his chest rise and fall evenly. | Breathing sounds are coming back on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | His neck veins look normal. |
| 220 | Both sides of his chest rise and fall evenly. | Breathing sounds are coming back on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | His neck veins look normal. |
| 230 | Both sides of his chest rise and fall evenly. | Breathing sounds are coming back on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | His neck veins look normal. |

### Scenario `left` / other-side-only

Interventions:

| Intervention | Side | Requested_Time (s) | Actual_Time (s) | Late |
| --- | --- | --- | --- | --- |
| needle-decompression-right | other side | 150 | 150 | no |

Rescue_Gate_Time: closed

Ending: lost at 340 s (cause: Lost_Condition group 1)

#### Vital signs

| Time (s) | Substituted | heartRate | spO2 | Overall_Status | Ending |
| --- | --- | --- | --- | --- | --- |
| 0 | no | 72.0 | 0.974 | normal | none |
| 10 | no | 72.0 | 0.974 | normal | none |
| 20 | no | 72.0 | 0.974 | normal | none |
| 30 | no | 72.0 | 0.974 | normal | none |
| 40 | no | 72.1 | 0.974 | normal | none |
| 50 | no | 73.2 | 0.975 | normal | none |
| 60 | no | 76.7 | 0.975 | normal | none |
| 70 | no | 82.1 | 0.973 | normal | none |
| 80 | no | 88.6 | 0.969 | warning | none |
| 90 | no | 94.2 | 0.962 | warning | none |
| 100 | no | 98.0 | 0.955 | warning | none |
| 110 | no | 101.2 | 0.948 | warning | none |
| 120 | no | 105.0 | 0.940 | warning | none |
| 130 | no | 110.9 | 0.932 | warning | none |
| 140 | no | 118.8 | 0.925 | warning | none |
| 150 | no | 127.5 | 0.919 | warning | none |
| 160 | no | 136.2 | 0.913 | warning | none |
| 170 | no | 144.0 | 0.909 | critical | none |
| 180 | no | 150.0 | 0.905 | critical | none |
| 190 | no | 154.6 | 0.902 | critical | none |
| 200 | no | 158.0 | 0.900 | critical | none |
| 210 | no | 160.4 | 0.898 | critical | none |
| 220 | no | 162.8 | 0.895 | critical | none |
| 230 | no | 165.0 | 0.892 | critical | none |
| 240 | no | 167.5 | 0.887 | critical | none |
| 250 | no | 170.1 | 0.883 | critical | none |
| 260 | no | 172.3 | 0.878 | critical | none |
| 270 | no | 174.2 | 0.875 | critical | none |
| 280 | no | 175.7 | 0.869 | critical | none |
| 290 | no | 176.7 | 0.861 | critical | none |
| 300 | no | 177.0 | 0.855 | critical | none |
| 310 | no | 177.2 | 0.849 | critical | none |
| 320 | no | 177.2 | 0.839 | critical | none |
| 330 | no | 177.2 | 0.836 | critical | none |
| 340 | no | 177.2 | 0.834 | critical | lost |

#### Vital_Bands at Simulation_Time 0

| Vital | Alarm_State | Direction |
| --- | --- | --- |
| heartRate | normal | none |
| respiratoryRate | normal | none |
| spO2 | normal | none |
| meanArterialPressure | normal | none |
| etCO2 | normal | none |
| tidalVolume | normal | none |

#### Status_Rules

| Rule | Sentence | Matched at (s) | Returned at (s) |
| --- | --- | --- | --- |
| play.status.rules[0] | His lips are turning blue and he is fighting for breath. | 260, 270, 280, 290, 300, 310, 320, 330, 340 | 260, 270, 280, 290, 300, 310, 320, 330, 340 |
| play.status.rules[1] | He looks pale and is struggling to breathe. | 110, 120, 130, 140, 150, 160, 170, 180, 190, 200, 210, 220, 230, 240, 250 | 110, 120, 130, 140, 150, 160, 170, 180, 190, 200, 210, 220, 230, 240, 250 |
| play.status.rules[2] | His heart is racing and he looks frightened. | 170, 180, 190, 200, 210, 220, 230, 240, 250, 260, 270, 280, 290, 300, 310, 320, 330, 340 | never |
| play.status.rules[3] | His heart is beating fast and he looks uneasy. | 110, 120, 130, 140, 150, 160 | never |

#### Speech

| Time (s) | Speech_Key | Line |
| --- | --- | --- |
| 0 | silent | silent |
| 30 | early | I... can't... get a breath in. My chest- |
| 60 | early | It hurts... when I try to breathe in. |
| 90 | early | I... can't... get a breath in. My chest- |
| 110 | play.status.rules[1] | It's getting worse... I can't catch my breath. |
| 140 | play.status.rules[1] | Why can't I breathe properly? |
| 170 | play.status.rules[1] | It's getting worse... I can't catch my breath. |
| 200 | play.status.rules[1] | Why can't I breathe properly? |
| 230 | play.status.rules[1] | It's getting worse... I can't catch my breath. |
| 260 | play.status.rules[0] | Can't... breathe... |
| 290 | play.status.rules[0] | Help... me... |
| 320 | play.status.rules[0] | Can't... breathe... |
| 340 | silent | silent |

Speech lines are computed on the Mark_Samples; the Web_App computes them on every received sample, so its line changes can come up to one Sample_Interval earlier or later.

#### Exam_Findings

| Exam_Button | Side | First Abnormal_Finding (s) |
| --- | --- | --- |
| look-chest | n/a | 30 |
| listen | affected side | 30 |
| listen | other side | never |
| windpipe | n/a | 260 |
| neck-veins | n/a | 30 |

| Time (s) | look-chest | listen (affected side) | listen (other side) | windpipe | neck-veins |
| --- | --- | --- | --- | --- | --- |
| 0 | Both sides of his chest rise and fall evenly. | You hear clear breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | His neck veins look normal. |
| 10 | Both sides of his chest rise and fall evenly. | You hear clear breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | His neck veins look normal. |
| 20 | Both sides of his chest rise and fall evenly. | You hear clear breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | His neck veins look normal. |
| 30 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 40 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 50 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 60 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 70 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 80 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 90 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 100 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 110 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 120 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 130 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 140 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 150 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 160 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 170 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 180 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 190 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 200 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 210 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 220 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 230 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 240 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 250 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 260 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 270 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 280 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 290 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 300 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 310 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 320 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 330 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 340 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |

### Scenario `left` / affected-side-early

Interventions:

| Intervention | Side | Requested_Time (s) | Actual_Time (s) | Late |
| --- | --- | --- | --- | --- |
| needle-decompression-left | affected side | 20 | 20 | no |

Rescue_Gate_Time: closed

Ending: lost at 340 s (cause: Lost_Condition group 1)

#### Vital signs

| Time (s) | Substituted | heartRate | spO2 | Overall_Status | Ending |
| --- | --- | --- | --- | --- | --- |
| 0 | no | 72.0 | 0.974 | normal | none |
| 10 | no | 72.0 | 0.974 | normal | none |
| 20 | no | 72.0 | 0.974 | normal | none |
| 30 | no | 72.0 | 0.974 | normal | none |
| 40 | no | 72.1 | 0.974 | normal | none |
| 50 | no | 73.2 | 0.975 | normal | none |
| 60 | no | 76.7 | 0.975 | normal | none |
| 70 | no | 82.1 | 0.973 | normal | none |
| 80 | no | 88.6 | 0.969 | warning | none |
| 90 | no | 94.2 | 0.962 | warning | none |
| 100 | no | 98.0 | 0.955 | warning | none |
| 110 | no | 101.2 | 0.948 | warning | none |
| 120 | no | 105.0 | 0.940 | warning | none |
| 130 | no | 110.9 | 0.932 | warning | none |
| 140 | no | 118.8 | 0.925 | warning | none |
| 150 | no | 127.5 | 0.919 | warning | none |
| 160 | no | 136.2 | 0.913 | warning | none |
| 170 | no | 144.0 | 0.909 | critical | none |
| 180 | no | 150.0 | 0.905 | critical | none |
| 190 | no | 154.6 | 0.902 | critical | none |
| 200 | no | 158.0 | 0.900 | critical | none |
| 210 | no | 160.4 | 0.898 | critical | none |
| 220 | no | 162.8 | 0.895 | critical | none |
| 230 | no | 165.0 | 0.892 | critical | none |
| 240 | no | 167.5 | 0.887 | critical | none |
| 250 | no | 170.1 | 0.883 | critical | none |
| 260 | no | 172.3 | 0.878 | critical | none |
| 270 | no | 174.2 | 0.875 | critical | none |
| 280 | no | 175.7 | 0.869 | critical | none |
| 290 | no | 176.7 | 0.861 | critical | none |
| 300 | no | 177.0 | 0.855 | critical | none |
| 310 | no | 177.2 | 0.849 | critical | none |
| 320 | no | 177.2 | 0.839 | critical | none |
| 330 | no | 177.2 | 0.836 | critical | none |
| 340 | no | 177.2 | 0.834 | critical | lost |
| 350 | no | 177.2 | 0.818 | critical | lost |
| 360 | no | 177.2 | 0.806 | critical | lost |
| 370 | no | 177.2 | 0.804 | critical | lost |
| 380 | no | 177.2 | 0.798 | critical | lost |
| 390 | no | 177.2 | 0.790 | critical | lost |
| 400 | no | 177.2 | 0.784 | critical | lost |
| 410 | no | 177.2 | 0.774 | critical | lost |
| 420 | no | 177.2 | 0.763 | critical | lost |
| 430 | no | 177.2 | 0.759 | critical | lost |
| 440 | no | 177.2 | 0.793 | critical | lost |
| 450 | no | 177.2 | 0.788 | critical | lost |
| 460 | no | 177.2 | 0.752 | critical | lost |
| 470 | no | 177.2 | 0.739 | critical | lost |
| 480 | no | 177.2 | 0.735 | critical | lost |
| 490 | no | 177.2 | 0.720 | critical | lost |
| 500 | no | 177.2 | 0.719 | critical | lost |
| 510 | no | 177.2 | 0.708 | critical | lost |
| 520 | no | 177.2 | 0.701 | critical | lost |
| 530 | no | 177.2 | 0.693 | critical | lost |
| 540 | no | 177.2 | 0.705 | critical | lost |
| 550 | no | 177.2 | 0.691 | critical | lost |
| 560 | no | 177.2 | 0.673 | critical | lost |
| 570 | no | 177.2 | 0.672 | critical | lost |
| 580 | no | 177.2 | 0.663 | critical | lost |
| 590 | no | 177.2 | 0.663 | critical | lost |
| 600 | no | 177.2 | 0.666 | critical | lost |

#### Vital_Bands at Simulation_Time 0

| Vital | Alarm_State | Direction |
| --- | --- | --- |
| heartRate | normal | none |
| respiratoryRate | normal | none |
| spO2 | normal | none |
| meanArterialPressure | normal | none |
| etCO2 | normal | none |
| tidalVolume | normal | none |

#### Status_Rules

| Rule | Sentence | Matched at (s) | Returned at (s) |
| --- | --- | --- | --- |
| play.status.rules[0] | His lips are turning blue and he is fighting for breath. | 260, 270, 280, 290, 300, 310, 320, 330, 340, 350, 360, 370, 380, 390, 400, 410, 420, 430, 440, 450, 460, 470, 480, 490, 500, 510, 520, 530, 540, 550, 560, 570, 580, 590, 600 | 260, 270, 280, 290, 300, 310, 320, 330, 340, 350, 360, 370, 380, 390, 400, 410, 420, 430, 440, 450, 460, 470, 480, 490, 500, 510, 520, 530, 540, 550, 560, 570, 580, 590, 600 |
| play.status.rules[1] | He looks pale and is struggling to breathe. | 110, 120, 130, 140, 150, 160, 170, 180, 190, 200, 210, 220, 230, 240, 250 | 110, 120, 130, 140, 150, 160, 170, 180, 190, 200, 210, 220, 230, 240, 250 |
| play.status.rules[2] | His heart is racing and he looks frightened. | 170, 180, 190, 200, 210, 220, 230, 240, 250, 260, 270, 280, 290, 300, 310, 320, 330, 340, 350, 360, 370, 380, 390, 400, 410, 420, 430, 440, 450, 460, 470, 480, 490, 500, 510, 520, 530, 540, 550, 560, 570, 580, 590, 600 | never |
| play.status.rules[3] | His heart is beating fast and he looks uneasy. | 110, 120, 130, 140, 150, 160 | never |
| play.status.rules[4] | He is breathing faster than normal. | 420, 430, 440, 450, 460, 470, 480, 490, 500, 510, 520, 530, 540, 550, 560, 570, 580, 590, 600 | never |

#### Speech

| Time (s) | Speech_Key | Line |
| --- | --- | --- |
| 0 | silent | silent |
| 30 | early | I... can't... get a breath in. My chest- |
| 60 | early | It hurts... when I try to breathe in. |
| 90 | early | I... can't... get a breath in. My chest- |
| 110 | play.status.rules[1] | It's getting worse... I can't catch my breath. |
| 140 | play.status.rules[1] | Why can't I breathe properly? |
| 170 | play.status.rules[1] | It's getting worse... I can't catch my breath. |
| 200 | play.status.rules[1] | Why can't I breathe properly? |
| 230 | play.status.rules[1] | It's getting worse... I can't catch my breath. |
| 260 | play.status.rules[0] | Can't... breathe... |
| 290 | play.status.rules[0] | Help... me... |
| 320 | play.status.rules[0] | Can't... breathe... |
| 340 | silent | silent |

Speech lines are computed on the Mark_Samples; the Web_App computes them on every received sample, so its line changes can come up to one Sample_Interval earlier or later.

#### Exam_Findings

| Exam_Button | Side | First Abnormal_Finding (s) |
| --- | --- | --- |
| look-chest | n/a | 30 |
| listen | affected side | 30 |
| listen | other side | never |
| windpipe | n/a | 260 |
| neck-veins | n/a | 30 |

| Time (s) | look-chest | listen (affected side) | listen (other side) | windpipe | neck-veins |
| --- | --- | --- | --- | --- | --- |
| 0 | Both sides of his chest rise and fall evenly. | You hear clear breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | His neck veins look normal. |
| 10 | Both sides of his chest rise and fall evenly. | You hear clear breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | His neck veins look normal. |
| 20 | Both sides of his chest rise and fall evenly. | You hear clear breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | His neck veins look normal. |
| 30 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 40 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 50 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 60 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 70 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 80 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 90 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 100 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 110 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 120 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 130 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 140 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 150 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 160 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 170 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 180 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 190 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 200 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 210 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 220 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 230 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 240 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 250 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 260 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 270 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 280 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 290 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 300 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 310 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 320 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 330 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 340 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 350 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 360 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 370 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 380 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 390 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 400 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 410 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 420 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 430 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 440 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 450 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 460 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 470 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 480 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 490 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 500 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 510 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 520 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 530 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 540 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 550 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 560 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 570 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 580 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 590 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 600 | **abnormal:** One side of his chest hardly moves when he breathes. | **abnormal:** You can barely hear any breathing on this side. | You hear clear breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |

### Early Decompression compared with no intervention

| Time (s) | heartRate early | heartRate none | respiratoryRate early | respiratoryRate none | spO2 early | spO2 none | meanArterialPressure early | meanArterialPressure none | etCO2 early | etCO2 none | tidalVolume early | tidalVolume none |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 40 | 72.1 | 72.1 | 12.0 | 12.0 | 0.974 | 0.974 | 94.9 | 94.9 | 35.2 | 35.2 | 561 | 561 |
| 50 | 73.2 | 73.2 | 12.0 | 12.0 | 0.975 | 0.975 | 93.8 | 93.8 | 34.8 | 34.8 | 533 | 533 |
| 60 | 76.7 | 76.7 | 12.0 | 12.0 | 0.975 | 0.975 | 93.9 | 93.9 | 34.7 | 34.7 | 490 | 490 |
| 70 | 82.1 | 82.1 | 12.0 | 12.0 | 0.973 | 0.973 | 93.2 | 93.2 | 34.8 | 34.8 | 465 | 465 |
| 80 | 88.6 | 88.6 | 12.0 | 12.0 | 0.969 | 0.969 | 93.0 | 93.0 | 35.1 | 35.1 | 412 | 412 |
| 90 | 94.2 | 94.2 | 11.9 | 11.9 | 0.962 | 0.962 | 91.9 | 91.9 | 35.5 | 35.5 | 344 | 344 |
| 100 | 98.0 | 98.0 | 11.2 | 11.2 | 0.955 | 0.955 | 89.8 | 89.8 | 35.7 | 35.7 | 337 | 337 |
| 110 | 101.2 | 101.2 | 12.9 | 12.9 | 0.948 | 0.948 | 88.3 | 88.3 | 35.6 | 35.6 | 326 | 326 |
| 120 | 105.0 | 105.0 | 13.4 | 13.4 | 0.940 | 0.940 | 87.5 | 87.5 | 35.8 | 35.8 | 317 | 317 |
| 130 | 110.9 | 110.9 | 13.9 | 13.9 | 0.932 | 0.932 | 87.0 | 87.0 | 36.0 | 36.0 | 311 | 311 |
| 140 | 118.8 | 118.8 | 14.6 | 14.6 | 0.925 | 0.925 | 86.2 | 86.2 | 36.1 | 36.1 | 309 | 309 |
| 150 | 127.5 | 127.5 | 15.1 | 15.1 | 0.919 | 0.919 | 85.6 | 85.6 | 36.1 | 36.1 | 313 | 313 |
| 160 | 136.2 | 136.2 | 15.7 | 15.7 | 0.913 | 0.913 | 85.0 | 85.0 | 35.9 | 35.9 | 320 | 320 |
| 170 | 144.0 | 144.0 | 16.0 | 16.0 | 0.909 | 0.909 | 83.0 | 83.0 | 35.3 | 35.3 | 330 | 330 |
| 180 | 150.0 | 150.0 | 16.6 | 16.6 | 0.905 | 0.905 | 83.6 | 83.6 | 34.8 | 34.8 | 348 | 348 |
| 190 | 154.6 | 154.6 | 16.9 | 16.9 | 0.902 | 0.902 | 83.3 | 83.3 | 33.8 | 33.8 | 374 | 374 |
| 200 | 158.0 | 158.0 | 17.2 | 17.2 | 0.900 | 0.900 | 82.4 | 82.4 | 32.7 | 32.7 | 381 | 381 |
| 210 | 160.4 | 160.4 | 17.5 | 17.5 | 0.898 | 0.898 | 81.3 | 81.3 | 31.7 | 31.7 | 388 | 388 |
| 220 | 162.8 | 162.8 | 17.8 | 17.8 | 0.895 | 0.895 | 81.5 | 81.5 | 30.7 | 30.7 | 389 | 389 |
| 230 | 165.0 | 165.0 | 18.0 | 18.0 | 0.892 | 0.892 | 80.3 | 80.3 | 29.8 | 29.8 | 383 | 383 |
| 240 | 167.5 | 167.5 | 18.1 | 18.1 | 0.887 | 0.887 | 79.2 | 79.2 | 29.0 | 29.0 | 379 | 379 |
| 250 | 170.1 | 170.1 | 18.3 | 18.3 | 0.883 | 0.883 | 79.2 | 79.2 | 28.2 | 28.2 | 398 | 398 |
| 260 | 172.3 | 172.3 | 18.5 | 18.5 | 0.878 | 0.878 | 79.7 | 79.7 | 27.5 | 27.5 | 393 | 393 |
| 270 | 174.2 | 174.2 | 18.6 | 18.6 | 0.875 | 0.875 | 81.0 | 81.0 | 27.1 | 27.1 | 385 | 385 |
| 280 | 175.7 | 175.7 | 18.8 | 18.8 | 0.869 | 0.869 | 80.7 | 80.7 | 26.5 | 26.5 | 383 | 383 |
| 290 | 176.7 | 176.7 | 19.0 | 19.0 | 0.861 | 0.861 | 80.0 | 80.0 | 25.8 | 25.8 | 398 | 398 |
| 300 | 177.0 | 177.0 | 19.1 | 19.1 | 0.855 | 0.855 | 78.6 | 78.6 | 24.9 | 24.9 | 417 | 417 |
| 310 | 177.2 | 177.2 | 19.4 | 19.4 | 0.849 | 0.849 | 78.3 | 78.3 | 24.2 | 24.2 | 417 | 417 |
| 320 | 177.2 | 177.2 | 19.5 | 19.5 | 0.839 | 0.839 | 79.5 | 79.5 | 23.5 | 23.5 | 432 | 432 |
| 330 | 177.2 | 177.2 | 19.6 | 19.6 | 0.836 | 0.836 | 79.7 | 79.7 | 23.0 | 23.0 | 459 | 459 |
| 340 | 177.2 | 177.2 | 19.6 | 19.6 | 0.834 | 0.834 | 78.2 | 78.2 | 22.4 | 22.4 | 455 | 455 |

Rule: In the `affected-side-early` Scenario, the tension pneumothorax counts as developing when at one or more Mark_Samples after the insult's `timeSeconds`, at least one vital sign with Case thresholds has an Alarm_State more severe (`normal < warning < critical`) than its Alarm_State at the last Mark_Sample at or before `timeSeconds`.

The tension pneumothorax still develops after the early Decompression: yes, first at 80 s (tidalVolume)

The early Scenario's Ending is not evidence for play-mode open question 1, item d.

## Variant `right` (Affected_Side: Right)

### Play_Section values used

| Item | Value |
| --- | --- |
| Rescue_Conditions | spO2 >= 0.95; heartRate <= 110 |
| Rescue Hold_Duration | 30 s |
| Lost_Condition group 1 | spO2 < 0.85 |
| Lost_Condition group 1 Hold_Duration | 30 s |
| Time_Limit | 600 s |
| Required_Interventions | needle-decompression-right |

### Calibration_Checks

| Check | Scenario | Result | Basis |
| --- | --- | --- | --- |
| affected-side-rescued | `right` / affected-side | pass | rescued at 230 s; gate 150 s + hold 30 s = 180 s ≤ 230 s ≤ 300 s |
| other-side-only-lost | `right` / other-side-only | pass | lost at 360 s (cause: Lost_Condition group 1); 360 s ≤ limit 600 s (Time_Limit); gate closed; rescue held without the gate at: 0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100 s; answers open question 1, item c |
| no-intervention-lost | `right` / no-intervention | pass | lost at 360 s (cause: Lost_Condition group 1); 360 s ≤ limit 600 s (Time_Limit); gate closed; rescue held without the gate at: 0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100 s |

### Scenario `right` / no-intervention

Interventions: none

Rescue_Gate_Time: closed

Ending: lost at 360 s (cause: Lost_Condition group 1)

#### Vital signs

| Time (s) | Substituted | heartRate | spO2 | Overall_Status | Ending |
| --- | --- | --- | --- | --- | --- |
| 0 | no | 72.0 | 0.974 | normal | none |
| 10 | no | 72.0 | 0.974 | normal | none |
| 20 | no | 72.0 | 0.974 | normal | none |
| 30 | no | 72.0 | 0.974 | normal | none |
| 40 | no | 72.1 | 0.975 | normal | none |
| 50 | no | 73.3 | 0.975 | normal | none |
| 60 | no | 76.8 | 0.975 | normal | none |
| 70 | no | 82.1 | 0.973 | normal | none |
| 80 | no | 88.7 | 0.970 | warning | none |
| 90 | no | 93.7 | 0.964 | warning | none |
| 100 | no | 96.9 | 0.957 | warning | none |
| 110 | no | 99.5 | 0.949 | warning | none |
| 120 | no | 103.1 | 0.940 | warning | none |
| 130 | no | 108.9 | 0.932 | warning | none |
| 140 | no | 116.4 | 0.925 | warning | none |
| 150 | no | 125.6 | 0.919 | warning | none |
| 160 | no | 133.8 | 0.914 | warning | none |
| 170 | no | 140.9 | 0.911 | critical | none |
| 180 | no | 146.5 | 0.907 | critical | none |
| 190 | no | 150.9 | 0.904 | critical | none |
| 200 | no | 154.5 | 0.901 | critical | none |
| 210 | no | 157.5 | 0.899 | critical | none |
| 220 | no | 160.1 | 0.896 | critical | none |
| 230 | no | 162.5 | 0.893 | critical | none |
| 240 | no | 165.0 | 0.889 | critical | none |
| 250 | no | 167.3 | 0.885 | critical | none |
| 260 | no | 169.5 | 0.881 | critical | none |
| 270 | no | 171.4 | 0.877 | critical | none |
| 280 | no | 173.0 | 0.873 | critical | none |
| 290 | no | 174.2 | 0.870 | critical | none |
| 300 | no | 175.1 | 0.868 | critical | none |
| 310 | no | 175.9 | 0.865 | critical | none |
| 320 | no | 176.6 | 0.860 | critical | none |
| 330 | no | 177.0 | 0.850 | critical | none |
| 340 | no | 177.1 | 0.839 | critical | none |
| 350 | no | 177.2 | 0.837 | critical | none |
| 360 | no | 177.2 | 0.833 | critical | lost |

#### Vital_Bands at Simulation_Time 0

| Vital | Alarm_State | Direction |
| --- | --- | --- |
| heartRate | normal | none |
| respiratoryRate | normal | none |
| spO2 | normal | none |
| meanArterialPressure | normal | none |
| etCO2 | normal | none |
| tidalVolume | normal | none |

#### Status_Rules

| Rule | Sentence | Matched at (s) | Returned at (s) |
| --- | --- | --- | --- |
| play.status.rules[0] | His lips are turning blue and he is fighting for breath. | 270, 280, 290, 300, 310, 320, 330, 340, 350, 360 | 270, 280, 290, 300, 310, 320, 330, 340, 350, 360 |
| play.status.rules[1] | He looks pale and is struggling to breathe. | 110, 120, 130, 140, 150, 160, 170, 180, 190, 200, 210, 220, 230, 240, 250, 260 | 110, 120, 130, 140, 150, 160, 170, 180, 190, 200, 210, 220, 230, 240, 250, 260 |
| play.status.rules[2] | His heart is racing and he looks frightened. | 170, 180, 190, 200, 210, 220, 230, 240, 250, 260, 270, 280, 290, 300, 310, 320, 330, 340, 350, 360 | never |
| play.status.rules[3] | His heart is beating fast and he looks uneasy. | 120, 130, 140, 150, 160 | never |

#### Speech

| Time (s) | Speech_Key | Line |
| --- | --- | --- |
| 0 | silent | silent |
| 30 | early | I... can't... get a breath in. My chest- |
| 60 | early | It hurts... when I try to breathe in. |
| 90 | early | I... can't... get a breath in. My chest- |
| 110 | play.status.rules[1] | It's getting worse... I can't catch my breath. |
| 140 | play.status.rules[1] | Why can't I breathe properly? |
| 170 | play.status.rules[1] | It's getting worse... I can't catch my breath. |
| 200 | play.status.rules[1] | Why can't I breathe properly? |
| 230 | play.status.rules[1] | It's getting worse... I can't catch my breath. |
| 260 | play.status.rules[1] | Why can't I breathe properly? |
| 270 | play.status.rules[0] | Can't... breathe... |
| 300 | play.status.rules[0] | Help... me... |
| 330 | play.status.rules[0] | Can't... breathe... |
| 360 | silent | silent |

Speech lines are computed on the Mark_Samples; the Web_App computes them on every received sample, so its line changes can come up to one Sample_Interval earlier or later.

#### Exam_Findings

| Exam_Button | Side | First Abnormal_Finding (s) |
| --- | --- | --- |
| look-chest | n/a | 30 |
| listen | other side | never |
| listen | affected side | 30 |
| windpipe | n/a | 270 |
| neck-veins | n/a | 30 |

| Time (s) | look-chest | listen (other side) | listen (affected side) | windpipe | neck-veins |
| --- | --- | --- | --- | --- | --- |
| 0 | Both sides of his chest rise and fall evenly. | You hear clear breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | His neck veins look normal. |
| 10 | Both sides of his chest rise and fall evenly. | You hear clear breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | His neck veins look normal. |
| 20 | Both sides of his chest rise and fall evenly. | You hear clear breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | His neck veins look normal. |
| 30 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 40 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 50 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 60 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 70 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 80 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 90 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 100 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 110 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 120 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 130 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 140 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 150 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 160 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 170 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 180 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 190 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 200 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 210 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 220 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 230 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 240 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 250 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 260 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 270 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 280 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 290 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 300 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 310 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 320 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 330 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 340 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 350 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 360 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |

### Scenario `right` / affected-side

Interventions:

| Intervention | Side | Requested_Time (s) | Actual_Time (s) | Late |
| --- | --- | --- | --- | --- |
| needle-decompression-right | affected side | 150 | 150 | no |

Rescue_Gate_Time: 150 s

Ending: rescued at 230 s

#### Vital signs

| Time (s) | Substituted | heartRate | spO2 | Overall_Status | Ending |
| --- | --- | --- | --- | --- | --- |
| 0 | no | 72.0 | 0.974 | normal | none |
| 10 | no | 72.0 | 0.974 | normal | none |
| 20 | no | 72.0 | 0.974 | normal | none |
| 30 | no | 72.0 | 0.974 | normal | none |
| 40 | no | 72.1 | 0.975 | normal | none |
| 50 | no | 73.3 | 0.975 | normal | none |
| 60 | no | 76.8 | 0.975 | normal | none |
| 70 | no | 82.1 | 0.973 | normal | none |
| 80 | no | 88.7 | 0.970 | warning | none |
| 90 | no | 93.7 | 0.964 | warning | none |
| 100 | no | 96.9 | 0.957 | warning | none |
| 110 | no | 99.5 | 0.949 | warning | none |
| 120 | no | 103.1 | 0.940 | warning | none |
| 130 | no | 108.9 | 0.932 | warning | none |
| 140 | no | 116.4 | 0.925 | warning | none |
| 150 | no | 125.6 | 0.919 | warning | none |
| 160 | no | 132.9 | 0.919 | warning | none |
| 170 | no | 131.8 | 0.929 | warning | none |
| 180 | no | 122.9 | 0.945 | warning | none |
| 190 | no | 113.2 | 0.957 | warning | none |
| 200 | no | 107.0 | 0.962 | warning | none |
| 210 | no | 103.3 | 0.964 | warning | none |
| 220 | no | 99.9 | 0.965 | warning | none |
| 230 | no | 97.7 | 0.965 | warning | rescued |

#### Vital_Bands at Simulation_Time 0

| Vital | Alarm_State | Direction |
| --- | --- | --- |
| heartRate | normal | none |
| respiratoryRate | normal | none |
| spO2 | normal | none |
| meanArterialPressure | normal | none |
| etCO2 | normal | none |
| tidalVolume | normal | none |

#### Status_Rules

| Rule | Sentence | Matched at (s) | Returned at (s) |
| --- | --- | --- | --- |
| play.status.rules[1] | He looks pale and is struggling to breathe. | 110, 120, 130, 140, 150, 160, 170, 180 | 110, 120, 130, 140, 150, 160, 170, 180 |
| play.status.rules[3] | His heart is beating fast and he looks uneasy. | 120, 130, 140, 150, 160, 170, 180, 190, 200, 210 | 190, 200, 210 |

#### Speech

| Time (s) | Speech_Key | Line |
| --- | --- | --- |
| 0 | silent | silent |
| 30 | early | I... can't... get a breath in. My chest- |
| 60 | early | It hurts... when I try to breathe in. |
| 90 | early | I... can't... get a breath in. My chest- |
| 110 | play.status.rules[1] | It's getting worse... I can't catch my breath. |
| 140 | play.status.rules[1] | Why can't I breathe properly? |
| 170 | play.status.rules[1] | It's getting worse... I can't catch my breath. |
| 190 | play.status.rules[3] | My heart's racing. What's happening to me? |
| 220 | silent | silent |
| 230 | rescued | Oh... I can breathe again. Thank you. |

Speech lines are computed on the Mark_Samples; the Web_App computes them on every received sample, so its line changes can come up to one Sample_Interval earlier or later.

#### Exam_Findings

| Exam_Button | Side | First Abnormal_Finding (s) |
| --- | --- | --- |
| look-chest | n/a | 30 |
| listen | other side | never |
| listen | affected side | 30 |
| windpipe | n/a | never |
| neck-veins | n/a | 30 |

| Time (s) | look-chest | listen (other side) | listen (affected side) | windpipe | neck-veins |
| --- | --- | --- | --- | --- | --- |
| 0 | Both sides of his chest rise and fall evenly. | You hear clear breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | His neck veins look normal. |
| 10 | Both sides of his chest rise and fall evenly. | You hear clear breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | His neck veins look normal. |
| 20 | Both sides of his chest rise and fall evenly. | You hear clear breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | His neck veins look normal. |
| 30 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 40 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 50 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 60 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 70 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 80 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 90 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 100 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 110 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 120 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 130 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 140 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 150 | Both sides of his chest rise and fall evenly. | You hear clear breathing on this side. | Breathing sounds are coming back on this side. | His windpipe is in the middle of his neck. | His neck veins look normal. |
| 160 | Both sides of his chest rise and fall evenly. | You hear clear breathing on this side. | Breathing sounds are coming back on this side. | His windpipe is in the middle of his neck. | His neck veins look normal. |
| 170 | Both sides of his chest rise and fall evenly. | You hear clear breathing on this side. | Breathing sounds are coming back on this side. | His windpipe is in the middle of his neck. | His neck veins look normal. |
| 180 | Both sides of his chest rise and fall evenly. | You hear clear breathing on this side. | Breathing sounds are coming back on this side. | His windpipe is in the middle of his neck. | His neck veins look normal. |
| 190 | Both sides of his chest rise and fall evenly. | You hear clear breathing on this side. | Breathing sounds are coming back on this side. | His windpipe is in the middle of his neck. | His neck veins look normal. |
| 200 | Both sides of his chest rise and fall evenly. | You hear clear breathing on this side. | Breathing sounds are coming back on this side. | His windpipe is in the middle of his neck. | His neck veins look normal. |
| 210 | Both sides of his chest rise and fall evenly. | You hear clear breathing on this side. | Breathing sounds are coming back on this side. | His windpipe is in the middle of his neck. | His neck veins look normal. |
| 220 | Both sides of his chest rise and fall evenly. | You hear clear breathing on this side. | Breathing sounds are coming back on this side. | His windpipe is in the middle of his neck. | His neck veins look normal. |
| 230 | Both sides of his chest rise and fall evenly. | You hear clear breathing on this side. | Breathing sounds are coming back on this side. | His windpipe is in the middle of his neck. | His neck veins look normal. |

### Scenario `right` / other-side-only

Interventions:

| Intervention | Side | Requested_Time (s) | Actual_Time (s) | Late |
| --- | --- | --- | --- | --- |
| needle-decompression-left | other side | 150 | 150 | no |

Rescue_Gate_Time: closed

Ending: lost at 360 s (cause: Lost_Condition group 1)

#### Vital signs

| Time (s) | Substituted | heartRate | spO2 | Overall_Status | Ending |
| --- | --- | --- | --- | --- | --- |
| 0 | no | 72.0 | 0.974 | normal | none |
| 10 | no | 72.0 | 0.974 | normal | none |
| 20 | no | 72.0 | 0.974 | normal | none |
| 30 | no | 72.0 | 0.974 | normal | none |
| 40 | no | 72.1 | 0.975 | normal | none |
| 50 | no | 73.3 | 0.975 | normal | none |
| 60 | no | 76.8 | 0.975 | normal | none |
| 70 | no | 82.1 | 0.973 | normal | none |
| 80 | no | 88.7 | 0.970 | warning | none |
| 90 | no | 93.7 | 0.964 | warning | none |
| 100 | no | 96.9 | 0.957 | warning | none |
| 110 | no | 99.5 | 0.949 | warning | none |
| 120 | no | 103.1 | 0.940 | warning | none |
| 130 | no | 108.9 | 0.932 | warning | none |
| 140 | no | 116.4 | 0.925 | warning | none |
| 150 | no | 125.6 | 0.919 | warning | none |
| 160 | no | 133.8 | 0.914 | warning | none |
| 170 | no | 140.9 | 0.911 | critical | none |
| 180 | no | 146.5 | 0.907 | critical | none |
| 190 | no | 150.9 | 0.904 | critical | none |
| 200 | no | 154.5 | 0.901 | critical | none |
| 210 | no | 157.5 | 0.899 | critical | none |
| 220 | no | 160.1 | 0.896 | critical | none |
| 230 | no | 162.5 | 0.893 | critical | none |
| 240 | no | 165.0 | 0.889 | critical | none |
| 250 | no | 167.3 | 0.885 | critical | none |
| 260 | no | 169.5 | 0.881 | critical | none |
| 270 | no | 171.4 | 0.877 | critical | none |
| 280 | no | 173.0 | 0.873 | critical | none |
| 290 | no | 174.2 | 0.870 | critical | none |
| 300 | no | 175.1 | 0.868 | critical | none |
| 310 | no | 175.9 | 0.865 | critical | none |
| 320 | no | 176.6 | 0.860 | critical | none |
| 330 | no | 177.0 | 0.850 | critical | none |
| 340 | no | 177.1 | 0.839 | critical | none |
| 350 | no | 177.2 | 0.837 | critical | none |
| 360 | no | 177.2 | 0.833 | critical | lost |

#### Vital_Bands at Simulation_Time 0

| Vital | Alarm_State | Direction |
| --- | --- | --- |
| heartRate | normal | none |
| respiratoryRate | normal | none |
| spO2 | normal | none |
| meanArterialPressure | normal | none |
| etCO2 | normal | none |
| tidalVolume | normal | none |

#### Status_Rules

| Rule | Sentence | Matched at (s) | Returned at (s) |
| --- | --- | --- | --- |
| play.status.rules[0] | His lips are turning blue and he is fighting for breath. | 270, 280, 290, 300, 310, 320, 330, 340, 350, 360 | 270, 280, 290, 300, 310, 320, 330, 340, 350, 360 |
| play.status.rules[1] | He looks pale and is struggling to breathe. | 110, 120, 130, 140, 150, 160, 170, 180, 190, 200, 210, 220, 230, 240, 250, 260 | 110, 120, 130, 140, 150, 160, 170, 180, 190, 200, 210, 220, 230, 240, 250, 260 |
| play.status.rules[2] | His heart is racing and he looks frightened. | 170, 180, 190, 200, 210, 220, 230, 240, 250, 260, 270, 280, 290, 300, 310, 320, 330, 340, 350, 360 | never |
| play.status.rules[3] | His heart is beating fast and he looks uneasy. | 120, 130, 140, 150, 160 | never |

#### Speech

| Time (s) | Speech_Key | Line |
| --- | --- | --- |
| 0 | silent | silent |
| 30 | early | I... can't... get a breath in. My chest- |
| 60 | early | It hurts... when I try to breathe in. |
| 90 | early | I... can't... get a breath in. My chest- |
| 110 | play.status.rules[1] | It's getting worse... I can't catch my breath. |
| 140 | play.status.rules[1] | Why can't I breathe properly? |
| 170 | play.status.rules[1] | It's getting worse... I can't catch my breath. |
| 200 | play.status.rules[1] | Why can't I breathe properly? |
| 230 | play.status.rules[1] | It's getting worse... I can't catch my breath. |
| 260 | play.status.rules[1] | Why can't I breathe properly? |
| 270 | play.status.rules[0] | Can't... breathe... |
| 300 | play.status.rules[0] | Help... me... |
| 330 | play.status.rules[0] | Can't... breathe... |
| 360 | silent | silent |

Speech lines are computed on the Mark_Samples; the Web_App computes them on every received sample, so its line changes can come up to one Sample_Interval earlier or later.

#### Exam_Findings

| Exam_Button | Side | First Abnormal_Finding (s) |
| --- | --- | --- |
| look-chest | n/a | 30 |
| listen | other side | never |
| listen | affected side | 30 |
| windpipe | n/a | 270 |
| neck-veins | n/a | 30 |

| Time (s) | look-chest | listen (other side) | listen (affected side) | windpipe | neck-veins |
| --- | --- | --- | --- | --- | --- |
| 0 | Both sides of his chest rise and fall evenly. | You hear clear breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | His neck veins look normal. |
| 10 | Both sides of his chest rise and fall evenly. | You hear clear breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | His neck veins look normal. |
| 20 | Both sides of his chest rise and fall evenly. | You hear clear breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | His neck veins look normal. |
| 30 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 40 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 50 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 60 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 70 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 80 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 90 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 100 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 110 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 120 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 130 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 140 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 150 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 160 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 170 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 180 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 190 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 200 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 210 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 220 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 230 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 240 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 250 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 260 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 270 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 280 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 290 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 300 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 310 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 320 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 330 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 340 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 350 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 360 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |

### Scenario `right` / affected-side-early

Interventions:

| Intervention | Side | Requested_Time (s) | Actual_Time (s) | Late |
| --- | --- | --- | --- | --- |
| needle-decompression-right | affected side | 20 | 20 | no |

Rescue_Gate_Time: closed

Ending: lost at 360 s (cause: Lost_Condition group 1)

#### Vital signs

| Time (s) | Substituted | heartRate | spO2 | Overall_Status | Ending |
| --- | --- | --- | --- | --- | --- |
| 0 | no | 72.0 | 0.974 | normal | none |
| 10 | no | 72.0 | 0.974 | normal | none |
| 20 | no | 72.0 | 0.974 | normal | none |
| 30 | no | 72.0 | 0.974 | normal | none |
| 40 | no | 72.1 | 0.975 | normal | none |
| 50 | no | 73.3 | 0.975 | normal | none |
| 60 | no | 76.8 | 0.975 | normal | none |
| 70 | no | 82.1 | 0.973 | normal | none |
| 80 | no | 88.7 | 0.970 | warning | none |
| 90 | no | 93.7 | 0.964 | warning | none |
| 100 | no | 96.9 | 0.957 | warning | none |
| 110 | no | 99.5 | 0.949 | warning | none |
| 120 | no | 103.1 | 0.940 | warning | none |
| 130 | no | 108.9 | 0.932 | warning | none |
| 140 | no | 116.4 | 0.925 | warning | none |
| 150 | no | 125.6 | 0.919 | warning | none |
| 160 | no | 133.8 | 0.914 | warning | none |
| 170 | no | 140.9 | 0.911 | critical | none |
| 180 | no | 146.5 | 0.907 | critical | none |
| 190 | no | 150.9 | 0.904 | critical | none |
| 200 | no | 154.5 | 0.901 | critical | none |
| 210 | no | 157.5 | 0.899 | critical | none |
| 220 | no | 160.1 | 0.896 | critical | none |
| 230 | no | 162.5 | 0.893 | critical | none |
| 240 | no | 165.0 | 0.889 | critical | none |
| 250 | no | 167.3 | 0.885 | critical | none |
| 260 | no | 169.5 | 0.881 | critical | none |
| 270 | no | 171.4 | 0.877 | critical | none |
| 280 | no | 173.0 | 0.873 | critical | none |
| 290 | no | 174.2 | 0.870 | critical | none |
| 300 | no | 175.1 | 0.868 | critical | none |
| 310 | no | 175.9 | 0.865 | critical | none |
| 320 | no | 176.6 | 0.860 | critical | none |
| 330 | no | 177.0 | 0.850 | critical | none |
| 340 | no | 177.1 | 0.839 | critical | none |
| 350 | no | 177.2 | 0.837 | critical | none |
| 360 | no | 177.2 | 0.833 | critical | lost |
| 370 | no | 177.2 | 0.826 | critical | lost |
| 380 | no | 177.2 | 0.823 | critical | lost |
| 390 | no | 177.2 | 0.821 | critical | lost |
| 400 | no | 177.2 | 0.814 | critical | lost |
| 410 | no | 177.2 | 0.794 | critical | lost |
| 420 | no | 177.2 | 0.794 | critical | lost |
| 430 | no | 177.2 | 0.780 | critical | lost |
| 440 | no | 177.2 | 0.762 | critical | lost |
| 450 | no | 177.2 | 0.764 | critical | lost |
| 460 | no | 177.2 | 0.764 | critical | lost |
| 470 | no | 177.2 | 0.763 | critical | lost |
| 480 | no | 177.2 | 0.737 | critical | lost |
| 490 | no | 177.2 | 0.722 | critical | lost |
| 500 | no | 177.2 | 0.713 | critical | lost |
| 510 | no | 177.2 | 0.708 | critical | lost |
| 520 | no | 177.2 | 0.712 | critical | lost |
| 530 | no | 177.2 | 0.702 | critical | lost |
| 540 | no | 177.2 | 0.696 | critical | lost |
| 550 | no | 177.2 | 0.701 | critical | lost |
| 560 | no | 177.2 | 0.681 | critical | lost |
| 570 | no | 177.2 | 0.681 | critical | lost |
| 580 | no | 177.2 | 0.698 | critical | lost |
| 590 | no | 177.2 | 0.669 | critical | lost |
| 600 | no | 177.2 | 0.660 | critical | lost |

#### Vital_Bands at Simulation_Time 0

| Vital | Alarm_State | Direction |
| --- | --- | --- |
| heartRate | normal | none |
| respiratoryRate | normal | none |
| spO2 | normal | none |
| meanArterialPressure | normal | none |
| etCO2 | normal | none |
| tidalVolume | normal | none |

#### Status_Rules

| Rule | Sentence | Matched at (s) | Returned at (s) |
| --- | --- | --- | --- |
| play.status.rules[0] | His lips are turning blue and he is fighting for breath. | 270, 280, 290, 300, 310, 320, 330, 340, 350, 360, 370, 380, 390, 400, 410, 420, 430, 440, 450, 460, 470, 480, 490, 500, 510, 520, 530, 540, 550, 560, 570, 580, 590, 600 | 270, 280, 290, 300, 310, 320, 330, 340, 350, 360, 370, 380, 390, 400, 410, 420, 430, 440, 450, 460, 470, 480, 490, 500, 510, 520, 530, 540, 550, 560, 570, 580, 590, 600 |
| play.status.rules[1] | He looks pale and is struggling to breathe. | 110, 120, 130, 140, 150, 160, 170, 180, 190, 200, 210, 220, 230, 240, 250, 260 | 110, 120, 130, 140, 150, 160, 170, 180, 190, 200, 210, 220, 230, 240, 250, 260 |
| play.status.rules[2] | His heart is racing and he looks frightened. | 170, 180, 190, 200, 210, 220, 230, 240, 250, 260, 270, 280, 290, 300, 310, 320, 330, 340, 350, 360, 370, 380, 390, 400, 410, 420, 430, 440, 450, 460, 470, 480, 490, 500, 510, 520, 530, 540, 550, 560, 570, 580, 590, 600 | never |
| play.status.rules[3] | His heart is beating fast and he looks uneasy. | 120, 130, 140, 150, 160 | never |
| play.status.rules[4] | He is breathing faster than normal. | 450, 460, 470, 480, 490, 500, 510, 520, 530, 540, 550, 560, 570, 580, 590, 600 | never |

#### Speech

| Time (s) | Speech_Key | Line |
| --- | --- | --- |
| 0 | silent | silent |
| 30 | early | I... can't... get a breath in. My chest- |
| 60 | early | It hurts... when I try to breathe in. |
| 90 | early | I... can't... get a breath in. My chest- |
| 110 | play.status.rules[1] | It's getting worse... I can't catch my breath. |
| 140 | play.status.rules[1] | Why can't I breathe properly? |
| 170 | play.status.rules[1] | It's getting worse... I can't catch my breath. |
| 200 | play.status.rules[1] | Why can't I breathe properly? |
| 230 | play.status.rules[1] | It's getting worse... I can't catch my breath. |
| 260 | play.status.rules[1] | Why can't I breathe properly? |
| 270 | play.status.rules[0] | Can't... breathe... |
| 300 | play.status.rules[0] | Help... me... |
| 330 | play.status.rules[0] | Can't... breathe... |
| 360 | silent | silent |

Speech lines are computed on the Mark_Samples; the Web_App computes them on every received sample, so its line changes can come up to one Sample_Interval earlier or later.

#### Exam_Findings

| Exam_Button | Side | First Abnormal_Finding (s) |
| --- | --- | --- |
| look-chest | n/a | 30 |
| listen | other side | never |
| listen | affected side | 30 |
| windpipe | n/a | 270 |
| neck-veins | n/a | 30 |

| Time (s) | look-chest | listen (other side) | listen (affected side) | windpipe | neck-veins |
| --- | --- | --- | --- | --- | --- |
| 0 | Both sides of his chest rise and fall evenly. | You hear clear breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | His neck veins look normal. |
| 10 | Both sides of his chest rise and fall evenly. | You hear clear breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | His neck veins look normal. |
| 20 | Both sides of his chest rise and fall evenly. | You hear clear breathing on this side. | You hear clear breathing on this side. | His windpipe is in the middle of his neck. | His neck veins look normal. |
| 30 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 40 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 50 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 60 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 70 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 80 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 90 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 100 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 110 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 120 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 130 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 140 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 150 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 160 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 170 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 180 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 190 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 200 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 210 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 220 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 230 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 240 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 250 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 260 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | His windpipe is in the middle of his neck. | **abnormal:** The veins in his neck are bulging. |
| 270 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 280 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 290 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 300 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 310 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 320 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 330 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 340 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 350 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 360 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 370 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 380 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 390 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 400 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 410 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 420 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 430 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 440 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 450 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 460 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 470 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 480 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 490 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 500 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 510 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 520 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 530 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 540 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 550 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 560 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 570 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 580 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 590 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |
| 600 | **abnormal:** One side of his chest hardly moves when he breathes. | You hear clear breathing on this side. | **abnormal:** You can barely hear any breathing on this side. | **abnormal:** His windpipe feels pushed off to one side. | **abnormal:** The veins in his neck are bulging. |

### Early Decompression compared with no intervention

| Time (s) | heartRate early | heartRate none | respiratoryRate early | respiratoryRate none | spO2 early | spO2 none | meanArterialPressure early | meanArterialPressure none | etCO2 early | etCO2 none | tidalVolume early | tidalVolume none |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 40 | 72.1 | 72.1 | 12.0 | 12.0 | 0.975 | 0.975 | 94.9 | 94.9 | 35.0 | 35.0 | 563 | 563 |
| 50 | 73.3 | 73.3 | 12.0 | 12.0 | 0.975 | 0.975 | 93.9 | 93.9 | 34.6 | 34.6 | 536 | 536 |
| 60 | 76.8 | 76.8 | 12.0 | 12.0 | 0.975 | 0.975 | 93.8 | 93.8 | 34.5 | 34.5 | 496 | 496 |
| 70 | 82.1 | 82.1 | 12.0 | 12.0 | 0.973 | 0.973 | 93.2 | 93.2 | 34.6 | 34.6 | 474 | 474 |
| 80 | 88.7 | 88.7 | 12.0 | 12.0 | 0.970 | 0.970 | 93.0 | 93.0 | 34.9 | 34.9 | 427 | 427 |
| 90 | 93.7 | 93.7 | 12.0 | 12.0 | 0.964 | 0.964 | 91.2 | 91.2 | 35.2 | 35.2 | 382 | 382 |
| 100 | 96.9 | 96.9 | 10.9 | 10.9 | 0.957 | 0.957 | 89.2 | 89.2 | 35.3 | 35.3 | 334 | 334 |
| 110 | 99.5 | 99.5 | 12.8 | 12.8 | 0.949 | 0.949 | 88.0 | 88.0 | 35.4 | 35.4 | 323 | 323 |
| 120 | 103.1 | 103.1 | 13.3 | 13.3 | 0.940 | 0.940 | 87.4 | 87.4 | 35.8 | 35.8 | 313 | 313 |
| 130 | 108.9 | 108.9 | 13.8 | 13.8 | 0.932 | 0.932 | 86.3 | 86.3 | 36.0 | 36.0 | 312 | 312 |
| 140 | 116.4 | 116.4 | 14.3 | 14.3 | 0.925 | 0.925 | 85.9 | 85.9 | 36.3 | 36.3 | 312 | 312 |
| 150 | 125.6 | 125.6 | 15.0 | 15.0 | 0.919 | 0.919 | 86.0 | 86.0 | 36.2 | 36.2 | 319 | 319 |
| 160 | 133.8 | 133.8 | 15.6 | 15.6 | 0.914 | 0.914 | 84.5 | 84.5 | 35.8 | 35.8 | 337 | 337 |
| 170 | 140.9 | 140.9 | 16.0 | 16.0 | 0.911 | 0.911 | 84.2 | 84.2 | 35.3 | 35.3 | 340 | 340 |
| 180 | 146.5 | 146.5 | 16.5 | 16.5 | 0.907 | 0.907 | 83.5 | 83.5 | 34.3 | 34.3 | 355 | 355 |
| 190 | 150.9 | 150.9 | 16.9 | 16.9 | 0.904 | 0.904 | 83.0 | 83.0 | 33.3 | 33.3 | 364 | 364 |
| 200 | 154.5 | 154.5 | 17.2 | 17.2 | 0.901 | 0.901 | 81.8 | 81.8 | 32.2 | 32.2 | 381 | 381 |
| 210 | 157.5 | 157.5 | 17.4 | 17.4 | 0.899 | 0.899 | 80.6 | 80.6 | 31.0 | 31.0 | 386 | 386 |
| 220 | 160.1 | 160.1 | 17.8 | 17.8 | 0.896 | 0.896 | 79.8 | 79.8 | 30.0 | 30.0 | 384 | 384 |
| 230 | 162.5 | 162.5 | 17.9 | 17.9 | 0.893 | 0.893 | 79.9 | 79.9 | 29.0 | 29.0 | 382 | 382 |
| 240 | 165.0 | 165.0 | 18.1 | 18.1 | 0.889 | 0.889 | 78.6 | 78.6 | 28.1 | 28.1 | 387 | 387 |
| 250 | 167.3 | 167.3 | 18.3 | 18.3 | 0.885 | 0.885 | 77.9 | 77.9 | 27.3 | 27.3 | 396 | 396 |
| 260 | 169.5 | 169.5 | 18.4 | 18.4 | 0.881 | 0.881 | 77.8 | 77.8 | 26.6 | 26.6 | 401 | 401 |
| 270 | 171.4 | 171.4 | 18.6 | 18.6 | 0.877 | 0.877 | 77.5 | 77.5 | 25.9 | 25.9 | 417 | 417 |
| 280 | 173.0 | 173.0 | 18.8 | 18.8 | 0.873 | 0.873 | 79.6 | 79.6 | 25.5 | 25.5 | 415 | 415 |
| 290 | 174.2 | 174.2 | 18.9 | 18.9 | 0.870 | 0.870 | 80.3 | 80.3 | 25.0 | 25.0 | 423 | 423 |
| 300 | 175.1 | 175.1 | 19.0 | 19.0 | 0.868 | 0.868 | 80.1 | 80.1 | 24.5 | 24.5 | 438 | 438 |
| 310 | 175.9 | 175.9 | 19.1 | 19.1 | 0.865 | 0.865 | 78.6 | 78.6 | 24.0 | 24.0 | 433 | 433 |
| 320 | 176.6 | 176.6 | 19.2 | 19.2 | 0.860 | 0.860 | 77.9 | 77.9 | 23.3 | 23.3 | 420 | 420 |
| 330 | 177.0 | 177.0 | 19.4 | 19.4 | 0.850 | 0.850 | 78.2 | 78.2 | 22.7 | 22.7 | 423 | 423 |
| 340 | 177.1 | 177.1 | 19.5 | 19.5 | 0.839 | 0.839 | 79.3 | 79.3 | 22.2 | 22.2 | 447 | 447 |
| 350 | 177.2 | 177.2 | 19.6 | 19.6 | 0.837 | 0.837 | 78.3 | 78.3 | 21.7 | 21.7 | 471 | 471 |
| 360 | 177.2 | 177.2 | 19.7 | 19.7 | 0.833 | 0.833 | 77.2 | 77.2 | 20.9 | 20.9 | 463 | 463 |

Rule: In the `affected-side-early` Scenario, the tension pneumothorax counts as developing when at one or more Mark_Samples after the insult's `timeSeconds`, at least one vital sign with Case thresholds has an Alarm_State more severe (`normal < warning < critical`) than its Alarm_State at the last Mark_Sample at or before `timeSeconds`.

The tension pneumothorax still develops after the early Decompression: yes, first at 80 s (tidalVolume)

The early Scenario's Ending is not evidence for play-mode open question 1, item d.

## Difference between Variants `left` and `right`

| Scenario_Kind | heart_rate | respiratory_rate | spo2 | mean_arterial_pressure | systolic_pressure | diastolic_pressure | etco2 | tidal_volume |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| no-intervention | 3.7 | 0.3 | 0.022 | 3.4 | 3.4 | 3.0 | 1.2 | 38 |
| affected-side | 2.3 | 0.3 | 0.009 | 1.3 | 1.0 | 1.5 | 0.6 | 38 |
| other-side-only | 3.7 | 0.3 | 0.022 | 3.4 | 3.4 | 3.0 | 1.2 | 38 |
| affected-side-early | 3.7 | 0.3 | 0.035 | 3.4 | 3.4 | 3.0 | 1.2 | 77 |
