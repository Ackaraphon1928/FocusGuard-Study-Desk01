"""Small durable local time-series store; no cloud dependency."""

import json
import sqlite3
import threading
from pathlib import Path


class Store:
    def __init__(self, path: str = ":memory:"):
        if path != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(path, check_same_thread=False)
        self.connection.row_factory = sqlite3.Row
        self.lock = threading.RLock()
        with self.lock, self.connection:
            self.connection.executescript("""
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS samples (id INTEGER PRIMARY KEY, ts REAL NOT NULL, mode TEXT NOT NULL, session_id TEXT, data TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS samples_ts ON samples(ts);
                CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, ts REAL NOT NULL, data TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, ts REAL NOT NULL, data TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS events_ts ON events(ts);
            """)

    def settings(self):
        with self.lock:
            row = self.connection.execute("SELECT data FROM settings WHERE id=1").fetchone()
        return json.loads(row[0]) if row else {}

    def save_settings(self, settings):
        with self.lock, self.connection:
            self.connection.execute("INSERT INTO settings VALUES(1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data", (json.dumps(settings),))

    def sample(self, timestamp, mode, session_id, data):
        with self.lock, self.connection:
            self.connection.execute("INSERT INTO samples(ts,mode,session_id,data) VALUES(?,?,?,?)", (timestamp, mode, session_id, json.dumps(data)))

    def save_session(self, session, timestamp):
        with self.lock, self.connection:
            self.connection.execute("INSERT INTO sessions VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data", (session["id"], timestamp, json.dumps(session)))

    def save_event(self, event, timestamp):
        with self.lock, self.connection:
            self.connection.execute("INSERT INTO events VALUES(?,?,?)", (event["id"], timestamp, json.dumps(event)))

    def history(self, since=0.0, limit=10000, mode=None):
        with self.lock:
            rows = self.connection.execute("SELECT data FROM (SELECT ts,data FROM samples WHERE ts>=? AND (? IS NULL OR mode=?) ORDER BY ts DESC LIMIT ?) ORDER BY ts", (since, mode, mode, limit)).fetchall()
        return [json.loads(row[0]) for row in rows]

    def sessions(self, limit=200, mode=None):
        with self.lock:
            rows = self.connection.execute("SELECT data FROM sessions WHERE (? IS NULL OR json_extract(data,'$.mode')=?) ORDER BY ts DESC LIMIT ?", (mode, mode, limit)).fetchall()
        return [json.loads(row[0]) for row in rows]

    def get_session(self, session_id):
        with self.lock:
            row = self.connection.execute("SELECT data FROM sessions WHERE id=?", (session_id,)).fetchone()
        return json.loads(row[0]) if row else None

    def events(self, limit=200, mode=None):
        with self.lock:
            rows = self.connection.execute("SELECT data FROM events WHERE (? IS NULL OR json_extract(data,'$.mode')=?) ORDER BY ts DESC, rowid DESC LIMIT ?", (mode, mode, limit)).fetchall()
        data = [json.loads(row[0]) for row in rows]
        for event in data:
            event.setdefault("mode", "unknown")
        return data

    def latest_event_cursor(self):
        with self.lock:
            return self.connection.execute("SELECT COALESCE(MAX(rowid),0) FROM events").fetchone()[0]

    def events_after(self, cursor=0, limit=500):
        """Ordered internal outbox cursor; public event IDs remain opaque UUIDs."""
        with self.lock:
            rows = self.connection.execute("SELECT rowid,data FROM events WHERE rowid>? ORDER BY rowid LIMIT ?", (cursor, limit)).fetchall()
        return [(row[0], json.loads(row[1])) for row in rows]

    def prune(self, before):
        with self.lock, self.connection:
            self.connection.execute("DELETE FROM samples WHERE ts<?", (before,))

    def close(self):
        with self.lock:
            self.connection.close()
