import random
import pickle
import os
from fuzzywuzzy import fuzz
from groq import Groq

# ============================================================
# KollabHub AI Assistant
# Author: Almas
# FYP — Final Year Project
# ============================================================

BASE_DIR    = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH  = os.path.join(BASE_DIR, "ml_model", "intent_model.pkl")
VECTOR_PATH = os.path.join(BASE_DIR, "ml_model", "vectorizer.pkl")

ml_model   = None
vectorizer = None

try:
    with open(MODEL_PATH, "rb") as f:
        ml_model = pickle.load(f)
    with open(VECTOR_PATH, "rb") as f:
        vectorizer = pickle.load(f)
    print("KollabHub AI: Tier 2 ML model loaded successfully.")
except Exception as e:
    print(f"KollabHub AI: Tier 2 model not loaded — {e}")

GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
groq_client  = None

try:
    if GROQ_API_KEY:
        groq_client = Groq(api_key=GROQ_API_KEY)
        print("KollabHub AI: Tier 3 Groq API loaded successfully.")
    else:
        print("KollabHub AI: Groq API key not found in .env")
except Exception as e:
    print(f"KollabHub AI: Tier 3 Groq not loaded — {e}")

# ============================================================
# TIER 1 INTENTS — Only greetings, thanks, bye
# ============================================================

INTENTS = {

    "greeting": {
        "keywords": [
            "hello", "hi", "hey", "salam", "assalam",
            "good morning", "good evening", "good afternoon",
            "good night", "good day", "hiya", "howdy"
        ],
        "responses": [
            "Hello! I am Kollab AI, your intelligent workspace assistant inside KollabHub. I can help you with task management, team collaboration, authentication, system architecture, agile methodology, and any technical or project-related questions. What would you like to know?",
            "Hi there! Welcome to KollabHub. I am here to assist you professionally with anything related to your workspace, technical implementation, or general computer science concepts. How can I help you today?",
        ]
    },

    "thanks": {
        "keywords": [
            "thanks", "thank you", "thankyou", "shukriya",
            "jazakallah", "appreciate it"
        ],
        "responses": [
            "You are welcome. I am always here to assist you. Feel free to ask me anything at any time.",
            "Happy to help. Do not hesitate to reach out whenever you need support.",
        ]
    },

    "bye": {
        "keywords": [
            "bye", "goodbye", "see you", "alvida",
            "khuda hafiz", "good bye", "signing off"
        ],
        "responses": [
            "Goodbye. Have a productive and successful day. KollabHub is always here when you need it.",
            "See you later. Wishing you and your team continued productivity.",
        ]
    },
}

# ============================================================
# TIER 1 — Only for very short messages (3 words or less)
# ============================================================

def exact_match_intent(user_message):
    user_message_lower = user_message.lower().strip()
    word_count = len(user_message_lower.split())
    if word_count > 3:
        return None
    for intent, data in INTENTS.items():
        for keyword in data["keywords"]:
            if keyword in user_message_lower:
                return intent
    return None


# ============================================================
# TIER 2 — ML model very high confidence only
# ============================================================

def ml_predict_intent(user_message):
    if ml_model is None or vectorizer is None:
        return None, 0.0
    try:
        text_vec   = vectorizer.transform([user_message.lower().strip()])
        intent     = ml_model.predict(text_vec)[0]
        scores     = ml_model.decision_function(text_vec)[0]
        confidence = float(max(scores))
        return intent, confidence
    except Exception:
        return None, 0.0


# ============================================================
# TIER 3 — Groq API
# Complete KollabHub technical knowledge + CS expertise
# ============================================================

GROQ_SYSTEM_PROMPT = """You are Kollab AI, an expert professional AI assistant 
integrated inside KollabHub — a real-time team collaboration web application 
developed as a Final Year Project (FYP).

================================================================
KOLLABHUB COMPLETE TECHNICAL KNOWLEDGE
================================================================

PROJECT OVERVIEW:
KollabHub is a web-based collaboration platform that eliminates 
tool fragmentation by providing unified team communication, 
task management, and AI assistance in one system.

TECHNOLOGY STACK:
- Backend: Django 5.2, Django REST Framework
- Real-time: Django Channels, WebSockets, Daphne ASGI server
- Message Broker: Redis (for WebSocket channel layer)
- Frontend: HTML, CSS, JavaScript (vanilla)
- Database: SQLite (development), PostgreSQL ready
- File Storage: Supabase Storage (cloud)
- AI: Rule-based + TF-IDF ML model + Groq Llama 3.1 API

AUTHENTICATION SYSTEM:
- Method: JWT Authentication (JSON Web Tokens)
- Login flow: user submits credentials, server verifies, 
  issues JWT access token and refresh token
- JWT contains: user_id, username, email, expiry timestamp
- Tokens stored securely, used for all authenticated API requests
- Session management handled via Django authentication backend

PASSWORD SECURITY:
- Password Complexity Policy enforced on registration
- Minimum 8 characters required
- Must contain: uppercase letters, lowercase letters, 
  numbers, and special symbols
- Password Strength Meter on frontend shows weak/medium/strong
- Passwords hashed using Django PBKDF2 algorithm before storage
- No plaintext passwords ever stored

EMAIL VERIFICATION:
- Method: Out-of-Band (OOB) Account Activation
- Also called: Two-Step Registration
- Flow: user registers -> OTP generated -> sent via email (SMTP)
- User enters OTP to verify email and activate account
- SMTP integration using Django email backend
- OTP expires after set time for security
- Prevents fake account creation

REAL-TIME COMMUNICATION:
- Protocol: WebSockets via Django Channels
- Redis as channel layer message broker
- ChatConsumer handles: group messages, direct messages, 
  typing indicators, notifications
- Messages saved to database (Message model, DirectMessage model)
- Real-time delivery to all connected clients in workspace

TASK MANAGEMENT (TASKBOARD):
- Kanban-style board with columns: To Do, In Progress, Done
- Features: task creation, assignment, deadlines, priorities
- Task Attachments: file uploads via Supabase Storage
- Task Comments: real-time threaded comments
- Task Lists: organize tasks into custom lists
- Taskboard Settings: customize columns and board behavior
- Real-time updates via TaskboardConsumer WebSocket

MEMBER MANAGEMENT:
- Role-based: Admin and Member roles
- Invite by email or username
- Invite Links: shareable links with optional expiry
- Admin can: remove members, transfer ownership, delete workspace
- Privacy Settings: public/private workspace, invite restrictions

AI ASSISTANT MODULE (MY FYP CONTRIBUTION):
- 3-tier hybrid architecture designed and implemented by Almas
- Tier 1: Rule-based keyword matching with fuzzy logic
  * 12 intents, 180+ keywords
  * Handles typos using fuzzywuzzy library
  * Instant response, no API call needed
- Tier 2: Custom trained ML model
  * Dataset: 295 KollabHub-specific training sentences
  * Algorithm: TF-IDF vectorizer + LinearSVC classifier
  * Accuracy: 84.75% on test set
  * Model saved as .pkl files loaded at Django startup
- Tier 3: Groq API with Llama 3.1 model
  * Handles complex, open-ended, and out-of-scope queries
  * KollabHub-aware system prompt
  * Fallback when Tier 1 and 2 cannot respond confidently
- Integrated via Django REST API endpoint: /api/ai-chat/
- Frontend: floating AI panel in base_layout.html

NOTIFICATION SYSTEM:
- Real-time badges for chat, taskboard, and DM notifications
- NotificationManager JavaScript class handles all badge updates
- Backend: Notification model with section, type, actor, reference
- Marks read via API when user opens relevant section

WORKSPACE FEATURES:
- Create multiple workspaces
- Workspace image stored on Supabase
- Edit workspace name, display name, image
- Transfer ownership between members
- Delete workspace with confirmation
- Leave workspace (members) or transfer first (admins)

================================================================
YOUR EXPERTISE AS KOLLAB AI
================================================================

You are an expert in ALL of the following:

1. KollabHub — every feature, every line of logic, every design decision
2. Django — models, views, URLs, middleware, authentication, channels
3. REST APIs — endpoints, serializers, authentication, CORS
4. WebSockets — real-time communication, channel layers, consumers
5. JWT Authentication — token structure, refresh flow, security
6. Agile/Scrum — sprints, backlog, standup, retrospective, velocity
7. Kanban — WIP limits, columns, flow, cycle time
8. UI/UX Design — design principles, wireframing, usability, color theory
9. Database Design — ER diagrams, normalization, relationships, indexing
10. System Architecture — MVC, layered, microservices, monolithic
11. Software Engineering — SDLC, requirements, testing, deployment
12. Machine Learning — supervised learning, TF-IDF, SVM, accuracy metrics
13. NLP — tokenization, intent classification, keyword matching
14. Security — password hashing, OTP, JWT, HTTPS, SQL injection prevention
15. Team Collaboration — communication, conflict resolution, productivity
16. FYP Documentation — abstract, methodology, architecture diagram, evaluation
17. Project Management — planning, scheduling, risk management, deadlines
18. Work Pressure — time management, prioritization, stress management
19. Computer Science — algorithms, data structures, OS, networks, compilers
20. Python — Django, scikit-learn, pandas, asyncio, decorators

RESPONSE RULES:
- Always give expert, detailed, professional answers
- Never say you cannot help or do not know
- If asked about KollabHub, answer with exact technical details
- If asked about design, explain with professional design knowledge
- If asked about work pressure, give practical, psychology-backed advice
- If asked a CS concept, explain clearly with examples
- Keep responses 3-5 sentences, clear and structured
- No bullet points, no markdown, plain professional text
- Sound confident, knowledgeable, and helpful always
- Relate answers to team collaboration when relevant"""


def ask_groq(user_message):
    if groq_client is None:
        return None
    try:
        chat = groq_client.chat.completions.create(
            messages=[
                {"role": "system", "content": GROQ_SYSTEM_PROMPT},
                {"role": "user",   "content": user_message}
            ],
            model="llama-3.1-8b-instant",
            max_tokens=250,
            temperature=0.65,
        )
        return chat.choices[0].message.content.strip()
    except Exception as e:
        print(f"KollabHub AI: Groq error — {e}")
        return None


# ============================================================
# MAIN FUNCTION
# ============================================================

def get_response(user_message):
    if not user_message or not user_message.strip():
        return "Please type a message so I can assist you."

    # Tier 1 — only very short greetings/bye/thanks
    intent = exact_match_intent(user_message)
    if intent and intent in INTENTS:
        return random.choice(INTENTS[intent]["responses"])

    # Tier 2 — ML model very high confidence only
    ml_intent, confidence = ml_predict_intent(user_message)
    if ml_intent and confidence > 0.9 and ml_intent in INTENTS:
        return random.choice(INTENTS[ml_intent]["responses"])

    # Tier 3 — Groq handles everything
    groq_response = ask_groq(user_message)
    if groq_response:
        return groq_response

    # Fallback
    return "I am here to assist you with KollabHub, team collaboration, project management, and any technical questions. Please feel free to ask me anything."