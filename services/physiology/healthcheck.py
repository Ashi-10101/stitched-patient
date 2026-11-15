"""Simple healthcheck for Docker container."""
import sys
import urllib.request

try:
    response = urllib.request.urlopen('http://localhost:8000/', timeout=5)
    if response.status == 200:
        sys.exit(0)
except Exception:
    pass

sys.exit(1)
