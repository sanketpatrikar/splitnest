import { useEffect, useMemo, useState } from 'react'
import './App.css'
import {
  createExpense,
  createParticipants,
  createPayment,
  deleteExpense,
  deleteParticipant,
  fetchData,
  updateExpense,
} from './lib/dataApi'
import { hasSupabaseEnv } from './lib/supabase'

const ADMIN_CREDENTIALS = {
  username: 'admin',
  password: 'i_am_admin!',
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
  payments: [],
}

const money = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
})

function buildSettlements(expenses, participants, payments) {
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
    const debtors = expense.participantIds.filter(
      (id) => participantIds.has(id) && id !== payer,
    )

    if (!amount || amount <= 0 || !payer || !participantIds.has(payer) || debtors.length === 0) return

    const split = amount / (debtors.length + 1)

    debtors.forEach((participantId) => {
      addDebt(participantId, payer, split)
    })
  })

  payments.forEach((payment) => {
    const amount = Number(payment.amount)
    if (!amount || amount <= 0) return
    if (!participantIds.has(payment.from) || !participantIds.has(payment.to)) return
    if (payment.from === payment.to) return

    addDebt(payment.to, payment.from, amount)
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
  const [data, setData] = useState(INITIAL_DATA)
  const [selectedParticipantId, setSelectedParticipantId] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)
  const [isAdminLoginOpen, setIsAdminLoginOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [errorText, setErrorText] = useState('')

  const loadData = async () => {
    if (!hasSupabaseEnv) {
      setIsLoading(false)
      return
    }

    try {
      setIsLoading(true)
      const remoteData = await fetchData()
      setData(remoteData)
      setErrorText('')
    } catch {
      setErrorText('Failed to load shared data from Supabase.')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  useEffect(() => {
    if (data.participants.length === 0) {
      setSelectedParticipantId('')
      return
    }

    const selectedExists = data.participants.some((participant) => participant.id === selectedParticipantId)
    if (!selectedExists) {
      setSelectedParticipantId(data.participants[0].id)
    }
  }, [data.participants, selectedParticipantId])

  const settlements = useMemo(
    () => buildSettlements(data.expenses, data.participants, data.payments || []),
    [data.expenses, data.participants, data.payments],
  )

  const participantById = useMemo(() => {
    const entries = data.participants.map((participant) => [participant.id, participant])
    return new Map(entries)
  }, [data.participants])

  const addParticipants = async (names) => {
    const cleanNames = names
      .map((name) => name.trim())
      .filter(Boolean)
    if (cleanNames.length === 0) return

    try {
      setIsSaving(true)
      await createParticipants(cleanNames)
      await loadData()
      setErrorText('')
    } catch {
      setErrorText('Unable to add participant(s).')
    } finally {
      setIsSaving(false)
    }
  }

  const addExpense = async (expenseInput) => {
    try {
      setIsSaving(true)
      await createExpense(expenseInput)
      await loadData()
      setErrorText('')
    } catch {
      setErrorText('Unable to create expense.')
    } finally {
      setIsSaving(false)
    }
  }

  const editExpense = async (expenseInput) => {
    try {
      setIsSaving(true)
      await updateExpense(expenseInput)
      await loadData()
      setErrorText('')
    } catch {
      setErrorText('Unable to update expense.')
    } finally {
      setIsSaving(false)
    }
  }

  const removeParticipant = async (participantId) => {
    try {
      setIsSaving(true)
      await deleteParticipant(participantId)
      await loadData()
      setErrorText('')
    } catch {
      setErrorText('Unable to delete participant.')
    } finally {
      setIsSaving(false)
    }
  }

  const removeExpense = async (expenseId) => {
    try {
      setIsSaving(true)
      await deleteExpense(expenseId)
      await loadData()
      setErrorText('')
    } catch {
      setErrorText('Unable to delete expense.')
    } finally {
      setIsSaving(false)
    }
  }

  const markSettlementPaid = async (settlement) => {
    try {
      setIsSaving(true)
      await createPayment(settlement)
      await loadData()
      setErrorText('')
    } catch {
      setErrorText('Unable to mark payment as settled.')
    } finally {
      setIsSaving(false)
    }
  }

  const handleAdminLogout = () => {
    setIsAdmin(false)
    setIsAdminLoginOpen(false)
  }

  if (!hasSupabaseEnv) {
    return <SetupPanel />
  }

  if (isLoading) {
    return (
      <main className="shell">
        <section className="panel pop-in">
          <h2>Connecting to shared data...</h2>
          <p className="hint">Please wait while SplitNest loads your workspace.</p>
        </section>
      </main>
    )
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Shared House Ledger</p>
          <h1>SplitNest</h1>
        </div>
        {isAdmin ? (
          <button className="ghost-btn" onClick={handleAdminLogout}>
            Admin logout
          </button>
        ) : (
          <button className="ghost-btn" onClick={() => setIsAdminLoginOpen((open) => !open)}>
            Admin
          </button>
        )}
      </header>

      {errorText && (
        <section className="panel">
          <p className="error-text">{errorText}</p>
        </section>
      )}

      {isAdminLoginOpen && !isAdmin && (
        <AdminLoginPanel
          onClose={() => setIsAdminLoginOpen(false)}
          onAdminLogin={() => {
            setIsAdmin(true)
            setIsAdminLoginOpen(false)
          }}
        />
      )}

      <UserDashboard
        participants={data.participants}
        settlements={settlements}
        participantById={participantById}
        selectedParticipantId={selectedParticipantId}
        onSelectParticipant={setSelectedParticipantId}
      />

      {isAdmin && (
        <AdminDashboard
          participants={data.participants}
          expenses={data.expenses}
          settlements={settlements}
          participantById={participantById}
          onAddParticipants={addParticipants}
          onDeleteParticipant={removeParticipant}
          onDeleteExpense={removeExpense}
          onAddExpense={addExpense}
          onEditExpense={editExpense}
          onMarkSettlementPaid={markSettlementPaid}
          isSaving={isSaving}
        />
      )}
    </main>
  )
}

function SetupPanel() {
  return (
    <main className="shell">
      <section className="panel pop-in">
        <h2>Supabase setup needed</h2>
        <p className="hint">Add these values in your `.env` and Vercel project settings:</p>
        <ul className="list">
          <li>
            <code>VITE_SUPABASE_URL</code>
          </li>
          <li>
            <code>VITE_SUPABASE_ANON_KEY</code>
          </li>
        </ul>
        <p className="hint">After adding them, restart dev server or redeploy.</p>
      </section>
    </main>
  )
}

function AdminLoginPanel({ onAdminLogin, onClose }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const submit = (event) => {
    event.preventDefault()

    if (username === ADMIN_CREDENTIALS.username && password === ADMIN_CREDENTIALS.password) {
      setError('')
      onAdminLogin()
      return
    }

    setError('Invalid admin credentials.')
  }

  return (
    <section className="panel login-panel pop-in">
      <h2>Admin login</h2>
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
        {error && <p className="error-text">{error}</p>}
        <div className="inline-form">
          <button className="primary-btn" type="submit">
            Continue
          </button>
          <button className="ghost-btn" type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </section>
  )
}

function AdminDashboard({
  participants,
  expenses,
  settlements,
  participantById,
  onAddParticipants,
  onDeleteParticipant,
  onDeleteExpense,
  onAddExpense,
  onEditExpense,
  onMarkSettlementPaid,
  isSaving,
}) {
  const [participantName, setParticipantName] = useState('')
  const [editingExpenseId, setEditingExpenseId] = useState('')
  const [title, setTitle] = useState('')
  const [amount, setAmount] = useState('')
  const [paidBy, setPaidBy] = useState(participants[0]?.id || '')
  const [selectedParticipants, setSelectedParticipants] = useState([])
  const [note, setNote] = useState('')

  const safePaidBy = participants.some((participant) => participant.id === paidBy)
    ? paidBy
    : participants[0]?.id || ''

  const validSelectedParticipants = selectedParticipants.filter((id) =>
    participants.some((participant) => participant.id === id) && id !== safePaidBy,
  )

  const selectableParticipants = participants.filter((participant) => participant.id !== safePaidBy)

  const resetExpenseForm = () => {
    setEditingExpenseId('')
    setTitle('')
    setAmount('')
    setSelectedParticipants([])
    setNote('')
  }

  const toggleSelected = (id) => {
    setSelectedParticipants((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    )
  }

  const toggleSelectAll = () => {
    const allIds = selectableParticipants.map((participant) => participant.id)
    const hasAll = allIds.length > 0 && allIds.every((id) => validSelectedParticipants.includes(id))
    setSelectedParticipants(hasAll ? [] : allIds)
  }

  const startEditExpense = (expense) => {
    setEditingExpenseId(expense.id)
    setTitle(expense.title)
    setAmount(String(expense.amount))
    setPaidBy(expense.paidBy)
    setSelectedParticipants(expense.participantIds.filter((id) => id !== expense.paidBy))
    setNote(expense.note || '')
  }

  const submitParticipant = (event) => {
    event.preventDefault()
    const parsed = participantName
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)

    if (parsed.length === 0) return

    onAddParticipants(parsed)
    setParticipantName('')
  }

  const submitExpense = (event) => {
    event.preventDefault()

    if (!title.trim() || !amount || !safePaidBy || validSelectedParticipants.length === 0) {
      return
    }

    if (editingExpenseId) {
      onEditExpense({
        id: editingExpenseId,
        title,
        amount,
        paidBy: safePaidBy,
        participantIds: validSelectedParticipants,
        note,
      })
      resetExpenseForm()
      return
    }

    onAddExpense({
      title,
      amount,
      paidBy: safePaidBy,
      participantIds: validSelectedParticipants,
      note,
    })

    resetExpenseForm()
  }

  const handleDeleteParticipant = (participant) => {
    const ok = window.confirm(
      `Delete ${participant.name}? This will remove their unpaid references and any expense they paid.`,
    )
    if (!ok) return
    onDeleteParticipant(participant.id)
  }

  const handleSettle = (item) => {
    const fromName = participantById.get(item.from)?.name || 'Unknown'
    const toName = participantById.get(item.to)?.name || 'Unknown'
    const ok = window.confirm(
      `Confirm settlement: ${fromName} paid ${money.format(item.amount)} to ${toName}?`,
    )
    if (!ok) return
    onMarkSettlementPaid(item)
  }

  const handleDeleteExpense = (expense) => {
    const ok = window.confirm(`Delete expense "${expense.title}"?`)
    if (!ok) return
    onDeleteExpense(expense.id)
    if (editingExpenseId === expense.id) {
      resetExpenseForm()
    }
  }

  const allSelected =
    selectableParticipants.length > 0 &&
    selectableParticipants.every((participant) => validSelectedParticipants.includes(participant.id))

  return (
    <section className="dashboard grid-two">
      <article className="panel pop-in delay-1">
        <h2>Participants</h2>
        <form className="inline-form" onSubmit={submitParticipant}>
          <input
            value={participantName}
            onChange={(event) => setParticipantName(event.target.value)}
            placeholder="Alex, Maya, Jordan"
          />
          <button className="primary-btn" type="submit" disabled={isSaving}>
            Add
          </button>
        </form>
        <p className="hint">Add one or many participants separated by commas.</p>
        <ul className="list">
          {participants.map((participant) => (
            <li key={participant.id}>
              <span>{participant.name}</span>
              <button
                className="danger-btn"
                type="button"
                disabled={isSaving}
                onClick={() => handleDeleteParticipant(participant)}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      </article>

      <article className="panel pop-in delay-2">
        <h2>{editingExpenseId ? 'Edit expense' : 'Create expense'}</h2>
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
            <select value={safePaidBy} onChange={(event) => setPaidBy(event.target.value)} required>
              {participants.map((participant) => (
                <option key={participant.id} value={participant.id}>
                  {participant.name}
                </option>
              ))}
            </select>
          </label>

          <fieldset>
            <legend>Included participants</legend>
            <p className="hint">Payer is excluded automatically.</p>
            <div className="checkbox-grid">
              <label className="check-item">
                <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} />
                All
              </label>
              {selectableParticipants.map((participant) => (
                <label key={participant.id} className="check-item">
                  <input
                    type="checkbox"
                    checked={validSelectedParticipants.includes(participant.id)}
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

          <button className="primary-btn" type="submit" disabled={isSaving}>
            {editingExpenseId ? 'Update expense' : 'Save expense'}
          </button>
          {editingExpenseId && (
            <button className="ghost-btn" type="button" onClick={resetExpenseForm} disabled={isSaving}>
              Cancel edit
            </button>
          )}
        </form>
      </article>

      <article className="panel full-width pop-in delay-3">
        <h2>Open balances</h2>
        {settlements.length === 0 ? (
          <p className="hint">All balances are clear.</p>
        ) : (
          <ul className="expense-list">
            {settlements.map((item) => (
              <li key={`${item.from}-${item.to}`}>
                <div>
                  <p className="expense-title">
                    {participantById.get(item.from)?.name || 'Unknown'} owes{' '}
                    {participantById.get(item.to)?.name || 'Unknown'}
                  </p>
                </div>
                <div className="inline-form compact-actions">
                  <strong>{money.format(item.amount)}</strong>
                  <button
                    className="primary-btn"
                    type="button"
                    disabled={isSaving}
                    onClick={() => handleSettle(item)}
                  >
                    Mark paid
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
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
                  {(() => {
                    const uniqueDebtors = new Set(expense.participantIds.filter((id) => id !== expense.paidBy))
                    const splitCount = uniqueDebtors.size + 1
                    return (
                      <p className="hint">
                        Paid by {participantById.get(expense.paidBy)?.name || 'Unknown'} • Split among {splitCount}{' '}
                        (includes payer)
                      </p>
                    )
                  })()}
                  {expense.note && <p className="hint">{expense.note}</p>}
                </div>
                <div className="inline-form compact-actions">
                  <strong>{money.format(expense.amount)}</strong>
                  <button
                    className="ghost-btn"
                    type="button"
                    onClick={() => startEditExpense(expense)}
                    disabled={isSaving}
                  >
                    Edit
                  </button>
                  <button
                    className="danger-btn"
                    type="button"
                    onClick={() => handleDeleteExpense(expense)}
                    disabled={isSaving}
                  >
                    Delete
                  </button>
                </div>
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
  if (participants.length === 0) {
    return (
      <section className="panel pop-in">
        <h2>Choose who you are</h2>
        <p className="hint">No participants yet. Ask admin to add names first.</p>
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
        <h2>Choose who you are</h2>
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
