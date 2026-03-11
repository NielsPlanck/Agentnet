import numpy as np
from openai import AsyncOpenAI

from app.config import settings

_client: AsyncOpenAI | None = None


def _get_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        _client = AsyncOpenAI(api_key=settings.openai_api_key)
    return _client


async def get_embedding(text: str) -> list[float]:
    """Generate an embedding for the given text.

    Falls back to a deterministic mock if no OpenAI key is configured.
    """
    if not settings.openai_api_key:
        return _mock_embedding(text)

    client = _get_client()
    response = await client.embeddings.create(
        input=text,
        model=settings.embedding_model,
    )
    return response.data[0].embedding


def _mock_embedding(text: str) -> list[float]:
    """Deterministic mock embedding for local dev without an API key."""
    rng = np.random.RandomState(hash(text) % 2**31)
    vec = rng.randn(settings.embedding_dim).astype(float)
    vec = vec / np.linalg.norm(vec)
    return vec.tolist()
