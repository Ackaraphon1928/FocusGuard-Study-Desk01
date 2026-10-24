"""Readable terminal diagnostics, configured without changing third-party logs."""
import logging
import os


def configure_logging():
    logger = logging.getLogger("focusguard")
    level = os.getenv("FOCUSGUARD_LOG_LEVEL", "INFO").upper()
    if level not in {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}:
        raise ValueError("FOCUSGUARD_LOG_LEVEL must be DEBUG, INFO, WARNING, ERROR or CRITICAL")
    logger.setLevel(level)
    if not any(getattr(handler, "_focusguard_console", False) for handler in logger.handlers):
        handler = logging.StreamHandler()
        handler._focusguard_console = True
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)-7s [%(name)s] %(message)s", datefmt="%H:%M:%S"))
        logger.addHandler(handler)
    logger.propagate = False

