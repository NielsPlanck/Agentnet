"""Seed the database with sample tools, capabilities, and actions."""

import asyncio

from app.database import async_session, engine
from app.models.capability import Capability
from app.models.tool import Action, Base, Tool
from app.services.embeddings import get_embedding

TOOLS = [
    {
        "name": "Figma",
        "provider": "Figma Inc.",
        "transport": "mcp",
        "base_url": "https://mcp.figma.com",
        "auth_type": "oauth",
        "tags": ["design", "ui"],
        "actions": [
            ("create_frame", "Create a new design frame or artboard", "write"),
            ("export_frame", "Export a frame as PNG, SVG, or PDF", "read"),
            ("generate_component", "Generate a reusable UI component", "write"),
        ],
    },
    {
        "name": "Canva",
        "provider": "Canva Pty Ltd",
        "transport": "mcp",
        "base_url": "https://mcp.canva.com",
        "auth_type": "oauth",
        "tags": ["design", "marketing"],
        "actions": [
            ("generate_layout", "Generate a layout from a text prompt", "write"),
            ("export_design", "Export design to various formats", "read"),
        ],
    },
    {
        "name": "Stripe",
        "provider": "Stripe Inc.",
        "transport": "mcp",
        "base_url": "https://mcp.stripe.com",
        "auth_type": "api_key",
        "tags": ["payments", "commerce"],
        "actions": [
            ("create_payment_intent", "Create a payment intent for checkout", "write"),
            ("list_charges", "List all charges for an account", "read"),
            ("create_refund", "Refund a charge", "write"),
        ],
    },
    {
        "name": "Shopify",
        "provider": "Shopify Inc.",
        "transport": "mcp",
        "base_url": "https://mcp.shopify.com",
        "auth_type": "oauth",
        "tags": ["commerce", "ecommerce"],
        "actions": [
            ("create_product", "Create a new product listing", "write"),
            ("search_products", "Search products by query", "read"),
            ("create_order", "Create a new order", "write"),
        ],
    },
    {
        "name": "Slack",
        "provider": "Salesforce",
        "transport": "mcp",
        "base_url": "https://mcp.slack.com",
        "auth_type": "oauth",
        "tags": ["communication", "messaging"],
        "actions": [
            ("send_message", "Send a message to a channel or user", "write"),
            ("list_channels", "List available channels", "read"),
            ("search_messages", "Search messages across channels", "read"),
        ],
    },
    {
        "name": "Gmail",
        "provider": "Google",
        "transport": "mcp",
        "base_url": "https://mcp.google.com/gmail",
        "auth_type": "oauth",
        "tags": ["communication", "email"],
        "actions": [
            ("send_email", "Send an email", "write", {
                "type": "object",
                "properties": {
                    "to": {"type": "string", "description": "Recipient email address"},
                    "subject": {"type": "string", "description": "Email subject"},
                    "body": {"type": "string", "description": "Email body text"},
                },
                "required": ["to", "subject"],
            }),
            ("search_emails", "Search emails by query", "read", {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Gmail search query (e.g. 'from:user@example.com')"},
                    "max_results": {"type": "integer", "description": "Max emails to return", "default": 10},
                },
                "required": ["query"],
            }),
            ("list_labels", "List email labels", "read", None),
        ],
    },
    {
        "name": "GitHub",
        "provider": "Microsoft",
        "transport": "mcp",
        "base_url": "https://mcp.github.com",
        "auth_type": "oauth",
        "tags": ["dev", "code"],
        "actions": [
            ("create_issue", "Create a new issue", "write"),
            ("create_pull_request", "Create a pull request", "write"),
            ("search_repositories", "Search repositories", "read"),
            ("list_commits", "List commits for a repo", "read"),
        ],
    },
    {
        "name": "Linear",
        "provider": "Linear Inc.",
        "transport": "mcp",
        "base_url": "https://mcp.linear.app",
        "auth_type": "oauth",
        "tags": ["dev", "project_management"],
        "actions": [
            ("create_issue", "Create a new issue", "write"),
            ("update_issue", "Update issue status or fields", "write"),
            ("list_projects", "List all projects", "read"),
        ],
    },
    {
        "name": "Notion",
        "provider": "Notion Labs",
        "transport": "mcp",
        "base_url": "https://mcp.notion.so",
        "auth_type": "oauth",
        "tags": ["productivity", "docs"],
        "actions": [
            ("create_page", "Create a new page in a database", "write"),
            ("search_pages", "Search pages by query", "read"),
            ("update_page", "Update page properties", "write"),
        ],
    },
    {
        "name": "Jira",
        "provider": "Atlassian",
        "transport": "mcp",
        "base_url": "https://mcp.atlassian.com/jira",
        "auth_type": "oauth",
        "tags": ["dev", "project_management"],
        "actions": [
            ("create_ticket", "Create a new Jira ticket", "write"),
            ("search_tickets", "Search tickets with JQL", "read"),
            ("update_ticket", "Update ticket fields", "write"),
        ],
    },
    {
        "name": "HubSpot",
        "provider": "HubSpot Inc.",
        "transport": "mcp",
        "base_url": "https://mcp.hubspot.com",
        "auth_type": "oauth",
        "tags": ["marketing", "crm"],
        "actions": [
            ("create_contact", "Create a new CRM contact", "write"),
            ("search_contacts", "Search contacts", "read"),
            ("send_marketing_email", "Send a marketing email campaign", "write"),
        ],
    },
    {
        "name": "Twilio",
        "provider": "Twilio Inc.",
        "transport": "mcp",
        "base_url": "https://mcp.twilio.com",
        "auth_type": "api_key",
        "tags": ["communication", "sms"],
        "actions": [
            ("send_sms", "Send an SMS message", "write"),
            ("make_call", "Initiate a phone call", "write"),
        ],
    },
    {
        "name": "AWS S3",
        "provider": "Amazon",
        "transport": "rest",
        "base_url": "https://s3.amazonaws.com",
        "auth_type": "api_key",
        "tags": ["cloud", "storage"],
        "actions": [
            ("upload_object", "Upload a file to S3", "write"),
            ("list_objects", "List objects in a bucket", "read"),
            ("download_object", "Download a file from S3", "read"),
        ],
    },
    {
        "name": "Snowflake",
        "provider": "Snowflake Inc.",
        "transport": "mcp",
        "base_url": "https://mcp.snowflake.com",
        "auth_type": "jwt",
        "tags": ["data", "analytics"],
        "actions": [
            ("run_query", "Execute a SQL query", "read"),
            ("list_tables", "List tables in a schema", "read"),
        ],
    },
    {
        "name": "Plaid",
        "provider": "Plaid Inc.",
        "transport": "rest",
        "base_url": "https://api.plaid.com",
        "auth_type": "api_key",
        "tags": ["finance", "banking"],
        "actions": [
            ("get_accounts", "Get linked bank accounts", "read"),
            ("get_transactions", "Get transactions for an account", "read"),
            ("create_link_token", "Create a Plaid Link token", "write"),
        ],
    },
    {
        "name": "Vercel",
        "provider": "Vercel Inc.",
        "transport": "mcp",
        "base_url": "https://mcp.vercel.com",
        "auth_type": "api_key",
        "tags": ["dev", "cloud", "hosting"],
        "actions": [
            ("create_deployment", "Deploy a project", "write"),
            ("list_deployments", "List deployments", "read"),
        ],
    },
    {
        "name": "Supabase",
        "provider": "Supabase Inc.",
        "transport": "mcp",
        "base_url": "https://mcp.supabase.com",
        "auth_type": "api_key",
        "tags": ["dev", "database", "cloud"],
        "actions": [
            ("query_table", "Query a database table", "read"),
            ("insert_rows", "Insert rows into a table", "write"),
            ("create_user", "Create an auth user", "write"),
        ],
    },
    {
        "name": "Airtable",
        "provider": "Airtable Inc.",
        "transport": "mcp",
        "base_url": "https://mcp.airtable.com",
        "auth_type": "api_key",
        "tags": ["productivity", "database"],
        "actions": [
            ("list_records", "List records in a table", "read"),
            ("create_record", "Create a new record", "write"),
            ("update_record", "Update a record", "write"),
        ],
    },
    {
        "name": "Booking.com",
        "provider": "Booking Holdings",
        "transport": "rest",
        "base_url": "https://api.booking.com",
        "auth_type": "api_key",
        "tags": ["travel", "hotels"],
        "actions": [
            ("search_hotels", "Search hotels by location and dates", "read"),
            ("get_hotel_details", "Get hotel details and availability", "read"),
            ("book_hotel", "Book a hotel room", "write"),
        ],
    },
    {
        "name": "Skyscanner",
        "provider": "Skyscanner Ltd",
        "transport": "rest",
        "base_url": "https://partners.api.skyscanner.net",
        "auth_type": "api_key",
        "tags": ["travel", "flights"],
        "actions": [
            ("search_flights", "Search and compare cheap flights by route, dates, and airline", "read"),
            ("get_flight_details", "Get detailed flight itinerary, price, and airline information", "read"),
            ("search_everywhere", "Explore cheapest flight destinations from an origin airport", "read"),
        ],
    },
    {
        "name": "Kayak",
        "provider": "Booking Holdings",
        "transport": "rest",
        "base_url": "https://www.kayak.com/labs/api",
        "auth_type": "api_key",
        "tags": ["travel", "flights", "hotels", "cars"],
        "status": "no_mcp",
        "actions": [
            ("search_flights", "Search and compare flight prices across hundreds of airlines", "read"),
            ("get_price_forecast", "Get flight price forecast and best time to buy", "read"),
            ("search_hotels", "Search and compare hotel prices by destination and dates", "read"),
            ("search_car_rentals", "Search and compare car rental prices", "read"),
        ],
    },
    {
        "name": "Google Flights",
        "provider": "Google",
        "transport": "rest",
        "base_url": "https://www.googleapis.com/travel/v1",
        "auth_type": "api_key",
        "tags": ["travel", "flights"],
        "actions": [
            ("search_flights", "Search flights by origin, destination, and travel dates", "read"),
            ("get_cheapest_dates", "Find the cheapest dates to fly between two cities", "read"),
            ("track_prices", "Track flight price changes and get alerts", "write"),
        ],
    },
    # Direct airlines
    {
        "name": "Air France",
        "provider": "Air France-KLM",
        "transport": "webmcp",
        "base_url": "https://www.airfrance.com",
        "auth_type": "oauth",
        "tags": ["travel", "flights", "airline"],
        "status": "no_mcp",
        "actions": [
            ("search_flights", "Search and book Air France flights directly on airfrance.com", "read"),
            ("book_flight", "Book a flight ticket directly with Air France", "write"),
            ("manage_booking", "View, change, or cancel an Air France booking", "write"),
            ("check_in_online", "Online check-in for an Air France flight", "write"),
        ],
    },
    {
        "name": "United Airlines",
        "provider": "United Airlines Inc.",
        "transport": "webmcp",
        "base_url": "https://www.united.com",
        "auth_type": "oauth",
        "tags": ["travel", "flights", "airline"],
        "status": "no_mcp",
        "actions": [
            ("search_flights", "Search and book United Airlines flights directly", "read"),
            ("book_flight", "Book a flight ticket directly with United Airlines", "write"),
            ("manage_reservation", "View, change, or cancel a United Airlines reservation", "write"),
            ("check_in_online", "Online check-in for a United Airlines flight", "write"),
        ],
    },
    {
        "name": "Delta Air Lines",
        "provider": "Delta Air Lines Inc.",
        "transport": "webmcp",
        "base_url": "https://www.delta.com",
        "auth_type": "oauth",
        "tags": ["travel", "flights", "airline"],
        "status": "no_mcp",
        "actions": [
            ("search_flights", "Search and book Delta Air Lines flights directly", "read"),
            ("book_flight", "Book a flight ticket directly with Delta", "write"),
            ("manage_booking", "View, change, or cancel a Delta booking", "write"),
            ("check_in_online", "Online check-in for a Delta Air Lines flight", "write"),
        ],
    },
    {
        "name": "Emirates",
        "provider": "Emirates Group",
        "transport": "webmcp",
        "base_url": "https://www.emirates.com",
        "auth_type": "oauth",
        "tags": ["travel", "flights", "airline"],
        "status": "no_mcp",
        "actions": [
            ("search_flights", "Search and book Emirates flights directly from Dubai hub", "read"),
            ("book_flight", "Book a premium Emirates flight ticket directly", "write"),
            ("manage_booking", "View, change, or cancel an Emirates booking", "write"),
        ],
    },
    {
        "name": "British Airways",
        "provider": "International Airlines Group",
        "transport": "webmcp",
        "base_url": "https://www.britishairways.com",
        "auth_type": "oauth",
        "tags": ["travel", "flights", "airline"],
        "status": "no_mcp",
        "actions": [
            ("search_flights", "Search and book British Airways flights directly", "read"),
            ("book_flight", "Book a British Airways flight ticket directly", "write"),
            ("manage_booking", "View, change, or cancel a British Airways booking", "write"),
        ],
    },
    {
        "name": "Lufthansa",
        "provider": "Lufthansa Group",
        "transport": "webmcp",
        "base_url": "https://www.lufthansa.com",
        "auth_type": "oauth",
        "tags": ["travel", "flights", "airline"],
        "status": "no_mcp",
        "actions": [
            ("search_flights", "Search and book Lufthansa flights directly", "read"),
            ("book_flight", "Book a Lufthansa flight ticket directly", "write"),
            ("manage_booking", "View, change, or cancel a Lufthansa booking", "write"),
        ],
    },
    # Accommodation
    {
        "name": "Airbnb",
        "provider": "Airbnb Inc.",
        "transport": "rest",
        "base_url": "https://api.airbnb.com/v2",
        "auth_type": "oauth",
        "tags": ["travel", "accommodation", "rooms"],
        "status": "no_mcp",
        "actions": [
            ("search_listings", "Search Airbnb short-term rental accommodations, apartments, and homes to stay in", "read"),
            ("get_listing_details", "Get details, photos, reviews, and nightly pricing for an Airbnb accommodation", "read"),
            ("book_listing", "Book an Airbnb short-term rental accommodation", "write"),
            ("list_reservations", "List your upcoming Airbnb accommodation reservations", "read"),
        ],
    },
    {
        "name": "Vrbo",
        "provider": "Expedia Group",
        "transport": "rest",
        "base_url": "https://api.vrbo.com/v1",
        "auth_type": "oauth",
        "tags": ["travel", "accommodation", "vacation_rental"],
        "status": "no_mcp",
        "actions": [
            ("search_properties", "Search vacation rental properties by location and dates", "read"),
            ("get_property_details", "Get details and availability for a vacation rental", "read"),
            ("book_property", "Book a vacation rental property", "write"),
        ],
    },
    # Food delivery — no MCP yet
    {
        "name": "Uber Eats",
        "provider": "Uber Technologies",
        "transport": "rest",
        "base_url": "https://api.uber.com/v1/eats",
        "auth_type": "oauth",
        "tags": ["food", "delivery", "restaurant"],
        "status": "no_mcp",
        "actions": [
            ("search_restaurants", "Search nearby restaurants for food delivery", "read"),
            ("place_order", "Place a food delivery order from a restaurant", "write"),
            ("track_delivery", "Track the status of a food delivery order", "read"),
            ("get_menu", "Get the menu and prices for a restaurant", "read"),
        ],
    },
    {
        "name": "DoorDash",
        "provider": "DoorDash Inc.",
        "transport": "rest",
        "base_url": "https://api.doordash.com/v1",
        "auth_type": "oauth",
        "tags": ["food", "delivery", "restaurant"],
        "status": "no_mcp",
        "actions": [
            ("search_stores", "Search restaurants and stores nearby for food delivery", "read"),
            ("create_delivery", "Create a food delivery order", "write"),
            ("get_delivery_status", "Check the status of a delivery", "read"),
        ],
    },
    {
        "name": "Grubhub",
        "provider": "Just Eat Takeaway",
        "transport": "rest",
        "base_url": "https://api.grubhub.com/v1",
        "auth_type": "oauth",
        "tags": ["food", "delivery", "restaurant"],
        "status": "no_mcp",
        "actions": [
            ("search_restaurants", "Search restaurants for food ordering and delivery", "read"),
            ("place_order", "Place a food order for delivery or pickup", "write"),
        ],
    },
    {
        "name": "Instacart",
        "provider": "Maplebear Inc.",
        "transport": "rest",
        "base_url": "https://api.instacart.com/v1",
        "auth_type": "oauth",
        "tags": ["food", "grocery", "delivery"],
        "status": "no_mcp",
        "actions": [
            ("search_products", "Search grocery products across stores", "read"),
            ("create_order", "Create a grocery delivery order", "write"),
            ("track_order", "Track grocery delivery status", "read"),
        ],
    },
    # Ride-hailing
    {
        "name": "Uber",
        "provider": "Uber Technologies",
        "transport": "rest",
        "base_url": "https://api.uber.com/v1",
        "auth_type": "oauth",
        "tags": ["transport", "rideshare"],
        "status": "no_mcp",
        "actions": [
            ("request_ride", "Request a ride to a destination", "write"),
            ("estimate_fare", "Get a fare estimate for a ride", "read"),
            ("get_ride_status", "Check the status of a current ride", "read"),
        ],
    },
    # Music & entertainment
    {
        "name": "Spotify",
        "provider": "Spotify AB",
        "transport": "mcp",
        "base_url": "https://mcp.spotify.com",
        "auth_type": "oauth",
        "tags": ["music", "entertainment"],
        "actions": [
            ("search_tracks", "Search for songs, albums, or artists", "read"),
            ("play_track", "Play a song or playlist", "write"),
            ("create_playlist", "Create a new playlist", "write"),
            ("get_recommendations", "Get music recommendations based on taste", "read"),
        ],
    },
    # Maps & navigation
    {
        "name": "Google Maps",
        "provider": "Google",
        "transport": "mcp",
        "base_url": "https://mcp.google.com/maps",
        "auth_type": "api_key",
        "tags": ["maps", "navigation", "places"],
        "actions": [
            ("search_places", "Search for places, restaurants, stores nearby", "read"),
            ("get_directions", "Get directions between two locations", "read"),
            ("geocode_address", "Convert an address to coordinates", "read"),
        ],
    },
    # Weather
    {
        "name": "OpenWeather",
        "provider": "OpenWeather Ltd",
        "transport": "rest",
        "base_url": "https://api.openweathermap.org/data/3.0",
        "auth_type": "api_key",
        "tags": ["weather", "data"],
        "actions": [
            ("get_current_weather", "Get current weather for a location", "read"),
            ("get_forecast", "Get weather forecast for upcoming days", "read"),
        ],
    },
    # Calendar
    {
        "name": "Google Calendar",
        "provider": "Google",
        "transport": "mcp",
        "base_url": "https://mcp.google.com/calendar",
        "auth_type": "oauth",
        "tags": ["productivity", "calendar"],
        "actions": [
            ("create_event", "Create a calendar event or meeting", "write"),
            ("list_events", "List upcoming events and meetings", "read"),
            ("update_event", "Update an existing calendar event", "write"),
        ],
    },
    # Social media
    {
        "name": "X (Twitter)",
        "provider": "X Corp",
        "transport": "rest",
        "base_url": "https://api.x.com/2",
        "auth_type": "oauth",
        "tags": ["social", "media"],
        "status": "no_mcp",
        "actions": [
            ("post_tweet", "Post a tweet or thread", "write"),
            ("search_tweets", "Search tweets by keyword or hashtag", "read"),
            ("get_timeline", "Get the home timeline", "read"),
        ],
    },
    # E-commerce / shopping
    {
        "name": "Amazon",
        "provider": "Amazon.com Inc.",
        "transport": "rest",
        "base_url": "https://api.amazon.com",
        "auth_type": "oauth",
        "tags": ["shopping", "ecommerce", "delivery"],
        "status": "no_mcp",
        "actions": [
            ("search_products", "Search products on Amazon", "read"),
            ("add_to_cart", "Add a product to shopping cart", "write"),
            ("place_order", "Place an order for items in cart", "write"),
            ("track_package", "Track a package delivery", "read"),
        ],
    },
]

CAPABILITIES = [
    ("design.generate_ui", "Generate UI", "Generate user interface designs and mockups", "design"),
    ("design.export", "Export Design", "Export designs to various formats", "design"),
    ("payments.charge", "Process Payment", "Process payments and charges", "commerce"),
    ("commerce.products", "Manage Products", "Create and search product listings", "commerce"),
    ("commerce.orders", "Manage Orders", "Create and manage orders", "commerce"),
    ("comms.messaging", "Send Messages", "Send messages via chat, email, or SMS", "communication"),
    ("comms.search", "Search Messages", "Search through messages and emails", "communication"),
    ("dev.issues", "Manage Issues", "Create and manage development issues and tickets", "dev"),
    ("dev.deploy", "Deploy Code", "Deploy applications and services", "dev"),
    ("data.query", "Query Data", "Run queries against databases and data warehouses", "data"),
    ("travel.search_hotel", "Search Hotels", "Search and book hotels", "travel"),
    ("travel.search_flight", "Search Flights", "Search and book flights", "travel"),
    ("finance.accounts", "Financial Accounts", "Access bank accounts and transactions", "finance"),
    ("productivity.docs", "Manage Docs", "Create and manage documents and pages", "productivity"),
    ("cloud.storage", "Cloud Storage", "Upload and download files from cloud storage", "cloud"),
    ("food.order", "Order Food", "Order food delivery from restaurants", "food"),
    ("food.grocery", "Order Groceries", "Order grocery delivery", "food"),
    ("transport.ride", "Request Ride", "Request rides and transportation", "transport"),
    ("music.play", "Play Music", "Search and play music", "entertainment"),
    ("maps.search", "Search Places", "Search for places and get directions", "maps"),
    ("weather.forecast", "Get Weather", "Get weather information and forecasts", "weather"),
    ("calendar.events", "Manage Calendar", "Create and manage calendar events", "productivity"),
    ("social.post", "Social Media", "Post and interact on social media", "social"),
    ("shopping.buy", "Shop Online", "Search and buy products online", "shopping"),
]


async def seed():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)

    async with async_session() as session:
        # Seed capabilities
        cap_map = {}
        for slug, title, desc, category in CAPABILITIES:
            emb = await get_embedding(f"{title}: {desc}")
            cap = Capability(slug=slug, title=title, description=desc, category=category, embedding=emb)
            session.add(cap)
            cap_map[slug] = cap

        await session.flush()

        # Seed tools + actions
        for t in TOOLS:
            tool = Tool(
                name=t["name"],
                provider=t["provider"],
                transport=t["transport"],
                base_url=t["base_url"],
                auth_type=t["auth_type"],
                tags=t["tags"],
                status=t.get("status", "active"),
            )
            session.add(tool)
            await session.flush()

            for action_tuple in t["actions"]:
                if len(action_tuple) == 4:
                    action_name, action_desc, op_type, input_schema = action_tuple
                else:
                    action_name, action_desc, op_type = action_tuple
                    input_schema = None
                emb = await get_embedding(f"{t['name']} {action_name}: {action_desc}")
                action = Action(
                    tool_id=tool.id,
                    name=action_name,
                    description=action_desc,
                    operation_type=op_type,
                    input_schema=input_schema,
                    embedding=emb,
                )
                session.add(action)

        await session.commit()
        print(f"Seeded {len(TOOLS)} tools and {len(CAPABILITIES)} capabilities.")


if __name__ == "__main__":
    asyncio.run(seed())
