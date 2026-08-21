#!/usr/bin/env python3
"""Render the central vmauth runtime config without printing secrets."""

from __future__ import annotations

import argparse
import json
import os
import re
import tempfile
from pathlib import Path

MIN_PASSWORD_LENGTH = 24


def read_value(path: Path, *, secret: bool = False) -> str:
    if not path.is_file():
        raise ValueError(f"required file is missing: {path.name}")
    value = path.read_text(encoding="utf-8").strip()
    if not value:
        raise ValueError(f"required file is empty: {path.name}")
    if "\n" in value or "\r" in value:
        raise ValueError(f"required file must contain one line: {path.name}")
    if secret and len(value) < MIN_PASSWORD_LENGTH:
        raise ValueError(
            f"credential in {path.name} must contain at least {MIN_PASSWORD_LENGTH} characters"
        )
    return value


def replace_all(template: str, values: dict[str, str]) -> str:
    rendered = template
    for placeholder, value in values.items():
        rendered = rendered.replace(placeholder, json.dumps(value))
    leftovers = sorted(set(re.findall(r"__[A-Z0-9_]+__", rendered)))
    if leftovers:
        raise ValueError(f"unresolved placeholders: {', '.join(leftovers)}")
    return rendered


def atomic_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        path.chmod(0o600)
    except BaseException:
        temporary.unlink(missing_ok=True)
        raise


def render_central(args: argparse.Namespace) -> None:
    secrets = Path(args.secrets_dir)
    values = {
        "query_username": read_value(secrets / "query_username"),
        "query_password": read_value(secrets / "query_password", secret=True),
        "ingest_username": read_value(secrets / "ingest_username"),
        "ingest_password": read_value(secrets / "ingest_password", secret=True),
    }
    if values["query_username"] == values["ingest_username"]:
        raise ValueError("query and ingest usernames must be different")
    if values["query_password"] == values["ingest_password"]:
        raise ValueError("query and ingest passwords must be different")

    template = Path(args.template).read_text(encoding="utf-8")
    rendered = replace_all(
        template,
        {
            "__QUERY_USERNAME_JSON__": values["query_username"],
            "__QUERY_PASSWORD_JSON__": values["query_password"],
            "__INGEST_USERNAME_JSON__": values["ingest_username"],
            "__INGEST_PASSWORD_JSON__": values["ingest_password"],
        },
    )
    atomic_write(Path(args.output), rendered)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    central = commands.add_parser("central")
    central.add_argument("--secrets-dir", required=True)
    central.add_argument("--template", required=True)
    central.add_argument("--output", required=True)
    central.set_defaults(handler=render_central)
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        args.handler(args)
    except (OSError, ValueError) as error:
        parser.error(str(error))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
