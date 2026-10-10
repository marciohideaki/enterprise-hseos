"""Python SDK worker for the core journey (stdlib only, SDK from the INSTALLED package).

Line-delimited JSON over stdio, same protocol as sdk-ts-client.ts. Run as:
    python3 -I -B sdk_py_client.py <sdk-dir> <url>      (credential in HSEOS_CONTROL_CREDENTIAL)
"""
import json
import os
import sys

sys.path.insert(0, sys.argv[1])
from hseos_control import ControlClient  # noqa: E402

client = ControlClient(sys.argv[2], os.environ["HSEOS_CONTROL_CREDENTIAL"])


def _paging(value):
    value = value or {}
    return {"after": value.get("after", 0), "limit": value.get("limit", 100)}


HANDLERS = {
    "prepare": lambda a: client.prepare(a[0]),
    "execute": lambda a: client.execute(a[0]),
    "query": lambda a: client.query(a[0], a[1] if len(a) > 1 and a[1] else "status"),
    "events": lambda a: client.events(a[0], **_paging(a[1] if len(a) > 1 else None)),
    "job": lambda a: client.job(a[0]),
    "jobQuery": lambda a: client.job_query(a[0]),
    "jobEvents": lambda a: client.job_events(a[0], **_paging(a[1] if len(a) > 1 else None)),
    "terminal": lambda a: client.terminal(a[0]),
    "terminalQuery": lambda a: client.terminal_query(a[0]),
    "terminalEvents": lambda a: client.terminal_events(a[0], **_paging(a[1] if len(a) > 1 else None)),
    "bindingInspect": lambda a: client.binding_inspect(a[0]),
    "campaignQuery": lambda a: client.campaign_query(a[0]),
    "campaignEvents": lambda a: client.campaign_events(a[0], **_paging(a[1] if len(a) > 1 else None)),
}


def emit(value):
    sys.stdout.write(json.dumps(value) + "\n")
    sys.stdout.flush()


emit({"ready": True, "runtime": "python", "version": sys.version.split()[0]})
for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    request = json.loads(line)
    try:
        handler = HANDLERS.get(request["method"])
        if handler is None:
            raise ValueError("Unknown method " + request["method"])
        emit({"id": request["id"], "ok": True, "result": handler(request.get("args") or [])})
    except RuntimeError as error:
        # The SDK raises RuntimeError(<CONTROL_* code>) for HTTP errors.
        emit({"id": request["id"], "ok": False, "error": {"code": str(error), "message": str(error)}})
    except Exception as error:  # noqa: BLE001 - report local validation failures to the orchestrator
        emit({"id": request["id"], "ok": False, "error": {"code": None, "message": f"{type(error).__name__}: {error}"}})
