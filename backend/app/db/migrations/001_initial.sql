CREATE TABLE recordings (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('meeting', 'note')),
    client_upload_id TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL CHECK (status IN (
        'uploaded', 'transcribing', 'diarizing', 'analyzing', 'indexing', 'ready', 'failed'
    )),
    claimed INTEGER NOT NULL DEFAULT 0,
    failed_step TEXT,
    error_code TEXT,
    error_message TEXT,
    title TEXT,
    created_at TEXT NOT NULL,
    duration_ms INTEGER,
    audio_ext TEXT NOT NULL,
    waveform_peaks TEXT,
    analysis TEXT
);

CREATE TABLE speakers (
    id TEXT PRIMARY KEY,
    recording_id TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    name TEXT,
    UNIQUE (recording_id, label)
);

CREATE TABLE segments (
    id TEXT PRIMARY KEY,
    recording_id TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
    idx INTEGER NOT NULL,
    start_ms INTEGER NOT NULL,
    end_ms INTEGER NOT NULL,
    speaker_id TEXT REFERENCES speakers(id) ON DELETE SET NULL,
    text TEXT NOT NULL,
    UNIQUE (recording_id, idx)
);

CREATE TABLE chunks (
    id TEXT PRIMARY KEY,
    recording_id TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
    first_segment_id TEXT NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
    last_segment_id TEXT NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
    start_ms INTEGER NOT NULL,
    end_ms INTEGER NOT NULL,
    text TEXT NOT NULL,
    embedding BLOB NOT NULL
);

CREATE TABLE tags (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
);

CREATE TABLE recording_tags (
    recording_id TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
    tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (recording_id, tag_id)
);

CREATE TABLE chats (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL
);

CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    text TEXT NOT NULL,
    citations TEXT,
    reply_type TEXT,
    scope TEXT,
    tag_ids TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX idx_segments_recording_order ON segments(recording_id, idx);
CREATE INDEX idx_chunks_recording ON chunks(recording_id);
CREATE INDEX idx_recordings_status_claimed ON recordings(status, claimed);
CREATE INDEX idx_messages_chat_created ON messages(chat_id, created_at);
