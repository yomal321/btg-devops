package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/chanbistec/btg-devops-api/internal/db"
	"github.com/chanbistec/btg-devops-api/middleware"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

type UserHandler struct {
	pool *pgxpool.Pool
}

func NewUserHandler(pool *pgxpool.Pool) *UserHandler {
	return &UserHandler{pool: pool}
}

// GET /users  (admin only)
func (h *UserHandler) List(w http.ResponseWriter, r *http.Request) {
	users, err := db.ListUsers(r.Context(), h.pool)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not list users")
		return
	}
	if users == nil {
		users = []db.User{}
	}
	writeJSON(w, http.StatusOK, users)
}

// POST /users  (admin only)
func (h *UserHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
		Role     string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Email == "" || req.Password == "" || req.Role == "" {
		writeError(w, http.StatusBadRequest, "email, password, and role required")
		return
	}
	if req.Role != "admin" && req.Role != "analyst" && req.Role != "viewer" {
		writeError(w, http.StatusBadRequest, "role must be admin, analyst, or viewer")
		return
	}
	if len(req.Password) < 8 {
		writeError(w, http.StatusBadRequest, "password must be at least 8 characters")
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not hash password")
		return
	}

	adminID := middleware.UserIDFromContext(r.Context())
	id, err := db.CreateUser(r.Context(), h.pool, db.CreateUserParams{
		Email:        req.Email,
		PasswordHash: string(hash),
		Role:         req.Role,
		CreatedBy:    adminID,
	})
	if err != nil {
		writeError(w, http.StatusConflict, "could not create user (email may already exist)")
		return
	}

	writeJSON(w, http.StatusCreated, map[string]string{"id": id})
}

// PATCH /users/{id}  (admin only)
func (h *UserHandler) Update(w http.ResponseWriter, r *http.Request) {
	userID := r.PathValue("id")
	if userID == "" {
		writeError(w, http.StatusBadRequest, "user id required")
		return
	}

	var req struct {
		Role     *string `json:"role"`
		IsActive *bool   `json:"is_active"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Role != nil && *req.Role != "admin" && *req.Role != "analyst" && *req.Role != "viewer" {
		writeError(w, http.StatusBadRequest, "role must be admin, analyst, or viewer")
		return
	}

	if err := db.UpdateUser(r.Context(), h.pool, db.UpdateUserParams{
		UserID:   userID,
		Role:     req.Role,
		IsActive: req.IsActive,
	}); err != nil {
		writeError(w, http.StatusInternalServerError, "could not update user")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"message": "updated"})
}
