.PHONY: help build up down logs shell-backend shell-frontend clean rebuild

help:
	@echo "Pulse Docker Commands"
	@echo "====================="
	@echo "make build           - Build Docker images"
	@echo "make up              - Start containers"
	@echo "make down            - Stop containers"
	@echo "make restart         - Restart containers"
	@echo "make logs            - Show logs from all containers"
	@echo "make logs-backend    - Show backend logs"
	@echo "make logs-frontend   - Show frontend logs"
	@echo "make shell-backend   - Open bash in backend"
	@echo "make shell-frontend  - Open shell in frontend"
	@echo "make clean           - Remove containers and volumes"
	@echo "make rebuild         - Clean rebuild and start"

build:
	docker-compose build --no-cache

up:
	docker-compose up

down:
	docker-compose down

restart:
	docker-compose restart

logs:
	docker-compose logs -f

logs-backend:
	docker-compose logs -f backend

logs-frontend:
	docker-compose logs -f frontend

shell-backend:
	docker-compose exec backend bash

shell-frontend:
	docker-compose exec frontend sh

clean:
	docker-compose down -v
	rm -rf backend/__pycache__ backend/.pytest_cache
	find . -type d -name __pycache__ -exec rm -rf {} +

rebuild: clean build up
