from app.agents.schemas import ActionItem, Item, MeetingAnalysis, NoteAnalysis
from app.processing.protocols import AnalysisRequest


class FakeAnalyzer:
    def analyze(self, request: AnalysisRequest) -> MeetingAnalysis | NoteAnalysis:
        text = " ".join(line.text for line in request.lines)
        if request.kind == "note":
            return NoteAnalysis(
                title="Fake analysis",
                tags=["demo"],
                key_points=[Item(text="Demo key point", sources=[1])],
                clean_text=text,
            )
        return MeetingAnalysis(
            title="Fake analysis",
            tags=["demo"],
            overview="A demo discussion was recorded.",
            decisions=[Item(text="Demo decision", sources=[1])],
            action_items=[ActionItem(text="Demo action", sources=[1], owner=None, due=None)],
            open_questions=[Item(text="Demo question", sources=[1])],
        )
