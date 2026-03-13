"""AI copywriting for B2B multichannel prospecting.

Generates personalized outreach messages per channel:
- Email: problem → solution → proof → CTA (natural, human-like tone)
- LinkedIn connection request: max 300 chars, casual/professional
- LinkedIn message: shorter than email, conversational
- Call script: brief talking points with opener + value prop + CTA
"""

import json
import logging
import re

from google import genai

from app.config import settings

log = logging.getLogger(__name__)


CHANNEL_GUIDELINES = {
    "email": {
        "max_words": 150,
        "tone": "professional but human — like a colleague writing, not a marketer",
        "structure": "Hook (reference something specific about them) → Problem you solve → Brief proof/credibility → Simple CTA (question, not a demand)",
        "rules": [
            "No images, no links (deliverability), no attachments",
            "Subject line: short, lowercase, looks like a personal email",
            "First line must reference something specific about the prospect — never generic",
            "Write like a human, not a template. No 'I hope this finds you well'",
            "CTA should be a simple question, not 'book a call'",
            "Sign off with just your first name",
        ],
    },
    "linkedin_connect": {
        "max_words": 50,
        "tone": "casual, peer-to-peer",
        "structure": "Why you're connecting (specific reason) → Value mention → No hard sell",
        "rules": [
            "Max 300 characters total",
            "Reference something specific: mutual connection, shared interest, their content",
            "Never pitch in a connection request",
            "No links",
        ],
    },
    "linkedin_message": {
        "max_words": 80,
        "tone": "conversational, like a DM to a colleague",
        "structure": "Reference previous interaction or their activity → Value observation → Soft question",
        "rules": [
            "Shorter than email, more conversational",
            "Can reference that you just connected",
            "Voice notes are a great differentiator — suggest recording one if Tier 1",
            "One question max as CTA",
        ],
    },
    "call": {
        "max_words": 100,
        "tone": "natural phone conversation",
        "structure": "Opener (who you are, 10 sec) → Reason for call (specific trigger) → Value prop (30 sec) → Question",
        "rules": [
            "Keep it to 30 seconds before asking a question",
            "Reference previous touchpoints (email you sent, LinkedIn)",
            "Ask a question to create dialogue, don't monologue",
            "Have a fallback if they're busy: 'When would be better?'",
        ],
    },
    "reminder": {
        "max_words": 30,
        "tone": "internal note",
        "structure": "What to do and why",
        "rules": ["This is an internal reminder, not sent to the prospect"],
    },
    "linkedin_voice_note": {
        "max_words": 60,
        "tone": "casual, spoken format",
        "structure": "Script for a 30-sec voice note: mention their name, reference something specific, one question",
        "rules": [
            "Write it as a spoken script (how you'd actually say it)",
            "30 seconds max when spoken aloud",
            "Mention their first name",
            "End with a question",
        ],
    },
}


async def generate_outreach_copy(
    channel: str,
    prospect_name: str,
    prospect_company: str = "",
    prospect_title: str = "",
    personalization: str = "",
    sender_name: str = "",
    sender_company: str = "",
    value_proposition: str = "",
    step_number: int = 1,
    is_followup: bool = False,
    previous_steps_summary: str = "",
) -> dict:
    """Generate personalized outreach copy for a specific channel.

    Returns dict with 'subject' (for email) and 'body'.
    """
    guidelines = CHANNEL_GUIDELINES.get(channel, CHANNEL_GUIDELINES["email"])

    prompt = f"""You are a B2B sales copywriter. Generate outreach copy for a {channel.replace('_', ' ')} message.

PROSPECT:
- Name: {prospect_name}
- Company: {prospect_company or 'Unknown'}
- Title: {prospect_title or 'Unknown'}
- Personalization context: {personalization or 'None available — use their title/company as hooks'}

SENDER:
- Name: {sender_name or 'Alex'}
- Company: {sender_company or 'Our company'}
- Value proposition: {value_proposition or 'We help companies like theirs grow'}

CONTEXT:
- This is step #{step_number} in the sequence
- Is follow-up to previous outreach: {is_followup}
{f'- Previous steps: {previous_steps_summary}' if previous_steps_summary else ''}

CHANNEL: {channel.replace('_', ' ')}
MAX WORDS: {guidelines['max_words']}
TONE: {guidelines['tone']}
STRUCTURE: {guidelines['structure']}
RULES:
{chr(10).join(f'- {r}' for r in guidelines['rules'])}

{'IMPORTANT: This is a FOLLOW-UP message. Reference that you reached out before. Keep it shorter and more direct than the first message. Do NOT repeat the same pitch — add a new angle or share a useful insight.' if is_followup else ''}

Return ONLY a JSON object:
{{"subject": "email subject line (only for email channel, empty string otherwise)", "body": "the message body"}}

Write naturally, like a real person. No corporate jargon. No template-sounding phrases.
Return valid JSON only, no markdown."""

    try:
        client = genai.Client(api_key=settings.gemini_api_key)
        response = await client.aio.models.generate_content(
            model=settings.gemini_chat_model,
            contents=prompt,
        )
        text = response.text.strip()
        match = re.search(r"\{[\s\S]*\}", text)
        if match:
            data = json.loads(match.group())
            return {
                "subject": data.get("subject", ""),
                "body": data.get("body", ""),
            }
    except Exception:
        log.exception("Copywriter failed for %s / %s", channel, prospect_name)

    # Fallback
    return {
        "subject": f"Quick question about {prospect_company}" if channel == "email" else "",
        "body": f"Hi {prospect_name.split()[0] if prospect_name else 'there'},\n\nWanted to connect regarding {prospect_company or 'your work'}.",
    }


async def generate_sequence_templates(
    tier: int,
    value_proposition: str = "",
    target_industry: str = "",
    target_role: str = "",
) -> list[dict]:
    """Generate a full sequence template for a given tier.

    Returns list of step dicts with: step_order, step_type, delay_days, subject_template, body_template.
    """
    tier_descriptions = {
        1: """TIER 1 (High-touch, manual):
- These are your top prospects with highest potential revenue
- Full multichannel: email + LinkedIn + phone + voice notes
- Personalize every message manually
- Sequence: Day 1 = email + LinkedIn connect, Day 3 = follow-up email, Day 5 = LinkedIn message (if connected), Day 7 = voice note, Day 10 = call, Day 14 = final email""",
        2: """TIER 2 (Semi-automated):
- Mid-value prospects, email + LinkedIn
- Personalize first touchpoint, rest can use templates with variables
- Sequence: Day 1 = email + LinkedIn connect, Day 3 = follow-up email, Day 7 = LinkedIn message, Day 10 = follow-up email, Day 14 = final email""",
        3: """TIER 3 (Automated):
- Volume play, mostly email-only
- Template-based with minimal personalization
- Sequence: Day 1 = email, Day 3 = follow-up, Day 7 = follow-up, Day 14 = final email""",
    }

    prompt = f"""You are a B2B sales strategist. Design a multichannel outreach sequence.

TIER: {tier}
{tier_descriptions.get(tier, tier_descriptions[2])}

VALUE PROPOSITION: {value_proposition or 'We help businesses grow and optimize their operations'}
TARGET INDUSTRY: {target_industry or 'B2B companies'}
TARGET ROLE: {target_role or 'Decision makers'}

Generate the sequence as a JSON array. Each step:
{{
  "step_order": 1,
  "step_type": "email|linkedin_connect|linkedin_message|linkedin_voice_note|call|reminder",
  "delay_days": 0,
  "subject_template": "Subject (for email, use {{{{name}}}}, {{{{company}}}} placeholders)",
  "body_template": "Body text with {{{{name}}}}, {{{{company}}}}, {{{{personalization}}}} placeholders"
}}

RULES:
- Use {{{{name}}}}, {{{{company}}}}, {{{{personalization}}}} as template variables
- Day 1 should have 2 simultaneous actions for Tier 1 and 2 (email + LinkedIn connect, both delay_days=0)
- LinkedIn connect note must be under 300 chars
- Each follow-up should add a new angle, not repeat
- The final email should be a polite breakup email
- Write naturally, not like a template

Return ONLY a JSON array, no markdown."""

    try:
        client = genai.Client(api_key=settings.gemini_api_key)
        response = await client.aio.models.generate_content(
            model=settings.gemini_chat_model,
            contents=prompt,
        )
        text = response.text.strip()
        match = re.search(r"\[[\s\S]*\]", text)
        if match:
            steps = json.loads(match.group())
            return steps
    except Exception:
        log.exception("Sequence template generation failed for tier %d", tier)

    # Fallback: basic sequence
    if tier == 1:
        return [
            {"step_order": 1, "step_type": "email", "delay_days": 0, "subject_template": "Quick question about {{company}}", "body_template": "Hi {{name}},\n\n{{personalization}}\n\nWould love to learn more about what you're working on at {{company}}."},
            {"step_order": 2, "step_type": "linkedin_connect", "delay_days": 0, "subject_template": "", "body_template": "Hi {{name}}, saw your work at {{company}} — would love to connect."},
            {"step_order": 3, "step_type": "email", "delay_days": 3, "subject_template": "Re: Quick question", "body_template": "Hi {{name}}, just following up on my previous note. Curious if you've thought about this."},
            {"step_order": 4, "step_type": "linkedin_message", "delay_days": 5, "subject_template": "", "body_template": "Hey {{name}}, thanks for connecting! Wanted to share a quick thought about {{company}}."},
            {"step_order": 5, "step_type": "linkedin_voice_note", "delay_days": 7, "subject_template": "", "body_template": "Record a 30-sec voice note for {{name}} mentioning {{personalization}}."},
            {"step_order": 6, "step_type": "call", "delay_days": 10, "subject_template": "", "body_template": "Call {{name}} at {{company}}. Reference your emails and LinkedIn outreach."},
            {"step_order": 7, "step_type": "email", "delay_days": 14, "subject_template": "Last note", "body_template": "Hi {{name}}, I'll keep this short — seems like the timing might not be right. I'll leave it here, but feel free to reach out anytime."},
        ]
    elif tier == 3:
        return [
            {"step_order": 1, "step_type": "email", "delay_days": 0, "subject_template": "{{company}} + us?", "body_template": "Hi {{name}},\n\n{{personalization}}\n\nWould it make sense to chat?"},
            {"step_order": 2, "step_type": "email", "delay_days": 3, "subject_template": "Re: {{company}}", "body_template": "Hi {{name}}, quick follow-up. Have you had a chance to think about this?"},
            {"step_order": 3, "step_type": "email", "delay_days": 7, "subject_template": "One more thought", "body_template": "Hi {{name}}, one quick insight that might be relevant for {{company}}."},
            {"step_order": 4, "step_type": "email", "delay_days": 14, "subject_template": "Closing the loop", "body_template": "Hi {{name}}, looks like the timing might not be right. No worries — feel free to reach out anytime."},
        ]
    else:  # tier 2
        return [
            {"step_order": 1, "step_type": "email", "delay_days": 0, "subject_template": "Quick question for {{name}}", "body_template": "Hi {{name}},\n\n{{personalization}}\n\nWould it be worth a quick conversation?"},
            {"step_order": 2, "step_type": "linkedin_connect", "delay_days": 0, "subject_template": "", "body_template": "Hi {{name}}, noticed your work at {{company}} — would love to connect."},
            {"step_order": 3, "step_type": "email", "delay_days": 3, "subject_template": "Re: Quick question", "body_template": "Hi {{name}}, just bumping this up. Curious about your thoughts."},
            {"step_order": 4, "step_type": "linkedin_message", "delay_days": 7, "subject_template": "", "body_template": "Hey {{name}}, thanks for connecting! Thought you might find this relevant for {{company}}."},
            {"step_order": 5, "step_type": "email", "delay_days": 10, "subject_template": "One last thought", "body_template": "Hi {{name}}, wanted to share one more angle that might be useful."},
            {"step_order": 6, "step_type": "email", "delay_days": 14, "subject_template": "Closing the loop", "body_template": "Hi {{name}}, I'll leave it here for now. Feel free to reach out anytime."},
        ]


async def personalize_template(
    template: str,
    prospect_name: str,
    prospect_company: str = "",
    personalization: str = "",
) -> str:
    """Replace template variables with actual values."""
    result = template
    first_name = prospect_name.split()[0] if prospect_name else "there"
    result = result.replace("{{name}}", first_name)
    result = result.replace("{{company}}", prospect_company or "your company")
    result = result.replace("{{personalization}}", personalization or "")
    return result
