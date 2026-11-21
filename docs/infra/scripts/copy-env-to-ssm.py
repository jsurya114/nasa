#!/usr/bin/env python3
"""Copy a backend .env file into AWS SSM Parameter Store, one SecureString per setting.

Why: the new server reads its settings from /nasa/prod/* (see terraform/user_data.sh.tpl). Values must never be
pasted into chat, a ticket or the repository, so this script reads the file itself and sends each value straight
to AWS through a private temporary file that is deleted at once (never on a command line, so it is not visible in
the process list).

Safe by default: with no --apply it only PRINTS the setting NAMES it would create (never a value) and writes nothing.

    # 1. look first (writes nothing). Run it from a machine that has Node and Backend/node_modules (npm ci).
    python3 copy-env-to-ssm.py /path/to/.env

    # 2. write for real
    AWS_PROFILE=nasa python3 copy-env-to-ssm.py /path/to/.env --apply

Values are read with the backend's own parser (dotenv from Backend/node_modules), so each one is exactly what the
old server's app sees: quotes, "\\n" inside double quotes and inline "# comments" are handled as the app handles them.

Before anything is written, every setting goes through the server's own renderer: the script runs
terraform/render-env.cjs (the code the bootstrap runs at boot) with the backend's dotenv, and REFUSES any setting it
cannot carry unchanged (a carriage return, a trailing backslash, a value holding all three quote characters, a name
that is not a valid setting name). Refused settings are listed by name only. With --apply nothing is written while any
is refused, so the copy is complete or absent. This check and the real boot can never disagree.

Other rules:
  * NODE_ENV, PORT and TRUST_PROXY are skipped: the server's bootstrap writes them itself.
  * SCHEDULED_JOBS_ENABLED is forced to "false": while the old server is still running, the new one must not run
    the scheduled jobs. Turn it on at cutover (see the migration steps).
  * An existing parameter is never replaced unless you add --overwrite.
  * Empty values are skipped (an unset switch must stay unset). Line breaks are allowed (they are marked in the list
    so you can check them against the old file). A value over 4 KB (up to 8 KB, for example a certificate chain) is
    stored in SSM's advanced tier (about $0.05 a month each) and marked in the list; over 8 KB is refused.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

SKIP = {"NODE_ENV", "PORT", "TRUST_PROXY"}
FORCED = {"SCHEDULED_JOBS_ENABLED": "false"}
NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
MAX_STANDARD = 4096  # standard-tier parameter size limit
MAX_ADVANCED = 8192  # advanced-tier parameter size limit
DEFAULT_BACKEND_DIR = Path(__file__).resolve().parents[3] / "Backend"
RENDER_ENV = Path(__file__).resolve().parents[1] / "terraform" / "render-env.cjs"

# Reads {parameters, port} on standard input and prints the names render-env.cjs would refuse, as JSON. It calls the
# same settingsFrom and render the bootstrap uses, with the backend's own dotenv.
RENDER_CHECK_JS = (
    "const {createRequire}=require('module');const r=require(process.argv[1]);"
    "const dotenv=createRequire(process.cwd()+'/package.json')('dotenv');"
    "let s='';process.stdin.setEncoding('utf8');"
    "process.stdin.on('data',d=>s+=d).on('end',()=>{const q=JSON.parse(s);"
    "const {settings}=r.settingsFrom(q.parameters,q.port);"
    "process.stdout.write(JSON.stringify(r.render(settings,dotenv.parse).bad))})"
)

# Reads the text on standard input and prints what the backend's dotenv makes of it, as JSON.
DOTENV_PARSE_JS = (
    "let s='';process.stdin.setEncoding('utf8');"
    "process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.stringify(require('dotenv').parse(s))))"
)


def dotenv_parse(text, backend_dir):
    """Parse .env text with the backend's own dotenv (the parser the app uses), so values match the old server."""
    try:
        result = subprocess.run(["node", "-e", DOTENV_PARSE_JS], input=text, cwd=backend_dir,
                                capture_output=True, text=True)
    except FileNotFoundError:
        sys.exit("node was not found. Install Node, or run this on a machine that has it.")
    if result.returncode != 0:
        sys.exit(f"could not run dotenv from {backend_dir} (run 'npm ci' in Backend first): "
                 f"{result.stderr.strip()[:200]}")
    return json.loads(result.stdout)


def renderer_refuses(plan, backend_dir):
    """Names of the settings the server's bootstrap would stop on, using its own renderer (render-env.cjs) and the
    backend's dotenv, so this check and the real boot can never disagree."""
    if not RENDER_ENV.is_file():
        sys.exit(f"{RENDER_ENV} not found: run this from a checkout that has the bootstrap renderer (develop or main).")
    request = {"parameters": [{"Name": f"/x/{key}", "Value": value} for key, value in plan.items()], "port": "3251"}
    try:
        result = subprocess.run(["node", "-e", RENDER_CHECK_JS, str(RENDER_ENV)], input=json.dumps(request),
                                cwd=backend_dir, capture_output=True, text=True)
    except FileNotFoundError:
        sys.exit("node was not found. Install Node, or run this on a machine that has it.")
    if result.returncode != 0:
        sys.exit(f"could not run the renderer check (run 'npm ci' in Backend first): {result.stderr.strip()[:200]}")
    return json.loads(result.stdout)


def put(name, value, overwrite, region):
    # The value goes through a private temporary file (owner-only, removed straight after), never a command line,
    # so it does not show in the process list.
    body = {"Name": name, "Value": value, "Type": "SecureString", "Overwrite": overwrite,
            "Description": "NASA backend setting copied from the old server's .env"}
    if len(value.encode()) > MAX_STANDARD:
        body["Tier"] = "Advanced"  # needed above 4 KB; costs about $0.05 a month for this parameter
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
    parser.add_argument("--backend-dir", default=str(DEFAULT_BACKEND_DIR),
                        help="folder with node_modules/dotenv (default: Backend next to this script's repo)")
    parser.add_argument("--apply", action="store_true", help="write to AWS (default: names only, writes nothing)")
    parser.add_argument("--overwrite", action="store_true", help="replace parameters that already exist")
    args = parser.parse_args()

    with open(args.env_file, encoding="utf-8") as handle:
        settings = dotenv_parse(handle.read(), args.backend_dir)

    prefix = args.path.rstrip("/")
    plan, too_big, bad_names = {}, [], []
    for key, value in settings.items():
        if key in SKIP:
            continue
        if not NAME_RE.match(key):
            bad_names.append(key[:30])
            continue
        value = FORCED.get(key, value)
        if value == "":
            continue
        if len(value.encode()) > MAX_ADVANCED:
            too_big.append(key)
            continue
        plan[key] = value
    for key, value in FORCED.items():
        plan.setdefault(key, value)

    # Round trip with the SAME code the server's bootstrap runs (terraform/render-env.cjs): every setting must come
    # back from dotenv exactly as stored, or it is refused by name.
    changed = sorted(renderer_refuses(plan, args.backend_dir))

    print(f"{'WRITING' if args.apply else 'DRY RUN (nothing is written)'}: "
          f"{len(plan) - len(changed)} settings under {prefix}/")
    for key in sorted(plan):
        if key in changed:
            continue
        marks = []
        if key in FORCED:
            marks.append("forced")
        if "\n" in plan[key] or "\r" in plan[key]:
            marks.append("has line breaks: check it against the old file")
        if len(plan[key].encode()) > MAX_STANDARD:
            marks.append("over 4 KB: advanced tier, about $0.05 a month")
        print(f"  {prefix}/{key}  [{len(plan[key])} characters]" + (f"  ({'; '.join(marks)})" if marks else ""))
    if SKIP & settings.keys():
        print("skipped (the bootstrap sets them):", ", ".join(sorted(SKIP & settings.keys())))
    if bad_names:
        print("IGNORED, not a valid setting name:", ", ".join(sorted(bad_names)))
    if changed:
        print("REFUSED, the value would arrive on the new server changed (round trip failed):", ", ".join(changed))
    if too_big:
        print("REFUSED, over 8 KB:", ", ".join(sorted(too_big)))

    refused = bool(changed or too_big)
    if not args.apply:
        print("\nNothing written. Add --apply to write these." +
              ("\nSome settings are REFUSED: they would not be copied." if refused else ""))
        return 1 if refused else 0
    if refused:
        print("\nNothing written: fix the refused settings first, so the copy is complete.", file=sys.stderr)
        return 1

    failed = []
    for key in sorted(plan):
        ok, error = put(f"{prefix}/{key}", plan[key], args.overwrite, args.region)
        if not ok:
            failed.append(key)
            print(f"  FAILED {key}: {error}", file=sys.stderr)
    print(f"\nwritten: {len(plan) - len(failed)}, failed: {len(failed)}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
