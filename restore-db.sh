#!/bin/bash

# Get the directory where the script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
cd "$SCRIPT_DIR"

# Enable debug output
set -x

# Create data directory if it doesn't exist
mkdir -p data

# Find any existing backups
backup_count=$(ls backups/juiceshop-*.sqlite 2>/dev/null | wc -l)
echo "Found $backup_count backup(s)"

# Check if this is a fresh install (no existing database and no backups)
if [ ! -f "data/juiceshop.sqlite" ] && [ "$backup_count" -eq 0 ]; then
    echo "No existing database or backups found - allowing fresh database initialization"
    exit 0
fi

# Find the most recent backup
latest_backup=$(ls -t backups/juiceshop-*.sqlite 2>/dev/null | head -n1)

if [ -z "$latest_backup" ]; then
    echo "No backup found in backups/ directory"
    exit 0
fi

# Stop the application if it's running (you may need to adjust this depending on how you run the app)
if pgrep -f "npm.*start" > /dev/null; then
    echo "Stopping application..."
    pkill -f "npm.*start"
fi

# Restore the backup
echo "Restoring from $latest_backup..."
cp "$latest_backup" data/juiceshop.sqlite
if [ $? -eq 0 ]; then
    echo "Database restored successfully!"
else
    echo "Error: Failed to restore database"
    exit 1
fi

# Disable debug output
set +x 