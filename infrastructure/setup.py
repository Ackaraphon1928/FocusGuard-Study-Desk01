"""Create local random development credentials without printing secret values."""
from __future__ import annotations

import secrets
from pathlib import Path


def main() -> None:
    target = Path(__file__).resolve().parent / ".env"
    if target.exists():
        print(f"Kept existing {target}; no credentials were changed.")
        return
    values = {
        "INFLUX_PASSWORD": secrets.token_urlsafe(24),
        "INFLUX_TOKEN": secrets.token_urlsafe(48),
        "GRAFANA_PASSWORD": secrets.token_urlsafe(24),
        "MQTT_BIND_ADDRESS": "127.0.0.1",
        "API_BIND_ADDRESS": "127.0.0.1",
        "MQTT_USERNAME": "",
        "MQTT_PASSWORD": "",
        "FOCUSGUARD_MODE": "demo",
        "AWS_REGION": "us-east-1",
        "BEDROCK_MODEL_ID": "",
    }
    with target.open("x", encoding="utf-8") as output:
        output.write("# Generated locally. Do not commit. Credentials initialize NEW volumes only.\n")
        output.write("\n".join(f"{key}={value}" for key, value in values.items()) + "\n")
    try:
        target.chmod(0o600)
    except OSError:
        pass  # Windows ACLs govern access on Windows.
    print(f"Created {target}. Read it locally for Grafana/Influx login credentials.")
    print("Start: docker compose --env-file infrastructure/.env -f infrastructure/compose.yaml up --build -d")


if __name__ == "__main__":
    main()
