CREATE TABLE `agent_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text,
	`session_id` text NOT NULL,
	`message_id` text NOT NULL,
	`name` text NOT NULL,
	`media_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`storage_key` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `agent_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `agent_messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `agent_audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text,
	`session_id` text NOT NULL,
	`user_id` text NOT NULL,
	`event_type` text NOT NULL,
	`tool_name` text,
	`payload` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `agent_file_edits` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text,
	`session_id` text NOT NULL,
	`message_id` text NOT NULL,
	`path` text NOT NULL,
	`before_sha` text,
	`after_sha` text,
	`kind` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `agent_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `agent_messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `agent_mcp_servers` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text,
	`name` text NOT NULL,
	`description` text,
	`transport` text NOT NULL,
	`config` text DEFAULT '{}' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `agent_memories` (
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
	`last_used_at` text
);
--> statement-breakpoint
CREATE TABLE `agent_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text,
	`session_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`parent_message_id` text,
	`role` text NOT NULL,
	`parts` text DEFAULT '[]' NOT NULL,
	`usage` text,
	`cost_usd` text DEFAULT '0' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`user_id` text,
	FOREIGN KEY (`session_id`) REFERENCES `agent_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `agent_pending_human_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text,
	`session_id` text NOT NULL,
	`description` text NOT NULL,
	`link` text,
	`poller_config` text,
	`state` text DEFAULT 'pending' NOT NULL,
	`resolution` text,
	`timeout_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`resolved_at` text,
	FOREIGN KEY (`session_id`) REFERENCES `agent_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `agent_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text,
	`name` text NOT NULL,
	`description` text,
	`git_remote` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `agent_role_permissions` (
	`role_id` text NOT NULL,
	`tool_name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`reason` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`role_id`, `tool_name`)
);
--> statement-breakpoint
CREATE TABLE `agent_session_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text,
	`session_id` text NOT NULL,
	`checkpoints` text DEFAULT '[]' NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `agent_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_session_plans_session_id_unique` ON `agent_session_plans` (`session_id`);--> statement-breakpoint
CREATE TABLE `agent_session_shares` (
	`org_id` text,
	`session_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`granted_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`session_id`, `user_id`),
	FOREIGN KEY (`session_id`) REFERENCES `agent_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `agent_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text,
	`provider_session_id` text NOT NULL,
	`title` text DEFAULT 'New chat' NOT NULL,
	`provider_id` text NOT NULL,
	`provider_config` text DEFAULT '{}' NOT NULL,
	`credential_id` text,
	`model` text,
	`permission_mode` text,
	`system_prompt` text,
	`workspace_id` text,
	`enabled_mcp_server_ids` text DEFAULT '[]' NOT NULL,
	`enabled_tools` text,
	`deny_list` text,
	`expose_flowlib_actions` integer DEFAULT false NOT NULL,
	`tool_output_budget` text DEFAULT '{"lines":100,"bytes":4096}' NOT NULL,
	`created_by` text NOT NULL,
	`visibility` text DEFAULT 'private' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`last_message_at` text,
	`message_count` integer DEFAULT 0 NOT NULL,
	`input_tokens_total` integer DEFAULT 0 NOT NULL,
	`output_tokens_total` integer DEFAULT 0 NOT NULL,
	`cost_usd` text DEFAULT '0' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `agent_workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `agent_skills` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`body` text NOT NULL,
	`scope` text DEFAULT 'personal' NOT NULL,
	`owner_id` text,
	`tags` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `agent_workspace_shares` (
	`org_id` text,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`granted_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`workspace_id`, `user_id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `agent_workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `agent_workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text,
	`name` text NOT NULL,
	`workspace_provider_id` text NOT NULL,
	`root_path` text,
	`git_remote` text,
	`git_branch` text,
	`sandbox_config` text,
	`project_id` text,
	`created_by` text NOT NULL,
	`visibility` text DEFAULT 'private' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
