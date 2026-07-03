package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/chanbistec/btg-devops-api/internal/db"
	"github.com/jackc/pgx/v5/pgxpool"
)

type FindingsHandler struct {
	pool *pgxpool.Pool
}

func NewFindingsHandler(pool *pgxpool.Pool) *FindingsHandler {
	return &FindingsHandler{pool: pool}
}

// GET /audits/{id}/findings
// Returns all findings for an audit ordered by severity (Critical first).
func (h *FindingsHandler) List(w http.ResponseWriter, r *http.Request) {
	auditID := r.PathValue("id")
	if auditID == "" {
		writeError(w, http.StatusBadRequest, "audit id required")
		return
	}

	findings, err := db.ListFindings(r.Context(), h.pool, auditID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not list findings")
		return
	}
	if findings == nil {
		findings = []db.Finding{}
	}
	writeJSON(w, http.StatusOK, findings)
}

// POST /audits/{id}/findings
// Saves findings extracted from Claude's analysis response.
// Called by the Next.js dashboard after receiving Claude's response.
func (h *FindingsHandler) Save(w http.ResponseWriter, r *http.Request) {
	auditID := r.PathValue("id")
	if auditID == "" {
		writeError(w, http.StatusBadRequest, "audit id required")
		return
	}

	var findings []db.Finding
	if err := json.NewDecoder(r.Body).Decode(&findings); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	for _, f := range findings {
		if err := db.SaveFinding(r.Context(), h.pool, auditID, f); err != nil {
			writeError(w, http.StatusInternalServerError, "could not save finding")
			return
		}
	}

	writeJSON(w, http.StatusCreated, map[string]any{
		"saved": len(findings),
	})
}

// POST /audits/{id}/analysis
// Saves the full Claude analysis JSON blob for an audit (for caching).
func (h *FindingsHandler) SaveAnalysis(w http.ResponseWriter, r *http.Request) {
	auditID := r.PathValue("id")
	if auditID == "" {
		writeError(w, http.StatusBadRequest, "audit id required")
		return
	}

	var body json.RawMessage
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if err := db.SaveClaudeAnalysis(r.Context(), h.pool, auditID, body); err != nil {
		writeError(w, http.StatusInternalServerError, "could not save analysis")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"message": "analysis saved"})
}
