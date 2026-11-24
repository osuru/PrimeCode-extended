import type React from 'react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { resolveModelDisplayName } from '../../../common';
import { cn } from '../../lib/cn';
import { useSettingsActions, useSettingsStore } from '../../store';
import { useVSCode } from '../../utils/vscode';
import { ChevronIcon } from '../icons';
import { type ModelData, ModelDropdown } from '../input/ModelDropdown';
import type { DropdownMenuItem } from '../ui';
import { GroupTitle, SettingRow, SettingsGroup } from './SettingsUI';

export const SmallModelSettingsSection: React.FC = () => {
	const { smallModel, opencodeProviders, proxyEndpoints } = useSettingsStore();
	const { setSettings } = useSettingsActions();
	const { postMessage } = useVSCode();
	const [showModelDropdown, setShowModelDropdown] = useState(false);
	const modelButtonRef = useRef<HTMLButtonElement>(null);

	const save = useCallback(
		(value: string) => {
			setSettings({ smallModel: value });
			postMessage({ type: 'updateSettings', settings: { smallModel: value } });
		},
		[postMessage, setSettings],
	);

	const extraItems = useMemo(
		(): DropdownMenuItem<ModelData>[] => [
			{
				id: '',
				label: 'None (OpenCode default)',
				data: { id: '', name: 'None (OpenCode default)', isActive: !smallModel },
			},
		],
		[smallModel],
	);

	const selectedModelLabel = useMemo(() => {
		if (!smallModel) return 'None (OpenCode default)';
		return resolveModelDisplayName(
			smallModel,
			opencodeProviders,
			proxyEndpoints.flatMap(endpoint => endpoint.models),
		);
	}, [opencodeProviders, proxyEndpoints, smallModel]);

	return (
		<div className="animate-fade-in">
			<GroupTitle>Small Model</GroupTitle>
			<SettingsGroup>
				<SettingRow
					title="Model"
					tooltip="OpenCode small_model used for lightweight tasks such as title generation"
					last
				>
					<div className="relative">
						<button
							ref={modelButtonRef}
							type="button"
							onClick={() => setShowModelDropdown(!showModelDropdown)}
							className={cn(
								'flex items-center justify-between gap-(--gap-2) px-(--gap-2-5) h-(--btn-height-sm) min-w-(--select-min-width) rounded-md bg-(--alpha-5) border border-(--alpha-10) text-sm text-(--alpha-90) cursor-pointer outline-none transition-all duration-200',
								'hover:bg-(--alpha-8) hover:border-(--alpha-20)',
								showModelDropdown &&
									'border-(--color-accent)/50 bg-(--alpha-10) ring-1 ring-(--color-accent)/20',
							)}
						>
							<span className="truncate">{selectedModelLabel}</span>
							<ChevronIcon expanded={showModelDropdown} size={10} className="shrink-0" />
						</button>
						{showModelDropdown && (
							<ModelDropdown
								anchorElement={modelButtonRef.current}
								onClose={() => setShowModelDropdown(false)}
								onSelectOverride={save}
								activeModelId={smallModel || ''}
								extraItems={extraItems}
							/>
						)}
					</div>
				</SettingRow>
			</SettingsGroup>
		</div>
	);
};
