-- CreateIndex
CREATE INDEX `Conversation_isArchived_isFavorite_updatedAt_idx` ON `Conversation`(`isArchived`, `isFavorite`, `updatedAt`);
