import json
import os
import asyncio
from datetime import datetime
from typing import Dict, Optional
from enum import Enum
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse
import os
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
import socketio
import uvicorn
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="K2 Arena")
sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins="*", ping_timeout=60, ping_interval=25)
sio_app = socketio.ASGIApp(sio, app)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class GameState(str, Enum):
    LOBBY = "lobby"
    QUESTION = "question"
    RESULTS = "results"
    FINISHED = "finished"


class Player:
    def __init__(self, sid: str, username: str):
        self.sid = sid
        self.username = username
        self.score = 0
        self.answers: Dict[int, int] = {}
        self.is_observer = False
        self.joined_at = datetime.now()

    def to_dict(self):
        return {
            "username": self.username,
            "score": self.score,
            "is_observer": self.is_observer,
        }


class Question:
    def __init__(self, data: dict):
        self.id = data["id"]
        self.question = data["question"]
        self.options = data["options"]
        self.correct_answer = data["correct_answer"]
        self.max_points = data["max_points"]
        self.explanation = data.get("explanation", "")
        self.is_tutorial = data.get("is_tutorial", False)


class Game:
    def __init__(self):
        self.state = GameState.LOBBY
        self.players: Dict[str, Player] = {}
        self.current_question_index = 0
        self.questions: list[Question] = []
        self.question_timer: Optional[int] = None
        self.timer_end: Optional[float] = None
        self.is_timer_running = False
        self.host_sid: Optional[str] = None
        self.seconds_per_question = 20
        self._load_questions()

    def _load_questions(self):
        import os
        base_dir = os.path.dirname(os.path.abspath(__file__))
        questions_path = os.path.join(base_dir, "questions.json")
        with open(questions_path, "r") as f:
            data = json.load(f)
            self.questions = [Question(q) for q in data]

    @property
    def real_question_count(self) -> int:
        return len(self.questions) - 1

    @property
    def current_question(self) -> Optional[Question]:
        if 0 <= self.current_question_index < len(self.questions):
            return self.questions[self.current_question_index]
        return None

    def get_player_list(self):
        return [p.to_dict() for p in self.players.values() if not p.is_observer]

    def get_observer_list(self):
        return [p.to_dict() for p in self.players.values() if p.is_observer]

    def get_current_question_for_player(self) -> Optional[dict]:
        if self.state != GameState.QUESTION or self.current_question is None:
            return None
        return {
            "id": self.current_question.id,
            "question": self.current_question.question,
            "options": self.current_question.options,
            "max_points": self.current_question.max_points,
            "is_tutorial": self.current_question.is_tutorial,
        }

    def start_timer(self, seconds: int):
        self.is_timer_running = True
        self.question_timer = seconds
        self.timer_end = asyncio.get_event_loop().time() + seconds

    def get_leaderboard(self):
        scored = [(p.username, p.score) for p in self.players.values() if not p.is_observer]
        scored.sort(key=lambda x: x[1], reverse=True)
        return [{"rank": i + 1, "username": name, "score": score} for i, (name, score) in enumerate(scored)]

    def get_answer_counts(self, question_index: int):
        counts = [0, 0, 0, 0]
        for p in self.players.values():
            if p.is_observer:
                continue
            answer = p.answers.get(question_index)
            if answer and 0 <= answer["option"] < len(counts):
                counts[answer["option"]] += 1
        return counts


game = Game()


def emit_to_all(event: str, data: dict):
    asyncio.create_task(sio.emit(event, data))


def emit_to_all_except(sid: str, event: str, data: dict):
    asyncio.create_task(sio.emit(event, data, skip_sid=sid))


def get_emissions_for_host() -> dict:
    return {
        "players": game.get_player_list(),
        "observers": game.get_observer_list(),
        "state": game.state.value,
        "current_question": game.get_current_question_for_player() if game.state == GameState.QUESTION else None,
        "question_timer": game.question_timer if game.state == GameState.QUESTION else None,
        "current_question_index": game.current_question_index,
        "total_questions": game.real_question_count,
        "leaderboard": game.get_leaderboard(),
    }


@app.get("/")
async def get_root():
    # Try root level dist first (Railway copies here)
    static_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "dist")
    alt_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend", "dist")
    alt_static = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
    index_path = os.path.join(static_dir, "index.html")
    alt_index = os.path.join(alt_dir, "index.html")
    alt_static_index = os.path.join(alt_static, "index.html")
    
    if os.path.exists(index_path):
        return FileResponse(index_path)
    if os.path.exists(alt_index):
        return FileResponse(alt_index)
    if os.path.exists(alt_static_index):
        return FileResponse(alt_static_index)
    
    return HTMLResponse("""<h1>K2 Arena</h1><p>Looking for built frontend...</p>""")


@sio.event
async def connect(sid, environ):
    print(f"Client connected: {sid}")
    if game.state == GameState.LOBBY:
        await sio.emit("lobby_state", {
            "players": game.get_player_list(),
            "is_host": sid == game.host_sid,
            "room_exists": game.host_sid is not None,
        }, to=sid)
    else:
        await sio.emit("game_running_state", {
            "is_observer": True,
            "message": "Game in progress: you joined late, sit back and watch!",
            "current_question": game.get_current_question_for_player(),
            "leaderboard": game.get_leaderboard()
        }, to=sid)


@sio.event
async def join_lobby(sid, data):
    username = data.get("username", "Player").strip()[:20]
    if not username:
        username = "Player"
    
    is_new_player = sid not in game.players
    
    if game.state != GameState.LOBBY:
        game.players[sid] = Player(sid, username)
        game.players[sid].is_observer = True
        await sio.emit("game_running", {
            "is_observer": True,
            "message": "Game in progress: you joined late, sit back and watch!",
            "current_question": game.get_current_question_for_player(),
            "leaderboard": game.get_leaderboard()
        }, to=sid)
        emit_to_all_except(sid, "player_joined", {"player": game.players[sid].to_dict(), "is_observer": True})
        return

    if is_new_player:
        game.players[sid] = Player(sid, username)
        # Assign host automatically if no host set yet
        if game.host_sid is None:
            game.host_sid = sid
    
    player = game.players[sid]
    is_host = sid == game.host_sid
    
    emit_to_all("lobby_update", {"players": game.get_player_list()})
    await sio.emit("lobby_joined", {"player": player.to_dict(), "is_host": is_host, "room_exists": True}, to=sid)


@sio.event
async def start_game(sid, data):
    if sid != game.host_sid or game.state != GameState.LOBBY:
        return
    
    game.state = GameState.QUESTION
    game.current_question_index = 0
    game.seconds_per_question = data.get("seconds_per_question", 20)
    
    await sio.emit("game_started", {
        "current_question": game.get_current_question_for_player(),
        "total_questions": game.real_question_count,
        "seconds_per_question": game.seconds_per_question,
    })
    
    emit_to_all("state_changed", {"state": GameState.QUESTION.value})
    await start_question_timer()


async def start_question_timer():
    if game.current_question_index >= len(game.questions):
        return
    
    game.start_timer(game.seconds_per_question)
    await sio.emit("timer_started", {"seconds": game.seconds_per_question})
    
    async def timer_tick():
        while game.is_timer_running and game.question_timer > 0:
            await asyncio.sleep(0.1)
            remaining = max(0, int(asyncio.get_event_loop().time() - game.timer_end) * -1)
            game.question_timer = remaining if remaining <= game.seconds_per_question else game.question_timer
            
        if game.question_timer <= 0:
            game.is_timer_running = False
            await end_question()
    
    asyncio.create_task(timer_tick())


@sio.event
async def submit_answer(sid, data):
    if game.state != GameState.QUESTION or game.is_timer_running is False:
        return

    player = game.players.get(sid)
    if not player or player.is_observer:
        return

    question = game.current_question
    if question is None:
        return

    # Undo any previous selection's points for this question so re-picking
    # or unselecting doesn't double-count.
    previous = player.answers.get(game.current_question_index)
    if previous:
        player.score -= previous["points"]

    answer = data.get("answer")
    if answer is None:
        # Unselecting: clear their answer for this question entirely.
        player.answers.pop(game.current_question_index, None)
        emit_to_all("answer_submitted", {
            "player": player.to_dict(),
            "question_id": game.current_question_index,
            "points": None,
        })
        return

    time_fraction = game.question_timer / game.seconds_per_question if game.seconds_per_question > 0 else 0
    points = int(question.max_points * max(0.1, time_fraction))

    if answer == question.correct_answer:
        player.score += points
    else:
        points = 0

    player.answers[game.current_question_index] = {
        "option": answer,
        "correct": answer == question.correct_answer,
        "points": points,
        "time_remaining": game.question_timer,
    }

    emit_to_all("answer_submitted", {
        "player": player.to_dict(),
        "question_id": game.current_question_index,
        "points": points,
    })


async def end_question():
    if game.state != GameState.QUESTION:
        return

    emit_to_all("question_ended", {
        "correct_answer": game.current_question.correct_answer if game.current_question else None,
        "leaderboard": game.get_leaderboard(),
        "answer_counts": game.get_answer_counts(game.current_question_index),
    })

    game.current_question_index += 1
    game.state = GameState.RESULTS
    game.is_timer_running = False

    emit_to_all("state_changed", {"state": GameState.RESULTS.value})


@sio.event
async def advance_question(sid, data):
    if sid != game.host_sid or game.state != GameState.RESULTS:
        return

    if game.current_question_index < len(game.questions):
        game.state = GameState.QUESTION
        emit_to_all("state_changed", {"state": GameState.QUESTION.value})
        await sio.emit("next_question", {
            "current_question": game.get_current_question_for_player(),
            "question_index": game.current_question_index,
        })
        await start_question_timer()
    else:
        game.state = GameState.FINISHED
        emit_to_all("state_changed", {"state": GameState.FINISHED.value})
        emit_to_all("game_finished", {
            "leaderboard": game.get_leaderboard(),
            "winner": find_winner()
        })


def find_winner():
    if not game.players:
        return None
    scored = [(p.username, p.score) for p in game.players.values() if not p.is_observer]
    if not scored:
        return None
    scored.sort(key=lambda x: x[1], reverse=True)
    return {"username": scored[0][0], "score": scored[0][1]}


@sio.event
async def disconnect(sid):
    global game
    if sid in game.players:
        was_host = sid == game.host_sid
        del game.players[sid]
        if was_host:
            # Host leaving ends the session entirely: reset the game so
            # everyone has to rejoin and a new host gets assigned.
            game = Game()
            await sio.emit("game_reset", {})
        else:
            emit_to_all("player_left", {"sid": sid})
    print(f"Client disconnected: {sid}")


@app.get("/api/players")
async def get_players():
    return {"players": game.get_player_list(), "observers": game.get_observer_list()}


@app.get("/api/game-state")
async def get_game_state():
    return {
        "state": game.state.value,
        "current_question": game.get_current_question_for_player() if game.state == GameState.QUESTION else None,
        "question_timer": game.question_timer if game.state == GameState.QUESTION else None,
        "current_question_index": game.current_question_index,
        "total_questions": game.real_question_count,
        "players": game.get_player_list(),
        "leaderboard": game.get_leaderboard(),
    }


@app.post("/api/reset-game")
async def reset_game():
    global game
    game = Game()
    await sio.emit("game_reset", {})
    return {"status": "ok"}


# ---- Static file serving ----
# Resolve frontend build directory (same fallback order as get_root())
def _resolve_static_dir():
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    candidates = [
        os.path.join(project_root, "dist"),
        os.path.join(project_root, "frontend", "dist"),
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "static"),
    ]
    for d in candidates:
        if os.path.exists(d):
            return d
    return None

_static_dir = _resolve_static_dir()
if _static_dir:
    _assets_dir = os.path.join(_static_dir, "assets")
    if os.path.exists(_assets_dir):
        app.mount("/assets", StaticFiles(directory=_assets_dir, html=False), name="assets")
    # Mount individual files at root level (vite.svg, etc.) that live alongside index.html
    for fname in os.listdir(_static_dir):
        fpath = os.path.join(_static_dir, fname)
        if os.path.isfile(fpath) and fpath.endswith(".svg"):
            app.mount(f"/{fname}", StaticFiles(directory=_static_dir, html=False), name=f"static-{fname}")

# ---- SPA catch-all (must come AFTER static mounts so they take priority) ----
@app.get("/{full_path:path}")
async def serve_spa(full_path: str):
    if not _static_dir:
        return HTMLResponse("<h1>Not Found</h1>", status_code=404)
    # Only serve index.html for actual page routes (no file extension)
    if "." not in full_path.split("/")[-1]:
        index_path = os.path.join(_static_dir, "index.html")
        if os.path.exists(index_path):
            return FileResponse(index_path)
    # Otherwise 404
    return HTMLResponse("<h1>Not Found</h1>", status_code=404)