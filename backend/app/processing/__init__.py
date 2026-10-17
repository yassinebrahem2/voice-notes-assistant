"""Recording analysis contracts."""

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    # app.container imports this package, so a runtime import would be circular.
    from app.container import Container


def wake_worker(container: "Container") -> None:
    """Retry calls this so a re-queued recording is picked up at once; the worker task fills in the body."""
