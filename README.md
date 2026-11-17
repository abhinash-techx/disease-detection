# PhytoVision AI — Plant Leaf Validation & Disease Assistant

This package preserves the original PhytoVision AI page structure and visual styling while separating HTML, CSS, JavaScript and the backend.

## Important model/configuration note
The original uploaded file did **not** contain a trained MobileNetV4 model. Its browser classifier was a colour/HSV heuristic and its bundled ONNX export file was only a random-weight demonstration stub. This package does not pretend that stub is trained.

This version uses Gemini Vision on the backend for two stages in one request:
1. Verify whether the image actually contains a recognizable plant leaf.
2. Only for a valid leaf, return a cautious disease assessment and bilingual English/Hindi report data.

Non-leaf or uncertain images are rejected, and no disease prediction is produced. A vision API key is required; the app fails closed if it is missing.

## Folder structure
- `index.html` — original UI markup, unchanged layout
- `css/style.css` — original embedded CSS, separated
- `js/app.js` — upload, validation UX, API calls, result, history and bilingual report
- `backend/main.py` — FastAPI API and image validation
- `backend/.env.example` — API key configuration template
- `netlify.toml` — static frontend deployment settings

## Run locally (Windows)
1. Install Python 3.10+.
2. Open a terminal in this project folder.
3. Create and activate a virtual environment:
   ```powershell
   py -m venv .venv
   .venv\Scripts\activate
   ```
4. Install backend dependencies:
   ```powershell
   pip install -r backend/requirements.txt
   ```
5. Copy `backend/.env.example` to `backend/.env` and add your Gemini API key.
6. Start the backend:
   ```powershell
   cd backend
   uvicorn main:app --reload --port 8000
   ```
7. In another terminal, from the project root, serve the frontend:
   ```powershell
   py -m http.server 5500
   ```
8. Open `http://localhost:5500`.

The browser calls `http://localhost:8000` by default. For a different API host, set `window.PHYTOVISION_API_URL` before loading `js/app.js`.

## Netlify deployment
Netlify can host the static frontend in this package, but it cannot run this FastAPI server as-is. Deploy the FastAPI backend separately to a Python ASGI host (for example, a service that supports Uvicorn), set `GEMINI_API_KEY` there, and set the frontend API URL to that backend origin.

For production, configure `CORS_ORIGINS` to the exact Netlify site origin, e.g. `https://your-site.netlify.app`. Do not put the Gemini key in frontend JavaScript or Netlify public variables.

## Report
The report opens a print-ready page containing both English and Hindi. Choose **Save as PDF** in the browser print dialog. Hindi rendering depends on a system/browser font with Devanagari support.

## Limitations
- Gemini's visual confidence and severity values are estimates, not calibrated probabilities or lab measurements.
- Similar-looking diseases can be confused. Use a local agriculture expert or lab for confirmation.
- The backend sends the uploaded image to the configured Gemini API for analysis; do not upload private or sensitive images.
- API usage may incur charges or be subject to provider quotas.
