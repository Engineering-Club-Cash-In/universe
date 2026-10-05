#!/usr/bin/env python3
"""Validate host-managed VictoriaLogs secret files without printing values."""

from __future__ import annotations

import argparse
import os
import stat
from pathlib import Path

EXPECTED_FILES = (
    "query_username",
    "query_password",
    "ingest_username",
    "ingest_password",
)
MIN_PASSWORD_LENGTH = 24
MAX_SECRET_BYTES = 4096


def validate_metadata(
    info: os.stat_result,
    *,
    name: str,
    expected_type: int,
    required_uid: int,
) -> None:
    is_expected_type = (
        stat.S_ISDIR(info.st_mode)
        if expected_type == stat.S_IFDIR
        else stat.S_ISREG(info.st_mode)
    )
    if not is_expected_type:
        kind = "directory" if expected_type == stat.S_IFDIR else "regular file"
        raise ValueError(f"invalid secret path: {name} must be a {kind}")
    if stat.S_IMODE(info.st_mode) & 0o077:
        raise ValueError(f"secret path permissions are too broad: {name}")
    if info.st_uid != required_uid:
        raise ValueError(f"invalid secret path owner: {name}")


def read_private_file(directory_fd: int, name: str, required_uid: int) -> str:
    flags = os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW | os.O_NONBLOCK
    fd = os.open(name, flags, dir_fd=directory_fd)
    try:
        info = os.fstat(fd)
        validate_metadata(
            info,
            name=name,
            expected_type=stat.S_IFREG,
            required_uid=required_uid,
        )
        raw_value = os.read(fd, MAX_SECRET_BYTES + 1)
    finally:
        os.close(fd)
    if len(raw_value) > MAX_SECRET_BYTES:
        raise ValueError(f"secret file is too large: {name}")
    value = raw_value.decode("utf-8").strip()
    if not value:
        raise ValueError(f"empty secret file: {name}")
    if "\n" in value or "\r" in value:
        raise ValueError(f"multiline secret file: {name}")
    return value


def validate(directory: Path, required_uid: int) -> None:
    flags = os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW | os.O_DIRECTORY
    directory_fd = os.open(directory, flags)
    try:
        validate_metadata(
            os.fstat(directory_fd),
            name="secret directory",
            expected_type=stat.S_IFDIR,
            required_uid=required_uid,
        )
        values = {
            name: read_private_file(directory_fd, name, required_uid)
            for name in EXPECTED_FILES
        }
    finally:
        os.close(directory_fd)

    if len(values["query_password"]) < MIN_PASSWORD_LENGTH:
        raise ValueError("query password is too short")
    if len(values["ingest_password"]) < MIN_PASSWORD_LENGTH:
        raise ValueError("ingest password is too short")
    if values["query_username"] == values["ingest_username"]:
        raise ValueError("query and ingest usernames must be different")
    if values["query_password"] == values["ingest_password"]:
        raise ValueError("query and ingest passwords must be different")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument(
        "--require-uid",
        type=int,
        default=0,
        help="required owner uid for directory and files (default: 0/root)",
    )
    args = parser.parse_args()
    try:
        validate(args.directory, args.require_uid)
    except (OSError, UnicodeError, ValueError) as error:
        parser.error(str(error))
    print(f"host_secret_files=PASS files_checked={len(EXPECTED_FILES)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
