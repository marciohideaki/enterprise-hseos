"""Trusted, bounded PTY/pipe bridge. Never imports workspace code."""
import base64
import errno
import fcntl
import json
import os
import pty
import selectors
import signal
import struct
import subprocess
import sys
import termios
import time


def emit(value):
    print(json.dumps(value, separators=(',', ':')), flush=True)


def run():
    config = json.loads(sys.argv[1])
    group = config['group']
    selector = selectors.DefaultSelector()
    child = None
    master = None
    slave = None
    input_fd = None
    status = 'failed'
    output_bytes = 0
    pending = b''
    deadline = time.monotonic() + config['timeout_ms'] / 1000

    def kill():
        with open(group + '/cgroup.kill', 'w') as target:
            target.write('1')
        # An unreaped child pins its PID. Never signal a numeric group after reap.
        if child and child.returncode is None:
            try:
                os.killpg(child.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass

    def resize(rows, cols):
        fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))

    # Parent identity is checked after installing PDEATHSIG, before any user code.
    launcher = """
import ctypes, os, signal, sys
parent = int(sys.argv[1])
if ctypes.CDLL(None).prctl(1, signal.SIGKILL) != 0:
    raise RuntimeError('pdeathsig unavailable')
if os.getppid() != parent:
    os._exit(125)
with open(sys.argv[2] + '/cgroup.procs', 'w') as target:
    target.write(str(os.getpid()))
os.execve(sys.argv[3], sys.argv[3:], {})
"""
    try:
        if config['mode'] == 'pty':
            master, slave = pty.openpty()
            resize(config['rows'], config['cols'])
        args = ['/usr/bin/python3', '-I', '-c', launcher, str(os.getpid()), group,
                '/usr/bin/prlimit', '--core=0:0', '--nofile=64:64', '--fsize=1048576:1048576',
                '--cpu=' + str(max(1, (config['timeout_ms'] + 999) // 1000)), '--',
                config['binary']] + config['args']
        child = subprocess.Popen(args, env={}, start_new_session=True,
                                 stdin=slave if slave is not None else subprocess.PIPE,
                                 stdout=slave if slave is not None else subprocess.PIPE,
                                 stderr=slave if slave is not None else subprocess.PIPE,
                                 pass_fds=tuple(config['fds']))
        if slave is not None:
            os.close(slave)
            slave = None
            input_fd = master
            selector.register(master, selectors.EVENT_READ, 'pty')
        else:
            input_fd = child.stdin.fileno()
            selector.register(child.stdout, selectors.EVENT_READ, 'stdout')
            selector.register(child.stderr, selectors.EVENT_READ, 'stderr')
        os.set_blocking(input_fd, False)
        selector.register(sys.stdin, selectors.EVENT_READ, 'control')
        emit({'kind': 'ready', 'pid': child.pid})
        status = 'running'
        while True:
            if time.monotonic() >= deadline:
                status = 'timed_out'
                break
            for key, _ in selector.select(min(0.05, max(0, deadline - time.monotonic()))):
                if key.data == 'control':
                    chunk = os.read(sys.stdin.fileno(), 65536)
                    if not chunk:
                        status = 'controller_lost'
                        return
                    pending += chunk
                    if len(pending) > 131072:
                        raise ValueError('control limit')
                    while b'\n' in pending:
                        line, pending = pending.split(b'\n', 1)
                        command = json.loads(line)
                        action = command['action']
                        if action == 'input':
                            data = base64.b64decode(command['data'], validate=True)
                            if len(data) > 4096:
                                raise ValueError('input limit')
                            # Partial writes are explicitly reported; never retried by recovery.
                            count = os.write(input_fd, data)
                            emit({'kind': 'ack', 'id': command['id'], 'bytes': count})
                            continue
                        if action == 'resize':
                            resize(command['rows'], command['cols'])
                        elif action in ('pause', 'continue'):
                            with open(group + '/cgroup.freeze', 'w') as target:
                                target.write('1' if action == 'pause' else '0')
                        elif action == 'interrupt':
                            with open(group + '/cgroup.procs') as source:
                                pids = source.read().split()
                            for pid in pids:
                                descriptor = None
                                try:
                                    descriptor = os.pidfd_open(int(pid))
                                    with open('/proc/' + pid + '/cgroup') as identity:
                                        member = identity.read().strip() == '0::' + group.removeprefix('/sys/fs/cgroup')
                                    if member:
                                        signal.pidfd_send_signal(descriptor, signal.SIGINT)
                                except (ProcessLookupError, FileNotFoundError):
                                    pass
                                finally:
                                    if descriptor is not None:
                                        os.close(descriptor)
                        elif action == 'eof':
                            if master is not None:
                                os.write(master, b'\x04')
                            elif not child.stdin.closed:
                                child.stdin.close()
                        elif action == 'terminate':
                            status = 'terminated'
                            kill()
                        else:
                            raise ValueError('unknown action')
                        emit({'kind': 'ack', 'id': command['id']})
                else:
                    try:
                        chunk = os.read(key.fd, 4096)
                    except OSError as error:
                        if error.errno != errno.EIO:
                            raise
                        chunk = b''
                    if not chunk:
                        selector.unregister(key.fileobj)
                        continue
                    remaining = config['max_output_bytes'] - output_bytes
                    output_bytes += len(chunk)
                    if remaining > 0:
                        emit({'kind': 'output', 'stream': key.data,
                              'data': base64.b64encode(chunk[:remaining]).decode('ascii')})
                    if output_bytes > config['max_output_bytes']:
                        status = 'output_limit'
                        kill()
            if child.poll() is not None:
                # Drain bytes already buffered; descendants cannot hold pipes indefinitely.
                kill()
                if not any(k.data != 'control' for k in selector.get_map().values()):
                    if status == 'running':
                        status = 'succeeded' if child.returncode == 0 else 'failed'
                    break
    finally:
        kill()
        if child:
            child.wait(timeout=5)
        drain_deadline = time.monotonic() + 5
        while True:
            with open(group + '/cgroup.events') as source:
                populated = 'populated 1' in source.read()
            if not populated:
                break
            if time.monotonic() >= drain_deadline:
                raise RuntimeError('teardown uncertain')
            time.sleep(0.01)
        if master is not None:
            os.close(master)
        if slave is not None:
            os.close(slave)
        selector.close()
        emit({'kind': 'exit', 'status': status, 'exit_code': child.returncode if child else None,
              'descendants_terminated': True})


if __name__ == '__main__':
    try:
        run()
    except (BrokenPipeError, OSError, ValueError, RuntimeError):
        sys.exit(1)
