#!/usr/bin/env bash
set -euo pipefail

required=(
  CRM_DATABASE_URL
  CARTERA_DATABASE_URL
  AWS_ACCESS_KEY_ID
  AWS_SECRET_ACCESS_KEY
  CRM_PG_DUMP
  CARTERA_PG_DUMP
  CRM_SSL_ROOT_CERT
  CARTERA_SSL_ROOT_CERT
  R2_ENDPOINT_URL
  R2_BUCKET
)
for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "missing required environment variable: $name" >&2
    exit 2
  fi
done

for cert in "$CRM_SSL_ROOT_CERT" "$CARTERA_SSL_ROOT_CERT"; do
  if [[ "$cert" != /* || ! -r "$cert" ]]; then
    echo "SSL root certificate must be an absolute readable file: $cert" >&2
    exit 2
  fi
done

if [[ ! "$R2_ENDPOINT_URL" =~ ^https://[0-9a-f]{32}\.r2\.cloudflarestorage\.com/?$ ]]; then
  echo "R2_ENDPOINT_URL must be an HTTPS Cloudflare R2 endpoint" >&2
  exit 2
fi
R2_ENDPOINT_URL=${R2_ENDPOINT_URL%/}

for command in "$CRM_PG_DUMP" "$CARTERA_PG_DUMP" pg_restore sha256sum aws python3; do
  command -v "$command" >/dev/null || {
    echo "required command not found: $command" >&2
    exit 2
  }
done

BACKUP_TIMESTAMP=${BACKUP_TIMESTAMP:-$(date -u +%Y%m%dT%H%M%SZ)}
BACKUP_DATE=${BACKUP_DATE:-$(TZ=America/Guatemala date +%F)}
BACKUP_CLASSES=${BACKUP_CLASSES:-daily}
IFS=',' read -r -a classes <<<"$BACKUP_CLASSES"
for class in "${classes[@]}"; do
  case "$class" in
    daily|weekly|monthly) ;;
    *)
      echo "invalid backup class: $class" >&2
      exit 2
      ;;
  esac
done

year=${BACKUP_DATE:0:4}
month=${BACKUP_DATE:5:2}
day=${BACKUP_DATE:8:2}
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

aws --endpoint-url "$R2_ENDPOINT_URL" s3api get-bucket-lifecycle-configuration \
  --bucket "$R2_BUCKET" --output json \
  | python3 "$script_dir/validate-r2-lifecycle.py"

for class in "${classes[@]}"; do
  prefix="$class/$year/$month/$day/$BACKUP_TIMESTAMP"
  existing=$(aws --endpoint-url "$R2_ENDPOINT_URL" s3api list-objects-v2 \
    --bucket "$R2_BUCKET" --prefix "$prefix/" --max-items 1 \
    --query 'Contents[0].Key' --output text)
  if [[ "$existing" != "None" && -n "$existing" ]]; then
    echo "backup prefix already contains objects: $prefix" >&2
    exit 1
  fi
done

umask 077
workdir=$(mktemp -d "${RUNNER_TEMP:-/tmp}/cashin-db-backup.XXXXXX")
trap 'rm -rf "$workdir"' EXIT
service_file="$workdir/pg_service.conf"
touch "$service_file"
chmod 600 "$service_file"

SERVICE_DATABASE_URL="$CRM_DATABASE_URL" \
  SERVICE_SSL_ROOT_CERT="$CRM_SSL_ROOT_CERT" \
  python3 "$script_dir/write-pg-service.py" crm "$service_file"
SERVICE_DATABASE_URL="$CARTERA_DATABASE_URL" \
  SERVICE_SSL_ROOT_CERT="$CARTERA_SSL_ROOT_CERT" \
  python3 "$script_dir/write-pg-service.py" cartera "$service_file"

create_dump() {
  local logical_name=$1
  local pg_dump_command=$2
  local output="$workdir/$logical_name.dump"

  PGSERVICE="$logical_name" \
  PGSERVICEFILE="$service_file" \
  PGAPPNAME="cashin-nightly-backup" \
  PGOPTIONS="-c default_transaction_read_only=on" \
    "$pg_dump_command" \
      --format=custom \
      --no-owner \
      --no-acl \
      --no-password \
      --serializable-deferrable \
      --file "$output"

  pg_restore --list "$output" >/dev/null
  (
    cd "$workdir"
    sha256sum "$logical_name.dump" >"$logical_name.dump.sha256"
  )
}

create_dump crm "$CRM_PG_DUMP"
create_dump cartera "$CARTERA_PG_DUMP"

printf 'completed_at=%s\nbackup_date=%s\n' \
  "$BACKUP_TIMESTAMP" "$BACKUP_DATE" >"$workdir/.complete"

for class in "${classes[@]}"; do
  prefix="$class/$year/$month/$day/$BACKUP_TIMESTAMP"
  for file in crm.dump crm.dump.sha256 cartera.dump cartera.dump.sha256; do
    aws --endpoint-url "$R2_ENDPOINT_URL" s3 cp \
      "$workdir/$file" "s3://$R2_BUCKET/$prefix/$file" \
      --only-show-errors
  done
done

for class in "${classes[@]}"; do
  prefix="$class/$year/$month/$day/$BACKUP_TIMESTAMP"
  aws --endpoint-url "$R2_ENDPOINT_URL" s3 cp \
    "$workdir/.complete" "s3://$R2_BUCKET/$prefix/.complete" \
    --only-show-errors
  echo "uploaded complete $class backup for $BACKUP_DATE"
done
