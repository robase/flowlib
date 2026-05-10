ALTER TABLE `flowlib_webhook_triggers` ADD `remote_webhook_id` text;--> statement-breakpoint
ALTER TABLE `flowlib_webhook_triggers` ADD `remote_credential_id` text REFERENCES flowlib_credentials(id);--> statement-breakpoint
ALTER TABLE `flowlib_webhook_triggers` ADD `remote_provider` text;--> statement-breakpoint
ALTER TABLE `flowlib_webhook_triggers` ADD `remote_scope` text;--> statement-breakpoint
ALTER TABLE `flowlib_webhook_triggers` ADD `remote_events` text;