#!/usr/bin/env python3
"""Copy a backend .env file into AWS SSM Parameter Store, one SecureString per setting.

Why: the new server reads its settings from /nasa/prod/* (see terraform/user_data.sh.tpl). Values must never be
pasted into chat, a ticket or the repository, so this script reads the file itself and sends each value straight
to AWS through a private temporary file that is deleted at once (never on a command line, so it is not visible in the
process list).

Safe by default: with no --apply it only PRINTS the setting NAMES it would create (never a value) and writes nothing.

    # 1. look first (writes nothing)
    python3 copy-env-to-ssm.py /path/to/.env

    # 2. write for real
    AWS_PROFILE=nasa python3 copy-env-to-ssm.py /path/to/.env --apply

Rules it follows:
  * NODE_ENV, PORT and TRUST_PROXY are skipped: the server's bootstrap writes them itself.
  * SCHEDULED_JOBS_ENABLED is forced to "false": while the old server is still running, the new one must not run
    the scheduled jobs. Turn it on at cutover (see the migration steps).
  * An existing parameter is never replaced unless you add --overwrite.
  * A value that holds a line break is refused (the bootstrap reads one line per setting). Fix it first.
  * Empty values are skipped (an unset switch must stay unset).
"""
import argparse
import json
import os
import re
import subprocess
import sys
import tempfile

SKIP = {"NODE_ENV", "PORT", "TRUST_PROXY"}
FORCED = {"SCHEDULED_JOBS_ENABLED": "false"}
NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
MAX_BYTES = 4096  # standard parameter size limit


def parse_env(path):
    """Minimal .env reader: KEY=VALUE, optional 'export ', optional matching quotes, # comments."""
    out = {}
    with open(path, encoding="utf-8") as handle:
        for number, raw in enumerate(handle, 1):
            line = raw.rstrip("\r\n")
            if not line.strip() or line.lstrip().startswith("#"):
                continue
            line = re.sub(r"^\s*export\s+", "", line)
            if "=" not in line:
                print(f"line {number}: no '=', ignored", file=sys.stderr)
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            if not NAME_RE.match(key):
                print(f"line {number}: '{key[:20]}' is not a valid setting name, ignored", file=sys.stderr)
                continue
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            out[key] = value
    return out


def put(name, value, overwrite, region):
    # The value goes through a private temporary file (owner-only, removed straight after), never a command line,
    # so it does not show in the process list.
    body = {"Name": name, "Value": value, "Type": "SecureString", "Overwrite": overwrite,
            "Description": "NASA backend setting copied from the old server's .env"}
    handle, path = tempfile.mkstemp(prefix="nasa-ssm-", suffix=".json")  # created with mode 0600
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as out:
            json.dump(body, out)
        cmd = ["aws", "ssm", "put-parameter", "--region", region, "--cli-input-json", "file://" + path]
        result = subprocess.run(cmd, capture_output=True, text=True)
    finally:
        os.remove(path)
    return result.returncode == 0, result.stderr.strip()[:200]


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("env_file")
    parser.add_argument("--path", default="/nasa/prod", help="parameter path prefix (default /nasa/prod)")
    parser.add_argument("--region", default="us-east-1")
    parser.add_argument("--apply", action="store_true", help="write to AWS (default: names only, writes nothing)")
    parser.add_argument("--overwrite", action="store_true", help="replace parameters that already exist")
    args = parser.parse_args()

    prefix = args.path.rstrip("/")
    settings = parse_env(args.env_file)
    plan, refused = {}, []
    for key, value in settings.items():
        if key in SKIP:
            continue
        value = FORCED.get(key, value)
        if value == "":
            continue
        if "\n" in value or "\r" in value or len(value.encode()) > MAX_BYTES:
            refused.append(key)
            continue
        plan[key] = value
    for key, value in FORCED.items():
        plan.setdefault(key, value)

    print(f"{'WRITING' if args.apply else 'DRY RUN (nothing is written)'}: {len(plan)} settings under {prefix}/")
    for key in sorted(plan):
        tag = "  (forced)" if key in FORCED else ""
        print(f"  {prefix}/{key}  [{len(plan[key])} characters]{tag}")
    if SKIP & settings.keys():
        print("skipped (the bootstrap sets them):", ", ".join(sorted(SKIP & settings.keys())))
    if refused:
        print("REFUSED (line break or over 4 KB, fix in the file first):", ", ".join(sorted(refused)))

    if not args.apply:
        print("\nNothing written. Add --apply to write these.")
        return 1 if refused else 0

    failed = []
    for key in sorted(plan):
        ok, error = put(f"{prefix}/{key}", plan[key], args.overwrite, args.region)
        if not ok:
            failed.append(key)
            print(f"  FAILED {key}: {error}", file=sys.stderr)
    print(f"\nwritten: {len(plan) - len(failed)}, failed: {len(failed)}, refused: {len(refused)}")
    return 1 if (failed or refused) else 0


if __name__ == "__main__":
    sys.exit(main())
