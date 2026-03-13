"""Google Drive API calls via httpx (no SDK)."""

import httpx

DRIVE_BASE = "https://www.googleapis.com/drive/v3"


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def list_files(
    token: str,
    query: str | None = None,
    page_size: int = 20,
    page_token: str | None = None,
    mime_type: str | None = None,
    order_by: str = "modifiedTime desc",
) -> dict:
    """List files in the user's Drive.

    Optional: filter by query (Drive q syntax) or mime_type.
    """
    params: dict = {
        "pageSize": page_size,
        "orderBy": order_by,
        "fields": "nextPageToken,files(id,name,mimeType,size,modifiedTime,webViewLink,iconLink,owners,shared)",
    }

    # Build q filter
    q_parts = []
    if query:
        q_parts.append(f"name contains '{query}'")
    if mime_type:
        q_parts.append(f"mimeType = '{mime_type}'")
    q_parts.append("trashed = false")
    params["q"] = " and ".join(q_parts)

    if page_token:
        params["pageToken"] = page_token

    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{DRIVE_BASE}/files",
            headers=_headers(token),
            params=params,
        )
        resp.raise_for_status()
        data = resp.json()

    files = []
    for f in data.get("files", []):
        files.append({
            "id": f["id"],
            "name": f.get("name", ""),
            "mime_type": f.get("mimeType", ""),
            "size": f.get("size"),
            "modified_time": f.get("modifiedTime", ""),
            "web_link": f.get("webViewLink", ""),
            "icon": f.get("iconLink", ""),
            "shared": f.get("shared", False),
        })

    return {
        "files": files,
        "next_page_token": data.get("nextPageToken"),
    }


async def get_file_metadata(token: str, file_id: str) -> dict:
    """Get metadata for a single file."""
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{DRIVE_BASE}/files/{file_id}",
            headers=_headers(token),
            params={
                "fields": "id,name,mimeType,size,modifiedTime,createdTime,webViewLink,owners,description,shared",
            },
        )
        resp.raise_for_status()
        f = resp.json()

    return {
        "id": f["id"],
        "name": f.get("name", ""),
        "mime_type": f.get("mimeType", ""),
        "size": f.get("size"),
        "modified_time": f.get("modifiedTime", ""),
        "created_time": f.get("createdTime", ""),
        "web_link": f.get("webViewLink", ""),
        "description": f.get("description", ""),
        "shared": f.get("shared", False),
    }


async def search_files(token: str, query: str, page_size: int = 20) -> dict:
    """Full-text search across Drive files."""
    params = {
        "pageSize": page_size,
        "q": f"fullText contains '{query}' and trashed = false",
        "fields": "files(id,name,mimeType,size,modifiedTime,webViewLink,iconLink)",
        "orderBy": "modifiedTime desc",
    }

    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{DRIVE_BASE}/files",
            headers=_headers(token),
            params=params,
        )
        resp.raise_for_status()
        data = resp.json()

    files = []
    for f in data.get("files", []):
        files.append({
            "id": f["id"],
            "name": f.get("name", ""),
            "mime_type": f.get("mimeType", ""),
            "size": f.get("size"),
            "modified_time": f.get("modifiedTime", ""),
            "web_link": f.get("webViewLink", ""),
        })

    return {"files": files}
