# Verification record

Verified on 24 October 2026 in the supplied Windows workspace.

| Check | Result |
|---|---|
| Python behavioral/integration suite | **54 tests passed**, using isolated stores and controlled time |
| Python syntax across backend, Pi adapters, infrastructure and evaluation | Passed |
| Backend dependency compatibility | `pip check` passed |
| PowerShell launcher | Parser validation passed; actual `start.ps1` launch served the app |
| Dashboard and API | HTTP 200 for the app, assets, API docs and CSV export |
| JavaScript | Syntax parsed successfully with Node VM |
| Dashboard rendering | All five pages rendered against live API snapshots for all ten demo scenarios: **50 combinations**, with no rendering exception or invalid numeric output |
| Session persistence and reflection | Actual local HTTP flow ended/saved a simulated session, automatically created a local summary with cloud consent off, then started a new session |
| ESP32 Node A firmware | PlatformIO build succeeded for `esp32dev` |
| ESP32 Node B firmware | PlatformIO build succeeded for `esp32dev` |
| Docker Compose | Base and authenticated configurations validated; backend lock resolved for Linux/Python 3.11 |
| Model asset | Official MediaPipe lite model downloaded and checked against its pinned SHA256 |
| Documentation | Relative links checked; no broken document links |

The rendering check uses an in-memory DOM harness, not a real browser. No connected browser was available in this session, so visual layout, mobile rendering, and browser interactions still need a manual browser pass. The dashboard uses responsive styles and native accessible controls, but that is not evidence of a completed visual review.

The Docker engine was stopped, so containers, live InfluxDB queries, and Grafana runtime were not exercised. MQTT behavior and external AI boundaries were tested with controlled adapters; live service configuration remains necessary.

No physical ESP32, Pi, camera, sensors, or actuators were attached. The compiled firmware is not a claim of successful flashing, electrical behavior, sensor accuracy, camera inference speed, or physical latency. Follow [HARDWARE.md](HARDWARE.md), then collect actual results with [the evaluation protocol](../evaluation/README.md).

Re-run the software suite with:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

The running demo produces clearly labeled synthetic readings. It does not contain claimed hardware benchmark results.
