package db

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// User represents a user row from the database.
type User struct {
	ID           string    `json:"id"`
	Email        string    `json:"email"`
	PasswordHash string    `json:"-"`
	Role         string    `json:"role"`
	IsActive     bool      `json:"is_active"`
	CreatedAt    time.Time `json:"created_at"`
	LastLogin    *time.Time `json:"last_login,omitempty"`
}

// GetUserByEmail looks up a user by email for login.
func GetUserByEmail(ctx context.Context, pool *pgxpool.Pool, email string) (*User, error) {
	var u User
	var lastLogin *time.Time
	err := pool.QueryRow(ctx, `
		SELECT id::text, email, password_hash, role, is_active, created_at, last_login
		FROM users
		WHERE email = $1
	`, email).Scan(&u.ID, &u.Email, &u.PasswordHash, &u.Role, &u.IsActive, &u.CreatedAt, &lastLogin)
	if err != nil {
		return nil, fmt.Errorf("getting user by email: %w", err)
	}
	u.LastLogin = lastLogin
	return &u, nil
}

// UpdateLastLogin records the current timestamp as the user's last login time.
func UpdateLastLogin(ctx context.Context, pool *pgxpool.Pool, userID string) error {
	_, err := pool.Exec(ctx, `UPDATE users SET last_login = NOW() WHERE id = $1`, userID)
	if err != nil {
		return fmt.Errorf("updating last login: %w", err)
	}
	return nil
}

// ListUsers returns all users for admin user management view.
func ListUsers(ctx context.Context, pool *pgxpool.Pool) ([]User, error) {
	rows, err := pool.Query(ctx, `
		SELECT id::text, email, password_hash, role, is_active, created_at, last_login
		FROM users
		ORDER BY created_at ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("listing users: %w", err)
	}
	defer rows.Close()

	var users []User
	for rows.Next() {
		var u User
		var lastLogin *time.Time
		if err := rows.Scan(&u.ID, &u.Email, &u.PasswordHash, &u.Role, &u.IsActive, &u.CreatedAt, &lastLogin); err != nil {
			return nil, fmt.Errorf("scanning user: %w", err)
		}
		u.LastLogin = lastLogin
		users = append(users, u)
	}
	return users, nil
}

// CreateUserParams holds fields for creating a new user.
type CreateUserParams struct {
	Email        string
	PasswordHash string
	Role         string
	CreatedBy    string
}

// CreateUser inserts a new user and returns their ID.
func CreateUser(ctx context.Context, pool *pgxpool.Pool, p CreateUserParams) (string, error) {
	var id string
	err := pool.QueryRow(ctx, `
		INSERT INTO users (email, password_hash, role, created_by)
		VALUES ($1, $2, $3, $4)
		RETURNING id::text
	`, p.Email, p.PasswordHash, p.Role, p.CreatedBy).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("creating user: %w", err)
	}
	return id, nil
}

// UpdateUserParams holds fields that can be updated by an admin.
type UpdateUserParams struct {
	UserID   string
	Role     *string
	IsActive *bool
}

// UpdateUser applies role and/or is_active changes to a user.
func UpdateUser(ctx context.Context, pool *pgxpool.Pool, p UpdateUserParams) error {
	if p.Role != nil {
		if _, err := pool.Exec(ctx, `UPDATE users SET role = $2 WHERE id = $1`, p.UserID, *p.Role); err != nil {
			return fmt.Errorf("updating role: %w", err)
		}
	}
	if p.IsActive != nil {
		if _, err := pool.Exec(ctx, `UPDATE users SET is_active = $2 WHERE id = $1`, p.UserID, *p.IsActive); err != nil {
			return fmt.Errorf("updating is_active: %w", err)
		}
	}
	return nil
}
