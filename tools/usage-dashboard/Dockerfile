FROM python:3.11-slim

WORKDIR /app

COPY cli.py scanner.py dashboard.py ./

# Data directory for the SQLite database
RUN mkdir -p /data

# Projects directory (mounted read-only from host)
RUN mkdir -p /projects

ENV HSEOS_USAGE_DB=/data/usage.db
ENV HSEOS_PROJECTS_DIR=/projects
ENV HOST=0.0.0.0
ENV PORT=8080

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8080/')" || exit 1

CMD ["python", "cli.py", "dashboard", "--projects-dir", "/projects"]
