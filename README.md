# WOM Lifecycle Insight

Processes Certificates of Conformance (PDF / DOC / DOCX) through **Azure Document Intelligence** and **Azure OpenAI GPT-4.1** to generate proactive lifecycle and recertification recommendations.

---

## Project structure

```
frontend/
├── backend/               ← FastAPI (Python)
│   ├── main.py
│   ├── models.py
│   ├── store.py
│   ├── requirements.txt
│   ├── .env
│   ├── routers/
│   │   ├── ingest.py
│   │   └── recommendations.py
│   └── services/
│       ├── document_intelligence.py
│       └── openai_service.py
└── lifecycle-insight/     ← React + Vite + TanStack (TypeScript)
    ├── src/
    ├── .env
    └── package.json
```

---

## Requirements

| Tool | Minimum version |
|------|----------------|
| Python | 3.11+ |
| Node.js | 18+ |
| Bun *(optional, faster installs)* | 1.x |

---

## 1 — Backend (FastAPI)

### Install

```bash
cd backend

# create a virtual environment
python -m venv .venv

# activate it
# Windows
.venv\Scripts\activate
# macOS / Linux
source .venv/bin/activate

# install dependencies
pip install -r requirements.txt
```

### Environment variables

The `.env` file is already populated with your Azure keys:

```
DOCUMENT_INTELLIGENCE_ENDPOINT=https://ocr-ey.cognitiveservices.azure.com/
DOCUMENT_INTELLIGENCE_KEY=...
DI_MODEL_ID=prebuilt-layout

AZURE_OPENAI_ENDPOINT=https://ruthv-mk14bf4j-eastus2.openai.azure.com/
AZURE_OPENAI_KEY=...
AZURE_OPENAI_DEPLOYMENT=gpt-4.1
AZURE_OPENAI_API_VERSION=2024-02-15-preview
```

### Run

```bash
uvicorn main:app --reload --port 8000
```

Interactive API docs → http://localhost:8000/docs

---

## 2 — Frontend (React + Vite)

### Install

```bash
cd lifecycle-insight
npm install
# or if you use Bun:
bun install
```

### Environment variables

`lifecycle-insight/.env` is already set:

```
VITE_API_URL=http://localhost:8000
```

### Run

```bash
npm run dev
# or
bun run dev
```

App → http://localhost:5173

---

## Running both at the same time

Open **two terminals**:

**Terminal 1 — backend**
```bash
cd backend
.venv\Scripts\activate
uvicorn main:app --reload --port 8000
```

**Terminal 2 — frontend**
```bash
cd lifecycle-insight
npm run dev
```

Then open http://localhost:5173 in your browser.

---

## How it works

1. Click **Ingest** in the top-right corner of the app.
2. Drop or select one or more **PDF / DOC / DOCX** Certificate of Conformance files.
3. Click **Process files**.
4. The backend:
   - Extracts text with **Azure Document Intelligence** (OCR for scanned PDFs).
   - Sends the text to **GPT-4.1** which pulls out customer, sales order, equipment, part numbers, serials, and certificate date.
   - Applies a **5-year recertification rule** to compute lifecycle status and priority.
5. Results appear instantly in the dashboard table.

---

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/recommendations` | All stored recommendations + summary stats |
| `POST` | `/api/ingest` | Upload files (`multipart/form-data`, field `files`) |
| `DELETE` | `/api/recommendations/{id}` | Remove a single recommendation |
| `GET` | `/api/health` | Health check |
