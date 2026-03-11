from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "sqlite+aiosqlite:///./agentnet.db"
    openai_api_key: str = ""
    embedding_model: str = "text-embedding-3-small"
    embedding_dim: int = 1536
    openai_chat_model: str = "gpt-5-mini"  # fallback, not used for chat
    gemini_chat_model: str = "gemini-3.1-flash-lite-preview"
    gemini_api_key: str = ""
    openai_fast_model: str = "gpt-4.1-nano"  # for quick utility calls (rewrite, discovery)
    tavily_api_key: str = ""

    # Google OAuth
    google_client_id: str = ""
    google_client_secret: str = ""
    google_redirect_uri: str = "http://localhost:8000/v1/oauth/google/callback"

    # Security
    oauth_encryption_key: str = ""
    session_secret: str = "change-me-in-production"
    admin_email: str = "admin@agentnet.com"  # change in .env
    admin_password: str = "agentnet-admin-2024"  # change in .env

    # Frontend URL
    frontend_url: str = "http://localhost:3003"

    model_config = {"env_prefix": "AGENTNET_", "env_file": ".env"}


settings = Settings()
