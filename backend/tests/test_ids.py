import re

from app.ids import new_id


def test_new_id_format() -> None:
    first = new_id("rec")
    assert re.fullmatch(r"rec_[0-9A-HJKMNP-TV-Z]{26}", first)
    assert first != new_id("rec")
