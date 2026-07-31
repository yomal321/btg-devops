#!/bin/bash
export GOTOOLCHAIN=local
export GOROOT=/tmp/go123root
export GOPROXY=direct
export GOSUMDB=off
export PATH="$GOROOT/bin:$PATH"
cd "/mnt/d/Bistec Intern Project/btg-devops/CLI Engine"
echo "--- go build (go.mod now says go 1.23.6, GOPROXY=direct) ---"
go build ./... 2>&1
echo "BUILD_EXIT=$?"
echo "--- go vet ---"
go vet ./... 2>&1
echo "VET_EXIT=$?"
echo "--- go test ---"
go test ./... 2>&1
echo "TEST_EXIT=$?"
echo "--- golangci-lint run ---"
/tmp/golangci-lint/golangci-lint run ./... 2>&1
echo "LINT_EXIT=$?"
