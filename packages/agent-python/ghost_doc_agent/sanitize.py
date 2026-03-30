"""
Deep sanitization of arbitrary Python objects before sending to the Hub.
Matching keys are replaced with the string "[REDACTED]".
"""
from __future__ import annotations

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
        "auth",
        "credential",
        "private_key",
        "ssn",
        "credit_card",
    }
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

    # Primitives — return as-is
    if value is None or isinstance(value, (bool, int, float, str, bytes)):
        return value

    obj_id = id(value)
    if obj_id in _seen:
        return _CIRCULAR
    _seen.add(obj_id)

    try:
        if isinstance(value, dict):
            return {
                k: _REDACTED if k.lower() in keys else sanitize_deep(v, keys, _seen=_seen)
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
