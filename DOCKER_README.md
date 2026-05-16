# Pulse - Docker Setup

Этот проект полностью сконфигурирован для запуска в Docker контейнерах.

## Требования

- Docker Desktop (или Docker Engine)
- docker-compose

## Структура

- **Backend**: FastAPI приложение на Python (порт 8000)
- **Frontend**: React + Vite приложение (порт 80 в продакшене)

## Окружения

Проект поддерживает несколько окружений:

- **development**: Локальная разработка (`http://localhost:8000`)
- **staging**: VPS сервер (`http://91.229.11.184:8000`)
- **production**: Продакшн с доменом (`https://pulse-investment.ru/api`)

## Запуск проекта

### Локальная разработка

```bash
# Перейдите в корневую папку проекта
cd /Users/mac/Documents/Pulse

# Запустите контейнеры
docker-compose up --build
```

### Продакшн деплой

```bash
# Деплой на VPS сервер
./deploy.sh production

# Или для staging
./deploy.sh staging
```

## Доступ к приложению

### Локальная разработка
- **Frontend**: http://localhost:5173
- **Backend API**: http://localhost:8000
- **API Docs (Swagger)**: http://localhost:8000/docs

### Продакшн
- **Frontend**: https://pulse-investment.ru
- **Backend API**: https://pulse-investment.ru/api
- **Health Check**: https://pulse-investment.ru/api/health

## Полезные команды

```bash
# Остановить контейнеры
docker-compose down

# Остановить и удалить volumes
docker-compose down -v

# Просмотреть логи
docker-compose logs -f

# Просмотреть логи конкретного сервиса
docker-compose logs -f backend
docker-compose logs -f frontend

# Пересобрать и перезапустить
docker-compose up --build --force-recreate

# Очистить все неиспользуемые ресурсы
docker system prune -f
```

## Конфигурация окружений

Frontend автоматически выбирает API endpoint на основе переменных окружения:

- `.env.development`: Локальная разработка
- `.env.staging`: VPS сервер
- `.env.production`: Продакшн домен

Переменная называется `VITE_API_BASE_URL`.

## Деплой на VPS

1. Убедитесь, что у вас есть SSH доступ к серверу
2. На сервере должен быть установлен Docker и docker-compose
3. Запустите `./deploy.sh production`
4. Приложение будет доступно по домену pulse-investment.ru

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
VITE_API_BASE_URL=http://localhost:8000
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
2. Измените `VITE_API_BASE_URL` на актуальный URL backend
3. Используйте production-grade веб-сервер для frontend (nginx)
4. Добавьте переменные окружения в `docker-compose.yml` или используйте `.env` файлы
