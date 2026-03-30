import pytest
from ghost_doc_agent.ring_buffer import RingBuffer


def test_raises_on_invalid_capacity() -> None:
    with pytest.raises(ValueError):
        RingBuffer(0)


def test_push_and_drain_in_order() -> None:
    buf: RingBuffer[int] = RingBuffer(5)
    buf.push(1)
    buf.push(2)
    buf.push(3)
    assert buf.drain() == [1, 2, 3]


def test_drain_clears_buffer() -> None:
    buf: RingBuffer[str] = RingBuffer(3)
    buf.push("a")
    buf.drain()
    assert buf.is_empty
    assert buf.length == 0


def test_evicts_oldest_when_full() -> None:
    buf: RingBuffer[int] = RingBuffer(3)
    buf.push(1)
    buf.push(2)
    buf.push(3)
    buf.push(4)  # evicts 1
    buf.push(5)  # evicts 2
    assert buf.drain() == [3, 4, 5]


def test_capacity_of_one() -> None:
    buf: RingBuffer[str] = RingBuffer(1)
    buf.push("first")
    buf.push("second")  # evicts "first"
    assert buf.drain() == ["second"]


def test_drain_on_empty_returns_empty() -> None:
    buf: RingBuffer[int] = RingBuffer(10)
    assert buf.drain() == []


def test_is_full_and_is_empty() -> None:
    buf: RingBuffer[int] = RingBuffer(2)
    assert buf.is_empty
    assert not buf.is_full

    buf.push(1)
    assert not buf.is_empty
    assert not buf.is_full

    buf.push(2)
    assert buf.is_full


def test_multiple_push_drain_cycles() -> None:
    buf: RingBuffer[int] = RingBuffer(3)
    buf.push(1)
    buf.push(2)
    assert buf.drain() == [1, 2]

    buf.push(3)
    buf.push(4)
    assert buf.drain() == [3, 4]
