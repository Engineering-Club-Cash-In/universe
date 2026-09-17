#!/usr/bin/env python3
import json
import sys

required = {
    ("daily/", 14),
    ("weekly/", 56),
    ("monthly/", 365),
}

try:
    rules = json.load(sys.stdin)["Rules"]
except (json.JSONDecodeError, KeyError, TypeError):
    raise SystemExit("invalid R2 lifecycle response")

enabled = {
    (
        rule.get("Filter", {}).get("Prefix", rule.get("Prefix")),
        rule.get("Expiration", {}).get("Days"),
    )
    for rule in rules
    if rule.get("Status") == "Enabled"
}
missing = required - enabled
if missing:
    raise SystemExit(f"missing required R2 lifecycle rules: {sorted(missing)}")
