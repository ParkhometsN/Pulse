#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

case "$1" in
    start)
        echo -e "${YELLOW}Starting containers...${NC}"
        docker-compose up
        ;;
    stop)
        echo -e "${YELLOW}Stopping containers...${NC}"
        docker-compose down
        ;;
    restart)
        echo -e "${YELLOW}Restarting containers...${NC}"
        docker-compose restart
        ;;
    build)
        echo -e "${YELLOW}Building containers...${NC}"
        docker-compose build --no-cache
        ;;
    logs)
        echo -e "${YELLOW}Showing logs...${NC}"
        docker-compose logs -f "${2:-}"
        ;;
    shell-backend)
        echo -e "${YELLOW}Opening backend shell...${NC}"
        docker-compose exec backend bash
        ;;
    shell-frontend)
        echo -e "${YELLOW}Opening frontend shell...${NC}"
        docker-compose exec frontend sh
        ;;
    clean)
        echo -e "${RED}Removing all containers, volumes, and networks...${NC}"
        docker-compose down -v
        ;;
    *)
        echo "Usage: $0 {start|stop|restart|build|logs|shell-backend|shell-frontend|clean} [service]"
        echo ""
        echo "Commands:"
        echo "  start                 - Start containers"
        echo "  stop                  - Stop containers"
        echo "  restart               - Restart containers"
        echo "  build                 - Build containers"
        echo "  logs [service]        - Show logs (optional: backend or frontend)"
        echo "  shell-backend         - Open bash shell in backend container"
        echo "  shell-frontend        - Open shell in frontend container"
        echo "  clean                 - Remove all containers and volumes"
        exit 1
        ;;
esac
