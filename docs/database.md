# Database

The first schema keeps the core chat loop small.

## Tables

### User

Reserved for login and multi-user isolation.

### Conversation

Stores one chat thread.

- `id`
- `userId`
- `title`
- `isFavorite`
- `isArchived`
- `groupId`
- `aiProvider`
- `aiModel`
- `createdAt`
- `updatedAt`

### Message

Stores each chat message.

- `id`
- `conversationId`
- `role`: `SYSTEM`, `USER`, or `ASSISTANT`
- `content`
- `createdAt`

## Migration

After MySQL is running and `apps/api/.env` has a valid `DATABASE_URL`, run:

```bash
docker compose exec -T mysql mysql -uroot -pchatai_root -e "CREATE DATABASE IF NOT EXISTS chatai_shadow;"
npm run prisma:migrate
```
