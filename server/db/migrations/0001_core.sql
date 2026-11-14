CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`prompt` text NOT NULL,
	`tier_id` text NOT NULL,
	`tier_snapshot` text NOT NULL,
	`status` text NOT NULL,
	`run_state` text NOT NULL,
	`last_error` text,
	`brief` text,
	`session_id` text,
	`approved_base_version` integer,
	`current_version` integer,
	`builds_this_message` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE INDEX `assets_list_idx` ON `assets` (`deleted_at`,`updated_at`);--> statement-breakpoint
CREATE INDEX `assets_run_state_idx` ON `assets` (`run_state`);--> statement-breakpoint
CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`kind` text NOT NULL,
	`path` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`sha256` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `attachments_asset_idx` ON `attachments` (`asset_id`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`asset_id` text NOT NULL,
	`seq` integer NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`ts` integer NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `events_asset_seq_idx` ON `events` (`asset_id`,`seq`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`ended_at` integer,
	`error` text,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `jobs_status_idx` ON `jobs` (`status`);--> statement-breakpoint
CREATE INDEX `jobs_asset_idx` ON `jobs` (`asset_id`);--> statement-breakpoint
CREATE TABLE `questions` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`payload` text NOT NULL,
	`status` text NOT NULL,
	`answer` text,
	`created_at` integer NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `questions_asset_idx` ON `questions` (`asset_id`,`status`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `versions` (
	`asset_id` text NOT NULL,
	`n` integer NOT NULL,
	`stage` text NOT NULL,
	`stats` text NOT NULL,
	`budget` text NOT NULL,
	`manifest` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`asset_id`, `n`),
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade
);
