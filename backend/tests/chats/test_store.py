"""Tests for chat database store operations."""

import pytest
from langchain_core.messages import AIMessage, HumanMessage

from app.agents.citations import FinalReply
from app.api.errors import ApiError, ErrorCode
from app.api.models.chats import AskIn, CitationOut
from app.chats.store import (
    add_assistant_message,
    add_user_message,
    create_chat,
    get_chat,
    history_for,
)
from app.container import Container
from app.db.connection import connect


def test_create_and_get_chat(container: Container) -> None:
    conn = connect(container.db_path)
    try:
        chat = create_chat(conn)
        assert chat.id.startswith("cht_")
        assert chat.created_at is not None

        detail = get_chat(conn, chat.id)
        assert detail.id == chat.id
        assert detail.messages == []

        with pytest.raises(ApiError) as exc_info:
            get_chat(conn, "cht_nonexistent")
        assert exc_info.value.status == 404
        assert exc_info.value.code == ErrorCode.not_found
    finally:
        conn.close()


def test_add_user_and_assistant_message(container: Container) -> None:
    conn = connect(container.db_path)
    try:
        chat = create_chat(conn)
        ask = AskIn(text="What was discussed?", scope="both", tag_ids=["tag_1"])
        msg_id = add_user_message(conn, chat.id, ask)
        assert msg_id.startswith("msg_")

        citations = [
            CitationOut(
                n=1,
                recording_id="rec_1",
                segment_id="seg_1",
                start_ms=12000,
                recording_title="Sync",
            )
        ]
        final = FinalReply(
            reply_type="answer",
            text="Discussion was had [1].",
            citations=citations,
        )
        assistant_msg = add_assistant_message(conn, chat.id, final)
        assert assistant_msg.id.startswith("msg_")
        assert assistant_msg.role == "assistant"
        assert assistant_msg.text == "Discussion was had [1]."
        assert assistant_msg.reply_type == "answer"
        assert len(assistant_msg.citations) == 1
        assert assistant_msg.citations[0].recording_title == "Sync"

        detail = get_chat(conn, chat.id)
        assert len(detail.messages) == 2
        assert detail.messages[0].id == msg_id
        assert detail.messages[0].role == "user"
        assert detail.messages[0].text == "What was discussed?"
        assert detail.messages[0].citations == []

        assert detail.messages[1].id == assistant_msg.id
        assert detail.messages[1].role == "assistant"
        assert detail.messages[1].text == "Discussion was had [1]."
        assert detail.messages[1].reply_type == "answer"
        assert len(detail.messages[1].citations) == 1
        assert detail.messages[1].citations[0] == citations[0]
    finally:
        conn.close()


def test_history_renders_citations_without_labels(container: Container) -> None:
    conn = connect(container.db_path)
    try:
        chat = create_chat(conn)

        # Turn 1
        add_user_message(conn, chat.id, AskIn(text="Hi", scope="both"))
        add_assistant_message(
            conn,
            chat.id,
            FinalReply(
                reply_type="answer",
                text="Hello! [1]",
                citations=[
                    CitationOut(
                        n=1,
                        recording_id="rec_1",
                        segment_id="seg_1",
                        start_ms=65000,
                        recording_title="Team Sync",
                    )
                ],
            ),
        )

        # Turn 2
        add_user_message(conn, chat.id, AskIn(text="Tell me more", scope="notes"))
        add_assistant_message(
            conn,
            chat.id,
            FinalReply(
                reply_type="answer",
                text="Here is detail [1] and more [2].",
                citations=[
                    CitationOut(
                        n=1,
                        recording_id="rec_2",
                        segment_id="seg_2",
                        start_ms=130000,
                        recording_title="Design Review",
                    ),
                    CitationOut(
                        n=2,
                        recording_id="rec_3",
                        segment_id="seg_3",
                        start_ms=5000,
                        recording_title="Notes",
                    ),
                ],
            ),
        )

        # Turn 3 (current question)
        msg3_id = add_user_message(conn, chat.id, AskIn(text="And next?", scope="both"))

        # Query history before msg3_id
        history = history_for(conn, chat.id, before_msg_id=msg3_id, turns=6)
        assert len(history) == 4
        assert isinstance(history[0], HumanMessage)
        assert history[0].content == "Hi"

        assert isinstance(history[1], AIMessage)
        # 65000 ms -> 01:05
        assert history[1].content == "Hello! (Team Sync, 01:05)"
        assert "[1]" not in str(history[1].content)
        assert "P1" not in str(history[1].content)

        assert isinstance(history[2], HumanMessage)
        assert history[2].content == "Tell me more"

        assert isinstance(history[3], AIMessage)
        # 130000 ms -> 02:10, 5000 ms -> 00:05
        assert history[3].content == "Here is detail (Design Review, 02:10) and more (Notes, 00:05)."
        assert "[1]" not in str(history[3].content)
        assert "[2]" not in str(history[3].content)

        # Test limit with turns=1 (should return last 2 messages before msg3_id: Turn 2's messages)
        history_turn1 = history_for(conn, chat.id, before_msg_id=msg3_id, turns=1)
        assert len(history_turn1) == 2
        assert isinstance(history_turn1[0], HumanMessage)
        assert history_turn1[0].content == "Tell me more"
        assert isinstance(history_turn1[1], AIMessage)
        assert history_turn1[1].content == "Here is detail (Design Review, 02:10) and more (Notes, 00:05)."
    finally:
        conn.close()
