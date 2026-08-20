#!/usr/bin/env python3
"""Fail if Coolify leaked logging credentials into container environments."""

from __future__ import annotations

import json
import sys
from pathlib import Path

SENSITIVE_ENV_NAMES = {
    "VMAUTH_QUERY_USERNAME",
    "VMAUTH_QUERY_PASSWORD",
    "VMAUTH_INGEST_USERNAME",
    "VMAUTH_INGEST_PASSWORD",
    "VECTOR_INGEST_USERNAME",
    "VECTOR_INGEST_PASSWORD",
}


def load_inspect(path: Path) -> list[object]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("inspect input must be a readable JSON array") from error
    if not isinstance(data, list):
        raise ValueError("inspect input must be a JSON array")
    return data


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: verify-secret-isolation.py INSPECT.json", file=sys.stderr)
        return 2

    try:
        containers = load_inspect(Path(argv[1]))
    except ValueError as error:
        print(str(error), file=sys.stderr)
        return 2

    leaks: list[tuple[str, str]] = []
    for item in containers:
        if not isinstance(item, dict):
            continue
        name = item.get("Name")
        safe_name = name.lstrip("/") if isinstance(name, str) else "unknown-container"
        config = item.get("Config")
        if not isinstance(config, dict):
            continue
        environment = config.get("Env")
        if not isinstance(environment, list):
            continue
        for entry in environment:
            if not isinstance(entry, str):
                continue
            variable_name = entry.split("=", 1)[0]
            if variable_name in SENSITIVE_ENV_NAMES:
                leaks.append((safe_name, variable_name))

    if leaks:
        for container_name, variable_name in sorted(set(leaks)):
            print(
                f"secret environment leak: container={container_name} variable={variable_name}",
                file=sys.stderr,
            )
        return 1

    print(f"secret_environment_isolation=PASS containers_checked={len(containers)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
