#!/usr/bin/env python3
"""
Create a password hash for the admin page.

    python3 tools/hash-password.py

Paste the printed value into admin/config.php ('password_hash') or into the
ADMIN_PASSWORD_HASH environment variable (Docker: .env file; remember that a
literal "$" must be written as "$$" inside docker-compose .env files).
"""

import base64
import getpass
import hashlib
import secrets
import sys

ITERATIONS = 600_000


def make_hash(password: str, iterations: int = ITERATIONS) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations, dklen=32)
    return "pbkdf2_sha256${}${}${}".format(
        iterations,
        base64.b64encode(salt).decode("ascii"),
        base64.b64encode(digest).decode("ascii"),
    )


def main() -> int:
    password = getpass.getpass("New admin password: ")
    if len(password) < 10:
        print("Use at least 10 characters.", file=sys.stderr)
        return 1
    if getpass.getpass("Repeat password: ") != password:
        print("The passwords do not match.", file=sys.stderr)
        return 1
    print()
    print(make_hash(password))
    return 0


if __name__ == "__main__":
    sys.exit(main())
