"""Optional local numeric calibration persistence, shared by vision adapters."""
from __future__ import annotations

import json
from pathlib import Path
import tempfile


def load_calibration(classifier, filename: str | Path) -> None:
    """The canonical classifier validates schema, selected view and numeric data."""
    classifier.load_calibration(json.loads(Path(filename).expanduser().read_text(encoding="utf-8")))


def save_calibration(classifier, filename: str | Path) -> None:
    """Replace a complete validated baseline atomically; never persist frames."""
    payload = classifier.export_calibration()
    encoded = json.dumps(payload, indent=2, allow_nan=False) + "\n"
    target = Path(filename).expanduser()
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=target.parent,
                                         prefix=target.name + ".", suffix=".tmp", delete=False) as output:
            temporary = Path(output.name)
            output.write(encoded)
        temporary.replace(target)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
