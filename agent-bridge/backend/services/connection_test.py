"""
backend/services/connection_test.py  —  Live credential validation
"""
from __future__ import annotations
import requests
from models.schemas import TestConnectionResponse


def test_discord(config: dict) -> TestConnectionResponse:
    token = config.get("bot_token", "")
    if not token:
        return TestConnectionResponse(success=False, message="Bot token is missing.")
    try:
        resp = requests.get(
            "https://discord.com/api/v10/users/@me",
            headers={"Authorization": f"Bot {token}"},
            timeout=8,
        )
        if resp.status_code == 200:
            data = resp.json()
            return TestConnectionResponse(
                success=True,
                message=f"Connected as {data.get('username')}#{data.get('discriminator', '0')}",
                detail=f"Bot ID: {data.get('id')}",
            )
        elif resp.status_code == 401:
            return TestConnectionResponse(success=False, message="Invalid bot token.")
        else:
            return TestConnectionResponse(
                success=False,
                message=f"Discord API error: {resp.status_code}",
            )
    except requests.exceptions.Timeout:
        return TestConnectionResponse(success=False, message="Connection timed out.")
    except Exception as e:
        return TestConnectionResponse(success=False, message=str(e))


def test_taiga(config: dict) -> TestConnectionResponse:
    url  = config.get("url", "").rstrip("/")
    user = config.get("username", "")
    pwd  = config.get("password", "")
    if not all([url, user, pwd]):
        return TestConnectionResponse(success=False, message="URL, username and password are all required.")
    try:
        resp = requests.post(
            f"{url}/auth",
            json={"type": "normal", "username": user, "password": pwd},
            timeout=8,
        )
        if resp.status_code == 200:
            data = resp.json()
            return TestConnectionResponse(
                success=True,
                message=f"Authenticated as {data.get('full_name', user)}",
                detail=f"Token acquired. User ID: {data.get('id')}",
            )
        elif resp.status_code == 400:
            return TestConnectionResponse(success=False, message="Invalid credentials.")
        else:
            return TestConnectionResponse(
                success=False,
                message=f"Taiga API error: {resp.status_code}",
            )
    except requests.exceptions.ConnectionError:
        return TestConnectionResponse(success=False, message="Cannot reach Taiga. Check the URL.")
    except requests.exceptions.Timeout:
        return TestConnectionResponse(success=False, message="Connection timed out.")
    except Exception as e:
        return TestConnectionResponse(success=False, message=str(e))


def test_gemini(config: dict) -> TestConnectionResponse:
    api_key = config.get("gemini_api_key", "")
    if not api_key:
        return TestConnectionResponse(success=False, message="API key is missing.")
    try:
        resp = requests.get(
            "https://generativelanguage.googleapis.com/v1beta/models",
            params={"key": api_key},
            timeout=8,
        )
        if resp.status_code == 200:
            models = resp.json().get("models", [])
            return TestConnectionResponse(
                success=True,
                message=f"Gemini API reachable — {len(models)} models available.",
            )
        elif resp.status_code == 400:
            return TestConnectionResponse(success=False, message="Invalid API key.")
        else:
            return TestConnectionResponse(
                success=False,
                message=f"Gemini API error: {resp.status_code}",
            )
    except Exception as e:
        return TestConnectionResponse(success=False, message=str(e))


TESTERS = {
    "discord": test_discord,
    "taiga":   test_taiga,
    "gemini":  test_gemini,
}


def run_test(platform: str, config: dict) -> TestConnectionResponse:
    tester = TESTERS.get(platform)
    if not tester:
        return TestConnectionResponse(
            success=False,
            message=f"No connection test available for '{platform}'."
        )
    return tester(config)
