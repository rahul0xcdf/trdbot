"""
What the bot is supposed to send, and when — all in IST.

GitHub's cron is best-effort, and on this repo it has been badly so: fires
land 20–80 minutes late and whole mornings get dropped (2026-09-02: nothing
fired between 02:33 and 07:14 UTC, so the 8:15 AM pre-market report went out
at 12:44 PM IST). One cron per report slot cannot hold a schedule under that,
because a dropped fire is simply a missing report and a late fire is a report
stamped with the wrong time.

So the workflow ticks every 15 minutes instead, and this module decides what
that tick should do:

  * a tick that lands BEFORE the target waits for it — the job sleeps until
    the exact IST time, so an early fire never sends early;
  * a tick that lands AFTER the target still runs, as long as it is inside
    that slot's grace window (how late that particular message is still worth
    receiving);
  * past the grace window nothing is sent — a "mid-morning" report at 4 PM is
    worse than no report at all.

The workflow keeps a per-slot marker (see `marker`) so a burst of delayed
ticks cannot send the same slot twice.

Stdlib only, on purpose: the workflow runs this before installing anything.
"""

from __future__ import annotations

import os
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

# India has no DST, so a fixed offset is more dependable here than a tz
# database that may or may not be installed on the runner.
IST = timezone(timedelta(hours=5, minutes=30), "IST")

# The workflow ticks every 15 min; 16 lets a tick claim the target just ahead
# of it (and wait for it) so no target falls between two ticks.
MAX_LEAD_MIN = 16


@dataclass(frozen=True)
class Slot:
    run_type: str
    hour: int
    minute: int
    grace_min: int     # how late this message is still worth sending
    priority: int = 0  # lower wins when two slots are due on the same tick

    def target(self, now: datetime) -> datetime:
        return now.replace(hour=self.hour, minute=self.minute,
                           second=0, microsecond=0)


def _vix_slots() -> list[Slot]:
    """Silent VIX checks every 30 min through the session (9:45 AM–3:15 PM)."""
    out = []
    t = datetime(2000, 1, 1, 9, 45)
    end = datetime(2000, 1, 1, 15, 15)
    while t <= end:
        # priority 1: a report slot always wins a tick over a VIX check.
        out.append(Slot("vix_check", t.hour, t.minute, grace_min=12, priority=1))
        t += timedelta(minutes=30)
    return out


SLOTS: tuple[Slot, ...] = (
    Slot("premarket",     8, 15, grace_min=45),  # useful any time before the open
    Slot("opening",       9, 30, grace_min=25),
    Slot("midmorning",   11,  0, grace_min=30),
    Slot("european_open", 12, 30, grace_min=30),
    Slot("london_us",    13, 30, grace_min=30),
    Slot("exit_reminder", 14, 45, grace_min=20),  # must beat the 3:30 close
    Slot("eod",          16,  0, grace_min=60),
    *_vix_slots(),
)


def now_ist() -> datetime:
    return datetime.now(IST)


def due_slot(now: datetime | None = None) -> tuple[Slot, datetime] | None:
    """
    The slot this tick should run, with its target time — or None.

    Ranking, in order: reports before VIX checks (priority); then a slot whose
    target has passed before one still ahead, since catching up on a dropped
    tick matters more than a head start on the next slot; then, among overdue
    slots, the most recent target, the older message being the staler one.
    """
    now = now or now_ist()
    if now.weekday() >= 5:   # NSE is shut at the weekend
        return None

    ranked = []
    for slot in SLOTS:
        target = slot.target(now)
        if target <= now <= target + timedelta(minutes=slot.grace_min):
            ranked.append(((slot.priority, 0, -target.timestamp()), slot, target))
        elif now < target <= now + timedelta(minutes=MAX_LEAD_MIN):
            ranked.append(((slot.priority, 1, target.timestamp()), slot, target))

    if not ranked:
        return None
    rank, slot, target = min(ranked, key=lambda r: r[0])
    return slot, target


def marker(slot: Slot, target: datetime) -> str:
    """Cache key body — one slot, one calendar day, one send."""
    return f"{slot.run_type}-{target:%Y-%m-%d-%H%M}"


def wait_until(epoch: float, max_wait_min: int = MAX_LEAD_MIN + 2) -> None:
    """Sleep until `epoch` so an early runner still sends at the target time."""
    delay = epoch - time.time()
    if delay <= 0:
        return
    delay = min(delay, max_wait_min * 60)
    when = datetime.fromtimestamp(epoch, IST).strftime("%I:%M %p IST")
    print(f"[OK] fired early — waiting {delay / 60:.1f} min to send at {when}")
    time.sleep(delay)


# ── CLI: the workflow's "what is due?" step ───────────────────────────────────

def _emit(**fields):
    for key, value in fields.items():
        print(f"{key}={value}")
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a") as fh:
            for key, value in fields.items():
                fh.write(f"{key}={value}\n")


def main() -> int:
    # A manual workflow_dispatch names its own flow and skips the schedule.
    manual = os.environ.get("RUN_TYPE_INPUT", "").strip()
    if manual:
        print(f"[OK] manual run: {manual}")
        _emit(due="true", run_type=manual, target_epoch="", marker="")
        return 0

    now = now_ist()
    found = due_slot(now)
    if found is None:
        print(f"[OK] nothing due at {now:%a %d %b %I:%M %p IST} — idle tick")
        _emit(due="false", run_type="", target_epoch="", marker="")
        return 0

    slot, target = found
    drift = (now - target).total_seconds() / 60
    how = f"{drift:.0f} min late" if drift >= 0 else f"{-drift:.0f} min early"
    print(f"[OK] due: {slot.run_type} (target {target:%I:%M %p IST}, "
          f"tick is {how}, grace {slot.grace_min} min)")
    _emit(due="true", run_type=slot.run_type,
          target_epoch=f"{target.timestamp():.0f}",
          marker=marker(slot, target))
    return 0


if __name__ == "__main__":
    sys.exit(main())
