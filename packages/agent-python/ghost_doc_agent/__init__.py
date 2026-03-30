"""
Ghost Doc Agent — Python tracing library.

Quick start::

    from ghost_doc_agent import Tracer

    tracer = Tracer(agent_id="my-service")

    @tracer.trace
    def my_function(x: int) -> int:
        return x * 2
"""
from .tracer import Tracer

__all__ = ["Tracer"]
