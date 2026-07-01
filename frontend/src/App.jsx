import { useState, useEffect, useCallback } from 'react'
import { io } from 'socket.io-client'

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:8000'

function App() {
  const [socket, setSocket] = useState(null)
  const [username, setUsername] = useState('')
  const [gameState, setGameState] = useState('lobby')
  const [players, setPlayers] = useState([])
  const [observers, setObservers] = useState([])
  const [currentQuestion, setCurrentQuestion] = useState(null)
  const [questionTimer, setQuestionTimer] = useState(null)
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0)
  const [totalQuestions, setTotalQuestions] = useState(0)
  const [leaderboard, setLeaderboard] = useState([])
  const [host, setHost] = useState(null)
  const [pickedAnswer, setPickedAnswer] = useState(null)
  const [networkStatus, setNetworkStatus] = useState('connecting')
  const [isHost, setIsHost] = useState(false)
  const [isObserver, setIsObserver] = useState(false)
  const [observerMessage, setObserverMessage] = useState('')
  const [scores, setScores] = useState({})

  useEffect(() => {
    const newSocket = io(SOCKET_URL, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: 5,
    })

    newSocket.on('connect', () => {
      setNetworkStatus('connected')
    })

    newSocket.on('disconnect', () => {
      setNetworkStatus('disconnected')
    })

    newSocket.on('connect_error', () => {
      setNetworkStatus('error')
    })

    newSocket.on('lobby_state', (data) => {
      setPlayers(data.players || [])
      setIsHost(data.is_host || false)
    })

    newSocket.on('lobby_joined', (data) => {
      setIsHost(data.is_host)
    })

    newSocket.on('lobby_update', (data) => {
      setPlayers(data.players || [])
    })

    newSocket.on('host_set', (data) => {
      setHost(data.host)
    })

    newSocket.on('player_joined', (data) => {
      if (data.is_observer) {
        setObservers(prev => [...prev, data.player])
      } else {
        setPlayers(prev => [...prev, data.player])
      }
    })

    newSocket.on('game_started', (data) => {
      setGameState('question')
      setCurrentQuestion(data.current_question)
      setTotalQuestions(data.total_questions)
      setCurrentQuestionIndex(0)
      setPickedAnswer(null)
    })

    newSocket.on('timer_started', (data) => {
      setQuestionTimer(data.seconds)
    })

    newSocket.on('answer_submitted', (data) => {
      setScores(prev => ({
        ...prev,
        [data.player.username]: data.points,
      }))
    })

    newSocket.on('question_ended', (data) => {
      setGameState('results')
    })

    newSocket.on('next_question', (data) => {
      setGameState('question')
      setCurrentQuestion(data.current_question)
      setCurrentQuestionIndex(data.question_index)
      setPickedAnswer(null)
    })

    newSocket.on('game_finished', (data) => {
      setGameState('finished')
      setLeaderboard(data.leaderboard)
    })

    newSocket.on('state_changed', (data) => {
      setGameState(data.state)
    })

    newSocket.on('game_running', (data) => {
      setIsObserver(true)
      setObserverMessage(data.message || 'Game in progress — you joined late, sit back and watch!')
      setCurrentQuestion(data.current_question)
      setLeaderboard(data.leaderboard || [])
      setGameState('observer')
    })

    newSocket.on('player_left', (data) => {
      setPlayers(prev => prev.filter(p => p.sid !== data.sid))
    })

    setSocket(newSocket)

    return () => {
      newSocket.close()
    }
  }, [])

  const joinLobby = useCallback((name) => {
    setUsername(name)
    if (socket) {
      socket.emit('join_lobby', { username: name })
      socket.emit('set_host')
    }
  }, [socket])

  const startGame = useCallback((secondsPerQuestion) => {
    if (socket && isHost) {
      socket.emit('start_game', { seconds_per_question: secondsPerQuestion })
    }
  }, [socket, isHost])

  const submitAnswer = useCallback((answerIndex) => {
    if (socket && gameState === 'question' && pickedAnswer === null) {
      setPickedAnswer(answerIndex)
      socket.emit('submit_answer', { answer: answerIndex })
    }
  }, [socket, gameState, pickedAnswer])

  return (
    <div className="app">
      {networkStatus !== 'connected' && (
        <div className="network-status">Connecting{networkStatus === 'disconnected' ? '...' : ' to server'}</div>
      )}
      
      {gameState === 'lobby' && (
        <LobbyScreen 
          onJoin={joinLobby}
          isHost={isHost}
          players={players}
        />
      )}
      
      {gameState === 'question' && (
        <QuestionScreen
          question={currentQuestion}
          timer={questionTimer}
          onAnswer={submitAnswer}
          pickedAnswer={pickedAnswer}
          questionIndex={currentQuestionIndex + 1}
          totalQuestions={totalQuestions}
        />
      )}
      
      {gameState === 'results' && (
        <ResultsScreen
          question={currentQuestion}
          leaderboard={leaderboard}
          players={players}
        />
      )}
      
      {gameState === 'finished' && (
        <FinalLeaderboard
          leaderboard={leaderboard}
        />
      )}
      
      {gameState === 'observer' && (
        <ObserverScreen
          message={observerMessage}
          question={currentQuestion}
          leaderboard={leaderboard}
        />
      )}
    </div>
  )
}

function LobbyScreen({ onJoin, isHost, players }) {
  return (
    <div className="screen lobby-screen">
      <div className="title-gradient">
        <h1>K2 Arena</h1>
        <p className="subtitle">A Kahoot-style Quiz Experience</p>
      </div>
      
      <div className="lobby-content">
        <div className="players-list">
          <h3>Players in Lobby ({players.length}/30)</h3>
          <ul>
            {players.map((p, i) => (
              <li key={i} className="player-item">{p.username}</li>
            ))}
          </ul>
        </div>
        
        <JoinForm onJoin={onJoin} isHost={isHost} playersCount={players.length} />
      </div>
    </div>
  )
}

function JoinForm({ onJoin, isHost, playersCount }) {
  const [name, setName] = useState('')

  const handleSubmit = (e) => {
    e.preventDefault()
    if (name.trim() && playersCount < 30) {
      onJoin(name.trim())
    }
  }

  return (
    <form className="join-form" onSubmit={handleSubmit}>
      <input
        type="text"
        placeholder="Enter your name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={20}
        className="name-input"
      />
      <button 
        type="submit" 
        className="join-btn"
        disabled={!name.trim() || playersCount >= 30}
      >
        {isHost ? (playersCount > 0 ? 'Start Game' : 'Become Host') : 'Join Game'}
      </button>
      {playersCount >= 30 && (
        <p className="full-message">Game is full (30 players)</p>
      )}
    </form>
  )
}

function QuestionScreen({ question, timer, onAnswer, pickedAnswer, questionIndex, totalQuestions }) {
  if (!question) return <div>Loading question...</div>

  const colors = ['#ff4757', '#2ed573', '#ffa502', '#3742fa']
  const letters = ['A', 'B', 'C', 'D']

  return (
    <div className="screen question-screen">
      <div className="timer-container">
        <div className="timer-bar" style={{ 
          width: `${(timer / (timer > 0 ? timer : 20)) * 100}%`
        }} />
        <div className="timer-value">{timer}s</div>
      </div>
      
      <div className="question-header">
        <span className="question-number">Question {questionIndex} / {totalQuestions}</span>
      </div>
      
      <div className="question-text">
        {question.question}
      </div>
      
      <div className="answer-options">
        {question.options.map((option, index) => (
          <button
            key={index}
            className={`answer-tile ${pickedAnswer === index ? 'locked' : ''} ${'answer-' + letters[index].toLowerCase()}`}
            onClick={() => onAnswer(index)}
            disabled={pickedAnswer !== null}
            style={{ backgroundColor: colors[index] }}
          >
            <div className="option-letter">{letters[index]}</div>
            <div className="option-text">{option}</div>
          </button>
        ))}
      </div>
    </div>
  )
}

function ResultsScreen({ question, leaderboard, players }) {
  const colors = ['#ff4757', '#2ed573', '#ffa502', '#3742fa']

  return (
    <div className="screen results-screen">
      <div className="results-header">Question Results</div>
      
      <div className="correct-answer-display">
        <h2>Correct Answer:</h2>
        <div className="correct-option" style={{ backgroundColor: colors[question.correct_answer] }}>
          {question.options[question.correct_answer]}
        </div>
      </div>
      
      <div className="leaderboard-preview">
        <h3>Leaderboard</h3>
        <ul>
          {leaderboard.slice(0, 5).map((p, i) => (
            <li key={i} className={`leaderboard-item ${i === 0 ? 'winner' : ''}`}>
              #{p.rank} {p.username} — {p.score} pts
            </li>
          ))}
        </ul>
      </div>
      
      <div className="explanation">
        {question.explanation}
      </div>
    </div>
  )
}

function FinalLeaderboard({ leaderboard }) {
  return (
    <div className="screen final-screen">
      <div className="title-gradient">
        <h1>🎉 Game Over! 🎉</h1>
      </div>
      
      <div className="final-leaderboard">
        <table>
          <thead>
            <tr>
              <th>Rank</th>
              <th>Player</th>
              <th>Score</th>
            </tr>
          </thead>
          <tbody>
            {leaderboard.map((p, i) => (
              <tr key={i} className={i === 0 ? 'winner-row' : ''}>
                <td>#{p.rank}</td>
                <td>{p.username}</td>
                <td>{p.score}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      
      {leaderboard[0] && (
        <div className="winner-congrats">
          🏆 {leaderboard[0].username} wins with {leaderboard[0].score} points!
        </div>
      )}
    </div>
  )
}

function ObserverScreen({ message, question, leaderboard }) {
  return (
    <div className="screen observer-screen">
      <div className="observer-message">
        {message}
      </div>
      
      {question && (
        <div className="observer-question">
          <h3>Current Question {leaderboard.length + 1}</h3>
          <div className="question-text">{question.question}</div>
          <div className="observer-options">
            {question.options.map((opt, i) => (
              <div key={i} className="observer-option" style={{ 
                backgroundColor: ['#ff4757', '#2ed573', '#ffa502', '#3742fa'][i]
              }}>
                {opt}
              </div>
            ))}
          </div>
        </div>
      )}
      
      <div className="observer-leaderboard">
        <h3>Live Leaderboard</h3>
        <table>
          <tbody>
            {leaderboard.slice(0, 10).map((p, i) => (
              <tr key={i}>
                <td>#{p.rank}</td>
                <td>{p.username}</td>
                <td>{p.score}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default App