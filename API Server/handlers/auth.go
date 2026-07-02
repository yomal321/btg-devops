package handlers

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/chanbistec/btg-devops-api/internal/db"
	"github.com/chanbistec/btg-devops-api/middleware"
	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

type AuthHandler struct {
	pool      *pgxpool.Pool
	jwtSecret string
}

func NewAuthHandler(pool *pgxpool.Pool, jwtSecret string) *AuthHandler {
	return &AuthHandler{pool: pool, jwtSecret: jwtSecret}
}

// POST /auth/login
func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Email == "" || req.Password == "" {
		writeError(w, http.StatusBadRequest, "email and password required")
		return
	}

	user, err := db.GetUserByEmail(r.Context(), h.pool, req.Email)
	if err != nil {
		// Don't reveal whether the email exists
		writeError(w, http.StatusUnauthorized, "invalid credentials")
		return
	}

	if !user.IsActive {
		writeError(w, http.StatusUnauthorized, "account is deactivated")
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)); err != nil {
		writeError(w, http.StatusUnauthorized, "invalid credentials")
		return
	}

	// Sign JWT
	expiresAt := time.Now().Add(24 * time.Hour)
	claims := middleware.Claims{
		UserID: user.ID,
		Email:  user.Email,
		Role:   user.Role,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   user.ID,
			ExpiresAt: jwt.NewNumericDate(expiresAt),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenStr, err := token.SignedString([]byte(h.jwtSecret))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not sign token")
		return
	}

	// Save session in DB
	ip := r.RemoteAddr
	ua := r.UserAgent()
	if err := db.CreateSession(r.Context(), h.pool, user.ID, tokenStr, ip, ua); err != nil {
		writeError(w, http.StatusInternalServerError, "could not create session")
		return
	}

	// Update last_login
	_ = db.UpdateLastLogin(r.Context(), h.pool, user.ID)

	writeJSON(w, http.StatusOK, map[string]any{
		"token":      tokenStr,
		"expires_at": expiresAt,
		"user": map[string]any{
			"id":    user.ID,
			"email": user.Email,
			"role":  user.Role,
		},
	})
}

// POST /auth/logout
func (h *AuthHandler) Logout(w http.ResponseWriter, r *http.Request) {
	token := extractBearerFromRequest(r)
	if token == "" {
		writeError(w, http.StatusBadRequest, "no token provided")
		return
	}
	if err := db.DeleteSession(r.Context(), h.pool, token); err != nil {
		writeError(w, http.StatusInternalServerError, "could not delete session")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"message": "logged out"})
}

func extractBearerFromRequest(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if len(h) > 7 && h[:7] == "Bearer " {
		return h[7:]
	}
	return ""
}
