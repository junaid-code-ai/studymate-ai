ALTER TABLE `documents` MODIFY COLUMN `extractedText` mediumtext;--> statement-breakpoint
ALTER TABLE `documents` ADD `processingStatus` varchar(32) DEFAULT 'uploaded' NOT NULL;--> statement-breakpoint
ALTER TABLE `documents` ADD `processingError` text;--> statement-breakpoint
ALTER TABLE `documents` ADD `processingStartedAt` timestamp;