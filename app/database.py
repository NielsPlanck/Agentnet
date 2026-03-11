from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.config import settings

# SQLite doesn't benefit from connection pooling — use NullPool to avoid
# pool exhaustion during concurrent crawls.
engine = create_async_engine(
    settings.database_url,
    echo=False,
    poolclass=NullPool,
)


@event.listens_for(engine.sync_engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    """Enable WAL mode for better concurrent write access."""
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA busy_timeout=30000")  # wait up to 30s on lock
    cursor.close()


async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
