import pool from './client'
import { ChatMessage } from '../types'

export async function findMessagesByAudit(auditId: string): Promise<ChatMessage[]> {
  const { rows } = await pool.query(
    `SELECT id, audit_id, user_id, role, content, created_at
     FROM chat_messages WHERE audit_id = $1 ORDER BY created_at ASC`,
    [auditId]
  )
  return rows
}

export async function insertMessage(
  auditId: string,
  userId: string,
  role: string,
  content: string
): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO chat_messages (audit_id, user_id, role, content)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [auditId, userId, role, content]
  )
  return rows[0].id
}

export async function findMessageById(messageId: number): Promise<ChatMessage | null> {
  const { rows } = await pool.query(
    `SELECT id, audit_id, user_id, role, content, created_at
     FROM chat_messages WHERE id = $1`,
    [messageId]
  )
  return rows[0] || null
}

export async function updateMessage(messageId: number, content: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE chat_messages SET content = $2 WHERE id = $1`,
    [messageId, content]
  )
  return (rowCount ?? 0) > 0
}

export async function deleteMessage(messageId: number): Promise<boolean> {
  const { rowCount } = await pool.query(`DELETE FROM chat_messages WHERE id = $1`, [messageId])
  return (rowCount ?? 0) > 0
}
