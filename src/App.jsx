import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import {
  createExpense,
  createParticipants,
  createSharePayment,
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

const ADMIN_SESSION_KEY = 'splitnest-admin-session'

function getStoredAdminSession() {
  try {
    return localStorage.getItem(ADMIN_SESSION_KEY) === '1'
  } catch {
    return false
  }
}

function setStoredAdminSession(isActive) {
  try {
    if (isActive) {
      localStorage.setItem(ADMIN_SESSION_KEY, '1')
    } else {
      localStorage.removeItem(ADMIN_SESSION_KEY)
    }
  } catch {
    // Ignore storage access errors
  }
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
      participantIds: ['p-maya', 'p-jordan'],
      note: 'Weekend stock-up',
      createdAt: new Date().toISOString(),
      shares: [],
      hasPayments: false,
    },
  ],
}

const money = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
})

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100
}

function sumAmounts(items) {
  return round2(items.reduce((sum, item) => sum + Number(item.amount), 0))
}

function getErrorMessage(error, fallback) {
  if (error && typeof error.message === 'string' && error.message.length > 0) {
    return error.message
  }

  return fallback
}

function buildExpenseBalanceGroups(expenses) {
  return expenses
    .map((expense) => {
      const items = (expense.shares || [])
        .filter((share) => Number(share.remainingAmount) > 0.009)
        .map((share) => ({
          shareId: share.id,
          from: share.debtorId,
          to: share.creditorId,
          amount: Number(share.remainingAmount),
          fullShare: Number(share.amount),
          paidAmount: Number(share.paidAmount),
          kind: share.kind,
          shareNote: share.note || '',
        }))

      if (items.length === 0) return null

      return {
        expenseId: expense.id,
        title: expense.title,
        note: expense.note || '',
        amount: Number(expense.amount),
        payer: expense.paidBy,
        items,
        totalPending: sumAmounts(items),
      }
    })
    .filter(Boolean)
}

function applyPairwiseAutoSettlement(expenseBalances) {
  const clonedGroups = expenseBalances.map((group) => ({
    ...group,
    items: group.items.map((item) => ({
      ...item,
      rawAmount: round2(item.amount),
      amount: round2(item.amount),
      autoSettled: 0,
    })),
    autoSettledTotal: 0,
  }))

  const pairBuckets = new Map()

  clonedGroups.forEach((group, groupIndex) => {
    group.items.forEach((item, itemIndex) => {
      const left = item.from < item.to ? item.from : item.to
      const right = item.from < item.to ? item.to : item.from
      const key = `${left}::${right}`
      const isForward = item.from === left && item.to === right

      if (!pairBuckets.has(key)) {
        pairBuckets.set(key, {
          left,
          right,
          forward: [],
          reverse: [],
        })
      }

      const bucket = pairBuckets.get(key)
      const ref = { groupIndex, itemIndex }

      if (isForward) {
        bucket.forward.push(ref)
      } else {
        bucket.reverse.push(ref)
      }
    })
  })

  const pairAdjustments = []

  const applyToRefs = (refs, settleAmount) => {
    let remaining = settleAmount

    refs.forEach((ref) => {
      if (remaining <= 0.009) return

      const item = clonedGroups[ref.groupIndex].items[ref.itemIndex]
      const deduct = round2(Math.min(item.amount, remaining))
      if (deduct <= 0) return

      item.amount = round2(item.amount - deduct)
      item.autoSettled = round2(item.autoSettled + deduct)
      remaining = round2(remaining - deduct)
    })
  }

  pairBuckets.forEach((bucket) => {
    const totalForward = round2(
      bucket.forward.reduce((sum, ref) => sum + clonedGroups[ref.groupIndex].items[ref.itemIndex].amount, 0),
    )
    const totalReverse = round2(
      bucket.reverse.reduce((sum, ref) => sum + clonedGroups[ref.groupIndex].items[ref.itemIndex].amount, 0),
    )

    const settled = round2(Math.min(totalForward, totalReverse))
    if (settled <= 0.009) return

    applyToRefs(bucket.forward, settled)
    applyToRefs(bucket.reverse, settled)

    pairAdjustments.push({
      from: bucket.left,
      to: bucket.right,
      amount: settled,
    })
  })

  const adjustedGroups = clonedGroups
    .map((group) => {
      const items = group.items.filter((item) => item.amount > 0.009)
      const autoSettledTotal = round2(group.items.reduce((sum, item) => sum + item.autoSettled, 0))

      if (items.length === 0) return null

      return {
        ...group,
        items,
        totalPending: sumAmounts(items),
        autoSettledTotal,
      }
    })
    .filter(Boolean)

  return {
    expenseBalances: adjustedGroups,
    pairAdjustments,
  }
}

function groupBalancesForParticipant(expenseBalances, participantId, direction) {
  const isOutgoing = direction === 'outgoing'

  return expenseBalances
    .map((group) => {
      const items = group.items
        .filter((item) => (isOutgoing ? item.from === participantId : item.to === participantId))
        .map((item) => ({
          ...item,
          counterpartyId: isOutgoing ? item.to : item.from,
        }))

      if (items.length === 0) return null

      return {
        ...group,
        items,
        amount: sumAmounts(items),
        autoSettledTotal: round2(items.reduce((sum, item) => sum + Number(item.autoSettled || 0), 0)),
      }
    })
    .filter(Boolean)
}

function App() {
  const [data, setData] = useState(INITIAL_DATA)
  const [selectedParticipantId, setSelectedParticipantId] = useState('')
  const [isAdmin, setIsAdmin] = useState(getStoredAdminSession)
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
    } catch (error) {
      setErrorText(getErrorMessage(error, 'Failed to load shared data from Supabase.'))
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

  const participantById = useMemo(() => {
    const entries = data.participants.map((participant) => [participant.id, participant])
    return new Map(entries)
  }, [data.participants])

  const rawExpenseBalances = useMemo(
    () => buildExpenseBalanceGroups(data.expenses || []),
    [data.expenses],
  )

  const { expenseBalances, pairAdjustments } = useMemo(
    () => applyPairwiseAutoSettlement(rawExpenseBalances),
    [rawExpenseBalances],
  )

  const addParticipants = async (names) => {
    const cleanNames = names
      .map((name) => name.trim())
      .filter(Boolean)

    if (cleanNames.length === 0) return false

    try {
      setIsSaving(true)
      await createParticipants(cleanNames)
      await loadData()
      setErrorText('')
      return true
    } catch (error) {
      setErrorText(getErrorMessage(error, 'Unable to add participant(s).'))
      return false
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
      return true
    } catch (error) {
      setErrorText(getErrorMessage(error, 'Unable to create expense.'))
      return false
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
      return true
    } catch (error) {
      setErrorText(getErrorMessage(error, 'Unable to update expense.'))
      return false
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
      return true
    } catch (error) {
      setErrorText(getErrorMessage(error, 'Unable to delete participant.'))
      return false
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
      return true
    } catch (error) {
      setErrorText(getErrorMessage(error, 'Unable to delete expense.'))
      return false
    } finally {
      setIsSaving(false)
    }
  }

  const recordSharePayment = async (paymentInput) => {
    try {
      setIsSaving(true)
      await createSharePayment(paymentInput)
      await loadData()
      setErrorText('')
      return true
    } catch (error) {
      setErrorText(getErrorMessage(error, 'Unable to record payment.'))
      return false
    } finally {
      setIsSaving(false)
    }
  }

  const handleAdminLogout = () => {
    setIsAdmin(false)
    setIsAdminLoginOpen(false)
    setStoredAdminSession(false)
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
            setStoredAdminSession(true)
          }}
        />
      )}

      <UserDashboard
        participants={data.participants}
        expenseBalances={expenseBalances}
        pairAdjustments={pairAdjustments}
        participantById={participantById}
        selectedParticipantId={selectedParticipantId}
        onSelectParticipant={setSelectedParticipantId}
      />

      {isAdmin && (
        <AdminDashboard
          participants={data.participants}
          expenses={data.expenses}
          expenseBalances={expenseBalances}
          pairAdjustments={pairAdjustments}
          participantById={participantById}
          onAddParticipants={addParticipants}
          onDeleteParticipant={removeParticipant}
          onDeleteExpense={removeExpense}
          onAddExpense={addExpense}
          onEditExpense={editExpense}
          onRecordSharePayment={recordSharePayment}
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
  expenseBalances,
  pairAdjustments,
  participantById,
  onAddParticipants,
  onDeleteParticipant,
  onDeleteExpense,
  onAddExpense,
  onEditExpense,
  onRecordSharePayment,
  isSaving,
}) {
  const [participantName, setParticipantName] = useState('')
  const [editingExpenseId, setEditingExpenseId] = useState('')
  const [isSplitLocked, setIsSplitLocked] = useState(false)
  const [title, setTitle] = useState('')
  const [amount, setAmount] = useState('')
  const [paidBy, setPaidBy] = useState(participants[0]?.id || '')
  const [selectedParticipants, setSelectedParticipants] = useState([])
  const [note, setNote] = useState('')
  const [isExpenseFormHighlighted, setIsExpenseFormHighlighted] = useState(false)
  const expenseFormRef = useRef(null)
  const highlightTimeoutRef = useRef(null)

  useEffect(() => {
    return () => {
      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current)
      }
    }
  }, [])

  const safePaidBy = participants.some((participant) => participant.id === paidBy)
    ? paidBy
    : participants[0]?.id || ''

  const validSelectedParticipants = selectedParticipants.filter((id) =>
    participants.some((participant) => participant.id === id) && id !== safePaidBy,
  )

  const selectableParticipants = participants.filter((participant) => participant.id !== safePaidBy)

  const resetExpenseForm = () => {
    setEditingExpenseId('')
    setIsSplitLocked(false)
    setTitle('')
    setAmount('')
    setPaidBy(participants[0]?.id || '')
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
    setIsSplitLocked(Boolean(expense.hasPayments))
    setTitle(expense.title)
    setAmount(String(expense.amount))
    setPaidBy(expense.paidBy)
    setSelectedParticipants(expense.participantIds.filter((id) => id !== expense.paidBy))
    setNote(expense.note || '')

    if (expenseFormRef.current) {
      expenseFormRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }

    setIsExpenseFormHighlighted(true)
    if (highlightTimeoutRef.current) {
      clearTimeout(highlightTimeoutRef.current)
    }
    highlightTimeoutRef.current = setTimeout(() => {
      setIsExpenseFormHighlighted(false)
      highlightTimeoutRef.current = null
    }, 900)
  }

  const submitParticipant = async (event) => {
    event.preventDefault()
    const parsed = participantName
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)

    if (parsed.length === 0) return

    const ok = await onAddParticipants(parsed)
    if (ok) {
      setParticipantName('')
    }
  }

  const submitExpense = async (event) => {
    event.preventDefault()

    if (!title.trim() || !amount || !safePaidBy || validSelectedParticipants.length === 0) {
      return
    }

    const payload = {
      id: editingExpenseId,
      title,
      amount,
      paidBy: safePaidBy,
      participantIds: validSelectedParticipants,
      note,
    }

    const ok = editingExpenseId ? await onEditExpense(payload) : await onAddExpense(payload)

    if (ok) {
      resetExpenseForm()
    }
  }

  const handleDeleteParticipant = async (participant) => {
    const ok = window.confirm(
      `Delete ${participant.name}? This will remove their unpaid references and any expense they paid.`,
    )
    if (!ok) return
    await onDeleteParticipant(participant.id)
  }

  const handleRecordPayment = async (item) => {
    const fromName = participantById.get(item.from)?.name || 'Unknown'
    const toName = participantById.get(item.to)?.name || 'Unknown'

    const promptValue = window.prompt(
      `Enter amount paid by ${fromName} to ${toName}.\nYou can enter more than remaining; extra will be added as a reverse due.`,
      item.amount.toFixed(2),
    )

    if (promptValue === null) return

    const parsed = Number(promptValue)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      window.alert('Please enter a valid amount greater than zero.')
      return
    }

    await onRecordSharePayment({
      shareId: item.shareId,
      from: item.from,
      to: item.to,
      amount: parsed,
    })
  }

  const handleDeleteExpense = async (expense) => {
    const ok = window.confirm(`Delete expense "${expense.title}"?`)
    if (!ok) return

    const removed = await onDeleteExpense(expense.id)
    if (removed && editingExpenseId === expense.id) {
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

      <article
        id="expense-form"
        ref={expenseFormRef}
        className={`panel pop-in delay-2${isExpenseFormHighlighted ? ' attention-pulse' : ''}`}
      >
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
              disabled={isSaving || (editingExpenseId && isSplitLocked)}
            />
          </label>
          <label>
            Paid by
            <select
              value={safePaidBy}
              onChange={(event) => setPaidBy(event.target.value)}
              required
              disabled={isSaving || (editingExpenseId && isSplitLocked)}
            >
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
            {editingExpenseId && isSplitLocked && (
              <p className="hint">Split fields are locked because payments already exist for this expense.</p>
            )}
            <div className="checkbox-grid">
              <label className="check-item">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleSelectAll}
                  disabled={isSaving || (editingExpenseId && isSplitLocked)}
                />
                All
              </label>
              {selectableParticipants.map((participant) => (
                <label key={participant.id} className="check-item">
                  <input
                    type="checkbox"
                    checked={validSelectedParticipants.includes(participant.id)}
                    onChange={() => toggleSelected(participant.id)}
                    disabled={isSaving || (editingExpenseId && isSplitLocked)}
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
        <h2>Open balances by expense</h2>
        {pairAdjustments.length > 0 && (
          <div className="hint-stack">
            <p className="hint">Auto-settled opposite dues:</p>
            <ul className="list compact-list">
              {pairAdjustments.map((adjustment) => (
                <li key={`adj-${adjustment.from}-${adjustment.to}`}>
                  <span>
                    {participantById.get(adjustment.from)?.name || 'Unknown'} {'<->'}{' '}
                    {participantById.get(adjustment.to)?.name || 'Unknown'}
                  </span>
                  <strong>{money.format(adjustment.amount)}</strong>
                </li>
              ))}
            </ul>
          </div>
        )}
        {expenseBalances.length === 0 ? (
          <p className="hint">All balances are clear.</p>
        ) : (
          <ul className="expense-list">
            {expenseBalances.map((group) => (
              <li key={group.expenseId} className="expense-group">
                <div>
                  <p className="expense-title">{group.title}</p>
                  <p className="hint">
                    Paid by {participantById.get(group.payer)?.name || 'Unknown'} • Pending{' '}
                    {money.format(group.totalPending)}
                  </p>
                  {group.autoSettledTotal > 0 && (
                    <p className="hint">Auto-settled in this expense: {money.format(group.autoSettledTotal)}</p>
                  )}
                  {group.note && <p className="hint">{group.note}</p>}
                  <ul className="list inner-list">
                    {group.items.map((item) => (
                      <li key={item.shareId}>
                        <div>
                          <p className="expense-title">
                            {participantById.get(item.from)?.name || 'Unknown'} owes{' '}
                            {participantById.get(item.to)?.name || 'Unknown'}
                          </p>
                          <p className="hint">
                            Original {money.format(item.fullShare)}
                            {item.autoSettled > 0 && ` • Auto-settled ${money.format(item.autoSettled)}`}
                            {' • '}Paid {money.format(item.paidAmount)} • Remaining {money.format(item.amount)}
                          </p>
                          {item.kind === 'overpayment_return' && (
                            <p className="hint">Overpayment return</p>
                          )}
                        </div>
                        <button
                          className="primary-btn"
                          type="button"
                          disabled={isSaving}
                          onClick={() => handleRecordPayment(item)}
                        >
                          Record payment
                        </button>
                      </li>
                    ))}
                  </ul>
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
            {expenses.map((expense) => {
              const splitCount = new Set(expense.participantIds.filter((id) => id !== expense.paidBy)).size + 1

              return (
                <li key={expense.id}>
                  <div>
                    <p className="expense-title">{expense.title}</p>
                    <p className="hint">
                      Paid by {participantById.get(expense.paidBy)?.name || 'Unknown'} • Split among {splitCount}{' '}
                      (includes payer)
                    </p>
                    {expense.hasPayments && (
                      <p className="hint">Payments recorded • split fields locked during edit</p>
                    )}
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
              )
            })}
          </ul>
        )}
      </article>
    </section>
  )
}

function UserDashboard({
  participants,
  expenseBalances,
  pairAdjustments,
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

  const outgoingByExpense = groupBalancesForParticipant(expenseBalances, selected, 'outgoing')
  const incomingByExpense = groupBalancesForParticipant(expenseBalances, selected, 'incoming')

  const selectedAdjustments = pairAdjustments.filter(
    (adjustment) => adjustment.from === selected || adjustment.to === selected,
  )

  const selectedAutoSettled = sumAmounts(selectedAdjustments)

  const totalOwe = sumAmounts(outgoingByExpense)
  const totalGet = sumAmounts(incomingByExpense)
  const net = round2(totalGet - totalOwe)

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

      {selectedAdjustments.length > 0 && (
        <article className="panel pop-in delay-2">
          <h3>Auto-settled offsets</h3>
          <p className="hint">Automatically netted for you: {money.format(selectedAutoSettled)}</p>
          <ul className="list compact-list">
            {selectedAdjustments.map((adjustment) => {
              const counterpartyId = adjustment.from === selected ? adjustment.to : adjustment.from

              return (
                <li key={`my-adj-${adjustment.from}-${adjustment.to}`}>
                  <span>{participantById.get(counterpartyId)?.name || 'Unknown'}</span>
                  <strong>{money.format(adjustment.amount)}</strong>
                </li>
              )
            })}
          </ul>
        </article>
      )}

      <article className="panel split-grid delay-2 pop-in">
        <div>
          <h3>You should pay</h3>
          {outgoingByExpense.length === 0 ? (
            <p className="hint">No pending payments.</p>
          ) : (
            <ul className="expense-list">
              {outgoingByExpense.map((group) => (
                <li key={group.expenseId} className="expense-group">
                  <div>
                    <p className="expense-title">{group.title}</p>
                    {group.autoSettledTotal > 0 && (
                      <p className="hint">Auto-settled in this expense: {money.format(group.autoSettledTotal)}</p>
                    )}
                    {group.note && <p className="hint">{group.note}</p>}
                    <ul className="list inner-list">
                      {group.items.map((item) => (
                        <li key={item.shareId}>
                          <div>
                            <p className="expense-title">
                              {participantById.get(item.counterpartyId)?.name || 'Unknown'}
                              {item.kind === 'overpayment_return' ? ' (return)' : ''}
                            </p>
                            {item.autoSettled > 0 && (
                              <p className="hint">Auto-settled: {money.format(item.autoSettled)}</p>
                            )}
                          </div>
                          <strong>{money.format(item.amount)}</strong>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <strong>{money.format(group.amount)}</strong>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h3>Should receive</h3>
          {incomingByExpense.length === 0 ? (
            <p className="hint">Nothing pending.</p>
          ) : (
            <ul className="expense-list">
              {incomingByExpense.map((group) => (
                <li key={group.expenseId} className="expense-group">
                  <div>
                    <p className="expense-title">{group.title}</p>
                    {group.autoSettledTotal > 0 && (
                      <p className="hint">Auto-settled in this expense: {money.format(group.autoSettledTotal)}</p>
                    )}
                    {group.note && <p className="hint">{group.note}</p>}
                    <ul className="list inner-list">
                      {group.items.map((item) => (
                        <li key={item.shareId}>
                          <div>
                            <p className="expense-title">
                              {participantById.get(item.counterpartyId)?.name || 'Unknown'}
                              {item.kind === 'overpayment_return' ? ' (return)' : ''}
                            </p>
                            {item.autoSettled > 0 && (
                              <p className="hint">Auto-settled: {money.format(item.autoSettled)}</p>
                            )}
                          </div>
                          <strong>{money.format(item.amount)}</strong>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <strong>{money.format(group.amount)}</strong>
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
