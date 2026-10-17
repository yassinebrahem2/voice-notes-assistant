from typing import Literal

from pydantic import BaseModel


class HealthOut(BaseModel):
    app_name: str
    version: str
    speech_backend: Literal["real", "fake"]
    roles: dict[str, str]
