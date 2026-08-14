"""
backend/routers/channels.py
"""
import uuid
from fastapi import APIRouter, HTTPException
from models.schemas import ChannelMapping
from core.store import get_config, save_config, append_log

router = APIRouter()


@router.get("", response_model=list[ChannelMapping])
def list_mappings():
    return get_config().channel_mappings


@router.post("", response_model=ChannelMapping, status_code=201)
def create_mapping(mapping: ChannelMapping):
    cfg = get_config()
    mapping.id = str(uuid.uuid4())
    cfg.channel_mappings.append(mapping)
    save_config(cfg)
    append_log("INFO", "channels", f"Added mapping: {mapping.channel_id} → {mapping.project_slug}")
    return mapping


@router.put("/{mapping_id}", response_model=ChannelMapping)
def update_mapping(mapping_id: str, mapping: ChannelMapping):
    cfg = get_config()
    for i, m in enumerate(cfg.channel_mappings):
        if m.id == mapping_id:
            mapping.id = mapping_id
            cfg.channel_mappings[i] = mapping
            save_config(cfg)
            return mapping
    raise HTTPException(status_code=404, detail="Mapping not found")


@router.delete("/{mapping_id}", status_code=204)
def delete_mapping(mapping_id: str):
    cfg = get_config()
    before = len(cfg.channel_mappings)
    cfg.channel_mappings = [m for m in cfg.channel_mappings if m.id != mapping_id]
    if len(cfg.channel_mappings) == before:
        raise HTTPException(status_code=404, detail="Mapping not found")
    save_config(cfg)
    append_log("INFO", "channels", f"Deleted mapping {mapping_id}")
