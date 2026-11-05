#!/usr/bin/env python3
"""Build Go for a requested Tauri target and PyInstaller on a matching host."""

import argparse
import os
import platform
import shutil
import subprocess
import sys
import venv
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
API = ROOT / "api"
BINARIES = ROOT / "src-tauri" / "binaries"
TARGETS = {
    "x86_64-unknown-linux-gnu": ("linux", "amd64"),
    "aarch64-unknown-linux-gnu": ("linux", "arm64"),
    "x86_64-apple-darwin": ("darwin", "amd64"),
    "aarch64-apple-darwin": ("darwin", "arm64"),
    "x86_64-pc-windows-msvc": ("windows", "amd64"),
    "aarch64-pc-windows-msvc": ("windows", "arm64"),
}


def host_matches(target: str) -> bool:
    goos, goarch = TARGETS[target]
    host_os = {"Linux": "linux", "Darwin": "darwin", "Windows": "windows"}.get(platform.system())
    machine = platform.machine().lower()
    host_arch = "arm64" if machine in {"aarch64", "arm64"} else "amd64" if machine in {"x86_64", "amd64", "x64"} else machine
    return host_os == goos and host_arch == goarch


def run(*args: str, cwd: Path = ROOT, env: dict[str, str] | None = None) -> None:
    subprocess.run(args, cwd=cwd, env=env, check=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("target", choices=TARGETS)
    args = parser.parse_args()
    goos, goarch = TARGETS[args.target]
    BINARIES.mkdir(parents=True, exist_ok=True)
    suffix = ".exe" if goos == "windows" else ""
    local_api = BINARIES / f"local-api-{args.target}{suffix}"
    env = os.environ.copy()
    env.update({"GOOS": goos, "GOARCH": goarch, "CGO_ENABLED": "0"})
    run("go", "build", "-trimpath", "-o", str(local_api), ".", cwd=API, env=env)

    if not host_matches(args.target):
        raise SystemExit(f"Go sidecar built for {args.target}; build the Python worker on a matching OS/architecture host.")
    environment = ROOT / "src-tauri" / "target" / "sidecar-venv" / args.target
    if not environment.exists():
        venv.create(environment, with_pip=True)
    python = environment / ("Scripts/python.exe" if goos == "windows" else "bin/python")
    run(str(python), "-m", "pip", "install", "-r", str(API / "requirements-ytmusic.txt"), "-r", str(API / "requirements-build.txt"))
    work = ROOT / "src-tauri" / "target" / "pyinstaller" / args.target
    dist = ROOT / "src-tauri" / "target" / "pyinstaller-dist" / args.target
    run(str(python), "-m", "PyInstaller", "--noconfirm", "--clean", "--distpath", str(dist), "--workpath", str(work), str(API / "ytmusic_worker.spec"), cwd=API)
    worker_name = "ytmusic-worker.exe" if goos == "windows" else "ytmusic-worker"
    worker_binary = BINARIES / f"ytmusic-worker-{args.target}{suffix}"
    shutil.copy2(dist / worker_name, worker_binary)
    run(sys.executable, str(API / "smoke_ytmusic_worker.py"), str(worker_binary))


if __name__ == "__main__":
    main()
