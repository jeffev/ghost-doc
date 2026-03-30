# ghost-doc-agent (Python)

Python tracing agent for [Ghost Doc](../../README.md).

## Installation

```bash
pip install ghost-doc-agent
```

## Quick start

```python
from ghost_doc_agent import Tracer

tracer = Tracer(agent_id="my-python-app")

@tracer.trace
def get_user(user_id: int) -> dict:
    """Fetches a full user record from the database."""
    return db.query("SELECT * FROM users WHERE id = ?", user_id)

# Async functions work too
@tracer.trace
async def fetch_data(url: str) -> bytes:
    """Downloads raw bytes from the given URL."""
    ...
```

Start the Ghost Doc Hub before running your application:

```bash
npx ghost-doc start
# → Hub + Dashboard at http://localhost:3001
```

## Docstring auto-extraction

The agent automatically uses the **first line of a function's docstring** as its description in the dashboard tooltip and inspector panel. No extra configuration needed — just write normal Python docstrings.

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
# → Dashboard shows: "Checks stock availability and payment validity for an order."
```

To override the docstring or provide a description when there is none, pass `description=` explicitly:

```python
@tracer.trace(description="Custom description that overrides the docstring")
def my_function(): ...
```

## Decorator API

```python
# No parentheses — docstring auto-extracted as description
@tracer.trace
def get_user(user_id: int): ...

# Custom label (overrides __qualname__ in the dashboard node name)
@tracer.trace(label="user.lookup")
def get_user(user_id: int): ...

# Explicit description (overrides docstring)
@tracer.trace(description="Fetches a user from the primary database replica")
def get_user(user_id: int): ...

# Label + description
@tracer.trace(label="user.lookup", description="Fetches a user from the primary database replica")
def get_user(user_id: int): ...

# Async functions — identical API
@tracer.trace
async def send_email(to: str, subject: str):
    """Sends a confirmation email via the SMTP relay."""
    ...
```

## Configuration

```python
from ghost_doc_agent import Tracer

tracer = Tracer(
    agent_id="api-service",               # shown in the dashboard as the agent badge
    hub_url="ws://localhost:3001/agent",   # default
    sanitize=frozenset({"password", "token", "secret", "api_key"}),
    buffer_size=500,                       # max spans buffered when Hub is unreachable
    enabled=True,                          # False disables all tracing (decorators become no-ops)
)
```

## Sanitization

Sensitive fields are redacted before leaving your process. The default blocklist covers `password`, `token`, `secret`, `authorization`, and `api_key`.

```python
tracer = Tracer(
    agent_id="api",
    sanitize=frozenset({"password", "token", "ssn", "credit_card", "api_key"}),
)
```

## Lifecycle

```python
# Gracefully stop the WebSocket transport
tracer.stop()
```

## Requirements

- Python 3.10+
- `websockets` (installed automatically)
