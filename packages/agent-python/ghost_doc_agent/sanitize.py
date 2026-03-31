"""
Deep sanitization of arbitrary Python objects before sending to the Hub.
Matching keys are replaced with the string "[REDACTED]".
"""
from __future__ import annotations

import re
from typing import Any

DEFAULT_SANITIZE_KEYS: frozenset[str] = frozenset(
    {
        "password",
        "passwd",
        "token",
        "secret",
        "authorization",
        "api_key",
        "apikey",
        "apitoken",
        "api_token",
        "auth",
        "auth_token",
        "access_token",
        "refresh_token",
        "id_token",
        "bearer",
        "jwt",
        "credential",
        "credentials",
        "private_key",
        "privatekey",
        "client_secret",
        "client_id",
        "session",
        "session_id",
        "sessionid",
        "cookie",
        "set_cookie",
        "x_api_key",
        "ssn",
        "social_security",
        "credit_card",
        "card_number",
        "cvv",
        "pin",
        "bank_account",
        "routing_number",
    }
)

# Regex patterns applied to string *values* to detect secrets regardless of key name.
_SECRET_VALUE_PATTERNS: tuple[re.Pattern[str], ...] = (
    # JWT: three base64url segments separated by dots
    re.compile(r"^[A-Za-z0-9_-]{2,}(?:\.[A-Za-z0-9_-]{2,}){2}$"),
    # Bare credit-card: 13-19 digits with optional spaces/dashes
    re.compile(r"^\d{4}[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{1,7}$"),
)

_REDACTED = "[REDACTED]"
_CIRCULAR = "[Circular]"


def sanitize_deep(
    value: Any,
    keys: frozenset[str] | None = None,
    *,
    _seen: set[int] | None = None,
) -> Any:
    """
    Recursively walk ``value`` and redact any dict key found in ``keys``.

    - Does NOT mutate the original value.
    - Handles circular references by replacing them with ``"[Circular]"``.
    - ``keys`` defaults to DEFAULT_SANITIZE_KEYS.

    Args:
        value:  The value to sanitize.
        keys:   Set of lowercase key names to redact.
        _seen:  Internal set of object IDs used for cycle detection.
                Do not pass this argument from user code.
    """
    if keys is None:
        keys = DEFAULT_SANITIZE_KEYS

    if _seen is None:
        _seen = set()

    # Primitives — check strings for secret patterns, return others as-is
    if value is None or isinstance(value, (bool, int, float, bytes)):
        return value
    if isinstance(value, str):
        stripped = value.strip()
        if any(p.match(stripped) for p in _SECRET_VALUE_PATTERNS):
            return _REDACTED
        return value

    obj_id = id(value)
    if obj_id in _seen:
        return _CIRCULAR
    _seen.add(obj_id)

    try:
        if isinstance(value, dict):
            return {
                k: _REDACTED
                if k.lower() in keys
                else sanitize_deep(v, keys, _seen=_seen)
                for k, v in value.items()
            }

        if isinstance(value, (list, tuple)):
            result = [sanitize_deep(item, keys, _seen=_seen) for item in value]
            return type(value)(result)  # preserve list vs tuple

        # For other objects, attempt to serialize via __dict__ if present
        if hasattr(value, "__dict__"):
            return sanitize_deep(vars(value), keys, _seen=_seen)

        # Fallback: convert to string representation
        return repr(value)
    finally:
        _seen.discard(obj_id)
