"""
Fixed-capacity ring buffer using collections.deque.
When full, the oldest item is evicted automatically (deque maxlen behavior).
"""
from __future__ import annotations

from collections import deque
from typing import Generic, TypeVar

T = TypeVar("T")


class RingBuffer(Generic[T]):
    """
    Thread-safe ring buffer backed by a collections.deque.

    deque(maxlen=N) automatically evicts the leftmost (oldest) item
    when a new item is appended to a full deque. This gives us ring
    buffer semantics without explicit index management.
    """

    def __init__(self, capacity: int) -> None:
        if capacity < 1:
            raise ValueError("RingBuffer capacity must be >= 1")
        self._data: deque[T] = deque(maxlen=capacity)

    def push(self, item: T) -> None:
        """Add an item. Evicts the oldest item if the buffer is full."""
        self._data.append(item)

    def drain(self) -> list[T]:
        """Return all items in insertion order and clear the buffer."""
        items = list(self._data)
        self._data.clear()
        return items

    @property
    def length(self) -> int:
        return len(self._data)

    @property
    def is_full(self) -> bool:
        return len(self._data) == self._data.maxlen

    @property
    def is_empty(self) -> bool:
        return len(self._data) == 0
