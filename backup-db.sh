#!/bin/bash

# Get the directory where the script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
cd "$SCRIPT_DIR"

# Create backups directory if it doesn't exist
mkdir -p backups

# Backup the database with timestamp
if [ -f "data/juiceshop.sqlite" ]; then
    cp "data/juiceshop.sqlite" "backups/juiceshop-$(date +%Y%m%d-%H%M%S).sqlite"
    echo "Database backed up to backups/"
else
    echo "No database found at data/juiceshop.sqlite"
    exit 0  # Exit successfully as this might be a fresh install
fi 