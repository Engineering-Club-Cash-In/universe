#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)
BASE="$ROOT/infra/observability/victorialogs"
TMP_DIR=$(mktemp -d)
cleanup() {
  python -c 'import shutil,sys; shutil.rmtree(sys.argv[1], ignore_errors=True)' "$TMP_DIR"
}
trap cleanup EXIT

python -m unittest discover -s "$BASE/tests" -v

mkdir -p "$TMP_DIR/central-secrets" "$TMP_DIR/agent-secrets"
umask 077
printf '%s' 'query-validation' > "$TMP_DIR/central-secrets/query_username"
openssl rand -hex 24 > "$TMP_DIR/central-secrets/query_password"
printf '%s' 'ingest-validation' > "$TMP_DIR/central-secrets/ingest_username"
openssl rand -hex 24 > "$TMP_DIR/central-secrets/ingest_password"
cp "$TMP_DIR/central-secrets/ingest_username" "$TMP_DIR/agent-secrets/ingest_username"
cp "$TMP_DIR/central-secrets/ingest_password" "$TMP_DIR/agent-secrets/ingest_password"

export VMAUTH_QUERY_USERNAME
VMAUTH_QUERY_USERNAME=$(<"$TMP_DIR/central-secrets/query_username")
export VMAUTH_QUERY_PASSWORD
VMAUTH_QUERY_PASSWORD=$(<"$TMP_DIR/central-secrets/query_password")
export VMAUTH_INGEST_USERNAME
VMAUTH_INGEST_USERNAME=$(<"$TMP_DIR/central-secrets/ingest_username")
export VMAUTH_INGEST_PASSWORD
VMAUTH_INGEST_PASSWORD=$(<"$TMP_DIR/central-secrets/ingest_password")
export VECTOR_INGEST_USERNAME="$VMAUTH_INGEST_USERNAME"
export VECTOR_INGEST_PASSWORD="$VMAUTH_INGEST_PASSWORD"
export VICTORIALOGS_ENDPOINT=https://logs.example.test/insert/elasticsearch/
export LOG_HOST=podman-validation
export LOG_ENVIRONMENT=staging

python "$BASE/scripts/render-config.py" central \
  --secrets-dir "$TMP_DIR/central-secrets" \
  --template "$BASE/central/config/vmauth.template.yaml" \
  --output "$TMP_DIR/vmauth.yaml"
python "$BASE/scripts/render-config.py" agent \
  --secrets-dir "$TMP_DIR/agent-secrets" \
  --template "$BASE/agent/config/vector.template.yaml" \
  --output "$TMP_DIR/vector.yaml" \
  --endpoint https://logs.example.test/insert/elasticsearch/ \
  --host podman-validation \
  --environment staging

python -c 'from pathlib import Path; import sys; source=Path(sys.argv[1]).read_text(); source=source.replace("    exclude_from_hc: true\n", "").replace("      context: ..\n", f"      context: {sys.argv[3]}\n"); Path(sys.argv[2]).write_text(source)' "$BASE/central/compose.yaml" "$TMP_DIR/central.compose.yaml" "$BASE"
python -c 'from pathlib import Path; import sys; source=Path(sys.argv[1]).read_text(); source=source.replace("    exclude_from_hc: true\n", "").replace("      context: ..\n", f"      context: {sys.argv[3]}\n"); Path(sys.argv[2]).write_text(source)' "$BASE/agent/compose.yaml" "$TMP_DIR/agent.compose.yaml" "$BASE"
podman compose -f "$TMP_DIR/central.compose.yaml" config >/dev/null
podman compose -f "$TMP_DIR/agent.compose.yaml" config >/dev/null

RENDER_IMAGE=localhost/cci/victorialogs-config-renderer:validation
mkdir -p "$TMP_DIR/container-central" "$TMP_DIR/container-agent"
podman build -f "$BASE/config-renderer.Dockerfile" -t "$RENDER_IMAGE" "$BASE" >/dev/null
podman run --rm --read-only --cap-drop=all --security-opt=no-new-privileges \
  -v "$TMP_DIR/central-secrets:/run/secrets:ro,Z" \
  -v "$TMP_DIR/container-central:/runtime:Z" \
  "$RENDER_IMAGE" central --secrets-dir /run/secrets \
  --template /opt/iac/vmauth.template.yaml --output /runtime/vmauth.yaml
podman run --rm --read-only --cap-drop=all --security-opt=no-new-privileges \
  -v "$TMP_DIR/agent-secrets:/run/secrets:ro,Z" \
  -v "$TMP_DIR/container-agent:/runtime:Z" \
  "$RENDER_IMAGE" agent --secrets-dir /run/secrets \
  --template /opt/iac/vector.template.yaml --output /runtime/vector.yaml \
  --endpoint "$VICTORIALOGS_ENDPOINT" --host "$LOG_HOST" --environment "$LOG_ENVIRONMENT"

VECTOR_IMAGE=$(python -c 'import re,sys; text=open(sys.argv[1]).read(); print(re.search(r"image: (timberio/vector:\S+)", text).group(1))' "$BASE/agent/compose.yaml")
VMAUTH_IMAGE=$(python -c 'import re,sys; text=open(sys.argv[1]).read(); print(re.search(r"image: (victoriametrics/vmauth:\S+)", text).group(1))' "$BASE/central/compose.yaml")

podman run --rm -v "$TMP_DIR/container-agent/vector.yaml:/etc/vector/vector.yaml:ro,Z" \
  "docker.io/$VECTOR_IMAGE" validate --no-environment /etc/vector/vector.yaml
podman run --rm -v "$TMP_DIR/container-agent/vector.yaml:/etc/vector/vector.yaml:ro,Z" \
  "docker.io/$VECTOR_IMAGE" test /etc/vector/vector.yaml
podman run --rm -v "$TMP_DIR/container-central/vmauth.yaml:/etc/vmauth/vmauth.yaml:ro,Z" \
  "docker.io/$VMAUTH_IMAGE" -auth.config=/etc/vmauth/vmauth.yaml -dryRun

printf 'observability_iac_validation=PASS\n'
