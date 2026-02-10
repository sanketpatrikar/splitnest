import { supabase } from './supabase'

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100
}

function toPaise(value) {
  return Math.round(Number(value) * 100)
}

function fromPaise(value) {
  return Number((value / 100).toFixed(2))
}

function toSet(values) {
  return new Set(values)
}

function setsEqual(a, b) {
  if (a.size !== b.size) return false
  for (const value of a) {
    if (!b.has(value)) return false
  }
  return true
}

function buildDebtorShares(totalAmount, debtorIds) {
  const uniqueDebtors = [...new Set(debtorIds)]
  const count = uniqueDebtors.length

  if (count === 0) return []

  const totalPaise = toPaise(totalAmount)
  const divisor = count + 1
  const baseShare = Math.floor(totalPaise / divisor)
  const remainder = totalPaise % divisor

  return uniqueDebtors.map((debtorId, index) => ({
    debtorId,
    amount: fromPaise(baseShare + (index < remainder ? 1 : 0)),
  }))
}

function mapSharePayment(row) {
  return {
    id: row.id,
    from: row.from_participant_id,
    to: row.to_participant_id,
    amount: Number(row.amount),
    note: row.note || '',
    createdAt: row.created_at,
  }
}

function mapExpenseShare(row) {
  const payments = (row.share_payments || []).map(mapSharePayment)
  const paidAmount = roundMoney(payments.reduce((sum, payment) => sum + Number(payment.amount), 0))
  const shareAmount = Number(row.share_amount)
  const remainingAmount = roundMoney(Math.max(shareAmount - paidAmount, 0))

  return {
    id: row.id,
    expenseId: row.expense_id,
    debtorId: row.debtor_id,
    creditorId: row.creditor_id,
    amount: shareAmount,
    kind: row.kind,
    originShareId: row.origin_share_id,
    note: row.note || '',
    createdAt: row.created_at,
    payments,
    paidAmount,
    remainingAmount,
  }
}

function mapExpense(row) {
  const shares = (row.expense_shares || [])
    .map(mapExpenseShare)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))

  return {
    id: row.id,
    title: row.title,
    amount: Number(row.amount),
    paidBy: row.paid_by,
    participantIds: (row.expense_participants || []).map((item) => item.participant_id),
    note: row.note || '',
    createdAt: row.created_at,
    shares,
    hasPayments: shares.some((share) => share.payments.length > 0),
  }
}

async function insertExpenseShares(expenseId, totalAmount, paidBy, debtorIds) {
  const shares = buildDebtorShares(totalAmount, debtorIds).map((share) => ({
    expense_id: expenseId,
    debtor_id: share.debtorId,
    creditor_id: paidBy,
    share_amount: share.amount,
    kind: 'expense_split',
  }))

  if (shares.length === 0) return

  const { error } = await supabase.from('expense_shares').insert(shares)
  if (error) throw error
}

export async function fetchData() {
  const [participantsResult, expensesResult] = await Promise.all([
    supabase.from('participants').select('id, name').order('created_at', { ascending: true }),
    supabase
      .from('expenses')
      .select(
        'id, title, amount, paid_by, note, created_at, expense_participants(participant_id), expense_shares(id, expense_id, debtor_id, creditor_id, share_amount, kind, origin_share_id, note, created_at, share_payments(id, from_participant_id, to_participant_id, amount, note, created_at))',
      )
      .order('created_at', { ascending: false }),
  ])

  if (participantsResult.error) throw participantsResult.error
  if (expensesResult.error) throw expensesResult.error

  return {
    participants: participantsResult.data,
    expenses: expensesResult.data.map(mapExpense),
  }
}

export async function createParticipants(names) {
  if (names.length === 0) return []

  const payload = names.map((name) => ({ name }))
  const { data, error } = await supabase.from('participants').insert(payload).select('id, name')

  if (error) throw error
  return data
}

export async function deleteParticipant(participantId) {
  const { error } = await supabase.from('participants').delete().eq('id', participantId)
  if (error) throw error
}

export async function createExpense(input) {
  const debtors = [...new Set(input.participantIds.filter((id) => id !== input.paidBy))]
  if (debtors.length === 0) {
    throw new Error('At least one participant must owe this expense.')
  }

  const { data: insertedExpense, error: expenseError } = await supabase
    .from('expenses')
    .insert({
      title: input.title.trim(),
      amount: Number(input.amount),
      paid_by: input.paidBy,
      note: input.note.trim(),
    })
    .select('id')
    .single()

  if (expenseError) throw expenseError

  const joinRows = debtors.map((participantId) => ({
    expense_id: insertedExpense.id,
    participant_id: participantId,
  }))

  const { error: joinError } = await supabase.from('expense_participants').insert(joinRows)
  if (joinError) throw joinError

  await insertExpenseShares(insertedExpense.id, Number(input.amount), input.paidBy, debtors)
}

export async function updateExpense(input) {
  const nextDebtors = [...new Set(input.participantIds.filter((id) => id !== input.paidBy))]
  if (nextDebtors.length === 0) {
    throw new Error('At least one participant must owe this expense.')
  }

  const { data: existingExpense, error: existingError } = await supabase
    .from('expenses')
    .select(
      'id, amount, paid_by, expense_participants(participant_id), expense_shares(id, share_payments(id))',
    )
    .eq('id', input.id)
    .single()

  if (existingError) throw existingError

  const currentDebtors = toSet((existingExpense.expense_participants || []).map((item) => item.participant_id))
  const nextDebtorsSet = toSet(nextDebtors)

  const amountChanged = roundMoney(existingExpense.amount) !== roundMoney(input.amount)
  const payerChanged = existingExpense.paid_by !== input.paidBy
  const debtorsChanged = !setsEqual(currentDebtors, nextDebtorsSet)
  const splitChanged = amountChanged || payerChanged || debtorsChanged

  const hasPayments = (existingExpense.expense_shares || []).some(
    (share) => (share.share_payments || []).length > 0,
  )

  if (splitChanged && hasPayments) {
    throw new Error(
      'Split details cannot be changed after payments are recorded. Create a new correction expense instead.',
    )
  }

  const { error: expenseError } = await supabase
    .from('expenses')
    .update({
      title: input.title.trim(),
      amount: Number(input.amount),
      paid_by: input.paidBy,
      note: input.note.trim(),
    })
    .eq('id', input.id)

  if (expenseError) throw expenseError

  if (!splitChanged) return

  const { error: deleteParticipantsError } = await supabase
    .from('expense_participants')
    .delete()
    .eq('expense_id', input.id)

  if (deleteParticipantsError) throw deleteParticipantsError

  const joinRows = nextDebtors.map((participantId) => ({
    expense_id: input.id,
    participant_id: participantId,
  }))

  const { error: joinError } = await supabase.from('expense_participants').insert(joinRows)
  if (joinError) throw joinError

  const { error: deleteSharesError } = await supabase
    .from('expense_shares')
    .delete()
    .eq('expense_id', input.id)

  if (deleteSharesError) throw deleteSharesError

  await insertExpenseShares(input.id, Number(input.amount), input.paidBy, nextDebtors)
}

export async function deleteExpense(expenseId) {
  const { error } = await supabase.from('expenses').delete().eq('id', expenseId)
  if (error) throw error
}

export async function createSharePayment(input) {
  const amount = roundMoney(Number(input.amount))
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Payment amount must be greater than zero.')
  }

  const { data: share, error: shareError } = await supabase
    .from('expense_shares')
    .select('id, expense_id, debtor_id, creditor_id, share_amount, share_payments(amount)')
    .eq('id', input.shareId)
    .single()

  if (shareError) throw shareError

  if (share.debtor_id !== input.from || share.creditor_id !== input.to) {
    throw new Error('Payment participants do not match the selected balance item.')
  }

  const paidAmount = roundMoney(
    (share.share_payments || []).reduce((sum, payment) => sum + Number(payment.amount), 0),
  )
  const remaining = roundMoney(Math.max(Number(share.share_amount) - paidAmount, 0))
  const applied = roundMoney(Math.min(amount, remaining))

  if (applied > 0) {
    const { error: paymentError } = await supabase.from('share_payments').insert({
      expense_share_id: share.id,
      from_participant_id: input.from,
      to_participant_id: input.to,
      amount: applied,
      note: input.note || '',
    })

    if (paymentError) throw paymentError
  }

  const extra = roundMoney(amount - applied)

  if (extra > 0) {
    const { error: reverseShareError } = await supabase.from('expense_shares').insert({
      expense_id: share.expense_id,
      debtor_id: share.creditor_id,
      creditor_id: share.debtor_id,
      share_amount: extra,
      kind: 'overpayment_return',
      origin_share_id: share.id,
      note: 'Auto-created from overpayment',
    })

    if (reverseShareError) throw reverseShareError
  }
}
