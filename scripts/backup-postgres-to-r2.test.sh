#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
SUBJECT="$ROOT/scripts/backup-postgres-to-r2.sh"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
FAKE_BIN="$TMP/bin"
mkdir -p "$FAKE_BIN"
touch "$TMP/root.crt"

cat >"$FAKE_BIN/pg_dump" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
[[ "${PGSERVICE:-}" == "crm" || "${PGSERVICE:-}" == "cartera" ]]
[[ -f "${PGSERVICEFILE:-}" ]]
[[ $(stat -c '%a' "$PGSERVICEFILE") == "600" ]]
[[ "${PGOPTIONS:-}" == *"default_transaction_read_only=on"* ]]
service_block=$(awk -v section="[$PGSERVICE]" '
  $0 == section { found=1; next }
  /^\[/ { found=0 }
  found { print }
' "$PGSERVICEFILE")
grep -q '^sslmode=verify-full$' <<<"$service_block"
grep -q "^sslrootcert=${EXPECTED_SSL_ROOT_CERT}$" <<<"$service_block"
grep -q '^channel_binding=require$' <<<"$service_block"
if grep -q '^options=' "$PGSERVICEFILE"; then
  echo "database URL must not override enforced read-only options" >&2
  exit 27
fi
if grep -q -- '-pooler\.neon\.tech' "$PGSERVICEFILE"; then
  echo "backup must use the unpooled Neon host" >&2
  exit 26
fi
if [[ "${PGOPTIONS:-}" == *"lock_timeout"* ]]; then
  echo "lock_timeout is not supported by the pooled Neon connection" >&2
  exit 25
fi
if grep -q ' = ' "$PGSERVICEFILE"; then
  echo "service file contains unsupported spaces around equals" >&2
  exit 24
fi
if [[ "${FAIL_CARTERA:-}" == "1" && "$PGSERVICE" == "cartera" ]]; then
  exit 23
fi
output=""
printf '%s\n' "$*" >>"$PG_DUMP_ARGS_LOG"
while (($#)); do
  case "$1" in
    --file) output=$2; shift 2 ;;
    *) shift ;;
  esac
done
printf 'archive\n' >"$output"
basename "$0" >>"$CALL_LOG"
EOF

cat >"$FAKE_BIN/pg_restore" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
[[ "$1" == "--list" ]]
[[ -s "$2" ]]
printf 'pg_restore\n' >>"$CALL_LOG"
EOF

cat >"$FAKE_BIN/aws" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"$AWS_LOG"
if [[ "$*" == *"s3api get-bucket-lifecycle-configuration"* ]]; then
  if [[ "${BAD_LIFECYCLE:-}" == "1" ]]; then
    printf '%s\n' '{"Rules":[]}'
  elif [[ "${SHORT_OVERLAPPING_LIFECYCLE:-}" == "1" ]]; then
    printf '%s\n' '{"Rules":[{"Status":"Enabled","Filter":{"Prefix":"daily/"},"Expiration":{"Days":14}},{"Status":"Enabled","Filter":{"Prefix":"weekly/"},"Expiration":{"Days":56}},{"Status":"Enabled","Filter":{"Prefix":"monthly/"},"Expiration":{"Days":365}},{"Status":"Enabled","Filter":{"Prefix":""},"Expiration":{"Days":7}}]}'
  elif [[ "${NON_EXPIRING_OVERLAP:-}" == "1" ]]; then
    printf '%s\n' '{"Rules":[{"Status":"Enabled","Filter":{"Prefix":"daily/"},"Expiration":{"Days":14}},{"Status":"Enabled","Filter":{"Prefix":"weekly/"},"Expiration":{"Days":56}},{"Status":"Enabled","Filter":{"Prefix":"monthly/"},"Expiration":{"Days":365}},{"Status":"Enabled","Filter":{"Prefix":""},"AbortIncompleteMultipartUpload":{"DaysAfterInitiation":1}}]}'
  else
    printf '%s\n' '{"Rules":[{"ID":"expire-daily-after-14-days","Status":"Enabled","Filter":{"Prefix":"daily/"},"Expiration":{"Days":14}},{"ID":"expire-weekly-after-56-days","Status":"Enabled","Filter":{"Prefix":"weekly/"},"Expiration":{"Days":56}},{"ID":"expire-monthly-after-365-days","Status":"Enabled","Filter":{"Prefix":"monthly/"},"Expiration":{"Days":365}}]}'
  fi
elif [[ "$*" == *"s3api list-objects-v2"* ]]; then
  [[ "${REUSED_PREFIX:-}" == "1" ]] && printf 'existing-object\n' || printf 'None\n'
elif [[ -n "${FAIL_AWS_MATCH:-}" && "$*" == *"$FAIL_AWS_MATCH"* ]]; then
  exit 42
fi
EOF
chmod +x "$FAKE_BIN/pg_dump" "$FAKE_BIN/pg_restore" "$FAKE_BIN/aws"
ln -s pg_dump "$FAKE_BIN/crm-pg-dump"
ln -s pg_dump "$FAKE_BIN/cartera-pg-dump"

assert_no_uploads() {
  if grep -q ' s3 cp ' "$TMP/aws.log"; then
    echo "failed precondition must not upload objects" >&2
    exit 1
  fi
}

run_backup() {
  PATH="$FAKE_BIN:$PATH" \
  CALL_LOG="$TMP/calls.log" \
  AWS_LOG="$TMP/aws.log" \
  PG_DUMP_ARGS_LOG="$TMP/pg-dump-args.log" \
  CRM_DATABASE_URL="${TEST_CRM_URL:-postgresql://backup:crm-secret@crm-pooler.neon.tech/neondb?sslmode=disable&channel_binding=disable}" \
  CARTERA_DATABASE_URL="postgresql://backup:***@cartera-pooler.neon.tech/postgres?sslmode=verify-full&channel_binding=require" \
  AWS_ACCESS_KEY_ID="${TEST_AWS_ACCESS_KEY_ID-backup-access-key}" \
  AWS_SECRET_ACCESS_KEY="${TEST_AWS_SECRET_ACCESS_KEY-backup-secret-key}" \
  CRM_PG_DUMP="$FAKE_BIN/crm-pg-dump" \
  CARTERA_PG_DUMP="$FAKE_BIN/cartera-pg-dump" \
  CRM_SSL_ROOT_CERT="$TMP/root.crt" \
  CARTERA_SSL_ROOT_CERT="$TMP/root.crt" \
  EXPECTED_SSL_ROOT_CERT="$TMP/root.crt" \
  R2_ENDPOINT_URL="${TEST_R2_ENDPOINT_URL:-https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com}" \
  R2_BUCKET="cashin-database-backups" \
  BACKUP_TIMESTAMP="20260917T210000Z" \
  BACKUP_DATE="2026-09-17" \
  BACKUP_CLASSES="daily,weekly" \
  "$SUBJECT"
}

run_backup
[[ $(grep -c '^crm-pg-dump$' "$TMP/calls.log") -eq 1 ]]
[[ $(grep -c '^cartera-pg-dump$' "$TMP/calls.log") -eq 1 ]]
[[ $(grep -c '^pg_restore$' "$TMP/calls.log") -eq 2 ]]
if grep -qE 'crm-secret|cartera-secret' "$TMP/pg-dump-args.log"; then
  echo "database credentials leaked into pg_dump arguments" >&2
  exit 1
fi
grep -q 's3api get-bucket-lifecycle-configuration' "$TMP/aws.log"
[[ $(grep -c ' s3 cp ' "$TMP/aws.log") -eq 10 ]]
grep -q 's3://cashin-database-backups/daily/2026/09/17/20260917T210000Z/crm.dump' "$TMP/aws.log"
grep -q 's3://cashin-database-backups/weekly/2026/09/17/20260917T210000Z/cartera.dump.sha256' "$TMP/aws.log"
grep ' s3 cp ' "$TMP/aws.log" >"$TMP/uploads.log"
[[ $(sed -n '9p' "$TMP/uploads.log") == *'/daily/2026/09/17/20260917T210000Z/.complete'* ]]
[[ $(sed -n '10p' "$TMP/uploads.log") == *'/weekly/2026/09/17/20260917T210000Z/.complete'* ]]

: >"$TMP/calls.log"
: >"$TMP/aws.log"
if FAIL_CARTERA=1 run_backup; then
  echo "expected the backup to fail when cartera pg_dump fails" >&2
  exit 1
fi
assert_no_uploads

: >"$TMP/calls.log"
: >"$TMP/aws.log"
if TEST_AWS_ACCESS_KEY_ID="" run_backup; then
  echo "expected missing AWS access key to fail" >&2
  exit 1
fi
[[ ! -s "$TMP/calls.log" ]]

if TEST_CRM_URL="postgresql://backup:crm-secret@crm-pooler.neon.tech/neondb?options=-c%20default_transaction_read_only%3Doff" run_backup; then
  echo "expected database options override to fail" >&2
  exit 1
fi

: >"$TMP/calls.log"
: >"$TMP/aws.log"
if REUSED_PREFIX=1 run_backup; then
  echo "expected reused backup prefix to fail" >&2
  exit 1
fi
[[ ! -s "$TMP/calls.log" ]]
assert_no_uploads

: >"$TMP/calls.log"
: >"$TMP/aws.log"
if BAD_LIFECYCLE=1 run_backup; then
  echo "expected missing lifecycle rules to fail" >&2
  exit 1
fi
[[ ! -s "$TMP/calls.log" ]]
assert_no_uploads

: >"$TMP/calls.log"
: >"$TMP/aws.log"
if SHORT_OVERLAPPING_LIFECYCLE=1 run_backup; then
  echo "expected shorter overlapping lifecycle rule to fail" >&2
  exit 1
fi
[[ ! -s "$TMP/calls.log" ]]
assert_no_uploads

: >"$TMP/calls.log"
: >"$TMP/aws.log"
NON_EXPIRING_OVERLAP=1 run_backup
[[ $(grep -c '^crm-pg-dump$' "$TMP/calls.log") -eq 1 ]]
[[ $(grep -c '^cartera-pg-dump$' "$TMP/calls.log") -eq 1 ]]

: >"$TMP/aws.log"
if FAIL_AWS_MATCH='/weekly/2026/09/17/20260917T210000Z/cartera.dump.sha256' run_backup; then
  echo "expected upload failure to fail the backup" >&2
  exit 1
fi
if grep -q '/.complete' "$TMP/aws.log"; then
  echo "no retention class may be marked complete after a later upload failure" >&2
  exit 1
fi

if TEST_R2_ENDPOINT_URL="http://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com" run_backup; then
  echo "expected insecure R2 endpoint to fail" >&2
  exit 1
fi

if env -i PATH="$FAKE_BIN:$PATH" "$SUBJECT" 2>/dev/null; then
  echo "expected missing configuration to fail" >&2
  exit 1
fi

echo "backup-postgres-to-r2 tests: PASS"
