#!/usr/bin/env python3
import configparser
import os
import re
import sys
from pathlib import Path
from urllib.parse import parse_qsl, unquote, urlsplit

if len(sys.argv) != 3 or not re.fullmatch(r"[a-z][a-z0-9_-]*", sys.argv[1]):
    raise SystemExit("usage: write-pg-service.py SERVICE_NAME OUTPUT_PATH")

service_name, output_path = sys.argv[1], Path(sys.argv[2])
url = os.environ.get("SERVICE_DATABASE_URL", "")
ssl_root_cert = Path(os.environ.get("SERVICE_SSL_ROOT_CERT", ""))
parsed = urlsplit(url)
if parsed.scheme not in {"postgres", "postgresql"}:
    raise SystemExit("database URL must use postgres or postgresql")
if not parsed.hostname or not parsed.username or not parsed.path.lstrip("/"):
    raise SystemExit("database URL must include host, user and database")
if not ssl_root_cert.is_absolute() or not ssl_root_cert.is_file():
    raise SystemExit("SERVICE_SSL_ROOT_CERT must be an absolute certificate file")

host = parsed.hostname
if host.endswith(".neon.tech") and host.split(".", 1)[0].endswith("-pooler"):
    host = host.replace("-pooler.", ".", 1)

values = {
    "host": host,
    "port": str(parsed.port or 5432),
    "dbname": unquote(parsed.path.lstrip("/")),
    "user": unquote(parsed.username),
}
if parsed.password is not None:
    values["password"] = unquote(parsed.password)

allowed_query_keys = {
    "application_name",
    "connect_timeout",
}
for key, value in parse_qsl(parsed.query, keep_blank_values=True):
    if key == "options":
        raise SystemExit("database URL options are not allowed")
    if key in allowed_query_keys:
        values[key] = value
values.update(
    sslmode="verify-full",
    sslrootcert=str(ssl_root_cert),
    channel_binding="require",
)

if any("\n" in value or "\r" in value for value in values.values()):
    raise SystemExit("database URL contains unsupported line breaks")

config = configparser.ConfigParser(interpolation=None)
if output_path.exists() and output_path.stat().st_size:
    config.read(output_path)
config[service_name] = values
with output_path.open("w", encoding="utf-8") as handle:
    config.write(handle, space_around_delimiters=False)
os.chmod(output_path, 0o600)
