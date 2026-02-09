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

export async function fetchData() {
  const [participantsResult, expensesResult] = await Promise.all([
    supabase.from('participants').select('id, name').order('created_at', { ascending: true }),
    supabase
      .from('expenses')
      .select('id, title, amount, paid_by, note, created_at, expense_participants(participant_id)')
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
  const participantIds = input.participantIds.includes(input.paidBy)
    ? input.participantIds
    : [...input.participantIds, input.paidBy]

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

  const joinRows = participantIds.map((participantId) => ({
    expense_id: insertedExpense.id,
    participant_id: participantId,
  }))

  const { error: joinError } = await supabase.from('expense_participants').insert(joinRows)

  if (joinError) throw joinError
}
