.PHONY: push push-app push-backend status

# Push both repos to their GitHub remotes in one command.
push: push-app push-backend

push-app:
	git -C CASCADE-app push origin main

push-backend:
	git -C CASCADE-backend push origin main

# Show working-tree status for both repos at a glance.
status:
	@echo "=== CASCADE-app ==="
	@git -C CASCADE-app status --short --branch
	@echo ""
	@echo "=== CASCADE-backend ==="
	@git -C CASCADE-backend status --short --branch
