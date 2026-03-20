import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent / "waitlist.db"

def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with get_connection() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS waitlist_leads (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL UNIQUE,
                name TEXT DEFAULT '',
                phone TEXT DEFAULT '',
                company TEXT DEFAULT '',
                role TEXT DEFAULT '',
                consent INTEGER NOT NULL DEFAULT 0,
                honeypot TEXT DEFAULT '',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.commit()