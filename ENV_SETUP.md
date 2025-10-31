Environment setup

1) Create a .env file in the project root with:

ALLOWED_ORIGINS=http://127.0.0.1:5502,http://localhost:5502,http://localhost:3000
GOOGLE_AI_API_KEY=YOUR_GOOGLE_AI_KEY
OPENAI_API_KEY=YOUR_OPENAI_API_KEY

2) Restart the server after saving the .env file.

Notes
- Keep your existing MONGODB_URI if already configured.
- Add other origins to ALLOWED_ORIGINS if you test from another URL.

