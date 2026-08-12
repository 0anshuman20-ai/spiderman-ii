from fastapi import FastAPI, APIRouter, HTTPException, Query
from fastapi.responses import Response
from dotenv import load_dotenv
import edge_tts
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional
import uuid
from datetime import datetime, timezone


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI(title="COSMIC WEAVER STUDIO API")
api_router = APIRouter(prefix="/api")


class TakeCreate(BaseModel):
    name: str
    transmission: Optional[int] = None
    world: Optional[str] = None
    duration: float = 0
    size: int = 0
    mime: str = "video/webm"


class Take(TakeCreate):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class ProgressToggle(BaseModel):
    recorded: bool


@api_router.get("/")
async def root():
    return {"message": "COSMIC WEAVER STUDIO ONLINE", "status": "transmitting"}


# THE ONE VOICE — locked server-side so every take carries the same narrator.
# Brian is the youngest-reading keyless neural US male; pushed faster and
# brighter he reads as "wired teenage hero", never "news anchor".
TTS_VOICE = "en-US-BrianMultilingualNeural"
TTS_RATE = "+14%"
TTS_PITCH = "+18Hz"


@api_router.get("/tts")
async def tts(text: str = Query(..., min_length=1, max_length=600)):
    """Synthesize one script line as MP3 with the locked studio voice."""
    try:
        communicate = edge_tts.Communicate(text.strip(), TTS_VOICE, rate=TTS_RATE, pitch=TTS_PITCH)
        chunks = []
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                chunks.append(chunk["data"])
        audio = b"".join(chunks)
        if len(audio) < 200:
            raise ValueError("empty audio")
        return Response(content=audio, media_type="audio/mpeg",
                        headers={"Cache-Control": "no-store"})
    except Exception as err:
        raise HTTPException(status_code=502, detail=f"tts relay failed: {err}")


@api_router.post("/takes", response_model=Take)
async def create_take(payload: TakeCreate):
    take = Take(**payload.model_dump())
    await db.takes.insert_one(take.model_dump())
    return take


@api_router.get("/takes", response_model=List[Take])
async def list_takes():
    docs = await db.takes.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return docs


@api_router.delete("/takes/{take_id}")
async def delete_take(take_id: str):
    res = await db.takes.delete_one({"id": take_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="take not found")
    return {"deleted": take_id}


@api_router.get("/progress")
async def get_progress():
    docs = await db.script_progress.find({}, {"_id": 0}).to_list(100)
    return {str(d["number"]): d["recorded"] for d in docs}


@api_router.post("/progress/{number}")
async def set_progress(number: int, payload: ProgressToggle):
    await db.script_progress.update_one(
        {"number": number},
        {"$set": {"number": number, "recorded": payload.recorded,
                  "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    return {"number": number, "recorded": payload.recorded}


@api_router.get("/stats")
async def stats():
    take_count = await db.takes.count_documents({})
    recorded = await db.script_progress.count_documents({"recorded": True})
    pipeline = [{"$group": {"_id": None, "total": {"$sum": "$duration"}}}]
    agg = await db.takes.aggregate(pipeline).to_list(1)
    total_dur = agg[0]["total"] if agg else 0
    return {"takes": take_count, "scriptsRecorded": recorded, "totalDuration": total_dur}


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
