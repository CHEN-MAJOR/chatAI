-- DropIndex
DROP INDEX `Conversation_isArchived_isFavorite_updatedAt_idx` ON `Conversation`;

-- AlterTable
ALTER TABLE `Conversation` ADD COLUMN `aiModel` VARCHAR(120) NULL,
    ADD COLUMN `aiProvider` VARCHAR(40) NULL;
