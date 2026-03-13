"""Speech-to-Text WebSocket proxy — OpenAI GPT-4o Realtime Transcription API.

Browser sends PCM16 audio at 24 kHz → this proxy base64-encodes and forwards
to OpenAI's Realtime transcription endpoint → returns transcript deltas and
completed sentences back to the browser.

Protocol (browser ↔ this endpoint):
  Browser sends:  binary PCM16 24kHz mono audio chunks
                  or JSON  {"type": "stop"}
  Server sends:   {"type": "ready"}
                  {"type": "delta",      "text": "partial..."}
                  {"type": "transcript",  "text": "Full sentence."}
                  {"type": "error",       "message": "..."}
"""

import asyncio
import base64
import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.config import settings

logger = logging.getLogger(__name__)

router = APIRouter()

OPENAI_REALTIME_URL = "wss://api.openai.com/v1/realtime?intent=transcription"

SESSION_CONFIG = {
    "type": "transcription_session.update",
    "session": {
        "input_audio_format": "pcm16",
        "input_audio_transcription": {
            "model": "gpt-4o-transcribe",
            "language": "en",
        },
        "turn_detection": {
            "type": "server_vad",
            "threshold": 0.3,
            "prefix_padding_ms": 300,
            "silence_duration_ms": 800,
        },
    },
}


@router.websocket("/stt")
async def stt_ws(websocket: WebSocket):
    """WebSocket: browser mic PCM16 → OpenAI Realtime Transcription → text."""
    await websocket.accept()

    if not settings.openai_api_key:
        await websocket.send_json(
            {"type": "error", "message": "OpenAI API key not configured"}
        )
        await websocket.close()
        return

    try:
        import websockets  # noqa: F811
    except ImportError:
        await websocket.send_json(
            {"type": "error", "message": "websockets package not installed"}
        )
        await websocket.close()
        return

    openai_ws = None
    try:
        headers = {
            "Authorization": f"Bearer {settings.openai_api_key}",
            "OpenAI-Beta": "realtime=v1",
        }
        openai_ws = await websockets.connect(
            OPENAI_REALTIME_URL,
            additional_headers=headers,
            max_size=None,
        )

        # Send session configuration
        await openai_ws.send(json.dumps(SESSION_CONFIG))

        # Wait for session init events (created + updated)
        for _ in range(5):
            init_msg = await asyncio.wait_for(openai_ws.recv(), timeout=10)
            init_event = json.loads(init_msg)
            etype = init_event.get("type", "")
            logger.info("STT init event: %s", etype)
            if etype == "transcription_session.updated":
                break
            if etype == "error":
                err = init_event.get("error", {})
                logger.error("STT init error: %s", err)
                await websocket.send_json(
                    {"type": "error", "message": err.get("message", "Init error")}
                )
                await websocket.close()
                return

        # Tell browser we're ready
        await websocket.send_json({"type": "ready"})
        logger.info("STT session ready — streaming audio")

        audio_chunks_sent = 0

        async def browser_to_openai():
            """Forward PCM16 audio from browser → OpenAI as base64."""
            nonlocal audio_chunks_sent
            try:
                while True:
                    data = await websocket.receive()
                    if "bytes" in data:
                        audio_b64 = base64.b64encode(data["bytes"]).decode("ascii")
                        await openai_ws.send(
                            json.dumps(
                                {
                                    "type": "input_audio_buffer.append",
                                    "audio": audio_b64,
                                }
                            )
                        )
                        audio_chunks_sent += 1
                        if audio_chunks_sent % 50 == 0:
                            logger.debug(
                                "STT: forwarded %d audio chunks", audio_chunks_sent
                            )
                    elif "text" in data:
                        try:
                            msg = json.loads(data["text"])
                            if msg.get("type") == "stop":
                                logger.info("STT: browser sent stop")
                                break
                        except json.JSONDecodeError:
                            pass
            except WebSocketDisconnect:
                logger.info("STT: browser disconnected")
            except Exception as e:
                logger.error("STT browser_to_openai error: %s", e)

        async def openai_to_browser():
            """Forward transcription events from OpenAI → browser."""
            try:
                async for message in openai_ws:
                    event = json.loads(message)
                    etype = event.get("type", "")

                    # Log all events for debugging
                    if etype not in (
                        "input_audio_buffer.speech_started",
                        "input_audio_buffer.speech_stopped",
                    ):
                        logger.info("STT OpenAI event: %s", etype)

                    if etype == "conversation.item.input_audio_transcription.delta":
                        delta = event.get("delta", "")
                        if delta:
                            logger.info("STT delta: %s", delta[:80])
                            await websocket.send_json(
                                {"type": "delta", "text": delta}
                            )

                    elif (
                        etype
                        == "conversation.item.input_audio_transcription.completed"
                    ):
                        transcript = event.get("transcript", "")
                        logger.info("STT transcript: %s", transcript[:200])
                        if transcript:
                            await websocket.send_json(
                                {"type": "transcript", "text": transcript}
                            )

                    elif etype == "error":
                        err = event.get("error", {})
                        logger.error("STT OpenAI error: %s", err)
                        await websocket.send_json(
                            {
                                "type": "error",
                                "message": err.get(
                                    "message", "Transcription error"
                                ),
                            }
                        )
            except Exception as e:
                logger.error("STT openai_to_browser error: %s", e)

        # Run both directions concurrently
        done, pending = await asyncio.wait(
            [
                asyncio.create_task(browser_to_openai()),
                asyncio.create_task(openai_to_browser()),
            ],
            return_when=asyncio.FIRST_COMPLETED,
        )
        for t in pending:
            t.cancel()
        logger.info("STT session ended (sent %d chunks)", audio_chunks_sent)

    except Exception as e:
        logger.error("STT error: %s", e)
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass
    finally:
        if openai_ws:
            try:
                await openai_ws.close()
            except Exception:
                pass
        try:
            await websocket.close()
        except Exception:
            pass
