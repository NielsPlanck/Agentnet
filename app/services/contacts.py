"""Google People/Contacts API calls via httpx (no SDK)."""

import httpx

PEOPLE_BASE = "https://people.googleapis.com/v1"


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def list_contacts(
    token: str,
    page_size: int = 50,
    page_token: str | None = None,
    query: str | None = None,
) -> dict:
    """List or search the user's contacts.

    If `query` is provided, uses the People API searchContacts endpoint.
    Otherwise lists all contacts via people.connections.list.
    """
    async with httpx.AsyncClient() as client:
        if query:
            # Search contacts
            resp = await client.get(
                f"{PEOPLE_BASE}/people:searchContacts",
                headers=_headers(token),
                params={
                    "query": query,
                    "readMask": "names,emailAddresses,phoneNumbers,organizations,photos",
                    "pageSize": min(page_size, 30),  # search max is 30
                },
            )
        else:
            # List all contacts
            params = {
                "resourceName": "people/me",
                "personFields": "names,emailAddresses,phoneNumbers,organizations,photos",
                "pageSize": page_size,
                "sortOrder": "FIRST_NAME_ASCENDING",
            }
            if page_token:
                params["pageToken"] = page_token
            resp = await client.get(
                f"{PEOPLE_BASE}/people/me/connections",
                headers=_headers(token),
                params=params,
            )

        resp.raise_for_status()
        data = resp.json()

    # Normalize results — search returns "results", list returns "connections"
    raw_people = []
    if query:
        raw_people = [r.get("person", {}) for r in data.get("results", [])]
    else:
        raw_people = data.get("connections", [])

    contacts = []
    for p in raw_people:
        names = p.get("names", [{}])
        name = names[0].get("displayName", "") if names else ""
        emails = [e.get("value", "") for e in p.get("emailAddresses", [])]
        phones = [ph.get("value", "") for ph in p.get("phoneNumbers", [])]
        orgs = p.get("organizations", [])
        company = orgs[0].get("name", "") if orgs else ""
        title = orgs[0].get("title", "") if orgs else ""
        photo = ""
        photos = p.get("photos", [])
        if photos:
            photo = photos[0].get("url", "")

        contacts.append({
            "resource_name": p.get("resourceName", ""),
            "name": name,
            "emails": emails,
            "phones": phones,
            "company": company,
            "title": title,
            "photo": photo,
        })

    return {
        "contacts": contacts,
        "total": data.get("totalPeople", len(contacts)),
        "next_page_token": data.get("nextPageToken"),
    }


async def get_contact(token: str, resource_name: str) -> dict:
    """Get a single contact by resource name (e.g. 'people/c12345')."""
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{PEOPLE_BASE}/{resource_name}",
            headers=_headers(token),
            params={
                "personFields": "names,emailAddresses,phoneNumbers,organizations,photos,biographies,addresses",
            },
        )
        resp.raise_for_status()
        p = resp.json()

    names = p.get("names", [{}])
    name = names[0].get("displayName", "") if names else ""
    emails = [e.get("value", "") for e in p.get("emailAddresses", [])]
    phones = [ph.get("value", "") for ph in p.get("phoneNumbers", [])]
    orgs = p.get("organizations", [])
    company = orgs[0].get("name", "") if orgs else ""
    title = orgs[0].get("title", "") if orgs else ""

    return {
        "resource_name": p.get("resourceName", ""),
        "name": name,
        "emails": emails,
        "phones": phones,
        "company": company,
        "title": title,
    }


async def get_user_profile(token: str) -> dict:
    """Get the authenticated user's own profile info."""
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{PEOPLE_BASE}/people/me",
            headers=_headers(token),
            params={
                "personFields": "names,emailAddresses,phoneNumbers,photos",
            },
        )
        resp.raise_for_status()
        p = resp.json()

    names = p.get("names", [{}])
    name = names[0].get("displayName", "") if names else ""
    emails = [e.get("value", "") for e in p.get("emailAddresses", [])]
    photo = ""
    photos = p.get("photos", [])
    if photos:
        photo = photos[0].get("url", "")

    return {
        "name": name,
        "emails": emails,
        "photo": photo,
    }
