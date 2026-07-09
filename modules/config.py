"""
Runtime config — currently just the active strategy.

data/config.json is committed to the repo, so a strategy set via the
/setstrategy Telegram command survives across CI jobs. Resolution order:

  1. STRATEGY env var        — explicit manual workflow-dispatch choice
  2. data/config.json        — set via /setstrategy
  3. ACTIVE_STRATEGY_VAR env — the ACTIVE_STRATEGY repo variable
  4. "adaptive"              — default
"""

import json
import os
from pathlib import Path

CONFIG_PATH = Path("data/config.json")


def _read() -> dict:
    try:
        if CONFIG_PATH.exists():
            return json.loads(CONFIG_PATH.read_text())
    except Exception as e:
        print(f"[WARN] config._read: {e}")
    return {}


def set_strategy(name: str):
    cfg = _read()
    cfg["strategy"] = name
    CONFIG_PATH.parent.mkdir(exist_ok=True)
    CONFIG_PATH.write_text(json.dumps(cfg, indent=1) + "\n")
    print(f"[OK] config.set_strategy: {name}")


def resolve_strategy_name(valid: set[str]) -> tuple[str, str]:
    """Return (strategy_name, source) using the precedence above."""
    env = os.environ.get("STRATEGY", "").strip().lower()
    if env in valid:
        return env, "manual run input"

    cfg = str(_read().get("strategy", "")).strip().lower()
    if cfg in valid:
        return cfg, "/setstrategy (data/config.json)"

    var = os.environ.get("ACTIVE_STRATEGY_VAR", "").strip().lower()
    if var in valid:
        return var, "ACTIVE_STRATEGY repo variable"

    return "adaptive", "default"
