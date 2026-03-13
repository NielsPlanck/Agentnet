"""Google Sheets API calls via httpx (no SDK)."""

import httpx

SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets"


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def get_spreadsheet(token: str, spreadsheet_id: str) -> dict:
    """Get spreadsheet metadata (title, sheets list, etc.)."""
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{SHEETS_BASE}/{spreadsheet_id}",
            headers=_headers(token),
            params={"fields": "spreadsheetId,properties.title,sheets.properties"},
        )
        resp.raise_for_status()
        data = resp.json()

    sheets = []
    for s in data.get("sheets", []):
        props = s.get("properties", {})
        sheets.append({
            "sheet_id": props.get("sheetId"),
            "title": props.get("title", ""),
            "index": props.get("index", 0),
            "row_count": props.get("gridProperties", {}).get("rowCount", 0),
            "column_count": props.get("gridProperties", {}).get("columnCount", 0),
        })

    return {
        "id": data.get("spreadsheetId", ""),
        "title": data.get("properties", {}).get("title", ""),
        "sheets": sheets,
    }


async def read_range(
    token: str,
    spreadsheet_id: str,
    range_notation: str = "Sheet1",
) -> dict:
    """Read values from a range (e.g. 'Sheet1!A1:Z100')."""
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{SHEETS_BASE}/{spreadsheet_id}/values/{range_notation}",
            headers=_headers(token),
            params={"valueRenderOption": "FORMATTED_VALUE"},
        )
        resp.raise_for_status()
        data = resp.json()

    values = data.get("values", [])
    return {
        "range": data.get("range", ""),
        "rows": values,
        "row_count": len(values),
    }


async def write_range(
    token: str,
    spreadsheet_id: str,
    range_notation: str,
    values: list[list],
) -> dict:
    """Write values to a range."""
    async with httpx.AsyncClient() as client:
        resp = await client.put(
            f"{SHEETS_BASE}/{spreadsheet_id}/values/{range_notation}",
            headers=_headers(token),
            params={"valueInputOption": "USER_ENTERED"},
            json={
                "range": range_notation,
                "majorDimension": "ROWS",
                "values": values,
            },
        )
        resp.raise_for_status()
        data = resp.json()

    return {
        "updated_range": data.get("updatedRange", ""),
        "updated_rows": data.get("updatedRows", 0),
        "updated_columns": data.get("updatedColumns", 0),
        "updated_cells": data.get("updatedCells", 0),
    }


async def append_rows(
    token: str,
    spreadsheet_id: str,
    range_notation: str,
    values: list[list],
) -> dict:
    """Append rows to the end of a sheet."""
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{SHEETS_BASE}/{spreadsheet_id}/values/{range_notation}:append",
            headers=_headers(token),
            params={
                "valueInputOption": "USER_ENTERED",
                "insertDataOption": "INSERT_ROWS",
            },
            json={
                "range": range_notation,
                "majorDimension": "ROWS",
                "values": values,
            },
        )
        resp.raise_for_status()
        data = resp.json()

    updates = data.get("updates", {})
    return {
        "updated_range": updates.get("updatedRange", ""),
        "updated_rows": updates.get("updatedRows", 0),
        "updated_cells": updates.get("updatedCells", 0),
    }


async def create_spreadsheet(
    token: str,
    title: str,
    sheet_titles: list[str] | None = None,
) -> dict:
    """Create a new spreadsheet."""
    body: dict = {
        "properties": {"title": title},
    }
    if sheet_titles:
        body["sheets"] = [
            {"properties": {"title": t}} for t in sheet_titles
        ]

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            SHEETS_BASE,
            headers=_headers(token),
            json=body,
        )
        resp.raise_for_status()
        data = resp.json()

    return {
        "id": data.get("spreadsheetId", ""),
        "title": data.get("properties", {}).get("title", ""),
        "url": f"https://docs.google.com/spreadsheets/d/{data.get('spreadsheetId', '')}",
    }
