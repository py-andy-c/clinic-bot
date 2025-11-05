# Optional: For local Docker builds only
# Railway uses nixpacks.toml for deployment, not this Dockerfile
# Simple single-stage build for development/demo
FROM python:3.12-slim

WORKDIR /app

# Install system dependencies (only gcc needed for psycopg2)
RUN apt-get update && apt-get install -y \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source code
COPY src/ ./src/

# Copy startup script and make it executable
COPY start.sh alembic.ini alembic/ ./ 
RUN chmod +x start.sh

# Set PYTHONPATH to include the app directory so Python can find src modules
ENV PYTHONPATH=/app

# Expose port
EXPOSE 8000

# Run migrations and start the application
# Use start.sh to ensure migrations run and proper directory structure
CMD ["bash", "start.sh"]
