package handlers

import (
	"net/http"

	"github.com/chanbistec/btg-devops-api/internal/db"
	"github.com/jackc/pgx/v5/pgxpool"
)

type AuditHandler struct {
	pool *pgxpool.Pool
}

func NewAuditHandler(pool *pgxpool.Pool) *AuditHandler {
	return &AuditHandler{pool: pool}
}

// GET /audits
// Returns lightweight audit list — no raw_data, no claude_analysis.
func (h *AuditHandler) List(w http.ResponseWriter, r *http.Request) {
	audits, err := db.ListAudits(r.Context(), h.pool)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not list audits")
		return
	}
	if audits == nil {
		audits = []db.AuditRow{}
	}
	writeJSON(w, http.StatusOK, audits)
}

// GET /audits/{id}
// GET /audits/{id}?resource=cosmosdb
// Without query param: returns full audit detail including raw_data.
// With ?resource=slug: returns only that resource's data from the audit.
func (h *AuditHandler) Get(w http.ResponseWriter, r *http.Request) {
	auditID := r.PathValue("id")
	if auditID == "" {
		writeError(w, http.StatusBadRequest, "audit id required")
		return
	}

	// If ?resource=slug is provided, return only that resource's data
	resourceSlug := r.URL.Query().Get("resource")
	if resourceSlug != "" {
		// Validate slug exists
		resource, err := db.GetResourceBySlug(r.Context(), h.pool, resourceSlug)
		if err != nil {
			writeError(w, http.StatusNotFound, "unknown resource type: "+resourceSlug)
			return
		}
		data, err := db.GetAuditResource(r.Context(), h.pool, auditID, resourceSlug)
		if err != nil {
			writeError(w, http.StatusNotFound, "no data found for this resource in the audit")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"audit_id": auditID,
			"resource": resource,
			"data":     data,
		})
		return
	}

	// No query param — return full audit
	audit, err := db.GetAudit(r.Context(), h.pool, auditID)
	if err != nil {
		writeError(w, http.StatusNotFound, "audit not found")
		return
	}
	writeJSON(w, http.StatusOK, audit)
}
