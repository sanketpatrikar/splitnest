import { supabase } from './supabase'

function mapExpense(row) {
  return {
    id: row.id,
    title: row.title,
    amount: Number(row.amount),
    paidBy: row.paid_by,
    participantIds: row.expense_participants.map((item) => item.participant_id),
    note: row.note || '',
    createdAt: row.created_at,
  }
}

function mapPayment(row) {
  return {
    id: row.id,
    from: row.from_participant_id,
    to: row.to_participant_id,
    amount: Number(row.amount),
    createdAt: row.created_at,
  }
}

export async function fetchData() {
  const [participantsResult, expensesResult, paymentsResult] = await Promise.all([
    supabase.from('participants').select('id, name').order('created_at', { ascending: true }),
    supabase
      .from('expenses')
      .select('id, title, amount, paid_by, note, created_at, expense_participants(participant_id)')
      .order('created_at', { ascending: false }),
    supabase
      .from('payments')
      .select('id, from_participant_id, to_participant_id, amount, created_at')
      .order('created_at', { ascending: false }),
  ])

  if (participantsResult.error) throw participantsResult.error
  if (expensesResult.error) throw expensesResult.error
  if (paymentsResult.error) throw paymentsResult.error

  return {
    participants: participantsResult.data,
    expenses: expensesResult.data.map(mapExpense),
    payments: paymentsResult.data.map(mapPayment),
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
  const participantIds = [...new Set(input.participantIds.filter((id) => id !== input.paidBy))]

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

  if (participantIds.length === 0) return

  const joinRows = participantIds.map((participantId) => ({
    expense_id: insertedExpense.id,
    participant_id: participantId,
  }))

  const { error: joinError } = await supabase.from('expense_participants').insert(joinRows)

  if (joinError) throw joinError
}

export async function updateExpense(input) {
  const participantIds = [...new Set(input.participantIds.filter((id) => id !== input.paidBy))]

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

  const { error: deleteJoinError } = await supabase
    .from('expense_participants')
    .delete()
    .eq('expense_id', input.id)

  if (deleteJoinError) throw deleteJoinError

  if (participantIds.length === 0) return

  const joinRows = participantIds.map((participantId) => ({
    expense_id: input.id,
    participant_id: participantId,
  }))

  const { error: joinError } = await supabase.from('expense_participants').insert(joinRows)

  if (joinError) throw joinError
}

export async function deleteExpense(expenseId) {
  const { error } = await supabase.from('expenses').delete().eq('id', expenseId)
  if (error) throw error
}

export async function createPayment(input) {
  const { error } = await supabase.from('payments').insert({
    from_participant_id: input.from,
    to_participant_id: input.to,
    amount: Number(input.amount),
  })

  if (error) throw error
}
