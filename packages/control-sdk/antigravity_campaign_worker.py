"""Controller-owned SDK worker. The process supervisor owns descendant drain."""
import asyncio
import importlib.metadata
import importlib.util
import json
import pathlib
import sys
import time


def main():
    raw = sys.stdin.buffer.read(131073)
    if len(raw) > 131072:
        raise ValueError('input limit')
    config = json.loads(raw)
    pathlib.Path(config['group'], 'cgroup.procs').write_text(str(__import__('os').getpid()))
    if importlib.metadata.version('google-antigravity') != config['sdk_version']:
        raise ValueError('SDK drift')
    spec = importlib.util.find_spec('google.antigravity')
    if spec is None or pathlib.Path(spec.origin).resolve() != pathlib.Path(config['sdk_module']).resolve():
        raise ValueError('SDK origin drift')
    if config['operation'] == 'inspect':
        return {'sdk_version': config['sdk_version']}
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
    from antigravity_client import AntigravityKernelClient, CampaignModelBridge
    bridge = CampaignModelBridge(config['bridge']['url'], config['bridge']['credential'], timeout=config['timeout_seconds'])
    client = AntigravityKernelClient(None, config['task_id'], campaign_model=bridge,
                                    max_tool_calls=2, deadline=time.time()+config['timeout_seconds'])
    return asyncio.run(client.run(config['prompt'], sdk_version=config['sdk_version'], checkpoint=config['checkpoint'],
                                  conversation_id=config.get('resume_session_id'),
                                  scratch=config['scratch'], max_model_calls=config['max_model_calls'],
                                  max_input_tokens=config['max_input_tokens'], max_output_tokens=config['max_output_tokens']))


if __name__ == '__main__':
    try:
        print(json.dumps({'result': main()}))
    except Exception:
        print(json.dumps({'error': 'CONTROL_OUTCOME_UNCERTAIN'}))
        sys.exit(1)
