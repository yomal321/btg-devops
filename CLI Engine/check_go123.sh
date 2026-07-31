#!/bin/bash
export GOTOOLCHAIN=local
export GOROOT=/tmp/go125root
export GOSUMDB=off
export GOPROXY=direct
export PATH="$GOROOT/bin:$PATH"
if [ ! -d "$GOROOT" ]; then
  mkdir -p "$GOROOT"
  curl -sL --connect-timeout 15 https://go.dev/dl/go1.25.0.linux-amd64.tar.gz -o /tmp/go125.tar.gz
  tar -C "$GOROOT" -xzf /tmp/go125.tar.gz --strip-components=1
fi
go version
cd "/mnt/d/Bistec Intern Project/btg-devops/CLI Engine"
echo "--- go build (go.mod: go 1.25.0, real Go 1.25.0 toolchain) ---"
go build ./... 2>&1
echo "BUILD_EXIT=$?"
echo "--- go vet ---"
go vet ./... 2>&1
echo "VET_EXIT=$?"
echo "--- go test ---"
go test ./... 2>&1
echo "TEST_EXIT=$?"
echo "--- golangci-lint install ---"
if [ ! -f /tmp/golangci-lint/golangci-lint ]; then
  curl -sL https://github.com/golangci/golangci-lint/releases/download/v1.64.8/golangci-lint-1.64.8-linux-amd64.tar.gz -o /tmp/golangci-lint.tar.gz
  mkdir -p /tmp/golangci-lint
  tar -C /tmp/golangci-lint -xzf /tmp/golangci-lint.tar.gz --strip-components=1
fi
echo "--- golangci-lint run ---"
/tmp/golangci-lint/golangci-lint run ./... 2>&1
echo "LINT_EXIT=$?"
