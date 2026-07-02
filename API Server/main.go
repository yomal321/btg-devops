package main

import (
	"context"
	"fmt"
	"net/http"
	"os"

	"github.com/chanbistec/btg-devops-api/handlers"
	"github.com/chanbistec/btg-devops-api/internal/db"
	"github.com/chanbistec/btg-devops-api/middleware"
)

func main() {
	ctx := context.Background()

	// --- Required environment variables ---
	databaseURL := os.Getenv("DATABASE_URL")
	jwtSecret := os.Getenv("JWT_SECRET")
	port := os.Getenv("PORT")

	if databaseURL == "" {
		fmt.Fprintln(os.Stderr, "DATABASE_URL is required")
		os.Exit(1)
	}
	if jwtSecret == "" {
		fmt.Fprintln(os.Stderr, "JWT_SECRET is required")
		os.Exit(1)
	}
	if port == "" {
		port = "8080"
	}

	// --- Database ---
	pool, err := db.Connect(ctx, databaseURL)
	if err != nil {
		fmt.Fprintf(os.Stderr, "database connection failed: %v\n", err)
		os.Exit(1)
	}
	defer pool.Close()

	// --- Apply schema and seed resources ---
	if err := db.ApplySchema(ctx, pool); err != nil {
		fmt.Fprintf(os.Stderr, "schema setup failed: %v\n", err)
		os.Exit(1)
	}
	if err := db.SeedResources(ctx, pool); err != nil {
		fmt.Fprintf(os.Stderr, "seeding resources failed: %v\n", err)
		os.Exit(1)
	}

	// --- Handlers ---
	authH := handlers.NewAuthHandler(pool, jwtSecret)
	auditH := handlers.NewAuditHandler(pool)
	findingsH := handlers.NewFindingsHandler(pool)
	chatH := handlers.NewChatHandler(pool)
	userH := handlers.NewUserHandler(pool)
	resourceH := handlers.NewResourceHandler(pool)

	// --- Middleware ---
	authMW := middleware.Auth(pool, jwtSecret)
	adminOnly := middleware.RequireRole("admin")
	analystOrAbove := middleware.RequireRole("admin", "analyst")

	// --- Routes ---
	mux := http.NewServeMux()

	// Health check (public)
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintln(w, `{"status":"ok"}`)
	})

	// Auth (public)
	mux.HandleFunc("POST /auth/login", authH.Login)

	// Auth (protected)
	mux.Handle("POST /auth/logout", authMW(http.HandlerFunc(authH.Logout)))

	// Audits (all roles)
	mux.Handle("GET /audits", authMW(http.HandlerFunc(auditH.List)))
	mux.Handle("GET /audits/{id}", authMW(http.HandlerFunc(auditH.Get)))

	// Findings (all roles read, analyst+ write)
	mux.Handle("GET /audits/{id}/findings", authMW(http.HandlerFunc(findingsH.List)))
	mux.Handle("POST /audits/{id}/findings", authMW(analystOrAbove(http.HandlerFunc(findingsH.Save))))
	mux.Handle("POST /audits/{id}/analysis", authMW(analystOrAbove(http.HandlerFunc(findingsH.SaveAnalysis))))

	// Chat (all roles read, analyst+ write)
	mux.Handle("GET /audits/{id}/chat", authMW(http.HandlerFunc(chatH.List)))
	mux.Handle("POST /audits/{id}/chat", authMW(analystOrAbove(http.HandlerFunc(chatH.Save))))

	// Resources registry (all roles)
	mux.Handle("GET /resources", authMW(http.HandlerFunc(resourceH.List)))
	mux.Handle("GET /audits/{id}/resources/{slug}", authMW(http.HandlerFunc(resourceH.GetBySlug)))
	mux.Handle("GET /audits/{id}/resources/id/{resource_id}", authMW(http.HandlerFunc(resourceH.GetByID)))

	// Users (admin only)
	mux.Handle("GET /users", authMW(adminOnly(http.HandlerFunc(userH.List))))
	mux.Handle("POST /users", authMW(adminOnly(http.HandlerFunc(userH.Create))))
	mux.Handle("PATCH /users/{id}", authMW(adminOnly(http.HandlerFunc(userH.Update))))

	// --- Start server ---
	addr := ":" + port
	fmt.Printf("btg-devops API server listening on %s\n", addr)
	if err := http.ListenAndServe(addr, mux); err != nil {
		fmt.Fprintf(os.Stderr, "server error: %v\n", err)
		os.Exit(1)
	}
}
