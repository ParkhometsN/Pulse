#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== Pulse Docker Setup ===${NC}\n"

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo -e "${RED}Docker is not installed. Please install Docker first.${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Docker found${NC}"

# Check if docker-compose is installed
if ! command -v docker-compose &> /dev/null; then
    echo -e "${RED}docker-compose is not installed. Please install docker-compose first.${NC}"
    exit 1
fi

echo -e "${GREEN}✓ docker-compose found${NC}\n"

# Build and start containers
echo -e "${YELLOW}Building and starting containers...${NC}\n"
docker-compose up --build

if [ $? -eq 0 ]; then
    echo -e "\n${GREEN}✓ Containers started successfully!${NC}"
    echo -e "\n${YELLOW}Access the application at:${NC}"
    echo -e "Frontend: ${GREEN}http://localhost:5173${NC}"
    echo -e "Backend:  ${GREEN}http://localhost:8000${NC}"
    echo -e "API Docs: ${GREEN}http://localhost:8000/docs${NC}"
else
    echo -e "\n${RED}✗ Failed to start containers${NC}"
    exit 1
fi
