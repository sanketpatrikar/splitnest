import { useEffect, useMemo, useState } from 'react'
import './App.css'

const STORAGE_KEY = 'splitwise-lite-data-v1'

const ADMIN_CREDENTIALS = {
  username: 'admin',
  password: 'i_am_admin!',
}

const USER_CREDENTIALS = {
  username: 'user',
  password: 'user',
}

const INITIAL_DATA = {
  participants: [
    { id: 'p-alex', name: 'Alex' },
    { id: 'p-maya', name: 'Maya' },
    { id: 'p-jordan', name: 'Jordan' },
  ],
  expenses: [
    {
      id: 'e-1',
      title: 'Groceries',
      amount: 72,
      paidBy: 'p-alex',
      participantIds: ['p-alex', 'p-maya', 'p-jordan'],
      note: 'Weekend stock-up',
      createdAt: new Date().toISOString(),
    },
  ],
}

const money = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
})

function useLocalState(key, fallback) {
  const [value, setValue] = useState(() => {
    const saved = localStorage.getItem(key)
    if (!saved) return fallback

    try {
      return JSON.parse(saved)
    } catch {
      return fallback
    }
  })

  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(value))
  }, [key, value])

  return [value, setValue]
}

function buildSettlements(expenses, participants) {
  const participantIds = new Set(participants.map((participant) => participant.id))
  const raw = new Map()

  const addDebt = (fromId, toId, amount) => {
    if (!raw.has(fromId)) raw.set(fromId, new Map())
    const creditorMap = raw.get(fromId)
    creditorMap.set(toId, (creditorMap.get(toId) || 0) + amount)
  }

  expenses.forEach((expense) => {
    const amount = Number(expense.amount)
    const payer = expense.paidBy
    const involved = expense.participantIds.filter((id) => participantIds.has(id))

    if (!amount || amount <= 0 || !payer || involved.length === 0) return

    const split = amount / involved.length

    involved.forEach((participantId) => {
      if (participantId === payer) return
      addDebt(participantId, payer, split)
    })
  })

  const settlements = []
  const ids = participants.map((participant) => participant.id)

  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const a = ids[i]
      const b = ids[j]

      const aToB = raw.get(a)?.get(b) || 0
      const bToA = raw.get(b)?.get(a) || 0
      const diff = Math.abs(aToB - bToA)

      if (diff < 0.01) continue

      if (aToB > bToA) {
        settlements.push({ from: a, to: b, amount: diff })
      } else {
        settlements.push({ from: b, to: a, amount: diff })
      }
    }
  }

  return settlements
}

function App() {
  const [data, setData] = useLocalState(STORAGE_KEY, INITIAL_DATA)
  const [auth, setAuth] = useState({ role: null, participantId: '' })

  const settlements = useMemo(
    () => buildSettlements(data.expenses, data.participants),
    [data.expenses, data.participants],
  )

  const participantById = useMemo(() => {
    const entries = data.participants.map((participant) => [participant.id, participant])
    return new Map(entries)
  }, [data.participants])

  const addParticipant = (name) => {
    const id = `p-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const participant = { id, name: name.trim() }
    setData((current) => ({ ...current, participants: [...current.participants, participant] }))
  }

  const addExpense = (expenseInput) => {
    const involved = expenseInput.participantIds.includes(expenseInput.paidBy)
      ? expenseInput.participantIds
      : [...expenseInput.participantIds, expenseInput.paidBy]

    const expense = {
      id: `e-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      title: expenseInput.title.trim(),
      amount: Number(expenseInput.amount),
      paidBy: expenseInput.paidBy,
      participantIds: involved,
      note: expenseInput.note.trim(),
      createdAt: new Date().toISOString(),
    }

    setData((current) => ({ ...current, expenses: [expense, ...current.expenses] }))
  }

  const deleteParticipant = (participantId) => {
    setData((current) => {
      const participants = current.participants.filter((participant) => participant.id !== participantId)

      const expenses = current.expenses
        .map((expense) => {
          if (expense.paidBy === participantId) return null

          const participantIds = expense.participantIds.filter((id) => id !== participantId)
          if (participantIds.length === 0) return null

          return { ...expense, participantIds }
        })
        .filter(Boolean)

      return { ...current, participants, expenses }
    })
  }

  const handleLogout = () => setAuth({ role: null, participantId: '' })

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Shared House Ledger</p>
          <h1>SplitNest</h1>
        </div>
        {auth.role && (
          <button className="ghost-btn" onClick={handleLogout}>
            Log out
          </button>
        )}
      </header>

      {!auth.role ? (
        <LoginPanel
          participantCount={data.participants.length}
          onAdminLogin={() => setAuth({ role: 'admin', participantId: '' })}
          onUserLogin={() =>
            setAuth({
              role: 'user',
              participantId: data.participants[0]?.id || '',
            })
          }
        />
      ) : auth.role === 'admin' ? (
        <AdminDashboard
          participants={data.participants}
          expenses={data.expenses}
          participantById={participantById}
          onAddParticipant={addParticipant}
          onDeleteParticipant={deleteParticipant}
          onAddExpense={addExpense}
        />
      ) : (
        <UserDashboard
          participants={data.participants}
          settlements={settlements}
          participantById={participantById}
          selectedParticipantId={auth.participantId}
          onSelectParticipant={(id) => setAuth((current) => ({ ...current, participantId: id }))}
        />
      )}
    </main>
  )
}

function LoginPanel({ participantCount, onAdminLogin, onUserLogin }) {
  const [mode, setMode] = useState('admin')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const submit = (event) => {
    event.preventDefault()
    const credentials = mode === 'admin' ? ADMIN_CREDENTIALS : USER_CREDENTIALS

    if (username !== credentials.username || password !== credentials.password) {
      setError('Invalid credentials.')
      return
    }

    setError('')
    if (mode === 'admin') {
      onAdminLogin()
    } else {
      onUserLogin()
    }
  }

  return (
    <section className="panel login-panel pop-in">
      <div className="mode-toggle" role="tablist" aria-label="Login type">
        <button
          className={mode === 'admin' ? 'mode-btn active' : 'mode-btn'}
          onClick={() => setMode('admin')}
        >
          Admin Login
        </button>
        <button
          className={mode === 'user' ? 'mode-btn active' : 'mode-btn'}
          onClick={() => setMode('user')}
        >
          Shared User Login
        </button>
      </div>

      <form className="stack" onSubmit={submit}>
        <label>
          Username
          <input value={username} onChange={(event) => setUsername(event.target.value)} required />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>
        {mode === 'user' && participantCount === 0 && (
          <p className="hint">No participants created yet. Ask the admin to create them first.</p>
        )}
        {error && <p className="error-text">{error}</p>}
        <button className="primary-btn" type="submit" disabled={mode === 'user' && participantCount === 0}>
          Continue
        </button>
      </form>
    </section>
  )
}

function AdminDashboard({
  participants,
  expenses,
  participantById,
  onAddParticipant,
  onDeleteParticipant,
  onAddExpense,
}) {
  const [participantName, setParticipantName] = useState('')
  const [title, setTitle] = useState('')
  const [amount, setAmount] = useState('')
  const [paidBy, setPaidBy] = useState(participants[0]?.id || '')
  const [selectedParticipants, setSelectedParticipants] = useState([])
  const [note, setNote] = useState('')

  useEffect(() => {
    if (!participants.some((participant) => participant.id === paidBy)) {
      setPaidBy(participants[0]?.id || '')
    }
  }, [participants, paidBy])

  useEffect(() => {
    setSelectedParticipants((current) =>
      current.filter((id) => participants.some((participant) => participant.id === id)),
    )
  }, [participants])

  const toggleSelected = (id) => {
    setSelectedParticipants((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    )
  }

  const submitParticipant = (event) => {
    event.preventDefault()
    const clean = participantName.trim()
    if (!clean) return
    onAddParticipant(clean)
    setParticipantName('')
  }

  const submitExpense = (event) => {
    event.preventDefault()

    if (!title.trim() || !amount || !paidBy || selectedParticipants.length === 0) {
      return
    }

    onAddExpense({
      title,
      amount,
      paidBy,
      participantIds: selectedParticipants,
      note,
    })

    setTitle('')
    setAmount('')
    setSelectedParticipants([])
    setNote('')
  }

  const handleDeleteParticipant = (participant) => {
    const ok = window.confirm(
      `Delete ${participant.name}? This will remove their unpaid references and any expense they paid.`,
    )
    if (!ok) return
    onDeleteParticipant(participant.id)
  }

  return (
    <section className="dashboard grid-two">
      <article className="panel pop-in delay-1">
        <h2>Participants</h2>
        <form className="inline-form" onSubmit={submitParticipant}>
          <input
            value={participantName}
            onChange={(event) => setParticipantName(event.target.value)}
            placeholder="Add participant name"
          />
          <button className="primary-btn" type="submit">
            Add
          </button>
        </form>
        <ul className="list">
          {participants.map((participant) => (
            <li key={participant.id}>
              <span>{participant.name}</span>
              <button
                className="danger-btn"
                type="button"
                onClick={() => handleDeleteParticipant(participant)}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      </article>

      <article className="panel pop-in delay-2">
        <h2>Create expense</h2>
        <form className="stack" onSubmit={submitExpense}>
          <label>
            Expense title
            <input value={title} onChange={(event) => setTitle(event.target.value)} required />
          </label>
          <label>
            Amount
            <input
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              required
            />
          </label>
          <label>
            Paid by
            <select value={paidBy} onChange={(event) => setPaidBy(event.target.value)} required>
              {participants.map((participant) => (
                <option key={participant.id} value={participant.id}>
                  {participant.name}
                </option>
              ))}
            </select>
          </label>

          <fieldset>
            <legend>Included participants</legend>
            <div className="checkbox-grid">
              {participants.map((participant) => (
                <label key={participant.id} className="check-item">
                  <input
                    type="checkbox"
                    checked={selectedParticipants.includes(participant.id)}
                    onChange={() => toggleSelected(participant.id)}
                  />
                  {participant.name}
                </label>
              ))}
            </div>
          </fieldset>

          <label>
            Note
            <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional" />
          </label>

          <button className="primary-btn" type="submit">
            Save expense
          </button>
        </form>
      </article>

      <article className="panel full-width pop-in delay-3">
        <h2>Recent expenses</h2>
        {expenses.length === 0 ? (
          <p className="hint">No expenses yet.</p>
        ) : (
          <ul className="expense-list">
            {expenses.map((expense) => (
              <li key={expense.id}>
                <div>
                  <p className="expense-title">{expense.title}</p>
                  <p className="hint">
                    Paid by {participantById.get(expense.paidBy)?.name || 'Unknown'} • Split among{' '}
                    {expense.participantIds.length}
                  </p>
                  {expense.note && <p className="hint">{expense.note}</p>}
                </div>
                <strong>{money.format(expense.amount)}</strong>
              </li>
            ))}
          </ul>
        )}
      </article>
    </section>
  )
}

function UserDashboard({
  participants,
  settlements,
  participantById,
  selectedParticipantId,
  onSelectParticipant,
}) {
  useEffect(() => {
    if (!selectedParticipantId && participants[0]) {
      onSelectParticipant(participants[0].id)
    }
  }, [selectedParticipantId, participants, onSelectParticipant])

  if (participants.length === 0) {
    return (
      <section className="panel">
        <h2>User view</h2>
        <p className="hint">No participants available yet. Ask the admin to add participants.</p>
      </section>
    )
  }

  const selected = selectedParticipantId || participants[0].id
  const outgoing = settlements.filter((item) => item.from === selected)
  const incoming = settlements.filter((item) => item.to === selected)

  const totalOwe = outgoing.reduce((sum, item) => sum + item.amount, 0)
  const totalGet = incoming.reduce((sum, item) => sum + item.amount, 0)
  const net = totalGet - totalOwe

  return (
    <section className="dashboard stack pop-in">
      <article className="panel">
        <h2>Choose your identity</h2>
        <select value={selected} onChange={(event) => onSelectParticipant(event.target.value)}>
          {participants.map((participant) => (
            <option key={participant.id} value={participant.id}>
              {participant.name}
            </option>
          ))}
        </select>
      </article>

      <article className="panel stat-grid delay-1 pop-in">
        <div>
          <p className="hint">You owe</p>
          <p className="stat negative">{money.format(totalOwe)}</p>
        </div>
        <div>
          <p className="hint">Owed to you</p>
          <p className="stat positive">{money.format(totalGet)}</p>
        </div>
        <div>
          <p className="hint">Net</p>
          <p className={net >= 0 ? 'stat positive' : 'stat negative'}>{money.format(net)}</p>
        </div>
      </article>

      <article className="panel split-grid delay-2 pop-in">
        <div>
          <h3>You should pay</h3>
          {outgoing.length === 0 ? (
            <p className="hint">No pending payments.</p>
          ) : (
            <ul className="list">
              {outgoing.map((item) => (
                <li key={`${item.from}-${item.to}`}>
                  <span>{participantById.get(item.to)?.name || 'Unknown'}</span>
                  <strong>{money.format(item.amount)}</strong>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h3>Should receive</h3>
          {incoming.length === 0 ? (
            <p className="hint">Nothing pending.</p>
          ) : (
            <ul className="list">
              {incoming.map((item) => (
                <li key={`${item.from}-${item.to}`}>
                  <span>{participantById.get(item.from)?.name || 'Unknown'}</span>
                  <strong>{money.format(item.amount)}</strong>
                </li>
              ))}
            </ul>
          )}
        </div>
      </article>
    </section>
  )
}

export default App
