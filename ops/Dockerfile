# The "ops" service: hosts Coolify scheduled tasks (cron curls + prod pg_dump).
# postgres:17-alpine ships pg_dump 17, which can dump any older server major.
# Build from the REPO ROOT context:  docker build -f ops/Dockerfile .
FROM postgres:17-alpine
RUN apk add --no-cache curl
COPY ops/backup.sh /usr/local/bin/backup.sh
RUN chmod +x /usr/local/bin/backup.sh
# Not a database — just stay alive so scheduled tasks can exec into it.
CMD ["sleep", "infinity"]
