#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)
BASE="$ROOT/infra/observability/victorialogs"
TMP_DIR=$(mktemp -d)
SUFFIX=$$
STORAGE_NAME="vlogs-iac-storage-$SUFFIX"
AUTH_NAME="vlogs-iac-vmauth-$SUFFIX"
VOLUME_NAME="vlogs-iac-data-$SUFFIX"
STORAGE_PORT=${STORAGE_PORT:-19428}
AUTH_PORT=${AUTH_PORT:-18427}
INTERNAL_PORT=${INTERNAL_PORT:-18428}

cleanup() {
  podman rm -f "$AUTH_NAME" "$STORAGE_NAME" >/dev/null 2>&1 || true
  podman volume rm "$VOLUME_NAME" >/dev/null 2>&1 || true
  python -c 'import shutil,sys; shutil.rmtree(sys.argv[1], ignore_errors=True)' "$TMP_DIR"
}
trap cleanup EXIT

for file in query_username query_password ingest_username ingest_password; do
  if [[ ! -s "$BASE/central/secrets/$file" ]]; then
    printf 'missing local smoke credential: central/secrets/%s\n' "$file" >&2
    exit 2
  fi
done

python "$BASE/scripts/render-config.py" central \
  --secrets-dir "$BASE/central/secrets" \
  --template "$BASE/central/config/vmauth.template.yaml" \
  --output "$TMP_DIR/vmauth.yaml"
python -c 'from pathlib import Path; import sys; p=Path(sys.argv[1]); p.write_text(p.read_text().replace("http://victoria-logs:9428", sys.argv[2]), encoding="utf-8")' \
  "$TMP_DIR/vmauth.yaml" "http://127.0.0.1:$STORAGE_PORT"

STORAGE_IMAGE=$(python -c 'import re,sys; text=open(sys.argv[1]).read(); print(re.search(r"image: (victoriametrics/victoria-logs:\S+)", text).group(1))' "$BASE/central/compose.yaml")
VMAUTH_IMAGE=$(python -c 'import re,sys; text=open(sys.argv[1]).read(); print(re.search(r"image: (victoriametrics/vmauth:\S+)", text).group(1))' "$BASE/central/compose.yaml")
podman pull "docker.io/$STORAGE_IMAGE" >/dev/null
podman pull "docker.io/$VMAUTH_IMAGE" >/dev/null
podman volume create "$VOLUME_NAME" >/dev/null

podman run -d --name "$STORAGE_NAME" --network host --cap-drop=all \
  --security-opt=no-new-privileges -v "$VOLUME_NAME:/victoria-logs-data" \
  "docker.io/$STORAGE_IMAGE" \
  -storageDataPath=/victoria-logs-data \
  -retentionPeriod=30d \
  -retention.maxDiskSpaceUsageBytes=12GiB \
  -memory.allowedBytes=512MiB \
  -httpListenAddr="127.0.0.1:$STORAGE_PORT" >/dev/null

for attempt in $(seq 1 30); do
  status=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$STORAGE_PORT/health" || true)
  [[ "$status" == 200 ]] && break
  [[ "$attempt" == 30 ]] && exit 1
  sleep 1
done

podman run -d --name "$AUTH_NAME" --network host --read-only --cap-drop=all \
  --security-opt=no-new-privileges -v "$TMP_DIR/vmauth.yaml:/etc/vmauth/vmauth.yaml:ro,Z" \
  "docker.io/$VMAUTH_IMAGE" \
  -auth.config=/etc/vmauth/vmauth.yaml \
  -httpListenAddr="127.0.0.1:$AUTH_PORT" \
  -httpInternalListenAddr="127.0.0.1:$INTERNAL_PORT" >/dev/null

for attempt in $(seq 1 30); do
  status=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$AUTH_PORT/health" || true)
  [[ "$status" == 200 ]] && break
  [[ "$attempt" == 30 ]] && exit 1
  sleep 1
done

INGEST_USER=$(<"$BASE/central/secrets/ingest_username")
INGEST_PASS=$(<"$BASE/central/secrets/ingest_password")
QUERY_USER=$(<"$BASE/central/secrets/query_username")
QUERY_PASS=$(<"$BASE/central/secrets/query_password")
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
printf '{"_time":"%s","_msg":"iac smoke event","service":"iac-smoke","environment":"staging","host":"podman-smoke","container_name":"smoke"}\n' "$NOW" > "$TMP_DIR/event.jsonl"

UNAUTH=$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:$AUTH_PORT/select/logsql/query?query=service%3Aiac-smoke")
METRICS=$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:$AUTH_PORT/metrics")
FLAGS=$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:$AUTH_PORT/flags")
PPROF=$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:$AUTH_PORT/debug/pprof/")
RELOAD=$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:$AUTH_PORT/-/reload")
WRITE_AS_QUERY=$(curl -sS -o /dev/null -w '%{http_code}' -u "$QUERY_USER:$QUERY_PASS" \
  -H 'Content-Type: application/stream+json' --data-binary @"$TMP_DIR/event.jsonl" \
  "http://127.0.0.1:$AUTH_PORT/insert/jsonline?_stream_fields=service,environment,host,container_name&_msg_field=_msg&_time_field=_time")
INGEST=$(curl -sS -o /dev/null -w '%{http_code}' -u "$INGEST_USER:$INGEST_PASS" \
  -H 'Content-Type: application/stream+json' --data-binary @"$TMP_DIR/event.jsonl" \
  "http://127.0.0.1:$AUTH_PORT/insert/jsonline?_stream_fields=service,environment,host,container_name&_msg_field=_msg&_time_field=_time")
READ_AS_INGEST=$(curl -sS -o /dev/null -w '%{http_code}' -u "$INGEST_USER:$INGEST_PASS" -G \
  --data-urlencode 'query=service:iac-smoke' --data-urlencode 'start=1h' \
  "http://127.0.0.1:$AUTH_PORT/select/logsql/query")

FOUND=no
for attempt in $(seq 1 20); do
  QUERY=$(curl -sS -o "$TMP_DIR/query.out" -w '%{http_code}' -u "$QUERY_USER:$QUERY_PASS" -G \
    --data-urlencode 'query=service:iac-smoke' --data-urlencode 'start=1h' \
    "http://127.0.0.1:$AUTH_PORT/select/logsql/query")
  if python -c 'from pathlib import Path; import sys; raise SystemExit(0 if "iac smoke event" in Path(sys.argv[1]).read_text() else 1)' "$TMP_DIR/query.out"; then
    FOUND=yes
    break
  fi
  sleep 1
done

printf 'observed health=200 unauth=%s metrics=%s flags=%s pprof=%s reload=%s write_as_query=%s ingest=%s read_as_ingest=%s query=%s event_found=%s\n' \
  "$UNAUTH" "$METRICS" "$FLAGS" "$PPROF" "$RELOAD" "$WRITE_AS_QUERY" "$INGEST" "$READ_AS_INGEST" "$QUERY" "$FOUND"

[[ "$UNAUTH" == 401 ]]
[[ "$METRICS" == 401 ]]
[[ "$FLAGS" == 401 ]]
[[ "$PPROF" == 401 ]]
[[ "$RELOAD" == 401 ]]
[[ "$WRITE_AS_QUERY" == 400 ]]
[[ "$INGEST" == 200 ]]
[[ "$READ_AS_INGEST" == 400 ]]
[[ "$QUERY" == 200 ]]
[[ "$FOUND" == yes ]]
printf 'health=200 unauth=401 native_endpoints=401 write_isolated=400 read_isolated=400 ingest=200 query=200 event_found=yes\n'
