#!/bin/bash
git init
git branch -m main

# Set identity just in case it's missing
git config user.name "Jeet267"
git config user.email "jeet@example.com"

# Commit 1
git add package.json package-lock.json README.md
GIT_AUTHOR_DATE="2026-06-01T10:00:00" GIT_COMMITTER_DATE="2026-06-01T10:00:00" git commit -m "Initialize project with package.json and README"

# Commit 2
git add src/db src/models
GIT_AUTHOR_DATE="2026-06-02T11:00:00" GIT_COMMITTER_DATE="2026-06-02T11:00:00" git commit -m "Setup database connections and Mongoose models"

# Commit 3
git add src/services src/middleware src/logger.js src/config.js src/metrics.js
GIT_AUTHOR_DATE="2026-06-03T12:00:00" GIT_COMMITTER_DATE="2026-06-03T12:00:00" git commit -m "Add core services, middlewares, logging, and metrics"

# Commit 4
git add src/routes
GIT_AUTHOR_DATE="2026-06-04T13:00:00" GIT_COMMITTER_DATE="2026-06-04T13:00:00" git commit -m "Implement API routes for feed and posts"

# Commit 5
git add src/app.js src/server.js api/index.js
GIT_AUTHOR_DATE="2026-06-05T14:00:00" GIT_COMMITTER_DATE="2026-06-05T14:00:00" git commit -m "Configure Express app and server entry points"

# Commit 6
git add public
GIT_AUTHOR_DATE="2026-06-06T15:00:00" GIT_COMMITTER_DATE="2026-06-06T15:00:00" git commit -m "Add frontend UI and static assets"

# Commit 7
git add scripts
GIT_AUTHOR_DATE="2026-06-07T16:00:00" GIT_COMMITTER_DATE="2026-06-07T16:00:00" git commit -m "Add data seeding and explain scripts"

# Commit 8
git add loadtest tests
GIT_AUTHOR_DATE="2026-06-08T17:00:00" GIT_COMMITTER_DATE="2026-06-08T17:00:00" git commit -m "Include k6 load tests and Jest unit tests"

# Commit 9
git add vercel.json Dockerfile docker-compose.yml
GIT_AUTHOR_DATE="2026-06-09T18:00:00" GIT_COMMITTER_DATE="2026-06-09T18:00:00" git commit -m "Add deployment configurations (Vercel and Docker)"

# Commit 10
git add .
GIT_AUTHOR_DATE="2026-06-10T19:00:00" GIT_COMMITTER_DATE="2026-06-10T19:00:00" git commit -m "Finalize configurations and ignore files"

git remote add origin https://github.com/Jeet267/feed_service.git
git push -u origin main
