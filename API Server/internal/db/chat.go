package db

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// ChatMessage is one message in an audit chat thread.
type ChatMessage struct {
	ID        string    `json:"id"`
	AuditID   string    `json:"audit_id"`
	UserID    string    `json:"user_id"`
	Role      string    `json:"role"` // "user" | "assistant"
	Content   string    `json:"content"`
	CreatedAt time.Time `json:"created_at"`
}

// SaveMessage inserts a new chat message.
func SaveMessage(ctx context.Context, pool *pgxpool.Pool, auditID, userID, role, content string) error {
	_, err := pool.Exec(ctx, `
		INSERT INTO chat_messages (audit_id, user_id, role, content)
		VALUES ($1, $2, $3, $4)
	`, auditID, userID, role, content)
	if err != nil {
		return fmt.Errorf("saving chat message: %w", err)
	}
	return nil
}

// ListMessages returns all chat messages for an audit in chronological order.
func ListMessages(ctx context.Context, pool *pgxpool.Pool, auditID string) ([]ChatMessage, error) {
	rows, err := pool.Query(ctx, `
		SELECT id::text, audit_id::text, user_id::text, role, content, created_at
		FROM chat_messages
		WHERE audit_id = $1
		ORDER BY created_at ASC
	`, auditID)
	if err != nil {
		return nil, fmt.Errorf("listing messages: %w", err)
	}
	defer rows.Close()

	var messages []ChatMessage
	for rows.Next() {
		var m ChatMessage
		if err := rows.Scan(&m.ID, &m.AuditID, &m.UserID, &m.Role, &m.Content, &m.CreatedAt); err != nil {
			return nil, fmt.Errorf("scanning message: %w", err)
		}
		messages = append(messages, m)
	}
	return messages, nil
}
