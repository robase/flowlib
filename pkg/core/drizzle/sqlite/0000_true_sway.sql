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
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
