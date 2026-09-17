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

def rule_retention(rule):
    filter_value = rule.get("Filter") or {}
    prefix = filter_value.get("Prefix")
    if prefix is None:
        prefix = (filter_value.get("And") or {}).get("Prefix")
    if prefix is None:
        prefix = rule.get("Prefix", "")
    return prefix, rule.get("Expiration", {}).get("Days")

enabled = [rule_retention(rule) for rule in rules if rule.get("Status") == "Enabled"]
missing = required - set(enabled)
if missing:
    raise SystemExit(f"missing required R2 lifecycle rules: {sorted(missing)}")

for required_prefix, required_days in required:
    for rule_prefix, rule_days in enabled:
        overlaps = required_prefix.startswith(rule_prefix) or rule_prefix.startswith(required_prefix)
        if overlaps and (not isinstance(rule_days, int) or rule_days < required_days):
            raise SystemExit(
                f"R2 lifecycle rule {rule_prefix!r} expires {required_prefix!r} "
                f"before {required_days} days"
            )
