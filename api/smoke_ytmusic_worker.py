#!/usr/bin/env python3
"""Credential-free smoke test for a packaged ytmusic-worker executable."""

import json
import subprocess
import sys
import tempfile
from pathlib import Path


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: smoke_ytmusic_worker.py PATH_TO_WORKER")
    with tempfile.TemporaryDirectory() as data_dir:
        result = subprocess.run(
            [str(Path(sys.argv[1]).resolve()), "--data-dir", data_dir],
            input=json.dumps({"id": 1, "method": "auth.status", "params": {}}) + "\n",
            capture_output=True,
            text=True,
            timeout=15,
            check=True,
        )
    response = json.loads(result.stdout)
    if response != {"id": 1, "result": {"authorized": False}}:
        raise SystemExit("worker did not return the expected unauthenticated status")


if __name__ == "__main__":
    main()
