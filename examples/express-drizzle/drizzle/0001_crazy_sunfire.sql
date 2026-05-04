CREATE TABLE `flowlib_vc_instance_state` (
	`id` text PRIMARY KEY NOT NULL,
	`repo` text NOT NULL,
	`branch` text NOT NULL,
	`last_instance_commit_sha` text,
	`last_reconciler_tick_at` text,
	`last_reconciler_error` text,
	`break_glass_until` text,
	`break_glass_actor` text,
	`break_glass_reason` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `flowlib_vc_pull_commits` (
	`flow_id` text NOT NULL,
	`commit_sha` text NOT NULL,
	`version_inserted` integer,
	`pulled_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`flow_id`, `commit_sha`),
	FOREIGN KEY (`flow_id`) REFERENCES `flowlib_flows`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `flowlib_vc_status_cache` (
	`flow_id` text PRIMARY KEY NOT NULL,
	`state` text NOT NULL,
	`chip_label` text NOT NULL,
	`action_label` text,
	`last_error` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`flow_id`) REFERENCES `flowlib_flows`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_flowlib_vc_sync_config` (
	`id` text PRIMARY KEY NOT NULL,
	`flow_id` text NOT NULL,
	`provider` text NOT NULL,
	`repo` text NOT NULL,
	`branch` text NOT NULL,
	`file_path` text NOT NULL,
	`mode` text NOT NULL,
	`sync_direction` text DEFAULT 'write' NOT NULL,
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
INSERT INTO `__new_flowlib_vc_sync_config`("id", "flow_id", "provider", "repo", "branch", "file_path", "mode", "sync_direction", "last_synced_at", "last_commit_sha", "last_synced_version", "draft_branch", "active_pr_number", "active_pr_url", "enabled", "created_at", "updated_at") SELECT "id", "flow_id", "provider", "repo", "branch", "file_path", "mode", "sync_direction", "last_synced_at", "last_commit_sha", "last_synced_version", "draft_branch", "active_pr_number", "active_pr_url", "enabled", "created_at", "updated_at" FROM `flowlib_vc_sync_config`;--> statement-breakpoint
DROP TABLE `flowlib_vc_sync_config`;--> statement-breakpoint
ALTER TABLE `__new_flowlib_vc_sync_config` RENAME TO `flowlib_vc_sync_config`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `flowlib_vc_sync_config_flow_id_unique` ON `flowlib_vc_sync_config` (`flow_id`);