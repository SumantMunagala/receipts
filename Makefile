.PHONY: gen dev-api test lint migrate

gen:
	@echo stub: oapi-codegen + openapi-typescript + zod land in Phase 4 Task 1

dev-api:
	cd api && air

test:
	cd api && go test -race ./...
	pnpm --dir web test

lint:
	cd api && golangci-lint run ./...
	pnpm --dir web lint

migrate:
	@echo stub: goose migrations land in Phase 4 Task 2
