"""Version-pinned local connection with native LiteRT usage and finite admission.

Reuses the SDK's message translator; owns engine/server lifetime and never runs
warm-up inference. Optional dependencies are imported only on strategy creation.
"""
import importlib.metadata
import json
import pathlib
import threading
import uuid


class LocalUsage:
    def __init__(self, calls, input_tokens, output_tokens):
        self.max_calls = calls
        self.max_input = input_tokens
        self.max_output = output_tokens
        self.calls = self.records = self.input = self.output = 0
        self.failed = False

    def admit(self):
        if (self.failed or self.calls >= self.max_calls or self.input >= self.max_input
                or self.output >= self.max_output):
            raise RuntimeError('CONTROL_CLIENT_LIMIT_REACHED')
        self.calls += 1
        return self.max_output - self.output

    def record(self, info):
        incoming, outgoing = info.last_prefill_token_count, info.last_decode_token_count
        if any(type(v) is not int or v < 0 for v in (incoming, outgoing)) or incoming == 0:
            self.failed = True
            raise RuntimeError('CONTROL_CLIENT_USAGE_INVALID')
        self.records += 1
        self.input += incoming
        self.output += outgoing
        if self.input > self.max_input or self.output > self.max_output:
            self.failed = True
            raise RuntimeError('CONTROL_CLIENT_LIMIT_REACHED')
        return {'prompt_tokens': incoming, 'completion_tokens': outgoing, 'total_tokens': incoming + outgoing}


def bounded_litert_config(base, usage_sink=None):
    class BoundedLiteRTConfig(base):
        def create_strategy(self, *, tool_runner, hook_runner):
            return _strategy(self, tool_runner, hook_runner, usage_sink)
    return BoundedLiteRTConfig


def _strategy(config, tool_runner, hook_runner, usage_sink):
    if (importlib.metadata.version('google-antigravity') != '0.1.18'
            or importlib.metadata.version('litert-lm') != '0.17.1'):
        raise RuntimeError('CONTROL_CLIENT_SDK_DRIFT')
    import litert_lm
    from google.antigravity.connections.local import litert_server, local_openai_connection

    budget = config.budget_config
    usage = LocalUsage(budget.max_model_calls, budget.max_input_tokens, budget.max_output_tokens)

    if usage_sink is not None:
        usage_sink['meter'] = usage

    class EngineAdmission:
        def __init__(self, engine):
            self.engine = engine

        def create_conversation(self, **kwargs):
            kwargs['max_output_tokens'] = usage.admit()
            return self.engine.create_conversation(**kwargs)

    class Handler(litert_server.LiteRTOpenAIHandler):
        def setup(self):
            super().setup()
            self.connection.settimeout(10)

        def do_POST(self):
            try:
                size = int(self.headers.get('Content-Length', '0'))
                if not 0 < size <= 131072 or self.headers.get('Transfer-Encoding'):
                    raise ValueError('size')
            except ValueError:
                self.send_error(400, 'Invalid request size')
                return
            super().do_POST()

        def _stream_response(self, conv, prompt, model_name):
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream')
            self.end_headers()
            identity = 'chatcmpl-' + uuid.uuid4().hex

            def frame(delta, reason=None, metrics=None):
                value = {'id': identity, 'object': 'chat.completion.chunk', 'model': model_name,
                         'choices': [{'index': 0, 'delta': delta, 'finish_reason': reason}]}
                if metrics is not None:
                    value['usage'] = metrics
                self.wfile.write(('data: ' + json.dumps(value) + '\n\n').encode())
                self.wfile.flush()

            reason = 'stop'
            for chunk in conv.send_message_async(prompt):
                if not isinstance(chunk, dict):
                    raise RuntimeError('CONTROL_CLIENT_RESPONSE_INVALID')
                delta = {}
                content = ''.join(v.get('text', '') for v in chunk.get('content', [])
                                  if v.get('type') == 'text')
                if content:
                    delta['content'] = content
                calls = chunk.get('tool_calls', [])
                if calls:
                    delta['tool_calls'] = [dict(litert_server._format_openai_tool_call(v, i, identity), index=i)
                                           for i, v in enumerate(calls)]
                    reason = 'tool_calls'
                if delta:
                    frame(delta)
            metrics = usage.record(conv.get_benchmark_info())
            frame({}, reason, metrics)
            self.wfile.write(b'data: [DONE]\n\n')
            self.wfile.flush()

        def _handle_synchronous(self, conv, prompt, model_name):
            # The SDK client uses streaming; do not accept an unmetered alternate path.
            usage.failed = True
            self.send_error(400, 'Streaming required')

    class Strategy(local_openai_connection.LocalOpenAIConnectionStrategy):
        async def __aenter__(self):
            self.local_engine = self.local_server = self.local_thread = None
            try:
                # Divide context capacity across admitted calls; include generation
                # in that capacity and disable ring buffers rather than wrap input.
                capacity = budget.max_input_tokens // budget.max_model_calls
                if capacity < 128:
                    raise ValueError('Local context capacity too small')
                self.local_engine = litert_lm.Engine(
                    config.model_path, backend=litert_lm.Backend.CPU(), cache_dir=config.cache_dir,
                    max_num_tokens=capacity, use_ringbuffers_local_attention=False, enable_benchmark=True)
                engine = self.local_engine.__enter__()
                self.local_server = litert_server.LiteRTOpenAIServer(
                    ('127.0.0.1', 0), Handler, engine=EngineAdmission(engine),
                    model_name=self._model_name, max_output_tokens=budget.max_output_tokens,
                    thinking_token_budget=0)
                self._base_url = f'http://127.0.0.1:{self.local_server.server_port}'
                self.local_thread = threading.Thread(target=self.local_server.serve_forever, daemon=True)
                self.local_thread.start()
                await super().__aenter__()
            except BaseException:
                self.close_local()
                raise

        def close_local(self):
            if self.local_server:
                if self.local_thread and self.local_thread.is_alive():
                    self.local_server.shutdown()
                    self.local_thread.join()
                self.local_server.server_close()
            if self.local_engine:
                if self.local_server:
                    # HTTP handler threads may outlive an SDK disconnect. Drain
                    # inference before releasing native engine memory.
                    with self.local_server.engine_lock:
                        self.local_engine.__exit__(None, None, None)
                else:
                    self.local_engine.__exit__(None, None, None)
            self.local_server = self.local_engine = self.local_thread = None

        async def __aexit__(self, *args):
            try:
                await super().__aexit__(*args)
            finally:
                self.close_local()

    return Strategy(
        base_url='http://127.0.0.1', model_name=pathlib.Path(config.model_path).name,
        tool_runner=tool_runner, hook_runner=hook_runner,
        system_instructions=config._get_system_instructions(), capabilities_config=config.capabilities,
        compaction_config=config._get_effective_compaction_config(), conversation_id=config.conversation_id,
        save_dir=config._get_or_create_save_dir(), workspaces=config.workspaces, app_data_dir=config.app_data_dir,
        skills_paths=config.skills_paths, mcp_servers=config.mcp_servers, subagents=config.subagents,
        env=config.env, debug_config=config.debug_config, retry_config=config.retry_config,
        budget_config=budget, session_continuation_mode=config.session_continuation_mode,
        policies=list(config.policies), tools=config.tools)
