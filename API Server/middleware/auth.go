package middleware

import (
	"context"
	"net/http"
	"strings"

	"github.com/chanbistec/btg-devops-api/internal/db"
	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type contextKey string

const (
	ContextUserID = contextKey("user_id")
	ContextRole   = contextKey("role")
	ContextEmail  = contextKey("email")
)

// Claims holds the JWT payload fields.
type Claims struct {
	UserID string `json:"user_id"`
	Email  string `json:"email"`
	Role   string `json:"role"`
	jwt.RegisteredClaims
}

// Auth returns an HTTP middleware that validates the JWT Bearer token.
// It checks both the token signature and that the session exists in the DB.
func Auth(pool *pgxpool.Pool, jwtSecret string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			token := extractBearer(r)
			if token == "" {
				http.Error(w, `{"error":"missing authorization token"}`, http.StatusUnauthorized)
				return
			}

			claims, err := parseJWT(token, jwtSecret)
			if err != nil {
				http.Error(w, `{"error":"invalid token"}`, http.StatusUnauthorized)
				return
			}

			// Validate session exists in DB (not logged out)
			userID, err := db.ValidateSession(r.Context(), pool, token)
			if err != nil || userID == "" {
				http.Error(w, `{"error":"session expired or invalid"}`, http.StatusUnauthorized)
				return
			}

			// Attach user info to request context
			ctx := context.WithValue(r.Context(), ContextUserID, claims.UserID)
			ctx = context.WithValue(ctx, ContextRole, claims.Role)
			ctx = context.WithValue(ctx, ContextEmail, claims.Email)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// RequireRole returns middleware that allows only the specified roles.
// Must be used after Auth middleware.
func RequireRole(roles ...string) func(http.Handler) http.Handler {
	allowed := make(map[string]bool, len(roles))
	for _, r := range roles {
		allowed[r] = true
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			role, _ := r.Context().Value(ContextRole).(string)
			if !allowed[role] {
				http.Error(w, `{"error":"forbidden"}`, http.StatusForbidden)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// UserIDFromContext extracts the user ID string from a request context.
func UserIDFromContext(ctx context.Context) string {
	v, _ := ctx.Value(ContextUserID).(string)
	return v
}

// RoleFromContext extracts the role string from a request context.
func RoleFromContext(ctx context.Context) string {
	v, _ := ctx.Value(ContextRole).(string)
	return v
}

func extractBearer(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if !strings.HasPrefix(h, "Bearer ") {
		return ""
	}
	return strings.TrimPrefix(h, "Bearer ")
}

func parseJWT(tokenStr, secret string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &Claims{}, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, jwt.ErrSignatureInvalid
		}
		return []byte(secret), nil
	})
	if err != nil {
		return nil, err
	}
	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		return nil, jwt.ErrTokenInvalidClaims
	}
	return claims, nil
}
