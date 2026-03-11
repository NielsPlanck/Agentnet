"""
Gemini Live real-time audio WebSocket bridge.
Frontend sends raw PCM 16kHz 16-bit mono chunks.
Gemini responds with PCM 24kHz 16-bit mono audio.
"""
import asyncio
import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from google import genai
from google.genai import types

from app.config import settings

logger = logging.getLogger(__name__)
router = APIRouter()

LIVE_MODEL = "gemini-2.5-flash-native-audio-preview-12-2025"

LIVE_SYSTEM = (
    "You are Iris, a helpful AI assistant. "
    "You are in a real-time voice conversation. "
    "Keep responses concise and conversational. "
    "Do not use markdown formatting — speak naturally."
)


@router.websocket("/live")
async def live_audio(websocket: WebSocket):
    await websocket.accept()

    client = genai.Client(
        api_key=settings.gemini_api_key,
        http_options={"api_version": "v1alpha"},
    )

    config = types.LiveConnectConfig(
        response_modalities=["AUDIO"],
        system_instruction=LIVE_SYSTEM,
        input_audio_transcription=types.AudioTranscriptionConfig(),
        output_audio_transcription=types.AudioTranscriptionConfig(),
    )

    try:
        async with client.aio.live.connect(model=LIVE_MODEL, config=config) as session:

            async def receive_from_client():
                """Forward mic audio from browser → Gemini."""
                try:
                    while True:
                        msg = await websocket.receive()
                        if "bytes" in msg and msg["bytes"]:
                            await session.send_realtime_input(
                                audio=types.Blob(
                                    data=msg["bytes"],
                                    mime_type="audio/pcm;rate=16000",
                                )
                            )
                        elif "text" in msg and msg["text"]:
                            data = json.loads(msg["text"])
                            if data.get("type") == "end_of_turn":
                                await session.send_realtime_input(audio_stream_end=True)
                            elif data.get("type") == "text":
                                await session.send_client_content(
                                    turns=[{"role": "user", "parts": [{"text": data["content"]}]}],
                                    turn_complete=True,
                                )
                except (WebSocketDisconnect, Exception):
                    pass

            async def send_to_client():
                """Forward Gemini audio responses → browser."""
                try:
                    async for response in session.receive():
                        sc = response.server_content
                        if sc is None:
                            continue
                        if sc.model_turn:
                            for part in sc.model_turn.parts:
                                if part.inline_data and part.inline_data.data:
                                    await websocket.send_bytes(part.inline_data.data)
                                elif part.text:
                                    await websocket.send_text(
                                        json.dumps({"type": "transcript", "role": "assistant", "text": part.text})
                                    )
                        if sc.input_transcription and sc.input_transcription.text:
                            await websocket.send_text(
                                json.dumps({"type": "transcript", "role": "user", "text": sc.input_transcription.text})
                            )
                        if sc.output_transcription and sc.output_transcription.text:
                            await websocket.send_text(
                                json.dumps({"type": "transcript", "role": "assistant", "text": sc.output_transcription.text})
                            )
                        if sc.turn_complete:
                            await websocket.send_text(json.dumps({"type": "turn_complete"}))
                except (WebSocketDisconnect, Exception) as e:
                    logger.debug("Live send_to_client ended: %s", e)

            await asyncio.gather(receive_from_client(), send_to_client())

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error("Live session error: %s", e)
        try:
            await websocket.send_text(json.dumps({"type": "error", "content": str(e)}))
        except Exception:
            pass
