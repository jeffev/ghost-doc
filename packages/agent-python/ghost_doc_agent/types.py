"""
TypedDict definitions that mirror the shared TraceEvent JSON schema.
These match the Zod schema defined in @ghost-doc/shared-types exactly.
"""
from __future__ import annotations

from typing import Any, Literal, Optional, TypedDict
from typing_extensions import NotRequired

Language = Literal["js", "python", "go", "rust", "java", "csharp", "other"]


class SourceInfo(TypedDict):
    agent_id: str
    language: Language
    file: str
    line: int
    function_name: str
    description: NotRequired[str]


class TimingInfo(TypedDict):
    started_at: float  # Unix epoch milliseconds
    duration_ms: float


class ErrorInfo(TypedDict):
    type: str
    message: str
    stack: str


class TraceEvent(TypedDict):
    schema_version: Literal["1.0"]
    trace_id: str
    span_id: str
    parent_span_id: Optional[str]
    source: SourceInfo
    timing: TimingInfo
    input: list[Any]
    output: Any
    error: Optional[ErrorInfo]
    tags: dict[str, str]
