"""Job application agent — orchestrates browser automation + vision in an agentic loop.

Yields SSE-formatted events as it navigates job boards, finds listings, and applies.
"""

import asyncio
import base64
import json
import logging
from collections.abc import AsyncGenerator
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.job_profile import JobApplication, JobProfile
from app.services.browser import BrowserSession
from app.services.job_vision import AgentAction, analyze_screenshot

logger = logging.getLogger(__name__)

# Maximum actions per agent run
MAX_STEPS = 50

# Timeout for the entire agent run (seconds)
AGENT_TIMEOUT = 300  # 5 minutes

# ── Board URL builders ──────────────────────────────────────────────

BOARD_SEARCH_URLS = {
    "linkedin": "https://www.linkedin.com/jobs/search/?keywords={query}&location={location}",
    "indeed": "https://www.indeed.com/jobs?q={query}&l={location}",
    "wttj": "https://www.welcometothejungle.com/en/jobs?query={query}&page=1&refinementList%5Boffices.country_code%5D%5B%5D=FR",
    "glassdoor": "https://www.glassdoor.com/Job/jobs.htm?sc.keyword={query}&locT=C&locKeyword={location}",
    "ycombinator": "https://www.ycombinator.com/jobs?query={query}&role={query}",
}


def _get_board_url(board: str, query: str, location: str, custom_url: str = "") -> str:
    """Build a search URL for the given job board.

    If custom_url is provided, use it directly (allows users to specify any job board URL).
    """
    if custom_url:
        return custom_url
    template = BOARD_SEARCH_URLS.get(board, BOARD_SEARCH_URLS["linkedin"])
    return template.format(
        query=query.replace(" ", "+"),
        location=location.replace(" ", "+"),
    )


def _build_task_context(profile: JobProfile, criteria: dict, jobs_found: list[dict]) -> str:
    """Build the task context string for the vision model."""
    roles = json.loads(profile.target_roles) if profile.target_roles else []
    locations = json.loads(profile.target_locations) if profile.target_locations else []

    lines = [
        f"USER PROFILE:",
        f"  Name: {profile.full_name}",
        f"  Email: {profile.email}",
        f"  Phone: {profile.phone}",
        f"  Location: {profile.location}",
        f"  LinkedIn: {profile.linkedin_url}",
        f"  Portfolio: {profile.portfolio_url}",
        f"  Target roles: {', '.join(roles)}",
        f"  Target locations: {', '.join(locations)}",
        f"  Salary range: {profile.salary_range}",
        f"  Job type: {profile.job_type}",
        "",
        f"CV SUMMARY (first 500 chars):",
        f"  {profile.cv_text[:500]}",
        "",
        f"SEARCH CRITERIA:",
        f"  Board: {criteria.get('board', 'linkedin')}",
        f"  Query: {criteria.get('search_query', '')}",
        f"  Location: {criteria.get('location', '')}",
        f"  Max results: {criteria.get('max_results', 5)}",
        "",
    ]

    if profile.additional_info:
        lines.append(f"ADDITIONAL INFO: {profile.additional_info[:300]}")
        lines.append("")

    if jobs_found:
        lines.append(f"JOBS FOUND SO FAR ({len(jobs_found)}):")
        for j in jobs_found:
            lines.append(f"  - {j.get('title', '?')} at {j.get('company', '?')}")
        lines.append("")

    return "\n".join(lines)


def _sse(event_type: str, data: dict) -> str:
    """Format a Server-Sent Event."""
    return f"data: {json.dumps({'type': event_type, **data})}\n\n"


async def run_job_agent(
    user_id: str,
    profile: JobProfile,
    criteria: dict,
    db: AsyncSession,
) -> AsyncGenerator[str, None]:
    """Run the job application agent. Yields SSE-formatted events.

    Events:
      - agent_status: {"phase": "...", "message": "...", "step": N}
      - browser_screenshot: {"image": "base64...", "url": "...", "action": "..."}
      - agent_found_job: {"title": "...", "company": "...", "url": "...", "description": "..."}
      - agent_ask: {"question": "...", "reason": "..."}
      - agent_error: {"message": "..."}
    """
    browser = BrowserSession()

    try:
        yield _sse("agent_status", {"phase": "starting", "message": "Launching browser..."})
        await browser.start()

        # Build search URL
        board = criteria.get("board", "linkedin")
        query = criteria.get("search_query", "")
        location = criteria.get("location", "")
        max_results = criteria.get("max_results", 5)
        custom_url = criteria.get("url", "")

        search_url = _get_board_url(board, query, location, custom_url)

        yield _sse("agent_status", {
            "phase": "navigating",
            "message": f"Opening {board.title()} job search...",
        })

        await browser.goto(search_url)
        await browser.wait(3)  # let page fully load

        # Take initial screenshot
        screenshot = await browser.screenshot()
        url = await browser.get_url()
        yield _sse("browser_screenshot", {
            "image": screenshot,
            "url": url,
            "action": f"Opened {board.title()} job search",
        })

        # ── Agentic loop ──────────────────────────────────────────────
        action_history: list[str] = []
        jobs_found: list[dict] = []

        for step in range(1, MAX_STEPS + 1):
            # Take screenshot for vision analysis
            screenshot = await browser.screenshot()
            url = await browser.get_url()

            # Ask vision model what to do
            task_context = _build_task_context(profile, criteria, jobs_found)
            action: AgentAction = await analyze_screenshot(
                screenshot_b64=screenshot,
                task_context=task_context,
                page_url=url,
                action_history=action_history,
            )

            action_desc = f"Step {step}: [{action.action}] {action.thought}"
            action_history.append(action_desc)
            logger.info("Job agent %s", action_desc)

            yield _sse("agent_status", {
                "phase": "acting",
                "message": action.thought,
                "step": step,
                "action": action.action,
            })

            # ── Execute the action ──────────────────────────────────
            try:
                if action.action == "done":
                    status = action.params.get("status", "complete")
                    message = action.params.get("message", "Agent finished.")
                    yield _sse("agent_status", {
                        "phase": "done",
                        "message": message,
                        "step": step,
                        "jobs_found": len(jobs_found),
                    })
                    break

                elif action.action == "ask_user":
                    yield _sse("agent_ask", {
                        "question": action.params.get("question", "I need your input"),
                        "reason": action.params.get("reason", ""),
                    })
                    # Agent pauses — frontend will resume with user's answer
                    break

                elif action.action == "found_job":
                    job = action.params
                    jobs_found.append(job)

                    # Save to DB
                    application = JobApplication(
                        user_id=user_id,
                        job_title=job.get("title", ""),
                        company=job.get("company", ""),
                        job_url=job.get("url", url),
                        board=board,
                        status="found",
                        extra_data=json.dumps(job),
                    )
                    db.add(application)
                    await db.flush()

                    yield _sse("agent_found_job", {
                        "title": job.get("title", ""),
                        "company": job.get("company", ""),
                        "url": job.get("url", url),
                        "description": job.get("description", ""),
                    })

                    # Check if we have enough jobs
                    if len(jobs_found) >= max_results:
                        yield _sse("agent_status", {
                            "phase": "done",
                            "message": f"Found {len(jobs_found)} jobs. Agent complete.",
                            "step": step,
                            "jobs_found": len(jobs_found),
                        })
                        break

                elif action.action == "click":
                    selector = action.params.get("selector", "")
                    await browser.click(selector)

                elif action.action == "click_xy":
                    x = int(action.params.get("x", 0))
                    y = int(action.params.get("y", 0))
                    await browser.click_coordinates(x, y)

                elif action.action == "fill":
                    selector = action.params.get("selector", "")
                    value = action.params.get("value", "")
                    # Replace profile placeholders
                    value = _resolve_profile_value(value, profile)
                    await browser.fill(selector, value)

                elif action.action == "scroll":
                    direction = action.params.get("direction", "down")
                    amount = action.params.get("amount", 3)
                    await browser.scroll(direction, amount)

                elif action.action == "goto":
                    goto_url = action.params.get("url", "")
                    if goto_url:
                        await browser.goto(goto_url)

                elif action.action == "upload_cv":
                    if profile.cv_base64:
                        file_data = base64.b64decode(profile.cv_base64)
                        selector = action.params.get("selector", "input[type='file']")
                        await browser.upload_file(
                            selector, file_data,
                            profile.cv_filename or "resume.pdf",
                            profile.cv_mime_type or "application/pdf",
                        )
                    else:
                        yield _sse("agent_ask", {
                            "question": "I need to upload your CV but you haven't uploaded one yet. Please upload your CV/resume.",
                            "reason": "Application form requires a CV file upload.",
                        })
                        break

                elif action.action == "press":
                    key = action.params.get("key", "Enter")
                    await browser.press(key)

                elif action.action == "wait":
                    seconds = min(action.params.get("seconds", 2), 10)
                    await browser.wait(seconds)

                else:
                    logger.warning("Unknown action: %s", action.action)

            except Exception as e:
                logger.error("Action execution error (step %d): %s", step, e)
                yield _sse("agent_status", {
                    "phase": "error",
                    "message": f"Action failed: {str(e)[:100]}",
                    "step": step,
                })
                # Continue to next step — the vision model will see the result

            # Small delay to pace the loop
            await asyncio.sleep(1)

            # Take post-action screenshot
            screenshot = await browser.screenshot()
            url = await browser.get_url()
            yield _sse("browser_screenshot", {
                "image": screenshot,
                "url": url,
                "action": action.thought[:100],
            })

        else:
            # Reached max steps
            yield _sse("agent_status", {
                "phase": "done",
                "message": f"Reached maximum steps ({MAX_STEPS}). Found {len(jobs_found)} jobs.",
                "step": MAX_STEPS,
                "jobs_found": len(jobs_found),
            })

        # Commit any DB changes
        await db.commit()

    except asyncio.TimeoutError:
        yield _sse("agent_error", {"message": "Agent timed out after 5 minutes."})
    except Exception as e:
        logger.error("Job agent error: %s", e, exc_info=True)
        yield _sse("agent_error", {"message": f"Agent error: {str(e)[:200]}"})
    finally:
        await browser.close()


def _resolve_profile_value(value: str, profile: JobProfile) -> str:
    """Replace common profile placeholders in form values."""
    replacements = {
        "{full_name}": profile.full_name,
        "{email}": profile.email,
        "{phone}": profile.phone,
        "{location}": profile.location,
        "{linkedin}": profile.linkedin_url,
        "{portfolio}": profile.portfolio_url,
        "{salary}": profile.salary_range,
    }
    for placeholder, replacement in replacements.items():
        if placeholder in value:
            value = value.replace(placeholder, replacement)
    return value
