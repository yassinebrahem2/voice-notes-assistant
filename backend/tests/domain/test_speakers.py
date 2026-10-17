from app.domain.speakers import display_name, render_speakers, tokenize_speakers


def test_tokenize_leaves_lowercase_speaker() -> None:
    text = "asked the speaker a question"
    assert tokenize_speakers(text, {"A": "spk_123"}) == text


def test_tokenize_possessive_round_trip() -> None:
    tokenized = tokenize_speakers("Speaker A's idea", {"A": "spk_123"})
    assert tokenized == "{{spk_123}}'s idea"
    assert render_speakers(tokenized, {"spk_123": "Sarah"}) == "Sarah's idea"


def test_tokenize_unknown_label_unchanged() -> None:
    assert tokenize_speakers("Speaker Q", {"A": "spk_123"}) == "Speaker Q"


def test_render_without_name() -> None:
    assert display_name("A", None) == "Speaker A"
    assert display_name("A", "Sarah") == "Sarah"
    assert render_speakers("{{spk_123}}", {"spk_123": display_name("A", None)}) == "Speaker A"
    assert render_speakers("{{spk_unknown}}", {}) == "{{spk_unknown}}"
