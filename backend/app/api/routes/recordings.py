import sqlite3
from typing import Annotated

from fastapi import APIRouter, Depends, Form, Query, Response, UploadFile

from app.api.deps import get_container, get_db
from app.api.errors import not_implemented
from app.api.models.recordings import (
    RecordingDetailOut,
    RecordingOut,
    RecordingPatchIn,
    SpeakerOut,
    SpeakerPatchIn,
)
from app.container import Container
from app.domain.types import RecordingKind
from app.processing import wake_worker
from app.recordings import edit, read

router = APIRouter(prefix="/recordings", tags=["recordings"])


@router.post(
    "",
    status_code=201,
    response_model=RecordingOut,
    responses={200: {"model": RecordingOut}},
    operation_id="upload_recording",
)
def upload_recording(
    kind: Annotated[RecordingKind, Form()], client_upload_id: Annotated[str, Form()], file: UploadFile
) -> RecordingOut:
    not_implemented()


@router.get("", response_model=list[RecordingOut], operation_id="list_recordings")
def list_recordings(
    conn: Annotated[sqlite3.Connection, Depends(get_db)],
    kind: RecordingKind | None = None,
    q: str | None = None,
    tag_id: Annotated[list[str] | None, Query()] = None,
) -> list[RecordingOut]:
    return read.list_recordings(conn, kind, q, tag_id or [])


@router.get("/{id}", response_model=RecordingDetailOut, operation_id="get_recording")
def get_recording(id: str, conn: Annotated[sqlite3.Connection, Depends(get_db)]) -> RecordingDetailOut:
    return read.get_recording_detail(conn, id)


@router.patch("/{id}", response_model=RecordingOut, operation_id="update_recording")
def update_recording(
    id: str, patch: RecordingPatchIn, conn: Annotated[sqlite3.Connection, Depends(get_db)]
) -> RecordingOut:
    return edit.update_recording(conn, id, patch)


@router.patch("/{id}/speakers/{speaker_id}", response_model=SpeakerOut, operation_id="rename_speaker")
def rename_speaker(
    id: str, speaker_id: str, patch: SpeakerPatchIn, conn: Annotated[sqlite3.Connection, Depends(get_db)]
) -> SpeakerOut:
    return edit.rename_speaker(conn, id, speaker_id, patch)


@router.delete("/{id}", status_code=204, operation_id="delete_recording")
def delete_recording(
    id: str,
    conn: Annotated[sqlite3.Connection, Depends(get_db)],
    container: Annotated[Container, Depends(get_container)],
) -> None:
    edit.delete_recording(conn, container.settings.data_dir, id)


@router.post("/{id}/retry", response_model=RecordingOut, operation_id="retry_recording")
def retry_recording(
    id: str,
    conn: Annotated[sqlite3.Connection, Depends(get_db)],
    container: Annotated[Container, Depends(get_container)],
) -> RecordingOut:
    recording = edit.retry_recording(conn, id)
    wake_worker(container)
    return recording


@router.get(
    "/{id}/audio",
    response_class=Response,
    responses={
        200: {"content": {"audio/*": {"schema": {"type": "string", "format": "binary"}}}},
        206: {"content": {"audio/*": {"schema": {"type": "string", "format": "binary"}}}},
    },
    operation_id="get_recording_audio",
)
def get_recording_audio(id: str) -> Response:
    not_implemented()
