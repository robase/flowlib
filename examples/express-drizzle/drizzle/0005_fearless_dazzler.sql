PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_agent_memories` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text,
	`scope` text NOT NULL,
	`user_id` text,
	`project_id` text,
	`content` text NOT NULL,
	`embedding` text,
	`tags` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_used_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `agent_projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_agent_memories`("id", "org_id", "scope", "user_id", "project_id", "content", "embedding", "tags", "created_by", "created_at", "last_used_at") SELECT "id", "org_id", "scope", "user_id", "project_id", "content", "embedding", "tags", "created_by", "created_at", "last_used_at" FROM `agent_memories`;--> statement-breakpoint
DROP TABLE `agent_memories`;--> statement-breakpoint
ALTER TABLE `__new_agent_memories` RENAME TO `agent_memories`;--> statement-breakpoint
PRAGMA foreign_keys=ON;