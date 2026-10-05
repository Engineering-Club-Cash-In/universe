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

mkdir -p "$TMP_DIR/central-secrets" "$TMP_DIR/container-central"
umask 077
printf '%s' 'query-validation' > "$TMP_DIR/central-secrets/query_username"
openssl rand -hex 24 > "$TMP_DIR/central-secrets/query_password"
printf '%s' 'ingest-validation' > "$TMP_DIR/central-secrets/ingest_username"
openssl rand -hex 24 > "$TMP_DIR/central-secrets/ingest_password"

export VICTORIALOGS_SECRETS_DIR="$TMP_DIR/central-secrets"

python "$BASE/scripts/render-config.py" central \
  --secrets-dir "$TMP_DIR/central-secrets" \
  --template "$BASE/central/config/vmauth.template.yaml" \
  --output "$TMP_DIR/vmauth.yaml"

python -c 'from pathlib import Path; import sys; source=Path(sys.argv[1]).read_text(); source=source.replace("    exclude_from_hc: true\n", "").replace("      context: ..\n", f"      context: {sys.argv[3]}\n"); Path(sys.argv[2]).write_text(source)' "$BASE/central/compose.yaml" "$TMP_DIR/central.compose.yaml" "$BASE"
podman compose -f "$TMP_DIR/central.compose.yaml" config >/dev/null

RENDER_IMAGE=localhost/cci/victorialogs-config-renderer:validation
podman build -f "$BASE/config-renderer.Dockerfile" -t "$RENDER_IMAGE" "$BASE" >/dev/null

BUILD_CONTEXT_CHECK="$TMP_DIR/build-context-check"
python -c 'from pathlib import Path; import shutil,sys; source=Path(sys.argv[1]); target=Path(sys.argv[2]); shutil.copytree(source, target); canaries=(target/"central/secrets/build-context-canary", target/"central/runtime/build-context-canary", target/".env"); [path.parent.mkdir(parents=True, exist_ok=True) for path in canaries]; [path.write_text("BUILD_CONTEXT_SECRET_CANARY") for path in canaries]; (target/"Dockerfile.context-check").write_text("ARG RENDER_IMAGE\nFROM ${RENDER_IMAGE}\nCOPY . /context\nRUN test ! -e /context/central/secrets/build-context-canary \\\n && test ! -e /context/central/runtime/build-context-canary \\\n && test ! -e /context/.env\n")' "$BASE" "$BUILD_CONTEXT_CHECK"
podman build \
  --build-arg "RENDER_IMAGE=$RENDER_IMAGE" \
  -f "$BUILD_CONTEXT_CHECK/Dockerfile.context-check" \
  "$BUILD_CONTEXT_CHECK" >/dev/null

podman run --rm --read-only --cap-drop=all --security-opt=no-new-privileges \
  -v "$TMP_DIR/central-secrets:/run/secrets:ro,Z" \
  -v "$TMP_DIR/container-central:/runtime:Z" \
  "$RENDER_IMAGE" central --secrets-dir /run/secrets \
  --template /opt/iac/vmauth.template.yaml --output /runtime/vmauth.yaml

VMAUTH_IMAGE=$(python -c 'import re,sys; text=open(sys.argv[1]).read(); print(re.search(r"image: (victoriametrics/vmauth:\S+)", text).group(1))' "$BASE/central/compose.yaml")
podman run --rm -v "$TMP_DIR/container-central/vmauth.yaml:/etc/vmauth/vmauth.yaml:ro,Z" \
  "docker.io/$VMAUTH_IMAGE" -auth.config=/etc/vmauth/vmauth.yaml -dryRun

printf 'observability_central_iac_validation=PASS\n'
