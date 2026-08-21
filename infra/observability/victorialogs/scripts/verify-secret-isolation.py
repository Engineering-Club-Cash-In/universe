#!/usr/bin/env python3
"""Verify complete secret-isolation evidence for the central stack."""

from __future__ import annotations

import json
import sys
from pathlib import Path

SENSITIVE_ENV_NAMES = {
    "VMAUTH_QUERY_USERNAME",
    "VMAUTH_QUERY_PASSWORD",
    "VMAUTH_INGEST_USERNAME",
    "VMAUTH_INGEST_PASSWORD",
}
EXPECTED_SERVICES = {"config-init", "victoria-logs", "vmauth"}


def load_inspect(path: Path) -> list[object]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("inspect input must be a readable JSON array") from error
    if not isinstance(data, list):
        raise ValueError("inspect input must be a JSON array")
    return data


def validate_container(
    item: object, index: int, expected_project: str
) -> tuple[str, list[str]]:
    if not isinstance(item, dict):
        raise ValueError(f"entry={index} reason=container-is-not-object")
    config = item.get("Config")
    if not isinstance(config, dict):
        raise ValueError(f"entry={index} reason=config-is-not-object")
    labels = config.get("Labels")
    if not isinstance(labels, dict):
        raise ValueError(f"entry={index} reason=labels-is-not-object")

    service = labels.get("com.docker.compose.service")
    if not isinstance(service, str) or not service:
        raise ValueError(f"entry={index} reason=service-label-is-not-string")
    if service not in EXPECTED_SERVICES:
        raise ValueError(f"entry={index} reason=unknown-compose-service")

    project = labels.get("com.docker.compose.project")
    if not isinstance(project, str) or not project:
        raise ValueError(f"entry={index} reason=project-label-is-not-string")
    if project != expected_project:
        raise ValueError(f"entry={index} reason=unexpected-compose-project")

    environment = config.get("Env")
    if not isinstance(environment, list):
        raise ValueError(f"entry={index} reason=env-is-not-list")
    if not all(isinstance(entry, str) for entry in environment):
        raise ValueError(f"entry={index} reason=env-entry-is-not-string")
    return service, environment


def main(argv: list[str]) -> int:
    if len(argv) != 3 or not argv[1]:
        print(
            "usage: verify-secret-isolation.py PROJECT INSPECT.json",
            file=sys.stderr,
        )
        return 2

    expected_project = argv[1]
    try:
        containers = load_inspect(Path(argv[2]))
    except ValueError as error:
        print(str(error), file=sys.stderr)
        return 2

    counts = {service: 0 for service in EXPECTED_SERVICES}
    invalid: list[str] = []
    leaks: list[tuple[int, str]] = []
    for index, item in enumerate(containers):
        try:
            service, environment = validate_container(item, index, expected_project)
        except ValueError as error:
            invalid.append(str(error))
            continue
        counts[service] += 1
        if counts[service] > 1:
            invalid.append(f"service={service} reason=duplicate-compose-service")
        for entry in environment:
            variable_name = entry.split("=", 1)[0]
            if variable_name in SENSITIVE_ENV_NAMES:
                leaks.append((index, variable_name))

    if invalid:
        for detail in invalid:
            print(f"invalid inspect evidence: {detail}", file=sys.stderr)
        return 1
    missing = {service for service, count in counts.items() if count == 0}
    if missing:
        print(
            "incomplete inspect evidence: missing_services=" + ",".join(sorted(missing)),
            file=sys.stderr,
        )
        return 1
    if leaks:
        for index, variable_name in sorted(set(leaks)):
            print(
                f"secret environment leak: entry={index} variable={variable_name}",
                file=sys.stderr,
            )
        return 1

    print(
        "secret_environment_isolation=PASS "
        f"services_checked={len(counts)} containers_checked={len(containers)}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
