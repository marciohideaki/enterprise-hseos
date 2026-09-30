"""Deterministic client-boundary tests. No SDK installation or model calls."""
import asyncio
import copy
import hashlib
import importlib.metadata
import json
import pathlib
import sys
import tempfile
import time
import types
import unittest
from unittest.mock import patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'packages/control-sdk'))
from antigravity_client import AntigravityKernelClient
from antigravity_litert import LocalUsage

RESOURCE = '10f737c0-c7d7-4150-8a39-853451619376'


def command(action='resume'):
    return {'schema_version': 1, 'command_id': '5d53b311-e19c-4fdb-a787-c057688586a2',
            'resource_id': RESOURCE, 'expected_sequence': 1, 'action': action, 'input': {}}


class Control:
    def __init__(self):
        self.calls = []
        self.fail = False

    def query(self, resource):
        return {'resource_id': resource, 'current_sequence': 2, 'task_result': 'approved',
                'state': '/private', 'credential': 'never disclose'}

    def execute(self, value):
        self.calls.append(value)
        if self.fail:
            raise RuntimeError('sensitive transport detail')
        return {'state': '/private'}


class Config:
    def __init__(self, **values):
        self.__dict__.update(values)


class Response:
    def __init__(self, chunks=None, usage=None, delay=0):
        self.chunks = chunks or ['done']
        self.usage_metadata = usage
        self.delay = delay
        self.cancelled = False

    async def __aiter__(self):
        for chunk in self.chunks:
            await asyncio.sleep(self.delay)
            yield chunk

    async def cancel(self):
        self.cancelled = True


class Agent:
    response = None
    entered = 0
    exited = 0

    def __init__(self, config):
        self.config = copy.deepcopy(config)

    async def __aenter__(self):
        Agent.entered += 1
        return self

    async def __aexit__(self, *args):
        Agent.exited += 1

    async def chat(self, prompt):
        return Agent.response


class ClientTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.control = Control()
        self.client = AntigravityKernelClient(self.control, RESOURCE, resume=command(), deadline=time.time()+30)
        self.configuration = dict(sdk_version='1.2.3', model='local/model', endpoint='http://127.0.0.1:1234/v1',
                                  scratch=self.directory.name, max_model_calls=2, max_input_tokens=100, max_output_tokens=50)
        self.sdk = types.SimpleNamespace(LocalOpenAIAgentConfig=Config, Agent=Agent)
        self.sdk_types = types.SimpleNamespace(**{name: Config for name in
                                                 ['CustomSystemInstructions', 'CapabilitiesConfig', 'BudgetConfig', 'RetryConfig',
                                                  'ModelAPIRetryConfig', 'ModelOutputRetryConfig']})
        self.sdk_types.BudgetScope = types.SimpleNamespace(FORWARD_LOOKING="FORWARD_LOOKING")
        self.sdk_types.SessionContinuationMode = types.SimpleNamespace(RESUME="RESUME")
        Agent.response = Response()
        Agent.entered = Agent.exited = 0

    def modules(self, name):
        return {'google.antigravity': self.sdk, 'google.antigravity.types': self.sdk_types}[name]

    def mocked_sdk(self):
        version = patch('importlib.metadata.version', return_value='1.2.3')
        imports = patch('importlib.import_module', side_effect=self.modules)
        self.addCleanup(version.stop)
        self.addCleanup(imports.stop)
        version.start()
        imports.start()

    def test_composed_client_exposes_only_reserved_model_capability_once(self):
        self.mocked_sdk()
        calls = []
        client = AntigravityKernelClient(None, RESOURCE, campaign_model=lambda: calls.append(1) or 'receipt', deadline=time.time()+30)
        _, config = client.configuration(**self.configuration)
        self.assertEqual([tool.__name__ for tool in config.tools], ['run_campaign_model'])
        self.assertEqual(client.run_campaign_model(), 'receipt')
        with self.assertRaisesRegex(RuntimeError, 'ACTION_DENIED'):
            client.run_campaign_model()
        self.assertEqual(calls, [1])
        with self.assertRaises(ValueError):
            AntigravityKernelClient(None, RESOURCE, campaign_model=lambda: None, resume=command(), deadline=time.time()+30)

    def test_local_usage_fences_calls_and_cumulative_generation(self):
        meter = LocalUsage(2, 100, 12)
        self.assertEqual(meter.admit(), 12)
        self.assertEqual(meter.record(types.SimpleNamespace(last_prefill_token_count=40, last_decode_token_count=7)),
                         {'prompt_tokens': 40, 'completion_tokens': 7, 'total_tokens': 47})
        self.assertEqual(meter.admit(), 5)
        meter.record(types.SimpleNamespace(last_prefill_token_count=45, last_decode_token_count=5))
        with self.assertRaisesRegex(RuntimeError, 'LIMIT_REACHED'):
            meter.admit()
        self.assertEqual((meter.input, meter.output, meter.calls, meter.records), (85, 12, 2, 2))

    def test_local_usage_rejects_unknown_negative_and_over_budget_measurements(self):
        for incoming, outgoing in [(None, 1), (0, 1), (True, 1), (-1, 1), (5, -1), (101, 1), (5, 13)]:
            meter = LocalUsage(2, 100, 12)
            meter.admit()
            with self.assertRaises(RuntimeError):
                meter.record(types.SimpleNamespace(last_prefill_token_count=incoming, last_decode_token_count=outgoing))
            self.assertTrue(meter.failed)
            with self.assertRaises(RuntimeError):
                meter.admit()

    def test_sdk_copy_preserves_single_admission_state(self):
        self.mocked_sdk()
        calls = []
        client = AntigravityKernelClient(None, RESOURCE, campaign_model=lambda: calls.append(1) or 'receipt', deadline=time.time()+30)
        _, config = client.configuration(**self.configuration)
        copied = copy.deepcopy(config)
        self.assertEqual(copied.tools[0](), 'receipt')
        with self.assertRaisesRegex(RuntimeError, 'ACTION_DENIED'):
            config.tools[0]()
        self.assertEqual(calls, [1])

    def test_litert_configuration_disables_downloads_gpu_and_remote_endpoint(self):
        self.mocked_sdk()
        self.sdk.LiteRTAgentConfig = Config
        checkpoint = pathlib.Path(self.directory.name, 'tiny.litertlm')
        checkpoint.write_text('fixture')
        config = dict(self.configuration)
        config.pop('model'); config.pop('endpoint'); config['checkpoint'] = str(checkpoint)
        _, value = self.client.configuration(**config)
        self.assertEqual(value.backend, 'cpu')
        self.assertFalse(value.download_if_missing)
        self.assertEqual(value.model_path, str(checkpoint))
        with self.assertRaises(ValueError):
            self.client.configuration(**config, endpoint='http://127.0.0.1:1234/v1')

    def test_import_and_construction_are_sdk_lazy(self):
        self.assertNotIn('google.antigravity', sys.modules)
        with patch('importlib.import_module', side_effect=AssertionError('eager import')):
            AntigravityKernelClient(self.control, RESOURCE, deadline=time.time()+30)

    def test_task_actions_are_fixed_once_and_inputs_are_copied(self):
        value = command()
        client = AntigravityKernelClient(self.control, RESOURCE, resume=value, deadline=time.time()+30)
        value['resource_id'] = 'modified by caller'
        self.assertNotIn('private', client.resume_task())
        self.assertEqual(self.control.calls, [command()])
        with self.assertRaisesRegex(RuntimeError, 'ACTION_DENIED'):
            client.resume_task()
        self.assertEqual(len(self.control.calls), 1)
        self.assertNotIn('private', client.task_status())
        self.assertNotIn('credential', client.task_status())

    def test_uncertain_dispatch_is_fenced_but_pinned_cancellation_remains_available(self):
        cancel = command('cancel')
        cancel['command_id'] = 'd6a260ff-e9ac-4c92-a6d0-ce96a783d3e5'
        client = AntigravityKernelClient(self.control, RESOURCE, resume=command(), cancel=cancel, deadline=time.time()+30)
        self.control.fail = True
        with self.assertRaisesRegex(RuntimeError, '^CONTROL_CLIENT_OUTCOME_UNCERTAIN$'):
            client.resume_task()
        self.control.fail = False
        client.task_status()
        client.cancel_task()
        with self.assertRaisesRegex(RuntimeError, 'ACTION_DENIED'):
            client.resume_task()
        self.assertEqual([v['action'] for v in self.control.calls], ['resume', 'cancel'])

    def test_invalid_limits_commands_and_unapproved_actions_fail_before_control(self):
        for update in ({'action': 'apply'}, {'resource_id': 'another'}, {'input': {'reconciliation_decision': {}}},
                       {'schema_version': True}, {'expected_sequence': -1}, {'command_id': 'invalid'}):
            value = command() | update
            with self.assertRaises(ValueError):
                AntigravityKernelClient(self.control, RESOURCE, resume=value, deadline=time.time()+30)
        with self.assertRaises(ValueError):
            AntigravityKernelClient(self.control, RESOURCE, deadline=float('inf'))
        with self.assertRaises(ValueError):
            AntigravityKernelClient(self.control, RESOURCE, deadline=time.time()+30, max_tool_calls=True)
        client = AntigravityKernelClient(self.control, RESOURCE, deadline=time.time()+30, max_tool_calls=1)
        client.task_status()
        with self.assertRaisesRegex(RuntimeError, 'LIMIT_REACHED'):
            client.task_status()
        self.assertEqual(self.control.calls, [])

    def test_configuration_disables_native_tools_and_uses_only_explicit_local_route(self):
        self.mocked_sdk()
        _, config = self.client.configuration(**self.configuration)
        self.assertEqual(config.capabilities.enabled_tools, [])
        self.assertFalse(config.capabilities.enable_subagents)
        self.assertEqual(config.skills_paths + config.mcp_servers + config.subagents, [])
        self.assertEqual(config.workspaces, [self.directory.name])
        self.assertEqual(config.retry_config.api_retry.max_retries, 0)
        self.assertEqual(config.retry_config.model_output_retry.max_retries, 0)
        self.assertEqual([t.__name__ for t in config.tools], ['task_status', 'resume_task'])
        self.assertEqual(config.budget_config.max_model_calls, 2)
        self.assertEqual(config.budget_config.scope, "FORWARD_LOOKING")
        for endpoint in ['https://api.example.invalid', 'http://localhost:1234',
                         'http://user@127.0.0.1:1234', 'http://127.0.0.1:1234/?key=value']:
            with self.assertRaises(ValueError):
                self.client.configuration(**(self.configuration | {'endpoint': endpoint}))
        self.assertEqual(Agent.entered, 0)

    def test_resume_identity_is_forwarded_without_path_traversal(self):
        self.mocked_sdk()
        _, config = self.client.configuration(**(self.configuration | {'conversation_id': 'c0c9c8bc-6992-45dc-9c98-a39d86ddc8d3'}))
        self.assertEqual(config.conversation_id, 'c0c9c8bc-6992-45dc-9c98-a39d86ddc8d3')
        for identity in ['../escape', '.', '..', '/tmp/session', 'a/b', '', 'short-session']:
            with self.assertRaises(ValueError):
                self.client.configuration(**(self.configuration | {'conversation_id': identity}))

    async def test_sdk_version_and_missing_dependency_fail_before_effect(self):
        with patch('importlib.metadata.version', return_value='different'):
            with self.assertRaisesRegex(RuntimeError, 'SDK_DRIFT'):
                await self.client.run('task', **self.configuration)
        with patch('importlib.metadata.version', side_effect=importlib.metadata.PackageNotFoundError):
            with self.assertRaisesRegex(RuntimeError, 'SDK_UNAVAILABLE'):
                await self.client.run('task', **self.configuration)
        self.assertEqual(Agent.entered, 0)

    async def test_native_usage_is_measured_and_incomplete_calls_are_rejected(self):
        self.mocked_sdk()
        meter = LocalUsage(2, 100, 50)
        self.client._local_usage['meter'] = meter
        meter.admit()
        meter.record(types.SimpleNamespace(last_prefill_token_count=17, last_decode_token_count=4))
        result = await self.client.run('task', **self.configuration)
        self.assertEqual(result['usage_source'], 'litert_native_benchmark')
        self.assertEqual(result['usage']['total_token_count'], 21)
        self.assertEqual(result['model_calls'], 1)
        second = AntigravityKernelClient(self.control, RESOURCE, deadline=time.time()+30)
        meter.admit()
        second._local_usage['meter'] = meter
        with self.assertRaisesRegex(RuntimeError, 'USAGE_INVALID'):
            await second.run('task', **self.configuration)

    async def test_unknown_usage_is_not_zero_and_client_is_single_use(self):
        self.mocked_sdk()
        result = await self.client.run('task', **self.configuration)
        self.assertEqual(result['text_sha256'], hashlib.sha256(b'done').hexdigest())
        self.assertIsNone(result['usage'])
        self.assertEqual(result['authority'], 'external_client')
        self.assertEqual(Agent.entered, Agent.exited)
        with self.assertRaises(ValueError):
            await self.client.run('again', **self.configuration)
        with self.assertRaisesRegex(RuntimeError, 'LIMIT_REACHED'):
            self.client.task_status()

    async def test_partial_usage_preserves_unknown_fields_and_excludes_vendor_payload(self):
        self.mocked_sdk()
        Agent.response = Response(usage=types.SimpleNamespace(prompt_token_count=12, candidates_token_count=0,
                                                              private='hidden'))
        result = await self.client.run('task', **self.configuration)
        self.assertEqual(result['usage']['prompt_token_count'], 12)
        self.assertEqual(result['usage']['candidates_token_count'], 0)
        self.assertIsNone(result['usage']['total_token_count'])
        self.assertNotIn('private', result['usage'])

    async def test_sdk_errors_are_sanitized_and_close_the_client(self):
        self.mocked_sdk()
        with patch.object(Agent, 'chat', side_effect=RuntimeError('private SDK transport detail')):
            with self.assertRaisesRegex(RuntimeError, '^CONTROL_CLIENT_SDK_FAILED$'):
                await self.client.run('task', **self.configuration)
        self.assertEqual(Agent.entered, Agent.exited)
        with self.assertRaises(ValueError):
            await self.client.run('again', **self.configuration)

    async def test_output_limit_cancels_and_timeout_drains_sdk_context(self):
        self.mocked_sdk()
        response = Response(chunks=['a' * 1048577])
        Agent.response = response
        with self.assertRaisesRegex(RuntimeError, 'OUTPUT_LIMIT'):
            await self.client.run('task', **self.configuration)
        self.assertTrue(response.cancelled)
        self.assertEqual(Agent.entered, Agent.exited)
        client = AntigravityKernelClient(self.control, RESOURCE, deadline=time.time()+0.05)
        Agent.response = Response(delay=1)
        with self.assertRaises(TimeoutError):
            await client.run('task', **self.configuration)
        self.assertEqual(Agent.entered, Agent.exited)


if __name__ == '__main__':
    unittest.main()
