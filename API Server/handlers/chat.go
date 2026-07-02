package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/chanbistec/btg-devops-api/internal/db"
	"github.com/chanbistec/btg-devops-api/middleware"
	"github.com/jackc/pgx/v5/pgxpool"
)

type ChatHandler struct {
	pool *pgxpool.Pool
}

func NewChatHandler(pool *pgxpool.Pool) *ChatHandler {
	return &ChatHandler{pool: pool}
}

// GET /audits/{id}/chat
// Returns all chat messages for an audit in chronological order.
func (h *ChatHandler) List(w http.ResponseWriter, r *http.Request) {
	auditID := r.PathValue("id")
	if auditID == "" {
		writeError(w, http.StatusBadRequest, "audit id required")
		return
	}

	messages, err := db.ListMessages(r.Context(), h.pool, auditID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not list messages")
		return
	}
	if messages == nil {
		messages = []db.ChatMessage{}
	}
	writeJSON(w, http.StatusOK, messages)
}

// POST /audits/{id}/chat
// Saves a chat message (user or assistant role).
// The Next.js dashboard calls Claude directly, then saves both the user
// message and Claude's response via this endpoint.
func (h *ChatHandler) Save(w http.ResponseWriter, r *http.Request) {
	auditID := r.PathValue("id")
	if auditID == "" {
		writeError(w, http.StatusBadRequest, "audit id required")
		return
	}

	userID := middleware.UserIDFromContext(r.Context())

	var req struct {
		Role    string `json:"role"`
		Content string `json:"content"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Role != "user" && req.Role != "assistant" {
		writeError(w, http.StatusBadRequest, "role must be 'user' or 'assistant'")
		return
	}
	if req.Content == "" {
		writeError(w, http.StatusBadRequest, "content required")
		return
	}

	if err := db.SaveMessage(r.Context(), h.pool, auditID, userID, req.Role, req.Content); err != nil {
		writeError(w, http.StatusInternalServerError, "could not save message")
		return
	}

	writeJSON(w, http.StatusCreated, map[string]string{"message": "saved"})
}
