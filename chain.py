"""
Self-scheduling timer chain: keeps the three reports on time using only
GitHub Actions — no outside scheduler.

GitHub's cron fired this bot 2.5–7 HOURS late, so reports don't use it.
Instead every report books the next one, using deployment environments
"wait-15" … "wait-3840" whose wait timer holds a queued job for that many
minutes WITHOUT a runner (free; wait timers need a public repo on Pro):

  evening report sent ──► timer(wait-480) ─► timer(wait-240) ─► timer(wait-120)
        ▲                                                              │
        │       ◄── report job sends at the exact minute ◄── sleep ◄───┘
        └───── books the next slot ◄────────────────────────────────────

Each hop re-measures the time left, so start-up delays never add up. The
last hop sleeps the final few minutes and starts the report LEAD_MIN early;
the report job builds the message, then waits for the target minute.

A watchdog (watchdog.yml, GitHub cron every 3 h — its lateness doesn't
matter) restarts the chain if nothing is waiting, e.g. after an outage.

Stdlib only, so a timer hop needs no pip install.

  python chain.py hop       — one timer hop (timer.yml)
  python chain.py watchdog  — start a chain if none is running
  python chain.py next      — print the next slot (debugging)
"""

import json
import os
import sys
import time
import urllib.request
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

IST = ZoneInfo("Asia/Kolkata")

SLOTS = [("premarket", 8, 15), ("afternoon", 14, 0), ("evening", 18, 0)]

# Environment wait timers, in minutes. Each must exist as "wait-<n>".
WAIT_ENVS = [3840, 1920, 960, 480, 240, 120, 60, 30, 15]

LEAD_MIN = 3     # start the report job this early (setup + build ≈ 1.5 min)
MAX_HOPS = 15    # safety stop for a runaway chain

TIMER_WORKFLOW = "timer.yml"
REPORT_WORKFLOW = "market-bot.yml"


# ── Slot maths ────────────────────────────────────────────────────────────────

def next_slot(after: datetime, holidays: set[date] = frozenset()) -> tuple[str, datetime]:
    """First report slot at least 5 min after `after`, on an NSE trading day."""
    t = after.astimezone(IST) + timedelta(minutes=5)
    day = t.date()
    for _ in range(30):
        if day.weekday() < 5 and day not in holidays:
            for name, h, m in SLOTS:
                slot = datetime(day.year, day.month, day.day, h, m, tzinfo=IST)
                if slot >= t:
                    return name, slot
        day += timedelta(days=1)
        t = datetime(day.year, day.month, day.day, tzinfo=IST)
    raise RuntimeError("no trading slot in the next 30 days")


def pick_wait(minutes_left: float) -> int | None:
    """Largest wait timer that still leaves LEAD_MIN before the target."""
    usable = minutes_left - LEAD_MIN
    for w in WAIT_ENVS:
        if w <= usable:
            return w
    return None


def label(target: datetime) -> str:
    return target.astimezone(IST).strftime("%a %d %b %I:%M %p")


def nse_holidays() -> set[date]:
    """NSE trading holidays, if the bot's modules are importable here."""
    try:
        from modules import nse_data
        return {d for h in nse_data.get_trading_holidays()
                if (d := nse_data._parse_date(h["date"]))}
    except Exception as e:
        print(f"[WARN] chain: holiday list unavailable ({e}) — assuming none")
        return set()


# ── GitHub API ────────────────────────────────────────────────────────────────

def _api(method: str, path: str, body: dict | None = None):
    req = urllib.request.Request(
        f"https://api.github.com/repos/{os.environ['GITHUB_REPOSITORY']}{path}",
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={
            "Authorization": f"Bearer {os.environ['GITHUB_TOKEN']}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "trdbot-chain",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        raw = r.read()
        return json.loads(raw) if raw else None


def _dispatch(workflow: str, inputs: dict):
    ref = os.environ.get("GITHUB_REF_NAME") or "main"
    _api("POST", f"/actions/workflows/{workflow}/dispatches", {"ref": ref, "inputs": inputs})
    print(f"[OK] chain: dispatched {workflow} {inputs}")


def chain_is_active() -> bool:
    """True if a timer hop or a report run is queued, waiting or running."""
    for wf in (TIMER_WORKFLOW, REPORT_WORKFLOW):
        runs = (_api("GET", f"/actions/workflows/{wf}/runs?per_page=20") or {}).get("workflow_runs", [])
        if any(r.get("status") != "completed" for r in runs):
            return True
    return False


# ── Chain steps ───────────────────────────────────────────────────────────────

def schedule(run_type: str, target: datetime, hop: int = 1):
    """Book the next step toward `target`: another wait, or the report itself."""
    if hop > MAX_HOPS:
        raise RuntimeError(f"chain: {hop} hops for one slot — stopping (runaway?)")
    left = (target - datetime.now(IST)).total_seconds() / 60
    wait = pick_wait(left)
    if wait is None:
        # Under 18 min to go: sleep here, then start the report LEAD_MIN early.
        pause = max(0.0, (left - LEAD_MIN) * 60)
        print(f"[OK] chain: {left:.1f} min to {run_type} — sleeping {pause / 60:.1f} min")
        time.sleep(pause)
        _dispatch(REPORT_WORKFLOW, {"run_type": run_type, "trigger": "chain",
                                    "send_at": str(int(target.timestamp()))})
    else:
        _dispatch(TIMER_WORKFLOW, {
            "run_type": run_type,
            "target": str(int(target.timestamp())),
            "label": label(target),
            "wait_env": f"wait-{wait}",
            "booked_at": str(int(time.time())),
            "hop": str(hop),
        })


def continue_after(slot_time: datetime):
    """Called by a report run when it's done: book the following slot."""
    run_type, target = next_slot(max(slot_time, datetime.now(IST)), nse_holidays())
    print(f"[OK] chain: next report {run_type} at {label(target)}")
    schedule(run_type, target)


def hop():
    """One timer hop. Runs after its environment's wait timer has elapsed."""
    run_type = os.environ["RUN_TYPE"]
    target = datetime.fromtimestamp(int(os.environ["TARGET"]), IST)
    wait = int(os.environ["WAIT_ENV"].removeprefix("wait-"))
    waited = (time.time() - int(os.environ["BOOKED_AT"])) / 60
    hop_no = int(os.environ.get("HOP") or 1)

    # If the environment's wait timer is missing (repo private again, or the
    # environment deleted), the job starts at once — stop instead of looping.
    if waited < wait * 0.8:
        raise RuntimeError(f"chain: wait-{wait} only held {waited:.1f} min — "
                           "wait timer not working; chain stopped")
    print(f"[OK] chain: hop {hop_no} waited {waited:.1f} min (timer {wait})")
    schedule(run_type, target, hop=hop_no + 1)


def watchdog():
    if chain_is_active():
        print("[OK] watchdog: chain is alive — nothing to do")
        return
    run_type, target = next_slot(datetime.now(IST), nse_holidays())
    print(f"[WARN] watchdog: no chain running — starting one for {run_type} at {label(target)}")
    schedule(run_type, target)


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "hop":
        hop()
    elif cmd == "watchdog":
        watchdog()
    elif cmd == "next":
        name, t = next_slot(datetime.now(IST), nse_holidays())
        print(name, label(t))
    else:
        sys.exit(__doc__)
