import pathlib,sys,tempfile,time,json,hashlib,importlib.metadata
from unittest.mock import patch
root=pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0,str(root/'packages/control-sdk'))
from antigravity_client import AntigravityKernelClient
with tempfile.TemporaryDirectory() as scratch:
 client=AntigravityKernelClient(None,'10f737c0-c7d7-4150-8a39-853451619376',deadline=time.time()+30)
 with patch('socket.socket.connect',side_effect=AssertionError('Network forbidden')),patch('subprocess.Popen',side_effect=AssertionError('Process forbidden')):
  sdk,config=client.configuration(sdk_version='0.1.18',model='unprovisioned/model',endpoint='http://127.0.0.1:1234/v1',scratch=scratch,max_model_calls=2,max_input_tokens=100,max_output_tokens=50)
 assert config.capabilities.enabled_tools==[]
 assert config.capabilities.enable_subagents is False
 assert config.workspaces==[scratch]
 assert config.skills_paths==config.mcp_servers==config.subagents==[]
 assert config.retry_config.api_retry.max_retries==0
 assert config.retry_config.model_output_retry.max_retries==0
 result={'sdk_version':importlib.metadata.version('google-antigravity'),'configuration':type(config).__name__,'builtin_tools':config.capabilities.enabled_tools,'subagents':config.capabilities.enable_subagents,'custom_tools':[t.__name__ for t in config.tools],'model_calls_limit':config.budget_config.max_model_calls,'network':'forbidden_by_test','process_launch':'forbidden_by_test','inference':'not_executed','real_conformance':'not_certified'}
print(json.dumps(result,indent=2))
(root/'docs/evolution/w3/evidence/antigravity-client/official-sdk-config.json').write_text(json.dumps(result,indent=2)+'\n')
