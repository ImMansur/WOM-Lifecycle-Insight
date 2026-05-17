import sys
import os

# Add the backend root to sys.path so routers, services, etc. are importable
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from main import app  # noqa: F401 — Vercel looks for `app` in this module
