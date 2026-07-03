package handlers

import (
	"net/http"
	"strconv"

	"github.com/chanbistec/btg-devops-api/internal/db"
	"github.com/jackc/pgx/v5/pgxpool"
)

type ResourceHandler struct {
	pool *pgxpool.Pool
}

func NewResourceHandler(pool *pgxpool.Pool) *ResourceHandler {
	return &ResourceHandler{pool: pool}
}

// GET /resources
// Returns the full list of all 12 resource type definitions.
func (h *ResourceHandler) List(w http.ResponseWriter, r *http.Request) {
	resources, err := db.ListResources(r.Context(), h.pool)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not list resources")
		return
	}
	if resources == nil {
		resources = []db.Resource{}
	}
	writeJSON(w, http.StatusOK, resources)
}

// GET /audits/{id}/resources/{slug}
// Returns one resource type's data from a specific audit using slug.
// Example: GET /audits/abc123/resources/storage
func (h *ResourceHandler) GetBySlug(w http.ResponseWriter, r *http.Request) {
	auditID := r.PathValue("id")
	slug := r.PathValue("slug")

	if auditID == "" || slug == "" {
		writeError(w, http.StatusBadRequest, "audit id and resource slug required")
		return
	}

	// Validate slug exists in resources table
	resource, err := db.GetResourceBySlug(r.Context(), h.pool, slug)
	if err != nil {
		writeError(w, http.StatusNotFound, "unknown resource type: "+slug)
		return
	}

	// Fetch that resource's data from the audit
	data, err := db.GetAuditResource(r.Context(), h.pool, auditID, slug)
	if err != nil {
		writeError(w, http.StatusNotFound, "no data found for this resource in the audit")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"resource": resource,
		"data":     data,
	})
}

// GET /audits/{id}/resources/id/{resource_id}
// Returns one resource type's data from a specific audit using numeric id.
// Example: GET /audits/abc123/resources/id/1
func (h *ResourceHandler) GetByID(w http.ResponseWriter, r *http.Request) {
	auditID := r.PathValue("id")
	resourceIDStr := r.PathValue("resource_id")

	if auditID == "" || resourceIDStr == "" {
		writeError(w, http.StatusBadRequest, "audit id and resource id required")
		return
	}

	resourceID, err := strconv.Atoi(resourceIDStr)
	if err != nil {
		writeError(w, http.StatusBadRequest, "resource id must be a number")
		return
	}

	// Look up the resource definition
	resource, err := db.GetResourceByID(r.Context(), h.pool, resourceID)
	if err != nil {
		writeError(w, http.StatusNotFound, "resource id not found")
		return
	}

	// Fetch that resource's data from the audit
	data, err := db.GetAuditResource(r.Context(), h.pool, auditID, resource.Slug)
	if err != nil {
		writeError(w, http.StatusNotFound, "no data found for this resource in the audit")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"resource": resource,
		"data":     data,
	})
}
