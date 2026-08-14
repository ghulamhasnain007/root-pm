"""
backend/routers/platforms.py
"""
from fastapi import APIRouter
from models.schemas import PlatformInfo
from services.catalogue import get_comm_platforms, get_pm_platforms

router = APIRouter()


@router.get("/comm", response_model=list[PlatformInfo])
def list_comm_platforms():
    return get_comm_platforms()


@router.get("/pm", response_model=list[PlatformInfo])
def list_pm_platforms():
    return get_pm_platforms()
