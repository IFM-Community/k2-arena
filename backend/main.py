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
        }

    def start_timer(self, seconds: int):
        self.is_timer_running = True
        self.question_timer = seconds
        self.timer_end = asyncio.get_event_loop().time() + seconds


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
        "total_questions": len(game.questions),
        "leaderboard": game.get_leaderboard(),
    }


@app.get("/")
async def get_root():
    # Try frontend/dist first (Railway builds here)
    static_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend", "dist")
    alt_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
    index_path = os.path.join(static_dir, "index.html")
    alt_index = os.path.join(alt_dir, "index.html")
    
    exists_dist = os.path.exists(index_path)
    exists_static = os.path.exists(alt_index)
    
    if exists_dist:
        return FileResponse(index_path)
    if exists_static:
        return FileResponse(alt_index)
    
    return HTMLResponse(f"""
    <h1>K2 Arena</h1>
    <p>Checking for index.html...</p>
    <p>frontend/dist/index.html exists: {exists_dist}</p>
    <p>backend/static/index.html exists: {exists_static}</p>
    <pre>{os.listdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))}</pre>
    """)


@sio.event
async def connect(sid, environ):
    print(f"Client connected: {sid}")
    if game.state == GameState.LOBBY:
        sio.emit("lobby_state", {"players": game.get_player_list(), "is_host": sid == game.host_sid})
    else:
        sio.emit("game_running_state", {
            "is_observer": True,
            "message": "Game in progress — you joined late, sit back and watch!",
            "current_question": game.get_current_question_for_player(),
            "leaderboard": game.get_leaderboard()
        })


@sio.event
async def join_lobby(sid, data):
    username = data.get("username", "Player").strip()[:20]
    if not username:
        username = "Player"
    
    is_new_player = sid not in game.players
    
    if game.state != GameState.LOBBY:
        game.players[sid] = Player(sid, username)
        game.players[sid].is_observer = True
        sio.emit("game_running", {
            "is_observer": True,
            "message": "Game in progress — you joined late, sit back and watch!",
            "current_question": game.get_current_question_for_player(),
            "leaderboard": game.get_leaderboard()
        }, to=sid)
        emit_to_all_except(sid, "player_joined", {"player": game.players[sid].to_dict(), "is_observer": True})
        return

    if is_new_player:
        game.players[sid] = Player(sid, username)
    
    player = game.players[sid]
    emit_to_all("lobby_update", {"players": game.get_player_list()})
    
    await sio.emit("lobby_joined", {"player": player.to_dict(), "is_host": sid == game.host_sid}, to=sid)


@sio.event
async def set_host(sid, data):
    if game.state != GameState.LOBBY:
        return
    game.host_sid = sid
    await sio.emit("host_set", {"host": game.players[sid].to_dict()}, to=sid)


@sio.event
async def start_game(sid, data):
    if sid != game.host_sid or game.state != GameState.LOBBY:
        return
    
    game.state = GameState.QUESTION
    game.current_question_index = 0
    game.seconds_per_question = data.get("seconds_per_question", 20)
    
    await sio.emit("game_started", {
        "current_question": game.get_current_question_for_player(),
        "total_questions": len(game.questions),
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
    
    answer = data.get("answer")
    if answer is None:
        return
    
    if player.sid in game.players:
        question = game.current_question
        if question is None:
            return
        
        if game.current_question_index not in player.answers:
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
    })
    
    game.current_question_index += 1
    game.state = GameState.RESULTS
    game.is_timer_running = False
    
    emit_to_all("state_changed", {"state": GameState.RESULTS.value})
    await sio.sleep(5)
    
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


def get_leaderboard():
    scored = [(p.username, p.score) for p in game.players.values() if not p.is_observer]
    scored.sort(key=lambda x: x[1], reverse=True)
    return [{"rank": i+1, "username": name, "score": score} for i, (name, score) in enumerate(scored)]


game.get_leaderboard = get_leaderboard


@sio.event
async def disconnect(sid):
    if sid in game.players:
        del game.players[sid]
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
        "total_questions": len(game.questions),
        "players": game.get_player_list(),
        "leaderboard": game.get_leaderboard(),
    }


@app.post("/api/reset-game")
async def reset_game():
    global game
    game = Game()
    sio.emit("game_reset", {})
    return {"status": "ok"}


@app.get("/{full_path:path}")
async def serve_spa(full_path: str):
    static_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
    if not os.path.exists(static_dir):
        project_root = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend", "dist")
        if os.path.exists(project_root):
            static_dir = project_root
    index_path = os.path.join(static_dir, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return HTMLResponse("<h1>Not Found</h1>", status_code=404)


if __name__ == "__main__":
    static_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
    if not os.path.exists(static_dir):
        project_root = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend", "dist")
        if os.path.exists(project_root):
            static_dir = project_root
    if os.path.exists(static_dir):
        app.mount("/static", StaticFiles(directory=static_dir), name="static")
    uvicorn.run(sio_app, host="0.0.0.0", port=8000)