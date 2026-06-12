import sys
import os

# Add backend directory to sys.path so all backend modules are importable
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "backend")))

from main import app

# Expose the app object for WSGI/ASGI servers (like Uvicorn/Gunicorn on Azure)
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)
