"""FastAPI application entry point."""
from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
)

from routers import ingest, recommendations, actions, export  # noqa: E402


@asynccontextmanager
async def lifespan(app: FastAPI):
    logging.getLogger(__name__).info("WOM Lifecycle Insight backend starting…")
    yield
    logging.getLogger(__name__).info("WOM Lifecycle Insight backend shut down.")


app = FastAPI(
    title="WOM Lifecycle Insight API",
    version="1.0.0",
    description=(
        "Processes Certificates of Conformance via Azure Document Intelligence "
        "and Azure OpenAI to generate lifecycle recommendations."
    ),
    lifespan=lifespan,
)

# CORS — allow all origins (internal / dev tool, no user credentials needed)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(recommendations.router)
app.include_router(ingest.router)
app.include_router(actions.router)
app.include_router(export.router)


@app.get("/")
async def root():
    return {
        "service": "WOM Lifecycle Insight API",
        "version": "1.0.0",
        "docs": "/docs",
    }
