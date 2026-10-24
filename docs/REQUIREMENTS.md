# FocusGuard requirements and delivery boundaries

The source design is [FocusGuard_Privacy_Aware_Smart_Study_Desk.md](../FocusGuard_Privacy_Aware_Smart_Study_Desk.md). Its examples are project inputs; configurable thresholds in the implementation are engineering defaults, not medical guidance. FocusGuard estimates observable desk conditions. It does not measure mental focus, diagnose posture problems, verify eye health, or provide calibrated sound-pressure measurements.

This repository delivers a software prototype with a deterministic sensor simulator and integration code for the distributed hardware architecture. The simulator makes the full decision flow reviewable without attached devices. It is not evidence of sensor accuracy, Raspberry Pi inference speed, electrical behavior, or a completed physical deployment.

## Traceability

| Source sections | Requirement | Prototype behavior / verification |
|---|---|---|
| 4, 33 | Privacy and edge-first operation | Decisions run locally. Camera integration publishes derived pose metadata; no frame/audio upload is required. The optional cloud summary receives aggregate session statistics. Local summaries and monitoring remain available without cloud credentials. |
| 5–6, 38–41 | Distributed sensors, including I2C | ESP32 Node A measures ToF distance and seat pressure; Node B measures motion and relative noise. Raspberry Pi integration reads BME280 and BH1750. Hardware installation and calibration are required to validate actual readings. |
| 7, 13, 15, 18 | Physical outputs and direct vision effect | Rules set lamp brightness and fan state; temporally sustained posture/distance conditions create warning events and buzzer commands. A simulator command is not physical actuation; the gateway actuator adapter must be connected. |
| 8, 11, 26 | Occupancy and automatic sessions | Multiple presence signals drive present/away/empty states, active versus paused session time, break reminders, and inactivity termination. Stale sensor state must not masquerade as fresh evidence. |
| 9 | Local pose estimation | OpenCV/MediaPipe integration derives posture categories and inference FPS locally. Camera mounting, model assets, visibility thresholds, and personal geometry require calibration. The dashboard's simulated pose is illustrative, not a video stream. |
| 9.5, 17 | Temporal filtering and cooldowns | A single abnormal sample does not trigger a posture warning. Sustained violations create events; cooldowns suppress continuous repetitions. Empty desks, unavailable vision, and unobserved gaps suppress pose-based warnings. |
| 10 | Viewing distance and fusion | ToF threshold monitoring is combined with forward-lean metadata when available. Physical distance is an approximation to viewing distance. |
| 12 | Eye-break assistance | A configurable reminder is based on session duration; the system does not inspect eye health or prove that a person looked away. |
| 13–15 | Environment monitoring | Lux, normalized relative noise, temperature, humidity, and pressure are ingested. Presence gates automatic lamp/fan behavior. Noise is amplitude metadata only. |
| 16 | Study Condition Score | Explainable weighted lighting, noise, thermal, posture, and distance components produce a 0–100 engineering score. Defaults use the source's 15/15/15/30/25 weighting. Missing or unavailable readings must be visibly identified. |
| 19 | Session interpretation | Structured aggregate statistics support an optional external AI summary. Credentials are server-side. Provider failure uses a local explanation and never controls an actuator. |
| 20 | MQTT, at least three topics | Node A, Node B, gateway environment, gateway vision, system event, and actuator topics follow the source naming. The optional broker integration connects real publishers to the same decision engine used by the simulator. |
| 21–22 | Local server and time-series history | FastAPI is the design document's code-first server alternative. SQLite preserves the standalone prototype's timestamped history; the deployment stack supplies Mosquitto, InfluxDB, and Grafana for the course architecture. These external services require separate startup and integration configuration. |
| 23 | Current and historical dashboard | The web dashboard shows desk conditions, occupancy, score, devices, session state, events, and history. Simulated values are labeled. API history/export supports examination outside the interface. |
| 24–25 | Timeline and event heatmap | The web Analytics page uses timestamped telemetry and warning events for its timeline and warning heatmap. Grafana supplies additional current/historical sensor panels. Views are empty until observations are collected. |
| 27, 42–43 | Advanced and stretch scope | Adaptive reminders use an explicit heuristic: when enabled and the current condition score is below 60, the sitting-reminder interval becomes 80% of its configured value. It does not learn a user's habits. Other included features and remaining extensions are documented below. |
| 30–31 | Quantitative and qualitative evaluation | Deterministic tests validate decision behavior. The evaluation tools accept measured posture labels, FPS, ToF errors, and latencies; no hardware performance results are prefilled. The demo includes low-confidence/offline failure cases. |
| 32–33 | Failure handling and deployment security | Camera/broker/AI availability must be visible; core local monitoring remains independent of cloud AI. Keep the development API and broker on a trusted network and configure authentication before a shared deployment. |
| 34, 37, 47–51 | Presentation and success criteria | Demo instructions connect occupancy, sensing, rules, actuation, history, AI, and failure handling. SDG 3/4/9 are intended motivations, not proven health/education outcomes. Market comparison and a recorded project video require the team's own evidence. |

## MQTT contract

| Topic | Allowed content | Owner |
|---|---|---|
| `focusguard/nodeA/user` | `distance_cm`, `seat_pressure`, `seat_occupied` | ESP32 Node A |
| `focusguard/nodeB/environment` | `motion`, `noise_level`, `noise_state` | ESP32 Node B |
| `focusguard/gateway/environment` | `temperature_c`, `humidity_percent`, `pressure_hpa`, `lux` | Raspberry Pi environment reader |
| `focusguard/gateway/vision` | `person_detected`, `posture`, `confidence`, `fps` | Local vision process |
| `focusguard/system/event` | Warning/reminder type, severity, timestamp | Decision engine |
| `focusguard/actuator` | Lamp percentage, fan state, bounded buzzer request | Decision engine / actuator gateway |

Publishers may attach device identity and timestamps as supported by the adapters. Image bytes, video, recordings, and speech transcripts are outside the normal telemetry contract. The receiver uses freshness checks; retaining a previous pose value must not make an offline camera look healthy.

## What must be validated on real hardware

1. Bring up both ESP32 nodes and verify all six sensor types, I2C addresses, supply voltage, ground, and calibration against references.
2. Mount the camera, install the pose model, and label independent examples of all five posture states, including failure cases.
3. Verify that a fresh vision result changes a real output through MQTT. Confirm the buzzer is bounded and the gateway's command-expiry/watchdog prevents an old command remaining active after connection loss. Manual lamp/fan overrides persist until automatic mode is restored or operating mode changes; they do not have an automatic UI timeout.
4. Start the local broker and time-series deployment. Confirm actual Node A, Node B, environment, and vision publishers are logged and visible in Grafana.
5. Measure accuracy/precision/recall/F1 on held-out labels, FPS on the named Pi and camera configuration, distance MAE over repeated reference trials, and end-to-end detection-to-actuation latency. Report trial count, units, setup, and failures.
6. Configure the chosen AI provider and demonstrate a generated summary of aggregate statistics. Disconnect the provider and show monitoring continues.
7. Produce the commercial comparison, SDG discussion, project presentation, and recorded end-to-end demo.

## Optional scope and remaining extensions

The prototype includes fan rules, configurable thresholds, screen/sitting reminders, an explainable score, session history, and summary integration where exposed by its API/UI. These are software features until the relevant device/provider is configured.

The design's face-free identity/card flow, mobile push notifications, advanced learned posture classifier, anomaly detection, multi-desk/multi-user tenancy, OTA ESP32 configuration, and cloud synchronization are future extensions. A configurable threshold is not an automatically learned personalized threshold. The implemented adaptive reminder is the simple score-based rule above; the design's richer long-term behavior adaptation remains an extension. A live aggregate dashboard is not evidence of a medical or productivity benefit.

## Code and verification map

| Concern | Implementation | Behavioral checks |
|---|---|---|
| Rules, occupancy, score, sessions, overrides | [backend/engine.py](../backend/engine.py) | [tests/test_engine.py](../tests/test_engine.py) |
| Durable local readings, sessions, settings, events | [backend/storage.py](../backend/storage.py) | Engine restart/persistence tests and API history/export tests |
| HTTP API, validation, WebSocket, CSV | [backend/main.py](../backend/main.py) | [tests/test_api.py](../tests/test_api.py) |
| MQTT, InfluxDB, AWS Bedrock fallback | [backend/integrations.py](../backend/integrations.py) | [tests/test_integrations.py](../tests/test_integrations.py) checks mode isolation, forwarding, and line protocol; API tests mock the summary boundary. Live services still require deployment checks. |
| User dashboard and simulator controls | [frontend/](../frontend/) | Same-origin HTTP smoke check; interactive review is separate from Python tests |
| ESP32 sensor nodes | [esp32/node_a/](../esp32/node_a/), [esp32/node_b/](../esp32/node_b/) | PlatformIO compilation and physical bring-up required |
| Local pose and actuator guards | [raspberry_pi/](../raspberry_pi/) | [tests/test_gateway.py](../tests/test_gateway.py) checks pure debounce/calibration/expiry logic without importing GPIO or a model |
| Broker, InfluxDB, Grafana deployment | [infrastructure/compose.yaml](../infrastructure/compose.yaml) | Docker startup and live data queries required on the deployment host |
| Accuracy/F1, FPS, distance MAE, latency | [evaluation/](../evaluation/) | [tests/test_evaluation.py](../tests/test_evaluation.py) verifies known metrics, input validation, and synthetic provenance. Real measurements and ground-truth labels remain required. |

Run `python -m unittest discover -s tests -v` after installing the backend dependencies. The tests use an isolated in-memory store, explicit engine timestamps, disabled broker/time-series adapters, and a mocked AWS client. They never operate a physical output or contact an AI service.

## Evidence policy

- Values produced by demo scenarios are synthetic and must remain labeled as such in screenshots or a presentation.
- Passing software tests supports the rules covered by those tests; it does not establish physical performance.
- An integration being supplied in code means it is available to configure, not that an external service or sensor was reached during development.
- Evaluation reports must be computed from supplied observations. Do not invent accuracy, FPS, latency, costs, battery life, or health outcomes.
