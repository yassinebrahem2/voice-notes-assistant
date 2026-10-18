from app.agents.citations import (
    COULD_NOT_FINISH,
    GREETING,
    HELP,
    NOT_FOUND,
    OUT_OF_SCOPE,
    FinalReply,
    check_citations,
)
from app.agents.schemas import ChatReply
from app.agents.sources import SourceRegistry
from app.rag.retrieve import Hit


def test_unknown_label_removed_and_numbering_compacted() -> None:
    registry = SourceRegistry()
    h1 = Hit(
        recording_id="rec_1",
        recording_title="Meeting Alpha",
        kind="meeting",
        created_at="2026-10-17T00:00:00Z",
        first_segment_id="seg_1",
        start_ms=1000,
        end_ms=4000,
        text="Alpha text",
        distance=0.1,
    )
    h2 = Hit(
        recording_id="rec_2",
        recording_title="Note Beta",
        kind="note",
        created_at="2026-10-17T00:00:00Z",
        first_segment_id="seg_2",
        start_ms=2000,
        end_ms=5000,
        text="Beta text",
        distance=0.2,
    )
    p1 = registry.add_passage(h1)
    p2 = registry.add_passage(h2)
    assert p1 == "P1"
    assert p2 == "P2"

    reply = ChatReply(
        reply_type="answer",
        text="According to notes [P1], launch is confirmed. Secret code is [P99]. Also sync [P2] and repeat [P1].",
    )
    res = check_citations(reply, registry)

    assert res.reply_type == "answer"
    assert "[P99]" not in res.text
    assert "[1]" in res.text
    assert "[2]" in res.text
    assert "[P1]" not in res.text
    assert "[P2]" not in res.text

    assert len(res.citations) == 2
    assert res.citations[0].n == 1
    assert res.citations[0].recording_id == "rec_1"
    assert res.citations[0].recording_title == "Meeting Alpha"

    assert res.citations[1].n == 2
    assert res.citations[1].recording_id == "rec_2"
    assert res.citations[1].recording_title == "Note Beta"


def test_answer_without_valid_citation_is_not_found() -> None:
    registry = SourceRegistry()

    reply_no_cites = ChatReply(reply_type="answer", text="An answer without any citation.")
    res1 = check_citations(reply_no_cites, registry)
    assert res1 == FinalReply("answer", NOT_FOUND, [])

    reply_unknown = ChatReply(reply_type="answer", text="An answer citing only [P99] and [R99].")
    res2 = check_citations(reply_unknown, registry)
    assert res2 == FinalReply("answer", NOT_FOUND, [])

    reply_empty = ChatReply(reply_type="answer", text="")
    res3 = check_citations(reply_empty, registry)
    assert res3 == FinalReply("answer", NOT_FOUND, [])

    reply_none_text = ChatReply(reply_type="answer", text=None)
    res4 = check_citations(reply_none_text, registry)
    assert res4 == FinalReply("answer", NOT_FOUND, [])


def test_none_reply_is_could_not_finish() -> None:
    registry = SourceRegistry()
    res = check_citations(None, registry)
    assert res == FinalReply("answer", COULD_NOT_FINISH, [])


def test_greeting_help_out_of_scope_fixed_texts() -> None:
    registry = SourceRegistry()

    reply_g = ChatReply(reply_type="greeting", text="Custom greeting attempt")
    res_g = check_citations(reply_g, registry)
    assert res_g == FinalReply("greeting", GREETING, [])

    reply_h = ChatReply(reply_type="help", text=None)
    res_h = check_citations(reply_h, registry)
    assert res_h == FinalReply("help", HELP, [])

    reply_o = ChatReply(reply_type="out_of_scope", text="What is the weather outside?")
    res_o = check_citations(reply_o, registry)
    assert res_o == FinalReply("out_of_scope", OUT_OF_SCOPE, [])
