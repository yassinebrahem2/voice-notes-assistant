"""Recording analysis contracts."""

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    # app.container imports this package, so a runtime import would be circular.
    from app.container import Container


def wake_worker(container: "Container") -> None:
    """Upload and retry call this so a queued recording is picked up at once; without a worker it does nothing."""
    if container.worker is not None:
        container.worker.wake()
