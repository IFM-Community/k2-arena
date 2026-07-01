import { useState, useEffect, useCallback, useRef } from 'react'
import { io } from 'socket.io-client'

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:8000'

function App() {
  const [socket, setSocket] = useState(null)
  const [username, setUsername] = useState('')
  const [gameState, setGameState] = useState('lobby')
  const [players, setPlayers] = useState([])
  const [observers, setObservers] = useState([])
  const [currentQuestion, setCurrentQuestion] = useState(null)
  const [timerTotal, setTimerTotal] = useState(20)
  const [timeRemaining, setTimeRemaining] = useState(20)
  const timerStartRef = useRef(null)
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0)
  const [totalQuestions, setTotalQuestions] = useState(0)
  const [leaderboard, setLeaderboard] = useState([])
  const [host, setHost] = useState(null)
  const [pickedAnswer, setPickedAnswer] = useState(null)
  const [correctAnswerIndex, setCorrectAnswerIndex] = useState(null)
  const [answerCounts, setAnswerCounts] = useState(null)
  const [isHost, setIsHost] = useState(false)
  const [isObserver, setIsObserver] = useState(false)
  const [observerMessage, setObserverMessage] = useState('')
  const [scores, setScores] = useState({})
  const [roomExists, setRoomExists] = useState(false)
  const [lobbyJoined, setLobbyJoined] = useState(false)

  useEffect(() => {
    if (gameState !== 'question') return
    const interval = setInterval(() => {
      if (timerStartRef.current == null) return
      const elapsed = (Date.now() - timerStartRef.current) / 1000
      setTimeRemaining(Math.max(0, timerTotal - elapsed))
    }, 100)
    return () => clearInterval(interval)
  }, [gameState, timerTotal])

  useEffect(() => {
    const newSocket = io(SOCKET_URL, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: 5,
    })

    newSocket.on('lobby_state', (data) => {
      setPlayers(data.players || [])
      setIsHost(data.is_host || false)
      setRoomExists(data.room_exists || false)
    })

    newSocket.on('lobby_joined', (data) => {
      setIsHost(data.is_host)
      setRoomExists(data.room_exists || true)
      setLobbyJoined(true)
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
      setCorrectAnswerIndex(null)
      setAnswerCounts(null)
    })

    newSocket.on('timer_started', (data) => {
      setTimerTotal(data.seconds)
      setTimeRemaining(data.seconds)
      timerStartRef.current = Date.now()
    })

    newSocket.on('answer_submitted', (data) => {
      setScores(prev => ({
        ...prev,
        [data.player.username]: data.points,
      }))
    })

    newSocket.on('question_ended', (data) => {
      setGameState('results')
      setLeaderboard(data.leaderboard || [])
      setCorrectAnswerIndex(data.correct_answer)
      setAnswerCounts(data.answer_counts || null)
    })

    newSocket.on('next_question', (data) => {
      setGameState('question')
      setCurrentQuestion(data.current_question)
      setCurrentQuestionIndex(data.question_index)
      setPickedAnswer(null)
      setCorrectAnswerIndex(null)
      setAnswerCounts(null)
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
      setObserverMessage(data.message || 'Game in progress: you joined late, sit back and watch!')
      setCurrentQuestion(data.current_question)
      setLeaderboard(data.leaderboard || [])
      setGameState('observer')
    })

    newSocket.on('player_left', (data) => {
      setPlayers(prev => prev.filter(p => p.sid !== data.sid))
    })

    newSocket.on('game_reset', () => {
      setGameState('lobby')
      setPlayers([])
      setObservers([])
      setCurrentQuestion(null)
      setCurrentQuestionIndex(0)
      setTotalQuestions(0)
      setLeaderboard([])
      setPickedAnswer(null)
      setCorrectAnswerIndex(null)
      setAnswerCounts(null)
      setIsHost(false)
      setIsObserver(false)
      setObserverMessage('')
      setScores({})
      setRoomExists(false)
      setLobbyJoined(false)
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
    }
  }, [socket])

  const startGame = useCallback((secondsPerQuestion) => {
    if (socket && isHost) {
      socket.emit('start_game', { seconds_per_question: secondsPerQuestion })
    }
  }, [socket, isHost])

  const submitAnswer = useCallback((answerIndex) => {
    if (!socket || gameState !== 'question') return
    if (pickedAnswer === answerIndex) {
      setPickedAnswer(null)
      socket.emit('submit_answer', { answer: null })
    } else {
      setPickedAnswer(answerIndex)
      socket.emit('submit_answer', { answer: answerIndex })
    }
  }, [socket, gameState, pickedAnswer])

  const advanceQuestion = useCallback(() => {
    if (socket && isHost) {
      socket.emit('advance_question', {})
    }
  }, [socket, isHost])

  return (
    <div className="app">
      {gameState === 'lobby' && (
        <LobbyScreen 
          onJoin={joinLobby}
          isHost={isHost}
          players={players}
          roomExists={roomExists}
          lobbyJoined={lobbyJoined}
          onStartGame={startGame}
        />
      )}
      
      {gameState === 'question' && (
        <QuestionScreen
          question={currentQuestion}
          timer={timeRemaining}
          totalTime={timerTotal}
          onAnswer={submitAnswer}
          pickedAnswer={pickedAnswer}
          questionIndex={currentQuestionIndex}
          totalQuestions={totalQuestions}
        />
      )}
      
      {gameState === 'results' && (
        <ResultsScreen
          question={currentQuestion}
          leaderboard={leaderboard}
          pickedAnswer={pickedAnswer}
          correctAnswerIndex={correctAnswerIndex}
          answerCounts={answerCounts}
          isHost={isHost}
          isLastQuestion={currentQuestionIndex >= totalQuestions}
          onAdvance={advanceQuestion}
          questionIndex={currentQuestionIndex}
          totalQuestions={totalQuestions}
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

function LobbyScreen({ onJoin, isHost, players, roomExists, lobbyJoined, onStartGame }) {
  if (lobbyJoined) {
    return (
      <div className="screen lobby-screen">
        <div className="title-gradient">
          <h1>K2 Arena</h1>
          <p className="subtitle">10 Things You Should Know About IFM</p>
        </div>
        
        <div className="lobby-content">
          <div className="players-list">
            <h3>Players in Lobby ({players.length}/50)</h3>
            <ul>
              {players.map((p, i) => (
                <li key={i} className="player-item">{p.username}{isHost && p.username === 'You' ? ' (You)' : ''}</li>
              ))}
            </ul>
          </div>
          
          <div className="lobby-controls">
            {isHost ? (
              <button
                className="join-btn"
                onClick={() => onStartGame(20)}
              >
                Start Game
              </button>
            ) : (
              <p className="waiting-message">The Arena is Filling Up...</p>
            )}
          </div>
        </div>
      </div>
    )
  }
  
  return (
    <div className="screen lobby-screen">
      <div className="title-gradient">
        <h1>K2 Arena</h1>
        <p className="subtitle">10 Things You Should Know About IFM</p>
      </div>
      
      <div className="lobby-content">
        <div className="players-list">
          <h3>Players in Lobby ({players.length}/50)</h3>
          <ul>
            {players.map((p, i) => (
              <li key={i} className="player-item">{p.username}</li>
            ))}
          </ul>
        </div>
        
        <JoinForm onJoin={onJoin} roomExists={roomExists} playersCount={players.length} />
      </div>
    </div>
  )
}

function JoinForm({ onJoin, roomExists, playersCount }) {
  const [name, setName] = useState('')

  const handleSubmit = (e) => {
    e.preventDefault()
    if (name.trim() && playersCount < 50) {
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
        disabled={!name.trim() || playersCount >= 50}
      >
        {roomExists ? 'Join Room' : 'Create Room'}
      </button>
      {playersCount >= 50 && (
        <p className="full-message">Game is full (50 players)</p>
      )}
    </form>
  )
}

function QuestionScreen({ question, timer, totalTime, onAnswer, pickedAnswer, questionIndex, totalQuestions }) {
  if (!question) return <div>Loading question...</div>

  const colors = ['#ff4757', '#2ed573', '#ffa502', '#3742fa']
  const letters = ['A', 'B', 'C', 'D']
  const pct = totalTime > 0 ? Math.max(0, Math.min(100, (timer / totalTime) * 100)) : 0

  return (
    <div className="screen question-screen">
      <div className="timer-container">
        <div className="timer-bar-track">
          <div className="timer-bar" style={{ width: `${pct}%` }} />
        </div>
        <div className="timer-value">{timer.toFixed(1)}s</div>
      </div>

      <div className="question-header">
        {question.is_tutorial ? (
          <span className="question-number tutorial-badge">Practice Question</span>
        ) : (
          <span className="question-number">Question {questionIndex} / {totalQuestions}</span>
        )}
      </div>

      <div className="question-text">
        {question.question}
      </div>

      <div className="answer-options">
        {question.options.map((option, index) => (
          <button
            key={index}
            className={`answer-tile ${pickedAnswer === index ? 'selected' : ''} ${'answer-' + letters[index].toLowerCase()}`}
            onClick={() => onAnswer(index)}
            style={{ backgroundColor: colors[index] }}
          >
            {pickedAnswer === index && <div className="selected-badge">✓</div>}
            <div className="option-letter">{letters[index]}</div>
            <div className="option-text">{option}</div>
          </button>
        ))}
      </div>
    </div>
  )
}

function ResultsScreen({ question, leaderboard, pickedAnswer, correctAnswerIndex, answerCounts, isHost, isLastQuestion, onAdvance, questionIndex, totalQuestions }) {
  const colors = ['#ff4757', '#2ed573', '#ffa502', '#3742fa']
  const letters = ['A', 'B', 'C', 'D']
  const answered = pickedAnswer !== null && pickedAnswer !== undefined
  const hasCorrectAnswer = correctAnswerIndex !== null && correctAnswerIndex !== undefined
  const wasCorrect = answered && hasCorrectAnswer && pickedAnswer === correctAnswerIndex

  return (
    <div className="screen results-screen">
      <div className="question-header">
        {question.is_tutorial ? (
          <span className="question-number tutorial-badge">Practice Question</span>
        ) : (
          <span className="question-number">Q{questionIndex} / {totalQuestions}</span>
        )}
      </div>

      <div className={`result-banner ${answered ? (wasCorrect ? 'correct' : 'incorrect') : 'unanswered'}`}>
        {answered ? (wasCorrect ? '✓ You got it right!' : '✗ Not quite') : "Time's up, no answer submitted"}
      </div>

      <div className="recap-question">
        <div className="recap-question-text">{question.question}</div>
        {hasCorrectAnswer && (
          <div className="recap-answer" style={{ backgroundColor: colors[correctAnswerIndex] }}>
            <span className="recap-answer-letter">{letters[correctAnswerIndex]}</span>
            {question.options[correctAnswerIndex]}
          </div>
        )}
        {answered && !wasCorrect && (
          <div className="your-answer">Your answer: {question.options[pickedAnswer]}</div>
        )}
      </div>

      <div className="leaderboard-preview">
        <h3>Leaderboard Top 10</h3>
        <ul>
          {leaderboard.slice(0, 10).map((p, i) => (
            <li key={i} className={`leaderboard-item ${i === 0 ? 'winner' : ''}`}>
              <span>#{p.rank} {p.username}</span>
              <span>{p.score} pts total</span>
            </li>
          ))}
        </ul>
      </div>

      {answerCounts && (
        <div className="answer-breakdown">
          <h3>How Everyone Answered</h3>
          {question.options.map((option, i) => {
            const count = answerCounts[i] || 0
            const maxCount = Math.max(1, ...answerCounts)
            const pct = (count / maxCount) * 100
            return (
              <div key={i} className="breakdown-row">
                <span className="breakdown-letter" style={{ backgroundColor: colors[i] }}>{letters[i]}</span>
                <div className="breakdown-bar-track">
                  <div className="breakdown-bar" style={{ width: `${pct}%`, backgroundColor: colors[i] }} />
                  <span className="breakdown-bar-text">{option}</span>
                </div>
                <span className="breakdown-count">{count}</span>
              </div>
            )
          })}
        </div>
      )}

      {question.explanation && (
        <div className="explanation">
          {question.explanation}
        </div>
      )}

      <div className="advance-controls">
        {isHost ? (
          <button className="join-btn" onClick={onAdvance}>
            {isLastQuestion ? 'Show Final Results' : 'Next Question'}
          </button>
        ) : (
          <p className="waiting-message">Waiting for host to continue...</p>
        )}
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