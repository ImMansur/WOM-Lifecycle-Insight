# WOM Lifecycle Insight

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Python](https://img.shields.io/badge/Python-3.11+-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?logo=fastapi&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![Vercel](https://img.shields.io/badge/Deploy-Vercel-black?logo=vercel&logoColor=white)

An intelligent document processing platform for **Worldwide Oilfield Machine (WOM)**. Ingests Certificates of Conformance (PDF / DOC / DOCX), extracts structured equipment data using AI, and generates proactive lifecycle and recertification recommendations — surfaced through a real-time operations dashboard.

---

## Features

- **Document Intelligence** — Multi-modal OCR extraction from scanned and digital certificates
- **AI Structured Extraction** — Automatically identifies customer, equipment, part numbers, serials, and certificate dates
- **Lifecycle Engine** — Applies 5-year recertification rules to compute status, priority, and urgency
- **Real-time Dashboard** — Live analytics, status distribution charts, and filterable recommendation table
- **Action Center** — Track and manage recertification tickets with AI-suggested actions
- **Secure Auth** — Firebase Authentication with role-based access control
- **Cloud Ready** — Single Vercel project deployment from the repo root

---

## Tech Stack

### Frontend
| Technology | Version | Purpose |
|------------|---------|----------|
| React | 18 | UI framework |
| TypeScript | 5 | Type-safe JavaScript |
| Vite | 6 | Build tool & dev server |
| TanStack Router | 1.x | File-based routing with type safety |
| TanStack Query | 5.x | Server state management & caching |
| Tailwind CSS | 4 | Utility-first styling |
| shadcn/ui | latest | Accessible Radix UI component library |
| Recharts | 2.x | Charting & data visualisation |
| React Hook Form | 7 | Form state management |
| Lucide React | latest | Icon library |
| Firebase SDK | 11 | Authentication & Firestore client |

### Backend
| Technology | Version | Purpose |
|------------|---------|----------|
| Python | 3.11+ | Runtime |
| FastAPI | 0.115 | REST API framework |
| Pydantic | v2 | Data validation & serialisation |
| Firebase Admin SDK | 6.6 | Firestore server-side access |
| python-multipart | 0.0.12 | Multipart file upload handling |
| python-dotenv | 1.0 | Environment variable loading |
| aiofiles | 24.x | Async file I/O |
| httpx | 0.27 | Async HTTP client |

### AI & Cloud Services
| Service | Purpose |
|---------|----------|
| Document Intelligence | Multi-modal OCR — extracts text from scanned and digital PDFs |
| AI Language Engine | Structured extraction of equipment metadata from raw text |
| Cloud Firestore | NoSQL real-time database for recommendations and actions |
| Firebase Authentication | Secure email/password auth with role-based access |

### Infrastructure & Deployment
| Technology | Purpose |
|------------|----------|
| Vercel | Single-project hosting — static SPA + Python serverless functions |
| Vercel Serverless | FastAPI routes served under `/api/*` |

---

## Project Structure

```
.
├── vercel.json                     # Single Vercel config (root)
├── backend/                        ← FastAPI (Python)
│   ├── main.py                     # App entry point
│   ├── models.py                   # Pydantic models
│   ├── store.py                    # Firestore data layer
│   ├── requirements.txt
│   ├── api/
│   │   └── index.py               # Vercel serverless entry
│   ├── routers/
│   │   ├── ingest.py              # File upload & processing
│   │   ├── recommendations.py     # Lifecycle recommendations
│   │   └── actions.py             # Action center
│   └── services/
│       ├── document_intelligence.py
│       └── openai_service.py
│
└── Frontend/                       ← React + Vite + TanStack (TypeScript)
    ├── src/
    │   ├── routes/                # Pages (dashboard, upload, login, etc.)
    │   ├── components/            # UI components
    │   └── lib/                   # API client, auth, utilities
    └── package.json
```

---

## Prerequisites

| Tool | Version |
|------|---------|
| Python | 3.11+ |
| Node.js | 18+ |
| npm / Bun | latest |

---

## Local Development

### 1. Clone the repository

```bash
git clone https://github.com/ImMansur/WOM-Lifecycle-Insight.git
cd WOM-Lifecycle-Insight
```

### 2. Backend setup

```bash
cd backend

# Create and activate virtual environment
python -m venv .venv

# Windows
.venv\Scripts\activate
# macOS / Linux
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

Create a `.env` file in `backend/` using `.env.example` as a reference:

```env
DOCUMENT_INTELLIGENCE_ENDPOINT=https://<resource>.cognitiveservices.azure.com/
DOCUMENT_INTELLIGENCE_KEY=<your-key>
DI_MODEL_ID=prebuilt-layout
DI_MAX_PAGES=500
DI_TIMEOUT_SECONDS=280

AZURE_OPENAI_ENDPOINT=https://<resource>.openai.azure.com/
AZURE_OPENAI_KEY=<your-key>
AZURE_OPENAI_DEPLOYMENT=gpt-4.1
AZURE_OPENAI_API_VERSION=2024-02-15-preview

FIREBASE_SERVICE_ACCOUNT_JSON=<json-string>
```

Start the backend:

```bash
uvicorn main:app --reload --port 8000
```

API docs → http://localhost:8000/docs

---

### 3. Frontend setup

```bash
cd Frontend
npm install
```

Create a `.env` file in `Frontend/` using `.env.example` as a reference:

```env
VITE_API_URL=http://localhost:8000

VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
```

Start the frontend:

```bash
npm run dev
```

App → http://localhost:5173

---

### 4. Run both together

Open two terminals:

```bash
# Terminal 1 — Backend
cd backend && .venv\Scripts\activate && uvicorn main:app --reload --port 8000

# Terminal 2 — Frontend
cd Frontend && npm run dev
```

---

## Deployment (Vercel)

Deploy as a **single Vercel project** from the repo root:

1. Import the repository on [vercel.com/new](https://vercel.com/new)
2. Leave **Root Directory** as `./` (default)
3. Vercel will auto-detect the `vercel.json` at the root
4. Set all environment variables (see below) in the Vercel dashboard
5. Click **Deploy**

**Environment variables to set in Vercel:**

```env
# Backend
DOCUMENT_INTELLIGENCE_ENDPOINT=
DOCUMENT_INTELLIGENCE_KEY=
DI_MODEL_ID=prebuilt-layout
DI_MAX_PAGES=500
DI_TIMEOUT_SECONDS=280
AZURE_OPENAI_ENDPOINT=
AZURE_OPENAI_KEY=
AZURE_OPENAI_DEPLOYMENT=gpt-4.1
AZURE_OPENAI_API_VERSION=2024-02-15-preview
FIREBASE_SERVICE_ACCOUNT_JSON=

# Frontend
VITE_API_URL=/
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
```

> **Note:** Set `VITE_API_URL` to `/` since the frontend and backend share the same domain.

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/recommendations` | Fetch all recommendations and summary stats |
| `POST` | `/api/ingest` | Upload files (`multipart/form-data`, field: `files`) |
| `GET` | `/api/actions` | Fetch all action tickets |
| `DELETE` | `/api/recommendations/{id}` | Delete a recommendation |
| `GET` | `/` | Health check / service info |

---

## How It Works

1. **Upload** — Drop one or more PDF / DOC / DOCX Certificate of Conformance files
2. **Extract** — Document Intelligence performs OCR and text extraction
3. **Parse** — AI Language Engine identifies customer, equipment, part numbers, serials, and dates
4. **Analyse** — The Lifecycle Engine applies the 5-year recertification rule to compute status and priority
5. **Act** — Results appear on the dashboard; high-priority items surface as action tickets

---

## License

MIT © 2026 Worldwide Oilfield Machine

---

## Author

**Mansur Javid**\
Built and maintained for Worldwide Oilfield Machine (WOM).\
🔗 [github.com/ImMansur](https://github.com/ImMansur)
