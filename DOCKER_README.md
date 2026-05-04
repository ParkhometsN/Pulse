# Pulse - Docker Setup

Этот проект полностью сконфигурирован для запуска в Docker контейнерах.

## Требования

- Docker Desktop (или Docker Engine)
- docker-compose

## Структура

- **Backend**: FastAPI приложение на Python (порт 8000)
- **Frontend**: React + Vite приложение (порт 5173)

## Запуск проекта

### Первый запуск

```bash
# Перейдите в корневую папку проекта
cd /Users/mac/Documents/Pulse

# Запустите контейнеры
docker-compose up --build
```

### Последующие запуски

```bash
# Просто запустите без rebuild
docker-compose up
```

## Доступ к приложению

- **Frontend**: http://localhost:5173
- **Backend API**: http://localhost:8000
- **API Docs (Swagger)**: http://localhost:8000/docs

## Полезные команды

```bash
# Остановить контейнеры
docker-compose down

# Остановить и удалить volumes
docker-compose down -v

# Просмотреть логи
docker-compose logs -f

# Логи конкретного сервиса
docker-compose logs -f backend
docker-compose logs -f frontend

# Выполнить команду в контейнере
docker-compose exec backend bash
docker-compose exec frontend sh

# Перестроить image
docker-compose build --no-cache
```

## Разработка

### Hot Reload

- **Backend**: При изменении файлов в `backend/src` - автоматически перезагружается (благодаря `--reload`)
- **Frontend**: При изменении файлов в `frontend/src` - автоматически перезагружается (Vite HMR)

### Переменные окружения

Переменные окружения для Docker находятся в `docker-compose.yml`. 

Для локальной разработки создайте `.env.local` файлы:

**backend/.env**:
```
PYTHONUNBUFFERED=1
```

**frontend/.env.local**:
```
VITE_API_URL=http://localhost:8000
```

## Структура Docker файлов

```
Pulse/
├── docker-compose.yml       # Конфигурация для запуска обоих контейнеров
├── .dockerignore            # Глобальный .dockerignore
├── backend/
│   ├── Dockerfile           # Production Dockerfile для backend
│   ├── .dockerignore        # Backend .dockerignore
│   ├── requirements.txt      # Python зависимости
│   └── src/                 # Python код
└── frontend/
    ├── Dockerfile           # Multi-stage Dockerfile для frontend
    ├── .dockerignore        # Frontend .dockerignore
    ├── package.json         # Node зависимости
    └── src/                 # React код
```

## Решение проблем

### Порты уже используются

Если порты 8000 или 5173 уже используются, измените их в `docker-compose.yml`:

```yaml
ports:
  - "8001:8000"  # Используйте 8001 вместо 8000
  - "5174:5173"  # Используйте 5174 вместо 5173
```

### Контейнеры не стартуют

```bash
# Проверьте логи
docker-compose logs

# Перестройте без кеша
docker-compose build --no-cache
docker-compose up
```

### Очистить все Docker данные

```bash
# Остановить все контейнеры
docker-compose down -v

# Удалить images
docker-compose down --rmi all
```

## Для Production

При развертывании на production:

1. Обновите `.dockerignore` в зависимости от нужд
2. Измените `VITE_API_URL` на актуальный URL backend
3. Используйте production-grade веб-сервер для frontend (nginx)
4. Добавьте переменные окружения в `docker-compose.yml` или используйте `.env` файлы
