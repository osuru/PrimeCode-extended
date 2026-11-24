import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { OpenCodeConfigService, ProjectConfigParseError } from './OpenCodeConfigService';

const files = new Map<string, string>();

vi.mock('vscode', async () => {
	const actual = await vi.importActual<typeof import('vscode')>('vscode');
	return {
		...actual,
		workspace: {
			...actual.workspace,
			fs: {
				...actual.workspace.fs,
				createDirectory: vi.fn(async () => {}),
				stat: vi.fn(async (uri: { fsPath: string }) => {
					if (!files.has(uri.fsPath)) {
						throw Object.assign(new Error('File not found'), { code: 'FileNotFound' });
					}
					return { type: actual.FileType.File };
				}),
				readFile: vi.fn(async (uri: { fsPath: string }) => {
					const value = files.get(uri.fsPath);
					if (value === undefined) {
						throw Object.assign(new Error('File not found'), { code: 'FileNotFound' });
					}
					return new TextEncoder().encode(value);
				}),
				writeFile: vi.fn(async (uri: { fsPath: string }, content: Uint8Array) => {
					files.set(uri.fsPath, new TextDecoder().decode(content));
				}),
			},
		},
	};
});

const workspaceRoot = '/test-workspace';
const configPath = path.join(workspaceRoot, 'opencode.json');
const testHome = '/test-home';
const globalConfigPath = path.join(testHome, '.config', 'opencode', 'opencode.json');
const originalHome = process.env.HOME;
const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;

describe('OpenCodeConfigService', () => {
	let service: OpenCodeConfigService;

	beforeEach(() => {
		process.env.HOME = testHome;
		delete process.env.XDG_CONFIG_HOME;
		files.clear();
		vi.clearAllMocks();
		service = new OpenCodeConfigService();
		service.setWorkspaceRoot(workspaceRoot);
	});

	afterEach(() => {
		if (originalHome === undefined) delete process.env.HOME;
		else process.env.HOME = originalHome;
		if (originalXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
		else process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
	});

	it('preserves unrelated keys when setting agent disabled', async () => {
		files.set(
			configPath,
			JSON.stringify({
				mcp: { docs: { type: 'remote', url: 'https://example.test' } },
				plugin: ['plugin-a'],
				permission: { bash: 'ask' },
				provider: { test: { npm: '@test/provider' } },
				agent: { build: { model: 'anthropic/claude' } },
			}),
		);

		await service.setAgentDisabled('build', true);

		const written = JSON.parse(files.get(configPath) ?? '{}');
		expect(written).toMatchObject({
			mcp: { docs: { type: 'remote', url: 'https://example.test' } },
			plugin: ['plugin-a'],
			permission: { bash: 'ask' },
			provider: { test: { npm: '@test/provider' } },
			agent: { build: { model: 'anthropic/claude', disable: true } },
		});
	});

	it('removes agent disable override when enabling inherited agent', async () => {
		files.set(configPath, JSON.stringify({ agent: { build: { disable: true } }, mcp: {} }));

		await service.setAgentDisabled('build', false);

		const written = JSON.parse(files.get(configPath) ?? '{}');
		expect(written).toEqual({ mcp: {} });
	});

	it('does not overwrite invalid project config', async () => {
		files.set(configPath, '{ invalid json');

		await expect(service.setAgentDisabled('build', true)).rejects.toBeInstanceOf(
			ProjectConfigParseError,
		);
		expect(vscode.workspace.fs.writeFile).not.toHaveBeenCalled();
		expect(files.get(configPath)).toBe('{ invalid json');
	});

	it('keeps short scalar arrays inline when patching project config', async () => {
		files.set(
			configPath,
			'{\n  "provider": {\n    "test": {\n      "models": {\n        "model-a": {\n          "modalities": {\n            "input": ["text", "image"],\n            "output": ["text"]\n          }\n        }\n      }\n    }\n  }\n}',
		);

		await service.setProjectField('permission', { bash: 'allow' });

		const written = files.get(configPath) ?? '';
		expect(written).toContain('"input": ["text", "image"]');
		expect(written).toContain('"output": ["text"]');
		expect(written.endsWith('\n')).toBe(false);
	});

	it('sets and removes the global small_model field', async () => {
		files.set(globalConfigPath, JSON.stringify({ theme: 'dark', small_model: 'old/model' }));

		await service.setGlobalSmallModel('provider/model');
		expect(JSON.parse(files.get(globalConfigPath) ?? '{}')).toEqual({
			theme: 'dark',
			small_model: 'provider/model',
		});

		await service.setGlobalSmallModel('');
		expect(JSON.parse(files.get(globalConfigPath) ?? '{}')).toEqual({ theme: 'dark' });
	});
});
