import { join } from 'node:path';
import * as vscode from 'vscode';
import {
	normalizeRateLimiterSettings,
	RATE_LIMITER_PLUGIN_FILE,
	type RateLimiterSettings,
} from '../common/rateLimiter';
import { getAppSettings } from '../core/executor/primecodeConfig';
import { logger } from '../utils/logger';
import { getGlobalOpenCodeDir } from './opencode/OpenCodeConfigService';

function renderPluginSource(config: RateLimiterSettings): string {
	const lines = [
		'import { appendFileSync, existsSync, mkdirSync } from "node:fs"',
		'import { tmpdir } from "node:os"',
		'import { join } from "node:path"',
		'',
		'const LOG_DIR = join(tmpdir(), "opencode-rate-limiter")',
		'if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true })',
		'',
		'function log(...args) {',
		'    appendFileSync(join(LOG_DIR, "rate-limiter.log"), "[" + Date.now() + "] " + args.join(" ") + "\\n")',
		'}',
		'',
		'function sleep(ms) {',
		'    return new Promise(resolve => setTimeout(resolve, ms))',
		'}',
		'',
		'const g = globalThis',
		'const state = g.__opencodePrimeCodeRateLimiter || (g.__opencodePrimeCodeRateLimiter = {',
		'    activeRequests: new Set(),',
		'    rateWindows: {},',
		'    totalServed: 0,',
		'    totalThrottled: 0,',
		'    totalConcurrencyBlocked: 0,',
		'    startTime: Date.now(),',
		'})',
		'',
		'const CONFIG = __RATE_LIMITER_CONFIG__;',
		'',
		'function pruneRateWindow(provider) {',
		'    const now = Date.now()',
		'    const cutoff = now - CONFIG.rateWindowMs',
		'    const timestamps = state.rateWindows[provider] || []',
		'    while (timestamps.length > 0 && timestamps[0] < cutoff) timestamps.shift()',
		'    state.rateWindows[provider] = timestamps',
		'    return timestamps',
		'}',
		'',
		'function checkRateLimit(provider) {',
		'    const timestamps = pruneRateWindow(provider)',
		'    if (timestamps.length >= CONFIG.maxRatePerWindow) {',
		'        const waitMs = timestamps[0] + CONFIG.rateWindowMs - Date.now() + 1',
		'        return { limited: true, waitMs: Math.max(waitMs, 0) }',
		'    }',
		'    return { limited: false, waitMs: 0 }',
		'}',
		'',
		'function markRequest(provider) {',
		'    if (!state.rateWindows[provider]) state.rateWindows[provider] = []',
		'    state.rateWindows[provider].push(Date.now())',
		'}',
		'',
		'async function acquireConcurrency(reqId) {',
		'    while (state.activeRequests.size >= CONFIG.maxConcurrent) {',
		'        state.totalConcurrencyBlocked++',
		'        log("CONCURRENCY_BLOCKED id=" + reqId + " active=" + state.activeRequests.size)',
		'        await sleep(CONFIG.checkIntervalMs)',
		'    }',
		'    state.activeRequests.add(reqId)',
		'    state.totalServed++',
		'    log("CONCURRENCY_ACQUIRED id=" + reqId + " active=" + state.activeRequests.size)',
		'    setTimeout(() => {',
		'        if (state.activeRequests.delete(reqId)) {',
		'            log("CONCURRENCY_TIMEOUT_RELEASE id=" + reqId + " active=" + state.activeRequests.size)',
		'        }',
		'    }, CONFIG.requestTimeoutMs)',
		'}',
		'',
		'async function rateLimiterPlugin() {',
		'    log("PLUGIN_LOADED maxConcurrent=" + CONFIG.maxConcurrent + " maxRate=" + CONFIG.maxRatePerWindow + "/" + CONFIG.rateWindowMs + "ms timeout=" + CONFIG.requestTimeoutMs + "ms check=" + CONFIG.checkIntervalMs + "ms")',
		'',
		'    return {',
		'        "chat.params": async (hookInput) => {',
		'            let providerID = "unknown"',
		'            try {',
		'                providerID = hookInput?.provider?.info?.id ?? hookInput?.model?.providerID ?? "unknown"',
		'                const reqId = providerID + "_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6)',
		'                log("REQUEST provider=" + providerID + " id=" + reqId + " active=" + state.activeRequests.size + " served=" + state.totalServed + " throttled=" + state.totalThrottled + " blocked=" + state.totalConcurrencyBlocked)',
		'',
		'                const rateCheck = checkRateLimit(providerID)',
		'                if (rateCheck.limited) {',
		'                    state.totalThrottled++',
		'                    log("RATE_LIMIT provider=" + providerID + " wait=" + rateCheck.waitMs + "ms")',
		'                    await sleep(rateCheck.waitMs)',
		'                }',
		'',
		'                await acquireConcurrency(reqId)',
		'                markRequest(providerID)',
		'                log("PASS provider=" + providerID + " id=" + reqId + " active=" + state.activeRequests.size)',
		'            } catch (err) {',
		'                log("ERROR provider=" + providerID + ": " + (err?.message ?? String(err)))',
		'            }',
		'        },',
		'    }',
		'}',
		'',
		'export default rateLimiterPlugin',
		'export { rateLimiterPlugin as server }',
	];

	return `${lines.join('\n').replace('__RATE_LIMITER_CONFIG__', JSON.stringify(config))}\n`;
}

async function readText(uri: vscode.Uri): Promise<string | undefined> {
	try {
		const raw = await vscode.workspace.fs.readFile(uri);
		return new TextDecoder().decode(raw);
	} catch (error) {
		const candidate = error as { code?: unknown; name?: unknown };
		if (candidate.code === 'FileNotFound' || candidate.name === 'EntryNotFound') return undefined;
		throw error;
	}
}

async function writeIfChanged(uri: vscode.Uri, content: string): Promise<boolean> {
	if ((await readText(uri)) === content) return false;
	await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content));
	return true;
}

export class RateLimiterPluginService {
	public async syncFromConfig(): Promise<void> {
		try {
			await this.apply(getAppSettings().rateLimiter);
		} catch (error) {
			logger.warn('[RateLimiterPluginService] Failed to sync plugin state:', error);
		}
	}

	public async apply(raw: unknown): Promise<void> {
		const config = normalizeRateLimiterSettings(raw);
		const globalDir = getGlobalOpenCodeDir();
		if (!globalDir) {
			logger.warn('[RateLimiterPluginService] No global OpenCode config directory available');
			return;
		}

		const pluginDir = join(globalDir, 'plugins');
		const pluginUri = vscode.Uri.file(join(pluginDir, RATE_LIMITER_PLUGIN_FILE));
		await vscode.workspace.fs.createDirectory(vscode.Uri.file(pluginDir));
		await this.ensureModulePackage(pluginDir);

		if (!config.enabled) {
			try {
				await vscode.workspace.fs.delete(pluginUri);
				logger.info('[RateLimiterPluginService] Rate limiter disabled, plugin removed');
			} catch (error) {
				const candidate = error as { code?: unknown; name?: unknown };
				if (candidate.code !== 'FileNotFound' && candidate.name !== 'EntryNotFound') throw error;
			}
			return;
		}

		const source = renderPluginSource(config);
		const changed = await writeIfChanged(pluginUri, source);
		if (changed) {
			logger.info('[RateLimiterPluginService] Rate limiter plugin written', {
				preset: config.preset,
				maxConcurrent: config.maxConcurrent,
				maxRatePerWindow: config.maxRatePerWindow,
				rateWindowMs: config.rateWindowMs,
			});
		}
	}

	private async ensureModulePackage(pluginDir: string): Promise<void> {
		const uri = vscode.Uri.file(join(pluginDir, 'package.json'));
		const existing = await readText(uri);
		if (existing === undefined) {
			await writeIfChanged(uri, '{"type":"module"}\n');
			return;
		}
		try {
			const parsed = JSON.parse(existing) as Record<string, unknown>;
			if (parsed.type !== 'module') {
				parsed.type = 'module';
				await writeIfChanged(uri, `${JSON.stringify(parsed, null, 2)}\n`);
			}
		} catch {
			logger.warn('[RateLimiterPluginService] Existing plugins/package.json is not valid JSON');
		}
	}
}
