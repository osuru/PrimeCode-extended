import * as vscode from 'vscode';
import { logger } from '../utils/logger';
import { getGlobalOpenCodeDir } from './opencode/OpenCodeConfigService';

const DEBOUNCE_MS = 500;
const OPENCODE_CONFIG_FILES = ['opencode.json', 'opencode.jsonc'] as const;
const STARTUP_GRACE_MS = 3000;
/** After a UI-initiated save, suppress watcher events for this duration. */
const UI_SAVE_SUPPRESS_MS = 2000;

function normalizePath(fsPath: string): string {
	const normalized = fsPath.replace(/\\/g, '/');
	return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export class ConfigFileWatcherService implements vscode.Disposable {
	private _debounceTimer: ReturnType<typeof setTimeout> | undefined;
	private readonly _disposables: vscode.Disposable[] = [];
	private _isReloading = false;
	private _startedAt = 0;
	private _suppressUntil = 0;
	/**
	 * Content hashes the extension itself wrote to watched config files,
	 * keyed by normalized path. When watcher fires for a file whose on-disk
	 * content matches a recorded hash, it's our own write — skip the reload.
	 * Prevents the self-write → watcher → reload → write loop.
	 */
	private readonly _selfWriteHashes = new Map<string, string>();
	/**
	 * Content hash the config file had the last time we reloaded on it,
	 * keyed by normalized path. A watcher event whose on-disk content matches
	 * this hash is a rewrite of identical content (e.g. by the OpenCode server
	 * itself) — not a real change — so we skip the reload. This breaks the
	 * self-rewrite → watcher → reload loop while preserving reload on genuine edits.
	 */
	private readonly _lastSeenHashes = new Map<string, string>();
	private _onReload: ((source: 'file-watcher' | 'manual') => Promise<void> | void) | undefined;

	public start(onReload: (source: 'file-watcher' | 'manual') => Promise<void> | void): void {
		this._onReload = onReload;

		if (this._disposables.length > 0) {
			return;
		}

		// Allow disabling config file watching entirely (e.g. if reload loops persist).
		if (
			vscode.workspace.getConfiguration('primeCode').get<boolean>('opencode.watchConfig', true) ===
			false
		) {
			logger.info('[ConfigFileWatcherService] Disabled via primeCode.opencode.watchConfig');
			return;
		}

		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		if (!workspaceRoot) {
			logger.warn('[ConfigFileWatcherService] No workspace root, cannot start watcher');
			return;
		}

		this._watchConfigFiles(workspaceRoot);
		const globalOpenCodeDir = getGlobalOpenCodeDir();
		if (globalOpenCodeDir) {
			this._watchConfigFiles(globalOpenCodeDir);
		}
		this._startedAt = Date.now();
	}

	public dispose(): void {
		if (this._debounceTimer) {
			clearTimeout(this._debounceTimer);
			this._debounceTimer = undefined;
		}

		for (const d of this._disposables) {
			d.dispose();
		}
		this._disposables.length = 0;
		logger.info('[ConfigFileWatcherService] Disposed');
	}

	/**
	 * Notify that the UI just wrote to opencode.json.
	 * Suppresses all file watcher events for a short period after the write,
	 * preventing reload loops when multiple writes happen in quick succession
	 * (e.g. syncing multiple proxy providers at startup).
	 * When a content hash + path are supplied, the watcher will additionally
	 * skip reloads for that file whose on-disk content matches the written hash.
	 */
	public notifyUiSave(contentHash?: string, fsPath?: string): void {
		this._suppressUntil = Date.now() + UI_SAVE_SUPPRESS_MS;
		if (contentHash && fsPath) {
			this._selfWriteHashes.set(normalizePath(fsPath), contentHash);
		}
		logger.debug('[ConfigFileWatcherService] UI save notified (suppressing watcher)', {
			suppressUntil: new Date(this._suppressUntil).toISOString(),
			contentHash: contentHash ?? undefined,
		});
	}

	private _watchConfigFiles(basePath: string): void {
		for (const file of OPENCODE_CONFIG_FILES) {
			const watcher = vscode.workspace.createFileSystemWatcher(
				new vscode.RelativePattern(basePath, file),
			);
			watcher.onDidChange(uri => this._handleFileChange(uri, 'change'));
			watcher.onDidCreate(uri => this._handleFileChange(uri, 'create'));
			watcher.onDidDelete(uri => this._handleFileChange(uri, 'delete'));
			this._disposables.push(watcher);
		}
	}

	private _handleFileChange(uri: vscode.Uri, eventType: 'change' | 'create' | 'delete'): void {
		logger.debug(`[ConfigFileWatcherService] File ${eventType}: ${uri.fsPath}`);

		if (this._startedAt && Date.now() - this._startedAt < STARTUP_GRACE_MS) {
			return;
		}

		// Suppress events caused by our own writes (time-based window)
		if (Date.now() < this._suppressUntil) {
			logger.debug('[ConfigFileWatcherService] Suppressed (within UI save window)');
			return;
		}

		if (this._debounceTimer) {
			clearTimeout(this._debounceTimer);
		}

		this._debounceTimer = setTimeout(async () => {
			const currentHash = await this._computeContentHash(uri);
			const pathKey = normalizePath(uri.fsPath);
			// Content-based dedup #1: this is the extension's own write (same content).
			if (currentHash && currentHash === this._selfWriteHashes.get(pathKey)) {
				this._selfWriteHashes.delete(pathKey);
				logger.debug('[ConfigFileWatcherService] Suppressed (self-write content match)');
				return;
			}
			// Content-based dedup #2: content is identical to what we last reloaded on —
			// a rewrite of unchanged content (e.g. by the server), not a real edit.
			const lastSeen = this._lastSeenHashes.get(pathKey);
			if (lastSeen !== undefined && currentHash === lastSeen) {
				logger.debug('[ConfigFileWatcherService] Suppressed (no actual content change)');
				return;
			}
			if (currentHash !== null) {
				this._lastSeenHashes.set(pathKey, currentHash);
			} else {
				this._lastSeenHashes.delete(pathKey);
			}
			void this._performReload('file-watcher');
		}, DEBOUNCE_MS);
	}

	private async _computeContentHash(uri: vscode.Uri): Promise<string | null> {
		try {
			const data = await vscode.workspace.fs.readFile(uri);
			const text = new TextDecoder().decode(data);
			let hash = 0;
			for (let i = 0; i < text.length; i++) {
				const ch = text.charCodeAt(i);
				hash = ((hash << 5) - hash + ch) | 0;
			}
			return hash.toString(36);
		} catch {
			return null;
		}
	}

	private async _performReload(source: 'file-watcher' | 'manual'): Promise<void> {
		if (this._isReloading) {
			logger.debug('[ConfigFileWatcherService] Reload already in progress, skipping');
			return;
		}

		this._isReloading = true;
		const startTime = Date.now();

		try {
			await this._onReload?.(source);

			void startTime;
		} catch (error) {
			logger.error('[ConfigFileWatcherService] Failed to reload config:', error);
		} finally {
			this._isReloading = false;
		}
	}
}
