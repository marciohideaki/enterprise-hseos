import subprocess
import sys
import time

subprocess.Popen(["/usr/bin/python3", "-c", "import time; time.sleep(600)", sys.argv[1]], start_new_session=True)
while True:
    time.sleep(0.05)
