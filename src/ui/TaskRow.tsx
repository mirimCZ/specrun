import { Box, Text } from 'ink';
import type { ReactElement } from 'react';
import { formatTokens, formatUsd } from '../progress/renderProgress.js';
import type { RowStatus, TaskRowView } from './dashboardStore.js';

const ICONS: Record<RowStatus, { icon: string; color?: string }> = {
  done: { icon: '✔', color: 'green' },
  running: { icon: '▶', color: 'cyan' },
  todo: { icon: '·' },
  blocked: { icon: '✖', color: 'red' },
  interrupted: { icon: '⏸', color: 'yellow' },
};

function stats(row: TaskRowView): string {
  switch (row.status) {
    case 'todo':
      return row.needs.length > 0 ? `needs ${row.needs.join(', ')}` : '';
    case 'blocked':
      return 'blocked';
    default: {
      const parts = [row.model ?? '', `${row.turns} t`];
      if (row.context !== null) parts.push(`ctx ${formatTokens(row.context)}`);
      parts.push(formatUsd(row.costUsd));
      return parts.filter((part) => part !== '').join('  ');
    }
  }
}

export function TaskRow({ row, idWidth }: { row: TaskRowView; idWidth: number }): ReactElement {
  const { icon, color } = ICONS[row.status];
  const dim = row.status === 'todo';
  return (
    <Box>
      <Text {...(color === undefined ? {} : { color })}>{icon} </Text>
      <Text bold={row.status === 'running'}>{row.id.padEnd(idWidth)} </Text>
      <Box flexGrow={1} flexShrink={1}>
        <Text wrap="truncate-end" dimColor={dim}>
          {row.title}
        </Text>
      </Box>
      <Text dimColor={dim}> {stats(row)}</Text>
    </Box>
  );
}
