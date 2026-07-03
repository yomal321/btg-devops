import { findMessagesByAudit, insertMessage, findMessageById, updateMessage, deleteMessage } from '../models/chat'
import { JWTPayload } from '../types'

export async function listChatController(auditId: string) {
  const messages = await findMessagesByAudit(auditId)
  return { data: messages, status: 200 }
}

export async function saveChatController(
  auditId: string,
  body: { role: string; content: string },
  auth: JWTPayload
) {
  const { role, content } = body

  if (!role || !content) {
    return { error: 'role and content required', status: 400 }
  }
  if (role !== 'user' && role !== 'assistant') {
    return { error: 'role must be user or assistant', status: 400 }
  }

  await insertMessage(auditId, auth.user_id, role, content)
  return { data: { message: 'saved' }, status: 201 }
}

export async function getChatMessageController(messageId: number) {
  const msg = await findMessageById(messageId)
  if (!msg) return { error: 'message not found', status: 404 }
  return { data: msg, status: 200 }
}

export async function updateChatController(messageId: number, body: { content: string }) {
  if (!body.content) return { error: 'content required', status: 400 }
  const updated = await updateMessage(messageId, body.content)
  if (!updated) return { error: 'message not found', status: 404 }
  return { data: { message: 'updated' }, status: 200 }
}

export async function deleteChatController(messageId: number) {
  const deleted = await deleteMessage(messageId)
  if (!deleted) return { error: 'message not found', status: 404 }
  return { data: { message: 'deleted' }, status: 200 }
}
