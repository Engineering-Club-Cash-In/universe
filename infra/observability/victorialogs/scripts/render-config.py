#!/usr/bin/env python3
"""Render runtime configs without committing or printing secrets."""

from __future__ import annotations

import argparse
import json
import os
import re
import tempfile
from pathlib import Path

MIN_PASSWORD_LENGTH = 24
ENVIRONMENTS = {"production", "staging", "development", "uat"}


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


def render_agent(args: argparse.Namespace) -> None:
    if args.environment not in ENVIRONMENTS:
        raise ValueError(f"unsupported environment: {args.environment}")
    if not re.fullmatch(r"https://[^\s/]+(?:/[^\s]*)?", args.endpoint):
        raise ValueError("endpoint must be an HTTPS URL")
    if not args.endpoint.rstrip("/").endswith("/insert/elasticsearch"):
        raise ValueError("endpoint must end in /insert/elasticsearch/")
    if not re.fullmatch(r"[A-Za-z0-9._-]{1,128}", args.host):
        raise ValueError("host contains unsupported characters")

    secrets = Path(args.secrets_dir)
    username = read_value(secrets / "ingest_username")
    password = read_value(secrets / "ingest_password", secret=True)
    template = Path(args.template).read_text(encoding="utf-8")
    rendered = replace_all(
        template,
        {
            "__LOG_HOST_JSON__": args.host,
            "__ENVIRONMENT_JSON__": args.environment,
            "__VICTORIALOGS_ENDPOINT_JSON__": args.endpoint,
            "__INGEST_USERNAME_JSON__": username,
            "__INGEST_PASSWORD_JSON__": password,
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

    agent = commands.add_parser("agent")
    agent.add_argument("--secrets-dir", required=True)
    agent.add_argument("--template", required=True)
    agent.add_argument("--output", required=True)
    agent.add_argument("--endpoint", required=True)
    agent.add_argument("--host", required=True)
    agent.add_argument("--environment", required=True)
    agent.set_defaults(handler=render_agent)
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
