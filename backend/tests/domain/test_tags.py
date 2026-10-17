from app.domain.tags import match_existing_tag, normalize_tag


def test_normalize_tag() -> None:
    assert normalize_tag("  Q4 Planning ") == "q4-planning"
    assert normalize_tag("x" * 30) == "x" * 24
    assert normalize_tag("Multiple\t  spaces") == "multiple-spaces"


def test_match_existing_tag() -> None:
    assert match_existing_tag("budgets", {"budget"}) == "budget"
    assert match_existing_tag("Budget", {"budgets"}) == "budgets"
    assert match_existing_tag("  Q4 Planning ", {"q4-planning"}) == "q4-planning"
    assert match_existing_tag("unrelated", {"budget"}) is None
    assert match_existing_tag("budgets", {"budgets", "budget"}) == "budgets"
