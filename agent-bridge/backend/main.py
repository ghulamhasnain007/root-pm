"""
backend/main.py  —  Agent Bridge FastAPI application
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from core.settings import APP_TITLE, APP_VERSION, CORS_ORIGINS
from routers import config, platforms, channels, status, logs

app = FastAPI(title=APP_TITLE, version=APP_VERSION)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(config.router,    prefix="/api/config",    tags=["Config"])
app.include_router(platforms.router, prefix="/api/platforms", tags=["Platforms"])
app.include_router(channels.router,  prefix="/api/channels",  tags=["Channels"])
app.include_router(status.router,    prefix="/api/status",    tags=["Status"])
app.include_router(logs.router,      prefix="/api/logs",      tags=["Logs"])


@app.get("/api/health")
def health():
    return {"status": "ok", "version": APP_VERSION}
