"""Vision service for job application agent — analyzes browser screenshots with Gemini.

Sends screenshots to Gemini vision model, receives structured action decisions.
"""

import base64
import json
import logging
from typing import Any

from google import genai
from google.genai import types
from pydantic import BaseModel

from app.config import settings

logger = logging.getLogger(__name__)

_vision_client: genai.Client | None = None


def _get_vision_client() -> genai.Client:
    global _vision_client
    if _vision_client is None:
        _vision_client = genai.Client(api_key=settings.gemini_api_key)
    return _vision_client


class AgentAction(BaseModel):
    """Structured action decision from the vision model."""
    thought: str
    action: str  # click | fill | scroll | goto | upload_cv | press | wait | done | ask_user | found_job | click_xy
    params: dict[str, Any] = {}


# ── Vision System Prompt ──────────────────────────────────────────────

JOB_AGENT_VISION_PROMPT = """You are a fully autonomous job application agent controlling a web browser.
You see a screenshot of the current page. Decide the SINGLE next action to take.

GOAL: Search for job listings matching the user's criteria, then fill out and submit application forms.

YOU ARE FULLY AUTONOMOUS — apply and submit without asking the user for confirmation.

RULES:
1. Return ONLY valid JSON: {"thought": "brief reasoning", "action": "action_name", "params": {...}}
2. Be precise with selectors — use CSS selectors, aria-labels, placeholder text, or visible button text.
3. If you see a cookie/consent banner, dismiss it first.
4. If you see a CAPTCHA or login wall you cannot bypass, use ask_user.
5. If a form field asks a question not covered by the user profile, use your best judgment or use ask_user.
6. After submitting an application, use done with status "submitted".
7. When you find a job listing, use found_job to log it, then proceed to apply.

AVAILABLE ACTIONS:
- click: {"selector": "CSS selector or button text"} — click an element
- click_xy: {"x": 640, "y": 300} — click at exact pixel coordinates (use when selector fails)
- fill: {"selector": "CSS selector, placeholder, or label", "value": "text to enter"} — fill an input
- scroll: {"direction": "down"|"up", "amount": 3} — scroll the page
- goto: {"url": "https://..."} — navigate to a URL
- upload_cv: {"selector": "file input selector"} — upload the user's CV/resume
- press: {"key": "Enter"|"Tab"|"Escape"} — press a keyboard key
- wait: {"seconds": 2} — wait for page to load
- done: {"status": "submitted"|"error"|"complete", "message": "description"} — finished
- ask_user: {"question": "...", "reason": "..."} — pause and ask the user (ONLY for login walls, CAPTCHAs, or missing critical info)
- found_job: {"title": "...", "company": "...", "url": "...", "description": "short desc"} — log a found job listing

BOARD-SPECIFIC HINTS:
- LinkedIn: Job search at linkedin.com/jobs, "Easy Apply" button for quick applications, may require login for applying
- Indeed: Job search at indeed.com, filter by location/type, "Apply now" buttons, often redirects to company sites
- Welcome to the Jungle: Job search at welcometothejungle.com, tech-focused, "Apply" button, good for European jobs
- Glassdoor: Job search at glassdoor.com, search bar at top, "Apply" button, may show company reviews first
- YC Jobs (ycombinator.com/jobs): Y Combinator startup job board. Jobs are listed as cards with company name, role title, location, and tags. Click a job card to see details. "Apply" button links to the company's application page. Filter by role type and location using the sidebar/filter options. Great for startup jobs at YC-backed companies.

FORM FILLING TIPS:
- For name fields: use the user's full name from profile
- For email: use the user's email
- For phone: use the user's phone number
- For location/city: use the user's location
- For LinkedIn URL: use from profile if available
- For "Why do you want to work here?": craft a brief answer based on the job description
- For salary expectations: use the user's salary range
- For cover letter: write a brief professional paragraph based on the CV and job description
- For file uploads (CV/resume): use upload_cv action
- For dropdown selectors: click the dropdown first, then click the option

IMPORTANT: Always return valid JSON. No markdown, no code blocks, just raw JSON."""


async def analyze_screenshot(
    screenshot_b64: str,
    task_context: str,
    page_url: str,
    action_history: list[str],
) -> AgentAction:
    """Send screenshot + context to Gemini vision, get structured action back."""
    client = _get_vision_client()

    history_text = "\n".join(action_history[-15:]) if action_history else "No actions yet"

    user_prompt = f"""Current URL: {page_url}

Task context:
{task_context}

Previous actions (latest):
{history_text}

Analyze this screenshot and decide what to do next. Return ONLY JSON."""

    contents = [
        types.Content(
            role="user",
            parts=[
                types.Part.from_text(text=user_prompt),
                types.Part.from_bytes(
                    data=base64.b64decode(screenshot_b64),
                    mime_type="image/jpeg",
                ),
            ],
        )
    ]

    try:
        response = await client.aio.models.generate_content(
            model=settings.gemini_vision_model,
            contents=contents,
            config=types.GenerateContentConfig(
                system_instruction=JOB_AGENT_VISION_PROMPT,
                max_output_tokens=1024,
                temperature=0.2,  # low temperature for more predictable actions
                response_mime_type="application/json",
            ),
        )

        raw = response.text.strip()
        logger.info("Vision response: %s", raw[:200])

        # Parse JSON response
        data = json.loads(raw)
        return AgentAction(**data)

    except json.JSONDecodeError as e:
        logger.error("Vision JSON parse error: %s — raw: %s", e, raw[:500] if 'raw' in dir() else "N/A")
        # Fallback: try to extract JSON from response
        return AgentAction(thought="Failed to parse vision response, scrolling to see more", action="scroll", params={"direction": "down", "amount": 2})

    except Exception as e:
        logger.error("Vision analysis error: %s", e)
        return AgentAction(thought=f"Vision error: {e}", action="wait", params={"seconds": 2})
