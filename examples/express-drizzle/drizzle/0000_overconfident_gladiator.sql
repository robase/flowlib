CREATE TABLE `flowlib_account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` text,
	`refresh_token_expires_at` text,
	`scope` text,
	`password` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `flowlib_user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `flowlib_action_traces` (
	`id` text PRIMARY KEY NOT NULL,
	`flow_run_id` text NOT NULL,
	`parent_node_execution_id` text,
	`node_id` text,
	`node_type` text,
	`tool_id` text,
	`tool_name` text,
	`iteration` integer,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`inputs` text NOT NULL,
	`outputs` text,
	`error` text,
	`started_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`completed_at` text,
	`duration` integer,
	`retry_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`flow_run_id`) REFERENCES `flowlib_flow_executions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_node_execution_id`) REFERENCES `flowlib_action_traces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `flowlib_apikey` (
	`id` text PRIMARY KEY NOT NULL,
	`config_id` text DEFAULT 'default' NOT NULL,
	`name` text,
	`start` text,
	`prefix` text,
	`key` text NOT NULL,
	`reference_id` text NOT NULL,
	`refill_interval` integer,
	`refill_amount` integer,
	`last_refill_at` text,
	`enabled` integer DEFAULT true,
	`rate_limit_enabled` integer,
	`rate_limit_time_window` integer,
	`rate_limit_max` integer,
	`request_count` integer,
	`remaining` integer,
	`last_request` text,
	`expires_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`permissions` text,
	`metadata` text
);
--> statement-breakpoint
CREATE TABLE `flowlib_batch_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`flow_run_id` text NOT NULL,
	`node_id` text NOT NULL,
	`provider` text NOT NULL,
	`batch_id` text,
	`status` text DEFAULT 'SUBMITTED' NOT NULL,
	`request_data` text NOT NULL,
	`response_data` text,
	`error` text,
	`submitted_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`completed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`flow_run_id`) REFERENCES `flowlib_flow_executions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `flowlib_chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`flow_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`tool_meta` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`flow_id`) REFERENCES `flowlib_flows`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `flowlib_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`auth_type` text NOT NULL,
	`config` text NOT NULL,
	`description` text,
	`is_active` integer DEFAULT true NOT NULL,
	`workspace_id` text,
	`is_shared` integer DEFAULT false NOT NULL,
	`metadata` text,
	`last_used_at` text,
	`expires_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `flowlib_flow_access` (
	`id` text PRIMARY KEY NOT NULL,
	`flow_id` text NOT NULL,
	`user_id` text,
	`team_id` text,
	`permission` text DEFAULT 'viewer' NOT NULL,
	`granted_by` text,
	`granted_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`expires_at` text,
	FOREIGN KEY (`flow_id`) REFERENCES `flowlib_flows`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `flowlib_flow_executions` (
	`id` text PRIMARY KEY NOT NULL,
	`flow_id` text NOT NULL,
	`flow_version` integer NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`inputs` text NOT NULL,
	`outputs` text,
	`error` text,
	`started_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`completed_at` text,
	`duration` integer,
	`created_by` text,
	`trigger_type` text,
	`trigger_id` text,
	`trigger_node_id` text,
	`trigger_data` text,
	`last_heartbeat_at` text,
	`node_outputs` text,
	FOREIGN KEY (`flow_id`) REFERENCES `flowlib_flows`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `flowlib_flow_triggers` (
	`id` text PRIMARY KEY NOT NULL,
	`flow_id` text NOT NULL,
	`node_id` text NOT NULL,
	`type` text NOT NULL,
	`is_enabled` integer DEFAULT true NOT NULL,
	`webhook_path` text,
	`webhook_secret` text,
	`cron_expression` text,
	`cron_timezone` text,
	`last_triggered_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`flow_id`) REFERENCES `flowlib_flows`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `flowlib_flow_triggers_webhook_path_unique` ON `flowlib_flow_triggers` (`webhook_path`);--> statement-breakpoint
CREATE TABLE `flowlib_flow_versions` (
	`flow_id` text NOT NULL,
	`version` integer NOT NULL,
	`flowlib_definition` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`created_by` text,
	PRIMARY KEY(`version`, `flow_id`),
	FOREIGN KEY (`flow_id`) REFERENCES `flowlib_flows`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `flowlib_flows` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`tags` text,
	`is_active` integer DEFAULT true NOT NULL,
	`live_version_number` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`scope_id` text,
	FOREIGN KEY (`scope_id`) REFERENCES `flowlib_rbac_teams`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `flowlib_rbac_scope_access` (
	`id` text PRIMARY KEY NOT NULL,
	`scope_id` text NOT NULL,
	`user_id` text,
	`team_id` text,
	`permission` text DEFAULT 'viewer' NOT NULL,
	`granted_by` text,
	`granted_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`scope_id`) REFERENCES `flowlib_rbac_teams`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `flowlib_rbac_team_members` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `flowlib_rbac_teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `flowlib_user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `flowlib_rbac_teams` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`parent_id` text,
	`created_by` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text,
	FOREIGN KEY (`parent_id`) REFERENCES `flowlib_rbac_teams`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `flowlib_user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `flowlib_session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` text NOT NULL,
	`token` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`impersonated_by` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `flowlib_user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `flowlib_session_token_unique` ON `flowlib_session` (`token`);--> statement-breakpoint
CREATE TABLE `flowlib_two_factor` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`secret` text NOT NULL,
	`backup_codes` text NOT NULL,
	`verified` integer DEFAULT false,
	FOREIGN KEY (`user_id`) REFERENCES `flowlib_user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `flowlib_user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`role` text DEFAULT 'default',
	`banned` integer DEFAULT false,
	`ban_reason` text,
	`ban_expires` text,
	`two_factor_enabled` integer DEFAULT false,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `flowlib_user_email_unique` ON `flowlib_user` (`email`);--> statement-breakpoint
CREATE TABLE `flowlib_vc_sync_config` (
	`id` text PRIMARY KEY NOT NULL,
	`flow_id` text NOT NULL,
	`provider` text NOT NULL,
	`repo` text NOT NULL,
	`branch` text NOT NULL,
	`file_path` text NOT NULL,
	`mode` text NOT NULL,
	`sync_direction` text DEFAULT 'push' NOT NULL,
	`last_synced_at` text,
	`last_commit_sha` text,
	`last_synced_version` integer,
	`draft_branch` text,
	`active_pr_number` integer,
	`active_pr_url` text,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`flow_id`) REFERENCES `flowlib_flows`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `flowlib_vc_sync_config_flow_id_unique` ON `flowlib_vc_sync_config` (`flow_id`);--> statement-breakpoint
CREATE TABLE `flowlib_vc_sync_history` (
	`id` text PRIMARY KEY NOT NULL,
	`flow_id` text NOT NULL,
	`action` text NOT NULL,
	`commit_sha` text,
	`pr_number` integer,
	`version` integer,
	`message` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`created_by` text,
	FOREIGN KEY (`flow_id`) REFERENCES `flowlib_flows`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `flowlib_verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text,
	`updated_at` text
);
--> statement-breakpoint
CREATE TABLE `flowlib_webhook_triggers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`webhook_path` text NOT NULL,
	`provider` text DEFAULT 'generic' NOT NULL,
	`is_enabled` integer DEFAULT true NOT NULL,
	`allowed_methods` text DEFAULT 'POST' NOT NULL,
	`hmac_enabled` integer DEFAULT false NOT NULL,
	`hmac_header_name` text,
	`hmac_secret` text,
	`allowed_ips` text,
	`flow_id` text,
	`node_id` text,
	`last_triggered_at` text,
	`last_payload` text,
	`trigger_count` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`flow_id`) REFERENCES `flowlib_flows`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `flowlib_webhook_triggers_webhook_path_unique` ON `flowlib_webhook_triggers` (`webhook_path`);