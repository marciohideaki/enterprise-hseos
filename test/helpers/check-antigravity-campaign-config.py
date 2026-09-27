import pathlib,sys,tempfile,time,json,importlib.metadata
from unittest.mock import patch
root=pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0,str(root/'packages/control-sdk'))
from antigravity_client import AntigravityKernelClient
with tempfile.TemporaryDirectory() as scratch:
 checkpoint=pathlib.Path(scratch)/'fixture.litertlm';checkpoint.write_bytes(b'configuration-only fixture, not model weights')
 client=AntigravityKernelClient(None,'10f737c0-c7d7-4150-8a39-853451619376',deadline=time.time()+30,campaign_model=lambda: {})
 with patch('socket.socket.connect',side_effect=AssertionError('Network forbidden')),patch('subprocess.Popen',side_effect=AssertionError('Process forbidden')):
  sdk,config=client.configuration(sdk_version='0.1.18',checkpoint=str(checkpoint),conversation_id='c0c9c8bc-6992-45dc-9c98-a39d86ddc8d3',scratch=scratch,max_model_calls=2,max_input_tokens=100,max_output_tokens=50)
 strategy=config.create_strategy(tool_runner=None,hook_runner=None)
 proto=strategy._build_harness_config()
 assert proto.budget_config.max_model_calls==2
 assert proto.budget_config.max_input_tokens==100
 assert proto.budget_config.max_output_tokens==50
 assert config.budget_config.scope.value=='FORWARD_LOOKING'
 assert config.conversation_id=='c0c9c8bc-6992-45dc-9c98-a39d86ddc8d3'
 assert config.capabilities.enabled_tools==[]
 assert config.capabilities.enable_subagents is False
 assert config.skills_paths==config.mcp_servers==config.subagents==[]
 assert config.retry_config.api_retry.max_retries==0
 assert [t.__name__ for t in config.tools]==['run_campaign_model']
 result={'sdk_version':importlib.metadata.version('google-antigravity'),'configuration':type(config).__name__,'builtin_tools':config.capabilities.enabled_tools,'custom_tools':[t.__name__ for t in config.tools],'conversation_id':config.conversation_id,'model_calls_limit':config.budget_config.max_model_calls,'network':'forbidden_by_test','process_launch':'forbidden_by_test','checkpoint':'placeholder for configuration validation only','inference':'not_executed','real_conformance':'not_certified'}
print(json.dumps(result))
