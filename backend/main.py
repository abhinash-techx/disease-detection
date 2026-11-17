
import base64
import json
import os
import re
import uuid
from io import BytesIO
from typing import Any

import requests
from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, UnidentifiedImageError

load_dotenv(
    dotenv_path=os.path.join(os.path.dirname(__file__), ".env"),
    override=True
)

app = FastAPI(title="PhytoVision AI API", version="3.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        origin.strip()
        for origin in os.getenv("CORS_ORIGINS", "http://localhost:5500").split(",")
        if origin.strip()
    ],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

MAX_IMAGE_BYTES = 5 * 1024 * 1024
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "").strip()
ALLOWED_MIME = {"image/jpeg", "image/png", "image/webp"}

GROQ_MODEL = os.getenv("GROQ_MODEL", "qwen/qwen3.8-27b")
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"


@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "PhytoVision AI",
        "vision_model": GROQ_MODEL,
        "provider": "Groq",
        "configured": bool(GROQ_API_KEY)
    }


def extract_json(text: str) -> dict[str, Any]:
    cleaned = text.strip()
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
    cleaned = re.sub(r"\s*```$", "", cleaned)

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", cleaned, re.S)

        if not match:
            raise ValueError("The vision model returned invalid JSON.")

        return json.loads(match.group(0))


def analyze_with_groq(image_bytes: bytes, mime_type: str) -> dict[str, Any]:

    api_key = GROQ_API_KEY

    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="GROQ_API_KEY is not configured. Add it to backend/.env."
        )

    prompt = """
You are a cautious plant-leaf image validation and plant disease assistant.

FIRST: Determine whether the main visible subject is clearly a real plant leaf.

A shoe, blanket, person, animal, vehicle, food, flower-only image,
landscape, soil-only image, or unrelated object is NOT a plant leaf.

If uncertain, blurry, too distant, mostly occluded, or no identifiable
leaf is visible, set is_leaf=false.

Never generate a plant disease prediction for a non-leaf image.

Return ONLY one valid JSON object with this exact structure:

{
 "is_leaf": true,
 "detected_object": "short object description",
 "disease_name": "disease name or Healthy Leaf",
 "disease_name_hi": "Hindi disease name",
 "scientific_name": "scientific name or Not applicable",
 "description": "English explanation",
 "description_hi": "Hindi explanation",
 "confidence": 0,
 "severity": 0,
 "severity_level": "Low",
 "severity_level_hi": "कम",
 "severity_note": "English severity caveat",
 "affected_crop": "crop or Unknown",
 "causal_organism": "organism or Unknown",
 "common_season": "season/conditions",
 "impact": "likely impact",
 "prevention": "prevention advice",
 "treatment_en": ["English practical suggestion"],
 "treatment_hi": ["हिन्दी में सुझाव"]
}

For is_leaf=false:
- disease_name = "Not a plant leaf"
- disease_name_hi = "यह पौधे की पत्ती नहीं है"
- scientific_name = "Not applicable"
- confidence = 0
- severity = 0
- severity_level = "Low"
- severity_level_hi = "लागू नहीं"
- Describe the visible object in detected_object.
- Use empty treatment arrays.
- Do not include any disease diagnosis.

For a valid leaf:
- Classify only when visual evidence supports it.
- If no disease signs are visible, use Healthy Leaf.
- Confidence and severity are rough visual estimates from 0 to 100.
- Use clear, concise Hindi and English.
- Do not prescribe exact pesticide doses or unsafe chemical mixing.
- Mention look-alike conditions when relevant.
- Never claim laboratory-confirmed certainty.
"""


    base64_image = base64.b64encode(image_bytes).decode("utf-8")

    payload = {
        "model": GROQ_MODEL,
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": prompt
                    },
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:{mime_type};base64,{base64_image}"
                        }
                    }
                ]
            }
        ],
        "temperature": 0.2,
        "max_completion_tokens": 1800,
        "response_format": {
            "type": "json_object"
        }
    }

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }

    try:
        response = requests.post(
            GROQ_URL,
            headers=headers,
            json=payload,
            timeout=(15, 120)
        )

    except requests.Timeout as exc:
        raise HTTPException(
            status_code=504,
            detail="Groq Vision API timed out. Please retry."
        ) from exc

    except requests.RequestException as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Groq API connection failed: {str(exc)}"
        ) from exc

    if response.status_code != 200:

        try:
            error_data = response.json()
            message = error_data.get("error", {}).get(
                "message", response.text
            )
        except Exception:
            message = response.text

        raise HTTPException(
            status_code=502,
            detail=f"Groq Vision API error ({response.status_code}): {message}"
        )

    try:
        response_data = response.json()
        output_text = response_data["choices"][0]["message"]["content"]
        result = extract_json(output_text)

    except (KeyError, IndexError, TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=502,
            detail="Groq returned an unreadable response. Please retry."
        ) from exc

    if "is_leaf" not in result or "detected_object" not in result:
        raise HTTPException(
            status_code=502,
            detail="AI response is missing image validation fields."
        )

    if not result["is_leaf"]:

        return {
            "is_leaf": False,
            "detected_object": str(
                result.get("detected_object") or "Unrecognized object"
            )[:120],
            "disease_name": "Not a plant leaf",
            "disease_name_hi": "यह पौधे की पत्ती नहीं है",
            "scientific_name": "Not applicable",
            "description": (
                "This image does not show a recognizable plant leaf. "
                "Disease analysis was not performed."
            ),
            "description_hi": (
                "इस तस्वीर में पहचानने योग्य पौधे की पत्ती नहीं दिख रही है। "
                "इसलिए रोग की जाँच नहीं की गई।"
            ),
            "confidence": 0,
            "severity": 0,
            "severity_level": "Low",
            "severity_level_hi": "लागू नहीं",
            "severity_note": "Upload a clear close-up image of a plant leaf.",
            "affected_crop": "Unknown",
            "causal_organism": "Unknown",
            "common_season": "Not applicable",
            "impact": "Not applicable",
            "prevention": "Upload a clear plant leaf image.",
            "treatment_en": [],
            "treatment_hi": []
        }

    def as_list(value):
        if not isinstance(value, list):
            return []

        return [str(item)[:400] for item in value[:10]]

    try:
        confidence = max(
            0, min(100, float(result.get("confidence", 0)))
        )
        severity = max(
            0, min(100, float(result.get("severity", 0)))
        )
    except (TypeError, ValueError):
        confidence, severity = 0, 0

    result.update({
        "is_leaf": True,
        "report_id": "PVA-" + uuid.uuid4().hex[:10].upper(),
        "confidence": round(confidence, 1),
        "severity": round(severity, 1),
        "severity_level": (
            "Low" if severity <= 30
            else "Medium" if severity <= 70
            else "High"
        ),
        "treatment_en": as_list(result.get("treatment_en")),
        "treatment_hi": as_list(result.get("treatment_hi"))
    })

    string_fields = [
        "disease_name",
        "disease_name_hi",
        "scientific_name",
        "description",
        "description_hi",
        "severity_note",
        "affected_crop",
        "causal_organism",
        "common_season",
        "impact",
        "prevention"
    ]

    for field in string_fields:
        result[field] = str(
            result.get(field) or "Not available"
        )[:2000]

    result.setdefault(
        "severity_level_hi",
        "कम" if severity <= 30
        else "मध्यम" if severity <= 70
        else "अधिक"
    )

    return result


@app.post("/api/analyze")
async def analyze(file: UploadFile = File(...)):

    if file.content_type not in ALLOWED_MIME:
        raise HTTPException(
            status_code=415,
            detail="Only JPG, PNG and WEBP images are supported."
        )

    image_bytes = await file.read(MAX_IMAGE_BYTES + 1)

    if len(image_bytes) > MAX_IMAGE_BYTES:
        raise HTTPException(
            status_code=413,
            detail="Image exceeds the 5MB limit."
        )

    try:
        image = Image.open(BytesIO(image_bytes))
        image.verify()

        image = Image.open(BytesIO(image_bytes))
        width, height = image.size

        if width < 96 or height < 96:
            raise HTTPException(
                status_code=400,
                detail="Image resolution is too small."
            )

        if width * height > 25_000_000:
            raise HTTPException(
                status_code=413,
                detail="Image dimensions are too large."
            )

    except UnidentifiedImageError as exc:
        raise HTTPException(
            status_code=400,
            detail="The uploaded file is not a valid image."
        ) from exc

    except OSError as exc:
        raise HTTPException(
            status_code=400,
            detail="The image file is damaged or unreadable."
        ) from exc

    return analyze_with_groq(image_bytes, file.content_type)
