from __future__ import annotations

import argparse
import asyncio

# Thin wrapper to keep `python main.py` working while runtime code moves to
# `server/bot/main.py` for clearer repo layout.
from backend.server.bot.main import main as bot_main


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Agent Bridge Bot (wrapper)")
    parser.add_argument("--config", default="backend/data/config.json",
        help="Path to config.json (default: backend/data/config.json)")
    args = parser.parse_args()
    asyncio.run(bot_main(args.config))
