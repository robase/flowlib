CREATE TABLE `flowlib_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`namespace` text NOT NULL,
	`value` text,
	`encrypted` integer DEFAULT false NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_by` text
);
