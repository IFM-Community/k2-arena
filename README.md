# K2 Arena

A real-time multiplayer trivia web app for up to 30 players, testing what you know about IFM (Institute of Foundation Models).

## Features

- **No room codes needed**: anyone with the URL can join
- **Single game session**: only one game runs at a time
- **Real-time multiplayer** via Socket.io
- **Tutorial question** followed by 10 rounds of IFM-themed trivia
- **Timer-based scoring**: faster correct answers earn more points
- **Observer mode** for late joiners
- **Mobile-friendly**: players can join on their phones

## Tech Stack

- **Frontend**: React + Vite
- **Backend**: FastAPI + Python-Socketio
- **Realtime**: WebSocket connections
- **Deploy**: Railway

## Quick Start

### Local Development

1. **Start the backend**:
   ```bash
   cd backend
   pip install -r requirements.txt
   python main.py
   ```
   The backend runs on `http://localhost:8000`

2. **Start the frontend** (in a new terminal):
   ```bash
   cd frontend
   npm install
   npm run dev
   ```
   The frontend runs on `http://localhost:5173`

3. **Open the app**: the lobby opens at `http://localhost:5173`

### How to Play

1. **Host**: First player to join becomes the host (you can also manually set as host)
2. **Players join**: Other players enter their names and join
3. **Start game**: Host clicks "Start Game" to begin
4. **Answer questions**: 10 IFM-themed questions with 4 options each
5. **Winner crowned**: Full leaderboard shown at the end

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `VITE_SOCKET_URL` | Backend URL for Socket.io | `wss://your-app.up.railway.app` |

Copy `.env.example` to `.env` in the frontend directory and update with your deployment URL.

## Railway Deployment

1. Push code to GitHub
2. Create new project on Railway at [railway.app](https://railway.app)
3. Connect your GitHub repository
4. Railway auto-detects the configuration

The app will be deployed at your Railway domain.

## Project Structure

```
k2-arena/
├── backend/
│   ├── main.py          # FastAPI + Socket.io server
│   ├── questions.json   # 10 IFM quiz questions
│   ├── requirements.txt # Python dependencies
│   └── static/          # Built frontend (auto-generated)
├── frontend/
│   ├── src/
│   │   ├── App.jsx      # Main app component
│   │   ├── main.jsx     # React entry point
│   │   └── index.css    # Styles
│   ├── public/
│   │   └── index.html   # HTML template
│   ├── package.json
│   └── vite.config.js
├── .env.example
├── .gitignore
├── railway.toml
└── README.md
```

## Game Flow

1. **Lobby**: Players join and pick nicknames
2. **Question**: 15-20 second timer, 4 answer tiles
3. **Results**: Correct answer revealed, leaderboard updated
4. **Final**: Full leaderboard with winner celebration

## Scoring

- **Max points**: 1000 per question
- **Formula**: `max_points × (time_remaining / total_time)`
- Wrong answers get 0 points
- Linear decay: fastest answers get most points

## License

MIT