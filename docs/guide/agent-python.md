# Python Agent

`ghost-doc-agent` is a Python tracing agent with the same decorator API as the JS agent.

## Installation

```bash
pip install ghost-doc-agent
```

## Creating a tracer

```python
from ghost_doc_agent import Tracer

tracer = Tracer(
    agent_id="my-api",                          # shown as agent badge in dashboard
    hub_url="ws://localhost:3001/agent",         # default
    sanitize=frozenset({"password", "token", "secret", "api_key"}),
    buffer_size=500,                             # max spans buffered when Hub unreachable
    enabled=True,                               # False = decorators become no-ops
    sample_rate=1.0,                            # 0.0–1.0 fraction of calls to emit (default: 1.0)
)
```

## `@tracer.trace` decorator

Works on sync and async functions.

```python
# No parentheses — docstring auto-extracted as description
@tracer.trace
def get_user(user_id: int) -> dict:
    """Fetches a full user record from the database."""
    return db.query("SELECT * FROM users WHERE id = ?", user_id)
# → Dashboard shows: "Fetches a full user record from the database."

# Async functions — identical API
@tracer.trace
async def fetch_data(url: str) -> bytes:
    """Downloads raw bytes from the given URL."""
    ...

# Custom label (overrides __qualname__ in the dashboard node name)
@tracer.trace(label="user.lookup")
def get_user(user_id: int): ...

# Explicit description (overrides docstring)
@tracer.trace(description="Fetches user from primary DB replica")
def get_user(user_id: int): ...

# Label + description
@tracer.trace(label="user.lookup", description="Primary DB lookup")
def get_user(user_id: int): ...
```

## Docstring auto-extraction

The agent automatically uses the **first line of the docstring** as the node description in the dashboard. No extra configuration needed — just write normal Python docstrings.

```python
@tracer.trace
def validate_order(order_id: str) -> bool:
    """Checks stock availability and payment validity for an order.

    Args:
        order_id: The UUID of the order to validate.

    Returns:
        True if the order can be fulfilled.
    """
    ...
# → Dashboard tooltip: "Checks stock availability and payment validity for an order."
```

To override the docstring, pass `description=` explicitly:

```python
@tracer.trace(description="Custom description")
def my_function(): ...
```

## What is captured

Every traced call emits the same `TraceEvent` schema as the JS agent:

- File path (`inspect.getfile()`) and line number
- Sanitized `*args` and `**kwargs`
- Return value (serialized via `json.dumps` with `repr()` fallback)
- `time.perf_counter()` timing
- Exception type, message, and traceback (if raised)

## Head-based sampling

Emit only a fraction of calls to reduce Hub bandwidth and storage:

```python
tracer = Tracer(
    agent_id="high-traffic-api",
    sample_rate=0.1,  # emit ~10% of calls
)
```

`sample_rate` is clamped to `[0.0, 1.0]`. Defaults to `1.0` (emit every call). Sampling is evaluated per call using `random.random()`.

## Sanitization

```python
tracer = Tracer(
    agent_id="api",
    sanitize=frozenset({"password", "token", "ssn", "credit_card", "api_key"}),
)
```

Default blocklist covers common credential fields:

```python
{
    "password", "token", "secret", "authorization", "api_key",
    "bearer", "jwt", "access_token", "refresh_token", "session",
    "cookie", "client_secret", "cvv", "pin", "private_key",
    "passphrase", "auth", "credentials",
}
```

In addition to key-based redaction, the sanitizer also detects **sensitive values by pattern**: JWT strings (three Base64 segments separated by `.`) and sequences of 13–19 digits that look like credit card numbers are replaced with `"[REDACTED]"` regardless of the key name.

## Lifecycle

```python
# Gracefully close the WebSocket transport
tracer.stop()
```

## Requirements

- Python 3.10+
- `websockets` (installed automatically)
