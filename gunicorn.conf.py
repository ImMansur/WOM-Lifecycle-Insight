# Gunicorn configuration file for Azure App Service
import multiprocessing

# Timeout for worker processes (in seconds)
# Set to 600 seconds (10 minutes) to allow long-running OCR and OpenAI tasks to complete
timeout = 600

# Keep-alive connection timeout
keepalive = 120

# Number of workers
# We limit to 2 workers to avoid running out of memory (OOM) on low-spec Azure plans
workers = 2

# Worker class
worker_class = "uvicorn.workers.UvicornWorker"

# Bind address
bind = "0.0.0.0:8000"
