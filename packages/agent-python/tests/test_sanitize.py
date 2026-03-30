from ghost_doc_agent.sanitize import DEFAULT_SANITIZE_KEYS, sanitize_deep


def test_redacts_matching_top_level_key() -> None:
    result = sanitize_deep({"username": "alice", "password": "secret"}, {"password"})
    assert result == {"username": "alice", "password": "[REDACTED]"}


def test_case_insensitive_key_matching() -> None:
    result = sanitize_deep(
        {"PASSWORD": "abc", "Token": "xyz"},
        {"password", "token"},
    )
    assert result == {"PASSWORD": "[REDACTED]", "Token": "[REDACTED]"}


def test_redacts_nested_keys() -> None:
    result = sanitize_deep(
        {"user": {"name": "bob", "token": "abc123"}},
        {"token"},
    )
    assert result == {"user": {"name": "bob", "token": "[REDACTED]"}}


def test_redacts_keys_inside_list_of_dicts() -> None:
    result = sanitize_deep(
        [{"id": 1, "secret": "shh"}, {"id": 2, "secret": "also-shh"}],
        {"secret"},
    )
    assert result == [{"id": 1, "secret": "[REDACTED]"}, {"id": 2, "secret": "[REDACTED]"}]


def test_does_not_mutate_original() -> None:
    original = {"password": "original"}
    sanitize_deep(original, {"password"})
    assert original["password"] == "original"


def test_primitives_pass_through_unchanged() -> None:
    assert sanitize_deep(42, set()) == 42
    assert sanitize_deep("hello", set()) == "hello"
    assert sanitize_deep(None, set()) is None
    assert sanitize_deep(True, set()) is True


def test_empty_key_set_changes_nothing() -> None:
    data = {"password": "abc", "token": "xyz"}
    assert sanitize_deep(data, frozenset()) == data


def test_circular_reference_replaced() -> None:
    obj: dict = {"a": 1}
    obj["self"] = obj
    result = sanitize_deep(obj, set())
    assert result["a"] == 1  # type: ignore[index]
    assert result["self"] == "[Circular]"  # type: ignore[index]


def test_default_sanitize_keys_redact_common_fields() -> None:
    data = {
        "id": 1,
        "password": "p@ssw0rd",
        "token": "abc",
        "secret": "shh",
        "authorization": "Bearer xyz",
        "api_key": "key123",
        "ssn": "123-45-6789",
    }
    result = sanitize_deep(data, DEFAULT_SANITIZE_KEYS)
    assert result["id"] == 1  # type: ignore[index]
    assert result["password"] == "[REDACTED]"  # type: ignore[index]
    assert result["token"] == "[REDACTED]"  # type: ignore[index]
    assert result["secret"] == "[REDACTED]"  # type: ignore[index]
    assert result["authorization"] == "[REDACTED]"  # type: ignore[index]
    assert result["ssn"] == "[REDACTED]"  # type: ignore[index]


def test_tuple_preserved_as_tuple() -> None:
    result = sanitize_deep((1, {"key": "val"}), set())
    assert isinstance(result, tuple)
    assert result == (1, {"key": "val"})  # type: ignore[comparison-overlap]
