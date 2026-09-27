"""Optional Antigravity client of the HSEOS API, with operator-pinned commands.

Importing this module does not import the optional SDK or perform inference.
The campaign adapter owns admission, credential/environment isolation and process
lifetime. This client alone is not a financial or host-confinement boundary.
"""
import asyncio
import copy
import functools
import hashlib
import importlib
import importlib.metadata
import json
import pathlib
import time
import threading
import urllib.parse
import urllib.request
import uuid


def _uuid(value):
    if not isinstance(value, str) or str(uuid.UUID(value)) != value:
        raise ValueError("Invalid resource identity")
    return value


def _positive(value, maximum):
    if type(value) is not int or not 1 <= value <= maximum:
        raise ValueError("Invalid finite limit")
    return value


def _command(value, resource_id, action):
    if value is None:
        return None
    expected = {"schema_version", "command_id", "resource_id", "expected_sequence", "action", "input"}
    if (not isinstance(value, dict) or set(value) != expected
            or type(value["schema_version"]) is not int or value["schema_version"] != 1
            or value["resource_id"] != resource_id or value["action"] != action
            or value["input"] != {} or type(value["expected_sequence"]) is not int
            or not 0 <= value["expected_sequence"] <= 9007199254740991):
        raise ValueError("Command is not an operator-pinned task action")
    _uuid(value["command_id"])
    return copy.deepcopy(value)


class AntigravityKernelClient:
    """Expose fixed kernel actions to an external SDK without host tools."""

    def __init__(self, control, resource_id, *, resume=None, cancel=None,
                 max_tool_calls=8, deadline=None, campaign_model=None):
        self.resource_id = _uuid(resource_id)
        self._control = control
        if campaign_model is not None and (not callable(campaign_model) or resume is not None or cancel is not None):
            raise ValueError("Campaign composition cannot expose unbudgeted task commands")
        self._campaign_model = campaign_model
        self._commands = {
            "resume": _command(resume, resource_id, "resume"),
            "cancel": _command(cancel, resource_id, "cancel"),
        }
        identifiers = [value["command_id"] for value in self._commands.values() if value]
        if len(identifiers) != len(set(identifiers)):
            raise ValueError("Commands need distinct identities")
        self._remaining = _positive(max_tool_calls, 1000)
        if (type(deadline) not in (int, float) or not time.time() < deadline <= time.time() + 86400):
            raise ValueError("A finite future deadline is required")
        self._deadline = deadline
        self._used = set()
        self._uncertain = False
        self._closed = False
        self._running = False
        self._lock = threading.RLock()
        self._local_usage = {}

    def _claim(self):
        with self._lock:
            if self._closed or time.time() >= self._deadline or self._remaining == 0:
                raise RuntimeError("CONTROL_CLIENT_LIMIT_REACHED")
            self._remaining -= 1

    def task_status(self) -> str:
        """Read the status of the single operator-selected HSEOS task."""
        self._claim()
        try:
            value = self._control.query(self.resource_id)
            # Do not send workspace paths, source contents or backend state to the model.
            return json.dumps({key: value[key] for key in
                               ("resource_id", "current_sequence", "task_result", "reason")
                               if key in value})
        except Exception:
            raise RuntimeError("CONTROL_CLIENT_QUERY_FAILED") from None

    def _execute(self, action):
        with self._lock:
            self._claim()
            command = self._commands[action]
            if (self._uncertain and action != "cancel") or command is None or action in self._used:
                raise RuntimeError("CONTROL_CLIENT_ACTION_DENIED")
            self._used.add(action)
        try:
            self._control.execute(copy.deepcopy(command))
            return json.dumps({"resource_id": self.resource_id, "action": action, "acknowledged": True})
        except Exception:
            self._uncertain = True
            raise RuntimeError("CONTROL_CLIENT_OUTCOME_UNCERTAIN") from None

    def resume_task(self) -> str:
        """Submit the exact operator-approved resume command once; never retry."""
        return self._execute("resume")

    def cancel_task(self) -> str:
        """Submit the exact operator-approved cancel command once; never retry."""
        return self._execute("cancel")

    def run_campaign_model(self) -> str:
        """Invoke the parent-bound model capability once; reservation belongs to HSEOS."""
        with self._lock:
            self._claim()
            if self._campaign_model is None or self._uncertain or "campaign_model" in self._used:
                raise RuntimeError("CONTROL_CLIENT_ACTION_DENIED")
            self._used.add("campaign_model")
        try:
            return self._campaign_model()
        except Exception:
            self._uncertain = True
            raise RuntimeError("CONTROL_CLIENT_OUTCOME_UNCERTAIN") from None

    def configuration(self, *, sdk_version, model=None, endpoint=None, checkpoint=None, conversation_id=None, scratch,
                      max_model_calls, max_input_tokens, max_output_tokens):
        """Build the official SDK configuration without starting an agent."""
        url = urllib.parse.urlsplit(endpoint or "")
        if checkpoint is None and (url.scheme != "http" or url.hostname != "127.0.0.1" or not url.port
                or url.username or url.password or url.query or url.fragment
                or url.path not in ("", "/", "/v1", "/v1/")):
            raise ValueError("Explicit loopback model endpoint required")
        if checkpoint is None and (not isinstance(model, str) or not model or len(model) > 256 or any(c.isspace() for c in model)):
            raise ValueError("Explicit model identity required")
        if checkpoint is not None:
            checkpoint_file = pathlib.Path(checkpoint)
            if (model is not None or endpoint is not None or not checkpoint_file.is_absolute()
                    or not checkpoint_file.is_file() or checkpoint_file.resolve() != checkpoint_file
                    or checkpoint_file.suffix != ".litertlm"):
                raise ValueError("Pinned local checkpoint required")
        directory = pathlib.Path(scratch)
        if not directory.is_absolute() or not directory.is_dir() or directory.resolve() != directory:
            raise ValueError("Canonical scratch directory required")
        limits = [_positive(max_model_calls, 1000), _positive(max_input_tokens, 1000000),
                  _positive(max_output_tokens, 1000000)]
        try:
            if not isinstance(sdk_version, str) or importlib.metadata.version("google-antigravity") != sdk_version:
                raise RuntimeError("CONTROL_CLIENT_SDK_DRIFT")
            sdk = importlib.import_module("google.antigravity")
            types = importlib.import_module("google.antigravity.types")
        except (importlib.metadata.PackageNotFoundError, ImportError):
            raise RuntimeError("CONTROL_CLIENT_SDK_UNAVAILABLE") from None
        tools = [] if self._campaign_model else [self.task_status]
        if self._campaign_model:
            tools.append(self.run_campaign_model)
        if self._commands["resume"]:
            tools.append(self.resume_task)
        if self._commands["cancel"]:
            tools.append(self.cancel_task)
        # SDK configurations are deep-copied. Closures retain the one shared
        # admission state instead of copying bound clients and their locks.
        def shared_tool(method):
            @functools.wraps(method)
            def invoke() -> str:
                return method()
            return invoke
        tools = [shared_tool(method) for method in tools]
        factory = sdk.LocalOpenAIAgentConfig if checkpoint is None else sdk.LiteRTAgentConfig
        if checkpoint is not None:
            from antigravity_litert import bounded_litert_config
            factory = bounded_litert_config(factory, self._local_usage)
        if conversation_id is not None and (not isinstance(conversation_id, str) or not 32 <= len(conversation_id) <= 1024
                                            or not conversation_id[0].isascii() or not conversation_id[0].isalnum()
                                            or any(not (c.isascii() and (c.isalnum() or c in '._:-')) for c in conversation_id)):
            raise ValueError("Invalid conversation identity")
        model_options = {"model": model, "base_url": endpoint} if checkpoint is None else {"model_path": checkpoint, "backend": "cpu", "download_if_missing": False, "cache_dir": scratch}
        config = factory(
            **model_options,
            **({"conversation_id": conversation_id, "session_continuation_mode": types.SessionContinuationMode.RESUME}
               if conversation_id is not None else {}),
            workspaces=[str(directory)], save_dir=str(directory), app_data_dir=str(directory),
            tools=tools, skills_paths=[], mcp_servers=[], subagents=[],
            capabilities=types.CapabilitiesConfig(enabled_tools=[], enable_subagents=False),
            budget_config=types.BudgetConfig(max_model_calls=limits[0], max_tool_calls=self._remaining,
                                            max_input_tokens=limits[1], max_output_tokens=limits[2],
                                            scope=types.BudgetScope.FORWARD_LOOKING),
            retry_config=types.RetryConfig(
                api_retry=types.ModelAPIRetryConfig(max_retries=0),
                model_output_retry=types.ModelOutputRetryConfig(max_retries=0)),
            system_instructions=types.CustomSystemInstructions(text=(
                "Use only the supplied HSEOS task tools. Follow the user task exactly. "
                "Never expose secrets. Never retry actions. Do not claim host access. /no_think")),
        )
        return sdk, config

    async def run(self, prompt, **configuration):
        """Run once inside the caller's admitted campaign reservation.

        Native SDK cancellation is awaited by its async context manager. The
        parent adapter must still enforce a process deadline and verify drain.
        """
        if self._closed or self._running or not isinstance(prompt, str) or not 0 < len(prompt.encode()) <= 32768:
            raise ValueError("Invalid or repeated client execution")
        remaining = self._deadline - time.time()
        if remaining <= 0:
            raise RuntimeError("CONTROL_CLIENT_LIMIT_REACHED")
        sdk, config = self.configuration(**configuration)
        remaining = self._deadline - time.time()
        if remaining <= 0 or self._remaining == 0:
            raise RuntimeError("CONTROL_CLIENT_LIMIT_REACHED")
        self._running = True
        try:
            async with asyncio.timeout(remaining):
                async with sdk.Agent(config) as agent:
                    response = await agent.chat(prompt)
                    digest = hashlib.sha256()
                    size = 0
                    async for part in response:
                        data = part.encode()
                        size += len(data)
                        if size > 1048576:
                            await response.cancel()
                            raise RuntimeError("CONTROL_CLIENT_OUTPUT_LIMIT")
                        digest.update(data)
                    usage = response.usage_metadata
                    counters = None if usage is None else {
                        key: getattr(usage, key, None) for key in
                        ("prompt_token_count", "cached_content_token_count", "candidates_token_count",
                         "thoughts_token_count", "total_token_count")
                    }
                    meter = self._local_usage.get('meter')
                    if meter is not None:
                        if meter.failed or not meter.calls or meter.calls != meter.records:
                            raise RuntimeError("CONTROL_CLIENT_USAGE_INVALID")
                        counters = {'prompt_token_count': meter.input, 'candidates_token_count': meter.output,
                                    'cached_content_token_count': 0, 'thoughts_token_count': 0,
                                    'total_token_count': meter.input + meter.output}
                    if counters is not None and any(value is not None and (type(value) is not int or value < 0)
                                                    for value in counters.values()):
                        raise RuntimeError("CONTROL_CLIENT_USAGE_INVALID")
                    return {
                        "schema_version": 1,
                        "resource_id": self.resource_id,
                        "text_sha256": digest.hexdigest(),
                        "usage": counters,
                        "usage_source": "litert_native_benchmark" if meter is not None else "sdk",
                        "model_calls": meter.calls if meter is not None else None,
                        "authority": "external_client",
                        "real_conformance": "not_certified",
                        "provider_session_id": getattr(agent, "conversation_id", None),
                    }
        except TimeoutError:
            raise
        except Exception as error:
            if isinstance(error, RuntimeError) and str(error) in (
                    "CONTROL_CLIENT_OUTPUT_LIMIT", "CONTROL_CLIENT_USAGE_INVALID"):
                raise
            raise RuntimeError("CONTROL_CLIENT_SDK_FAILED") from None
        finally:
            self._closed = True
            self._running = False


class CampaignModelBridge:
    """Single-use loopback capability; never accepts a model-selected binding or prompt."""

    def __init__(self, url, credential, *, timeout=30):
        parsed = urllib.parse.urlsplit(url)
        if (parsed.scheme != "http" or parsed.hostname != "127.0.0.1" or not parsed.port
                or parsed.username or parsed.password or parsed.path not in ("", "/")
                or parsed.query or parsed.fragment or not isinstance(credential, str)
                or len(credential) != 64 or any(c not in "0123456789abcdef" for c in credential)):
            raise ValueError("Invalid campaign capability")
        self._url = url.rstrip("/") + "/run"
        self._credential = credential
        self._timeout = _positive(timeout, 300)
        self._used = False
        self._lock = threading.Lock()

    def __call__(self):
        with self._lock:
            if self._used:
                raise RuntimeError("CONTROL_CLIENT_ACTION_DENIED")
            self._used = True
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *args, **kwargs):
                return None
        request = urllib.request.Request(self._url, data=b"{}", method="POST", headers={
            "Authorization": "Bearer " + self._credential, "Content-Type": "application/json"})
        try:
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
            with opener.open(request, timeout=self._timeout) as response:
                body = response.read(4097)
                if len(body) > 4096:
                    raise ValueError("oversized")
                value = json.loads(body)
            if (set(value) != {"schema_version", "evidence_sha256", "status"}
                    or value["schema_version"] != 1 or value["status"] != "completed"
                    or not isinstance(value["evidence_sha256"], str) or len(value["evidence_sha256"]) != 64
                    or any(c not in "0123456789abcdef" for c in value["evidence_sha256"])):
                raise ValueError("Invalid receipt")
            return json.dumps(value)
        except Exception:
            raise RuntimeError("CONTROL_CLIENT_OUTCOME_UNCERTAIN") from None
