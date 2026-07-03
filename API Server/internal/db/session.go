package db

import (
	"context"
	"crypto/sha256"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

const sessionDuration = 24 * time.Hour

// hashToken returns a SHA-256 hex hash of the JWT token string.
// We store the hash, not the raw token, so the DB never holds a live credential.
func hashToken(token string) string {
	h := sha256.Sum256([]byte(token))
	return fmt.Sprintf("%x", h)
}

// CreateSession records a new JWT session in the database.
func CreateSession(ctx context.Context, pool *pgxpool.Pool, userID, token, ipAddress, userAgent string) error {
	expiresAt := time.Now().Add(sessionDuration)
	_, err := pool.Exec(ctx, `
		INSERT INTO user_sessions (user_id, token_hash, expires_at, ip_address, user_agent)
		VALUES ($1, $2, $3, $4, $5)
	`, userID, hashToken(token), expiresAt, ipAddress, userAgent)
	if err != nil {
		return fmt.Errorf("creating session: %w", err)
	}
	return nil
}

// ValidateSession checks that the token hash exists and is not expired.
// Returns the user_id if valid, empty string if not found or expired.
func ValidateSession(ctx context.Context, pool *pgxpool.Pool, token string) (userID string, err error) {
	err = pool.QueryRow(ctx, `
		SELECT user_id::text FROM user_sessions
		WHERE token_hash = $1 AND expires_at > NOW()
	`, hashToken(token)).Scan(&userID)
	if err != nil {
		return "", fmt.Errorf("validating session: %w", err)
	}
	return userID, nil
}

// DeleteSession removes a session (logout).
func DeleteSession(ctx context.Context, pool *pgxpool.Pool, token string) error {
	_, err := pool.Exec(ctx, `DELETE FROM user_sessions WHERE token_hash = $1`, hashToken(token))
	if err != nil {
		return fmt.Errorf("deleting session: %w", err)
	}
	return nil
}

// DeleteExpiredSessions removes all sessions past their expiry time.
func DeleteExpiredSessions(ctx context.Context, pool *pgxpool.Pool) error {
	_, err := pool.Exec(ctx, `DELETE FROM user_sessions WHERE expires_at <= NOW()`)
	if err != nil {
		return fmt.Errorf("deleting expired sessions: %w", err)
	}
	return nil
}
