from pydantic import BaseModel


class TagOut(BaseModel):
    id: str
    name: str
    count: int
