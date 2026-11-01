#!/usr/bin/env python3
"""
Resource Monitor backend.

Polls Ricoh (and other Printer-MIB compatible) printers over SNMP, writes a
``printer_data.json`` snapshot and optionally:

* uploads it to a web host over SFTP (atomic rename, so the website never
  reads a half-written file), and
* POSTs the same snapshot to the PHP history logger
  (``Frontend/api/process-printers.php``).

It runs headless, so it works the same on a Raspberry Pi, a Linux server,
inside Docker, as a systemd service or on Windows.

Usage::

    python RicohReader.py                 # poll forever (same as "run")
    python RicohReader.py once            # poll a single time and exit
    python RicohReader.py check           # show the effective configuration
    python RicohReader.py printers list   # manage Printers.json
    python RicohReader.py --help

Configuration is read from ``config.json`` (see ``config.example.json``),
the legacy ``credentials.json`` and ``RM_*`` environment variables, in
increasing order of priority.
"""

from __future__ import annotations

import argparse
import asyncio
import copy
import json
import logging
import os
import pickle
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Any

__version__ = "4.0.0"

log = logging.getLogger("resource-monitor")

BASE_DIR = Path(__file__).resolve().parent

# Printer-MIB (RFC 3805) OIDs. Ricoh devices expose all of these.
OID_MODEL = "1.3.6.1.2.1.43.5.1.1.16.1"
OID_SERIAL = "1.3.6.1.2.1.43.5.1.1.17.1"
OID_SUPPLY_NAMES = "1.3.6.1.2.1.43.11.1.1.6.1"
OID_SUPPLY_MAX = "1.3.6.1.2.1.43.11.1.1.8.1"
OID_SUPPLY_LEVELS = "1.3.6.1.2.1.43.11.1.1.9.1"
OID_TRAY_MAX = "1.3.6.1.2.1.43.8.2.1.9.1"
OID_TRAY_LEVELS = "1.3.6.1.2.1.43.8.2.1.10.1"
OID_TRAY_NAMES = "1.3.6.1.2.1.43.8.2.1.13.1"
OID_ALERTS = "1.3.6.1.2.1.43.18.1.1.8.1"

# Placeholder strings kept for compatibility with the frontend, the PHP
# logger and older snapshots.
ERR_MODEL = "Error fetching model"
ERR_INK = "Error fetching ink levels"
ERR_TRAY = "Error fetching tray information"
ERR_ERRORS = "Error fetching errors"

DEFAULT_CONFIG: dict[str, Any] = {
    "interval_seconds": 40,
    "printers_file": "Printers.json",
    "concurrency": 16,
    "snmp": {
        "community": "public",
        "port": 161,
        "timeout": 6,
        "retries": 2,
    },
    "output": {
        # Where the snapshot is written locally. When the backend runs on the
        # same machine as the web server, point this straight into the web
        # folder and leave SFTP disabled.
        "file": "printer_data.json",
    },
    "sftp": {
        "enabled": None,  # None = enabled automatically when host is set
        "host": "",
        "port": 22,
        "user": "",
        "pass": "",
        "key_file": "",
        "path": "",
        # false = trust on first use: the server key is saved to known_hosts
        #         and the upload is refused if it ever changes.
        # true  = only accept keys already in ~/.ssh/known_hosts.
        "verify_host_key": False,
        "known_hosts_file": "known_hosts",
        "timeout": 15,
    },
    "logger": {
        "url": "",
        "key": "",
        "timeout": 15,
    },
}

# Environment variable -> config path. Handy for Docker and systemd.
ENV_OVERRIDES: dict[str, tuple[str, ...]] = {
    "RM_INTERVAL": ("interval_seconds",),
    "RM_PRINTERS_FILE": ("printers_file",),
    "RM_CONCURRENCY": ("concurrency",),
    "RM_SNMP_COMMUNITY": ("snmp", "community"),
    "RM_SNMP_PORT": ("snmp", "port"),
    "RM_SNMP_TIMEOUT": ("snmp", "timeout"),
    "RM_SNMP_RETRIES": ("snmp", "retries"),
    "RM_OUTPUT_FILE": ("output", "file"),
    "RM_SFTP_ENABLED": ("sftp", "enabled"),
    "RM_SFTP_HOST": ("sftp", "host"),
    "RM_SFTP_PORT": ("sftp", "port"),
    "RM_SFTP_USER": ("sftp", "user"),
    "RM_SFTP_PASS": ("sftp", "pass"),
    "RM_SFTP_KEY_FILE": ("sftp", "key_file"),
    "RM_SFTP_PATH": ("sftp", "path"),
    "RM_SFTP_VERIFY_HOST_KEY": ("sftp", "verify_host_key"),
    "RM_LOGGER_URL": ("logger", "url"),
    "RM_LOGGER_KEY": ("logger", "key"),
}

PRINTER_DEFAULTS = {"IP": "", "Name": "", "Serial": "", "EID": "", "Default": True}


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

class ConfigError(Exception):
    """Raised for configuration problems the user has to fix."""


def _deep_merge(base: dict, override: dict) -> dict:
    result = copy.deepcopy(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = _deep_merge(result[key], value)
        else:
            result[key] = value
    return result


def _coerce(value: str, current: Any) -> Any:
    if isinstance(current, bool) or current is None and value.lower() in {"true", "false", "1", "0", "yes", "no"}:
        return value.strip().lower() in {"1", "true", "yes", "on"}
    if isinstance(current, int) and not isinstance(current, bool):
        return int(value)
    return value


def _read_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8-sig") as handle:
        return json.load(handle)


def legacy_credentials_to_config(credentials: dict) -> dict:
    """Map the old flat ``credentials.json`` format onto the new structure."""
    sftp = {key: credentials[key] for key in ("host", "port", "user", "pass", "path") if key in credentials}
    if "port" in sftp:
        sftp["port"] = int(sftp["port"])
    config: dict[str, Any] = {"sftp": sftp}
    logger_cfg = {}
    if credentials.get("logger_url"):
        logger_cfg["url"] = credentials["logger_url"]
    if credentials.get("logger_key"):
        logger_cfg["key"] = credentials["logger_key"]
    if logger_cfg:
        config["logger"] = logger_cfg
    return config


def load_config(config_path: Path | None = None, environ: dict[str, str] | None = None) -> dict:
    """Build the effective configuration: defaults < credentials.json < config.json < env."""
    environ = os.environ if environ is None else environ
    config = copy.deepcopy(DEFAULT_CONFIG)

    legacy = BASE_DIR / "credentials.json"
    if legacy.is_file():
        try:
            config = _deep_merge(config, legacy_credentials_to_config(_read_json(legacy)))
        except (OSError, ValueError) as exc:
            raise ConfigError(f"Could not read {legacy}: {exc}") from exc

    path = config_path or Path(environ.get("RM_CONFIG", BASE_DIR / "config.json"))
    if path.is_file():
        try:
            config = _deep_merge(config, _read_json(path))
        except (OSError, ValueError) as exc:
            raise ConfigError(f"Could not read {path}: {exc}") from exc
    elif config_path is not None:
        raise ConfigError(f"Config file not found: {path}")

    for env_name, keys in ENV_OVERRIDES.items():
        if env_name not in environ or environ[env_name] == "":
            continue
        target = config
        for key in keys[:-1]:
            target = target.setdefault(key, {})
        try:
            target[keys[-1]] = _coerce(environ[env_name], target.get(keys[-1]))
        except ValueError as exc:
            raise ConfigError(f"Invalid value for {env_name}: {environ[env_name]!r}") from exc

    sftp = config["sftp"]
    if sftp.get("enabled") is None:
        sftp["enabled"] = bool(sftp.get("host"))

    if int(config["interval_seconds"]) < 5:
        raise ConfigError("interval_seconds must be at least 5")

    return config


def resolve_path(value: str | os.PathLike) -> Path:
    path = Path(value).expanduser()
    return path if path.is_absolute() else BASE_DIR / path


def redact(config: dict) -> dict:
    safe = copy.deepcopy(config)
    for section, key in (("sftp", "pass"), ("logger", "key")):
        if safe.get(section, {}).get(key):
            safe[section][key] = "********"
    return safe


# ---------------------------------------------------------------------------
# Printer list
# ---------------------------------------------------------------------------

class _SafeUnpickler(pickle.Unpickler):
    """Only allows plain builtin containers, so importing a legacy .pkl is safe."""

    def find_class(self, module: str, name: str):  # noqa: D401
        raise pickle.UnpicklingError(f"Refusing to load {module}.{name} from pickle")


def normalize_printer(entry: dict) -> dict:
    if not isinstance(entry, dict):
        raise ValueError("Each printer must be a JSON object")
    printer = {**PRINTER_DEFAULTS, **entry}
    printer["IP"] = str(printer["IP"]).strip()
    printer["Name"] = str(printer["Name"]).strip() or printer["IP"]
    printer["Serial"] = str(printer["Serial"] or "").strip()
    printer["EID"] = str(printer["EID"] or "").strip()
    if isinstance(printer["Default"], str):
        printer["Default"] = printer["Default"].strip().lower() in {"1", "true", "yes"}
    if not printer["IP"]:
        raise ValueError(f"Printer {entry!r} is missing an IP address")
    return printer


def load_printers(path: Path) -> list[dict]:
    if not path.is_file():
        raise ConfigError(
            f"Printer list not found: {path}\n"
            f"Create it with:  python {Path(__file__).name} printers add --ip 192.0.2.10 --name \"Office\""
        )
    try:
        data = _read_json(path)
    except ValueError as exc:
        raise ConfigError(f"{path} is not valid JSON: {exc}") from exc
    if not isinstance(data, list):
        raise ConfigError(f"{path} must contain a JSON list of printers")
    return [normalize_printer(item) for item in data]


def save_printers(path: Path, printers: list[dict]) -> None:
    atomic_write_json(path, [normalize_printer(p) for p in printers])


def import_pickle(source: Path) -> list[dict]:
    with source.open("rb") as handle:
        data = _SafeUnpickler(handle).load()
    if not isinstance(data, list):
        raise ConfigError("The .pkl file does not contain a list of printers")
    return [normalize_printer(item) for item in data]


# ---------------------------------------------------------------------------
# SNMP
# ---------------------------------------------------------------------------

def decode_snmp_text(value: Any) -> str:
    """Ricoh returns text as either UTF-8 or Latin-1; try UTF-8 first."""
    if isinstance(value, (bytes, bytearray)):
        raw = bytes(value).rstrip(b"\x00")
        try:
            return raw.decode("utf-8").strip()
        except UnicodeDecodeError:
            return raw.decode("latin-1").strip()
    return "" if value is None else str(value).strip()


SUPPLY_COLOR_KEYWORDS = (
    ("waste", ("waste", "brukt", "spill", "rest", "abfall", "resttoner", "used toner")),
    ("black", ("black", "sort", "svart", "schwarz", " k ", "(k)")),
    ("cyan", ("cyan",)),
    ("magenta", ("magenta",)),
    ("yellow", ("yellow", "gul", "gelb")),
)


def detect_supply_color(name: str) -> str | None:
    lowered = f" {name.lower()} "
    for color, keywords in SUPPLY_COLOR_KEYWORDS:
        if any(keyword in lowered for keyword in keywords):
            return color
    return None


def supply_percent(level: Any, maximum: Any) -> int | None:
    """Convert a Printer-MIB level/max pair into a percentage (None if unknown)."""
    try:
        level = int(level)
    except (TypeError, ValueError):
        return None
    if level < 0:
        return None  # -2 = unknown, -3 = "some remaining"
    try:
        maximum = int(maximum)
    except (TypeError, ValueError):
        maximum = 100
    if maximum <= 0:
        maximum = 100
    return max(0, min(100, round(level * 100 / maximum)))


def _int_or_none(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


class SnmpReader:
    """Small async wrapper around puresnmp 2.x."""

    def __init__(self, community: str, port: int, timeout: int, retries: int):
        self.community = community
        self.port = port
        self.timeout = timeout
        # puresnmp treats "retries" as the number of attempts; 0 would never send.
        self.retries = max(1, retries)

    def _client(self, ip: str, community: str | None = None):
        from puresnmp import Client, PyWrapper, V2C

        client = Client(ip, V2C(community or self.community), port=self.port)
        client.configure(timeout=self.timeout, retries=self.retries)
        return PyWrapper(client)

    @staticmethod
    async def _walk(client, oid: str) -> list[Any]:
        values = []
        async for varbind in client.walk(oid):
            values.append(varbind.value)
        return values

    async def read_printer(self, printer: dict) -> dict:
        ip = printer["IP"]
        client = self._client(ip, printer.get("Community"))
        info: dict[str, Any] = {}

        try:
            info["Model"] = decode_snmp_text(await client.get(OID_MODEL)) or ERR_MODEL
        except Exception as exc:  # noqa: BLE001 - any failure means "offline"
            log.warning("%s (%s): no SNMP response (%s)", printer["Name"], ip, type(exc).__name__)
            info.update({
                "Online": False,
                "Model": ERR_MODEL,
                "Ink Levels": [ERR_INK],
                "Supplies": [],
                "Tray Information": [ERR_TRAY],
                "Trays": [],
                "Errors": [ERR_ERRORS],
            })
            return info

        info["Online"] = True

        try:
            info["DetectedSerial"] = decode_snmp_text(await client.get(OID_SERIAL))
        except Exception:  # noqa: BLE001 - optional value
            pass

        # Supplies (toner). "Ink Levels" keeps the legacy "NN%" list.
        try:
            levels = await self._walk(client, OID_SUPPLY_LEVELS)
            info["Ink Levels"] = [f"{value}%" for value in levels]
            try:
                names = [decode_snmp_text(v) for v in await self._walk(client, OID_SUPPLY_NAMES)]
                maxima = await self._walk(client, OID_SUPPLY_MAX)
            except Exception:  # noqa: BLE001
                names, maxima = [], []
            supplies = []
            for index, level in enumerate(levels):
                name = names[index] if index < len(names) else ""
                maximum = maxima[index] if index < len(maxima) else None
                supplies.append({
                    "index": index,
                    "name": name,
                    "color": detect_supply_color(name) if name else None,
                    "level": _int_or_none(level),
                    "max": _int_or_none(maximum),
                    "percent": supply_percent(level, maximum),
                })
            info["Supplies"] = supplies
        except Exception as exc:  # noqa: BLE001
            log.warning("%s (%s): could not read toner levels: %s", printer["Name"], ip, exc)
            info["Ink Levels"] = [ERR_INK]
            info["Supplies"] = []

        # Paper trays. "Tray Information" keeps the legacy list of strings.
        try:
            levels = await self._walk(client, OID_TRAY_LEVELS)
            info["Tray Information"] = [str(value) for value in levels]
            try:
                names = [decode_snmp_text(v) for v in await self._walk(client, OID_TRAY_NAMES)]
                maxima = await self._walk(client, OID_TRAY_MAX)
            except Exception:  # noqa: BLE001
                names, maxima = [], []
            info["Trays"] = [
                {
                    "index": index,
                    "name": names[index] if index < len(names) else "",
                    "level": _int_or_none(level),
                    "max": _int_or_none(maxima[index]) if index < len(maxima) else None,
                }
                for index, level in enumerate(levels)
            ]
        except Exception as exc:  # noqa: BLE001
            log.warning("%s (%s): could not read trays: %s", printer["Name"], ip, exc)
            info["Tray Information"] = [ERR_TRAY]
            info["Trays"] = []

        # Active alerts / status messages.
        try:
            errors = []
            for value in await self._walk(client, OID_ALERTS):
                text = decode_snmp_text(value)
                if text:
                    errors.append(text)
            info["Errors"] = errors
        except Exception as exc:  # noqa: BLE001
            log.warning("%s (%s): could not read alerts: %s", printer["Name"], ip, exc)
            info["Errors"] = [ERR_ERRORS]

        return info


async def poll_printers(printers: list[dict], reader: SnmpReader, concurrency: int) -> list[dict]:
    now = datetime.now().astimezone()
    legacy_time = now.strftime("%d %m %Y, %H:%M")
    timestamp = now.isoformat(timespec="seconds")
    semaphore = asyncio.Semaphore(max(1, concurrency))

    async def one(printer: dict) -> dict:
        async with semaphore:
            result = await reader.read_printer(printer)
        base = {key: printer.get(key, PRINTER_DEFAULTS[key]) for key in PRINTER_DEFAULTS}
        base.update({"Time": legacy_time, "Timestamp": timestamp})
        base.update(result)
        return base

    return list(await asyncio.gather(*(one(p) for p in printers)))


# ---------------------------------------------------------------------------
# Output: local file, SFTP and history logger
# ---------------------------------------------------------------------------

def atomic_write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(data, handle, indent=4, ensure_ascii=False)
            handle.write("\n")
        os.chmod(tmp_name, 0o644)
        os.replace(tmp_name, path)
    except BaseException:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise


def upload_sftp(local_file: Path, settings: dict) -> None:
    """Upload atomically: write ``<name>.uploading`` then rename over the real file."""
    import paramiko

    ssh = paramiko.SSHClient()
    known_hosts = resolve_path(settings.get("known_hosts_file") or "known_hosts")
    if settings.get("verify_host_key"):
        ssh.load_system_host_keys()
        ssh.set_missing_host_key_policy(paramiko.RejectPolicy())
    else:
        # Trust on first use. A changed key raises BadHostKeyException
        # (possible man-in-the-middle) instead of silently uploading.
        if known_hosts.is_file():
            ssh.load_host_keys(str(known_hosts))
        else:
            known_hosts.parent.mkdir(parents=True, exist_ok=True)
            known_hosts.touch(mode=0o600)
            ssh.load_host_keys(str(known_hosts))
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    connect_args: dict[str, Any] = {
        "hostname": settings["host"],
        "port": int(settings.get("port") or 22),
        "username": settings.get("user") or None,
        "timeout": int(settings.get("timeout") or 15),
    }
    if settings.get("key_file"):
        connect_args["key_filename"] = str(resolve_path(settings["key_file"]))
    if settings.get("pass"):
        connect_args["password"] = settings["pass"]

    try:
        ssh.connect(**connect_args)
        if not settings.get("verify_host_key"):
            try:
                ssh.save_host_keys(str(known_hosts))
            except OSError as exc:
                log.warning("Could not save %s: %s", known_hosts, exc)
        with ssh.open_sftp() as sftp:
            if settings.get("path"):
                sftp.chdir(settings["path"])
            remote = local_file.name
            temp = remote + ".uploading"
            sftp.put(str(local_file), temp)
            try:
                sftp.posix_rename(temp, remote)
            except (OSError, AttributeError):
                # Fallback for servers without the posix-rename extension.
                try:
                    sftp.remove(remote)
                except OSError:
                    pass
                sftp.rename(temp, remote)
        log.info("Uploaded %s to %s:%s", local_file.name, settings["host"], settings.get("path") or "~")
    finally:
        ssh.close()


def post_to_logger(snapshot: list[dict], settings: dict) -> dict | None:
    url = (settings.get("url") or "").strip()
    key = (settings.get("key") or "").strip()
    if not url or not key:
        return None
    if urllib.parse.urlsplit(url).scheme not in {"http", "https"}:
        raise RuntimeError("logger.url must start with https:// (or http:// for a local server)")

    request = urllib.request.Request(
        url,
        data=json.dumps(snapshot, ensure_ascii=False).encode("utf-8"),
        method="POST",
        headers={
            "Content-Type": "application/json; charset=utf-8",
            "X-Logger-Key": key,
            "User-Agent": f"ResourceMonitor/{__version__}",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=int(settings.get("timeout") or 15)) as response:
            body = response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"history logger answered HTTP {exc.code}: {body[:500]}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"could not reach history logger: {exc.reason}") from exc

    try:
        result = json.loads(body)
    except ValueError:
        raise RuntimeError(f"history logger returned invalid JSON: {body[:200]}") from None
    log.info(
        "History logger: %s opened, %s resolved",
        result.get("incidents_opened", "?"),
        result.get("incidents_resolved", "?"),
    )
    return result


def security_warnings(config: dict) -> list[str]:
    """Problems worth logging once at start-up."""
    warnings = []
    url = str(config["logger"].get("url") or "")
    if url.startswith("http://"):
        host = urllib.parse.urlsplit(url).hostname or ""
        if host not in {"localhost", "127.0.0.1", "::1", "web"} and "." in host:
            warnings.append("logger.url uses plain http:// - the logger key is sent unencrypted. Use https://.")
    if config["logger"].get("key") and len(str(config["logger"]["key"])) < 16:
        warnings.append("logger.key is shorter than 16 characters; the website will refuse it.")
    if os.name == "posix":
        for name in ("config.json", "credentials.json"):
            path = BASE_DIR / name
            if path.is_file() and path.stat().st_mode & 0o077:
                warnings.append(f"{path} is readable by other users and contains secrets. Run: chmod 600 {path}")
    return warnings


def poll_once(config: dict) -> list[dict]:
    printers = load_printers(resolve_path(config["printers_file"]))
    snmp = config["snmp"]
    reader = SnmpReader(str(snmp["community"]), int(snmp["port"]), int(snmp["timeout"]), int(snmp["retries"]))

    started = time.monotonic()
    snapshot = asyncio.run(poll_printers(printers, reader, int(config.get("concurrency", 16))))
    online = sum(1 for p in snapshot if p.get("Online"))
    log.info("Polled %d printers (%d online) in %.1fs", len(snapshot), online, time.monotonic() - started)

    output = resolve_path(config["output"]["file"])
    atomic_write_json(output, snapshot)
    log.debug("Wrote %s", output)

    # Upload and logging are independent: one failing must not stop the other.
    if config["sftp"].get("enabled"):
        try:
            upload_sftp(output, config["sftp"])
        except Exception as exc:  # noqa: BLE001
            log.error("SFTP upload failed: %s", exc)

    try:
        post_to_logger(snapshot, config["logger"])
    except Exception as exc:  # noqa: BLE001
        log.error("History logging failed: %s", exc)

    return snapshot


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

def cmd_run(config: dict, _args) -> int:
    stop = {"flag": False}

    def handle_signal(signum, _frame):
        log.info("Received signal %s, stopping after the current poll...", signum)
        stop["flag"] = True

    for sig in (getattr(signal, "SIGTERM", None), getattr(signal, "SIGINT", None)):
        if sig is not None:
            signal.signal(sig, handle_signal)

    for warning in security_warnings(config):
        log.warning("Security: %s", warning)

    interval = int(config["interval_seconds"])
    log.info("Resource Monitor %s started, polling every %ss (Ctrl+C to stop)", __version__, interval)
    while not stop["flag"]:
        started = time.monotonic()
        try:
            poll_once(config)
        except ConfigError as exc:
            log.error("%s", exc)
        except Exception:  # noqa: BLE001 - keep the service alive
            log.exception("Unexpected error during polling")
        deadline = started + interval
        while not stop["flag"] and time.monotonic() < deadline:
            time.sleep(min(1.0, max(0.0, deadline - time.monotonic())))
    log.info("Stopped.")
    return 0


def cmd_once(config: dict, args) -> int:
    snapshot = poll_once(config)
    if args.print:
        json.dump(snapshot, sys.stdout, indent=2, ensure_ascii=False)
        print()
    return 0


def cmd_check(config: dict, _args) -> int:
    print(json.dumps(redact(config), indent=2, ensure_ascii=False))
    for warning in security_warnings(config):
        print(f"WARNING: {warning}")
    path = resolve_path(config["printers_file"])
    printers = load_printers(path)
    print(f"\n{len(printers)} printer(s) in {path}")
    print(f"Snapshot file: {resolve_path(config['output']['file'])}")
    print(f"SFTP upload:   {'enabled' if config['sftp']['enabled'] else 'disabled'}")
    print(f"History log:   {'enabled' if config['logger'].get('url') and config['logger'].get('key') else 'disabled'}")
    return 0


def cmd_printers(config: dict, args) -> int:
    path = resolve_path(config["printers_file"])
    action = args.printers_action or "list"

    if action == "import-pkl":
        printers = import_pickle(Path(args.file))
        save_printers(path, printers)
        print(f"Imported {len(printers)} printer(s) into {path}")
        return 0

    printers = load_printers(path) if path.is_file() or action != "add" else []

    if action == "list":
        if not printers:
            print("No printers configured.")
        for index, p in enumerate(printers, 1):
            print(f"{index:>3}. {p['Name']:<24} {p['IP']:<16} {p['Serial']}")
        return 0

    if action == "add":
        if any(p["IP"] == args.ip for p in printers):
            print(f"A printer with IP {args.ip} already exists.", file=sys.stderr)
            return 1
        printers.append(normalize_printer({"IP": args.ip, "Name": args.name, "Serial": args.serial or "", "EID": args.eid or ""}))
        save_printers(path, printers)
        print(f"Added {args.name or args.ip}. {len(printers)} printer(s) configured.")
        return 0

    if action == "remove":
        remaining = [p for p in printers if args.target not in (p["IP"], p["Name"])]
        if len(remaining) == len(printers):
            print(f"No printer matches {args.target!r}.", file=sys.stderr)
            return 1
        save_printers(path, remaining)
        print(f"Removed {len(printers) - len(remaining)} printer(s).")
        return 0

    if action == "edit":
        editor = os.environ.get("VISUAL") or os.environ.get("EDITOR") or ("notepad" if os.name == "nt" else "nano")
        if not shutil.which(editor.split()[0]):
            print(f"Editor {editor!r} not found. Set the EDITOR environment variable.", file=sys.stderr)
            return 1
        if not path.is_file():
            save_printers(path, [])
        subprocess.call([*editor.split(), str(path)])
        try:
            printers = load_printers(path)
        except ConfigError as exc:
            print(f"Warning: {exc}", file=sys.stderr)
            return 1
        print(f"Saved. {len(printers)} printer(s) configured.")
        return 0

    return 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Poll printers over SNMP and publish printer_data.json.")
    parser.add_argument("-c", "--config", type=Path, help="path to config.json (default: config.json next to this script)")
    parser.add_argument("-v", "--verbose", action="store_true", help="debug logging")
    parser.add_argument("--version", action="version", version=__version__)
    sub = parser.add_subparsers(dest="command")

    sub.add_parser("run", help="poll forever (default)")
    once = sub.add_parser("once", help="poll a single time and exit")
    once.add_argument("--print", action="store_true", help="print the snapshot to stdout")
    sub.add_parser("check", help="validate and show the effective configuration")

    printers = sub.add_parser("printers", help="manage the printer list")
    psub = printers.add_subparsers(dest="printers_action")
    psub.add_parser("list", help="list printers")
    add = psub.add_parser("add", help="add a printer")
    add.add_argument("--ip", required=True)
    add.add_argument("--name", default="")
    add.add_argument("--serial", default="")
    add.add_argument("--eid", default="")
    remove = psub.add_parser("remove", help="remove a printer by IP or name")
    remove.add_argument("target")
    psub.add_parser("edit", help="open the printer list in $EDITOR")
    imp = psub.add_parser("import-pkl", help="import a legacy Printers.pkl file")
    imp.add_argument("file")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    logging.getLogger("paramiko").setLevel(logging.WARNING)
    try:
        config = load_config(args.config)
        handler = {
            None: cmd_run,
            "run": cmd_run,
            "once": cmd_once,
            "check": cmd_check,
            "printers": cmd_printers,
        }[args.command]
        return handler(config, args)
    except ConfigError as exc:
        log.error("%s", exc)
        return 2
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    sys.exit(main())
