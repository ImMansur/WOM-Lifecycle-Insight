import sys
import os

# Add backend directory to sys.path so all backend modules are importable
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend")))

from main import app  # noqa: F401
from mangum import Mangum

# Vercel invokes Python functions via AWS Lambda-style interface; mangum bridges ASGI → Lambda
handler = Mangum(app, lifespan="off")
