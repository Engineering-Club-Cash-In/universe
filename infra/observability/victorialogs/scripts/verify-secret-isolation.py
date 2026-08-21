#!/usr/bin/env python3
"""Fail if inspect evidence is incomplete or exposes credentials."""

from __future__ import annotations

import json
import re
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

EXPECTED_SERVICES = {
    "central": {"config-init", "victoria-logs", "vmauth"},
    "agent": {"config-init", "docker-socket-proxy", "vector"},
}


def load_inspect(path: Path) -> list[object]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("inspect input must be a readable JSON array") from error
    if not isinstance(data, list):
        raise ValueError("inspect input must be a JSON array")
    return data


def identify_service(item: dict[object, object], expected: set[str]) -> str | None:
    config = item.get("Config")
    if not isinstance(config, dict):
        return None

    labels = config.get("Labels")
    if isinstance(labels, dict):
        compose_service = labels.get("com.docker.compose.service")
        if isinstance(compose_service, str) and compose_service in expected:
            return compose_service

    name = item.get("Name")
    if not isinstance(name, str):
        return None
    safe_name = name.lstrip("/")
    for service in expected:
        if safe_name == service or re.search(
            rf"(?:^|-){re.escape(service)}-\d+$", safe_name
        ):
            return service
    return None


def main(argv: list[str]) -> int:
    if len(argv) != 3 or argv[1] not in EXPECTED_SERVICES:
        print(
            "usage: verify-secret-isolation.py central|agent INSPECT.json",
            file=sys.stderr,
        )
        return 2

    stack = argv[1]
    expected = EXPECTED_SERVICES[stack]
    try:
        containers = load_inspect(Path(argv[2]))
    except ValueError as error:
        print(str(error), file=sys.stderr)
        return 2

    leaks: list[tuple[str, str]] = []
    found_services: set[str] = set()
    for item in containers:
        if not isinstance(item, dict):
            continue
        name = item.get("Name")
        safe_name = name.lstrip("/") if isinstance(name, str) else "unknown-container"
        service = identify_service(item, expected)
        if service is not None:
            found_services.add(service)

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

    missing = expected - found_services
    if missing:
        print(
            "incomplete inspect evidence: missing_services=" + ",".join(sorted(missing)),
            file=sys.stderr,
        )
        return 1

    if leaks:
        for container_name, variable_name in sorted(set(leaks)):
            print(
                f"secret environment leak: container={container_name} variable={variable_name}",
                file=sys.stderr,
            )
        return 1

    print(
        "secret_environment_isolation=PASS "
        f"stack={stack} services_checked={len(found_services)} "
        f"containers_checked={len(containers)}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
