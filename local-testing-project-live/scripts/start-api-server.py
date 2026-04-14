#!/usr/bin/env python3
"""
Helper script to start the Cedar API dev server in the background
and poll until it's ready to accept requests.

Usage:
    python3 scripts/start-api-server.py
"""

import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOG_FILE = "/tmp/cedar-api.log"
PID_FILE = "/tmp/cedar-api.pid"
API_URL = "http://localhost:8911/graphql"
POLL_INTERVAL_SECONDS = 3
MAX_WAIT_SECONDS = 180


def main():
    print(f"Starting Cedar API dev server in: {PROJECT_DIR}")
    print(f"Logging to: {LOG_FILE}")

    log_file = open(LOG_FILE, "w")

    proc = subprocess.Popen(
        ["yarn", "cedar", "dev", "api"],
        stdout=log_file,
        stderr=log_file,
        cwd=PROJECT_DIR,
        start_new_session=True,
    )

    with open(PID_FILE, "w") as f:
        f.write(str(proc.pid))

    print(f"Server process started with PID {proc.pid}")
    print(
        f"Polling {API_URL} every {POLL_INTERVAL_SECONDS}s (max {MAX_WAIT_SECONDS}s)..."
    )

    elapsed = 0
    attempt = 0

    while elapsed < MAX_WAIT_SECONDS:
        time.sleep(POLL_INTERVAL_SECONDS)
        elapsed += POLL_INTERVAL_SECONDS
        attempt += 1

        # Check if the process has already died
        if proc.poll() is not None:
            print(f"\nServer process exited early with code {proc.returncode}")
            print_last_log_lines(LOG_FILE, 40)
            sys.exit(1)

        try:
            query = b'{"query":"{ __typename }"}'
            req = urllib.request.Request(
                API_URL,
                data=query,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=3) as resp:
                body = resp.read().decode("utf-8", errors="replace")
                print(f"\nServer is ready after {elapsed}s! Response: {body[:120]}")
                sys.exit(0)
        except urllib.error.HTTPError as e:
            # Any HTTP response (even 4xx) means the server is up
            print(f"\nServer is ready after {elapsed}s (HTTP {e.code})")
            sys.exit(0)
        except Exception as e:
            if attempt % 5 == 0:
                print(f"  Still waiting ({elapsed}s elapsed)... [{type(e).__name__}]")

    print(f"\nServer did not become ready within {MAX_WAIT_SECONDS}s.")
    print_last_log_lines(LOG_FILE, 50)
    sys.exit(1)


def print_last_log_lines(path, n):
    try:
        with open(path) as f:
            lines = f.readlines()
        print(f"\n--- Last {n} lines of {path} ---")
        for line in lines[-n:]:
            print(line, end="")
        print("--- end of log ---")
    except OSError as e:
        print(f"Could not read log file {path}: {e}")


if __name__ == "__main__":
    main()
