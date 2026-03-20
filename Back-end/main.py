from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routes.waitlist import router as waitlist_router

app = FastAPI(title="Klaedon API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # loosened for local testing
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(waitlist_router)

@app.get("/")
def root():
    return {"status": "ok"}

@app.get("/api/health")
def health():
    return {"status": "healthy"}