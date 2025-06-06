# Use Python 3.10 slim image for smaller size
FROM python:3.10-slim

# Set working directory
WORKDIR /app

# Install system dependencies for audio processing
RUN apt-get update && apt-get install -y \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better Docker caching
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application files
COPY app.py .
COPY conversation_flow.py .
COPY stt_module.py .
COPY tts_module.py .
COPY llm_module.py .
COPY memory_module.py .
COPY session_manager.py .
COPY faq_knowledge_base.py .
COPY conversation_logger.py .

# Copy Google Cloud credentials
COPY google_credentials.json .

# Copy templates directory
COPY templates/ ./templates/

# Create necessary directories for uploads and static files
RUN mkdir -p uploads static logs

# Set environment variables
ENV FLASK_APP=app.py
ENV FLASK_ENV=production
ENV PYTHONUNBUFFERED=1

# Expose port (using 5000 as that's what the app uses)
EXPOSE 5000

# Add healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:5000/ || exit 1

# Run the application
CMD ["python", "app.py"]