import React from 'react';
import { useAction } from '../actions';
export type ThemeName =
  'blue' | 'system' | 'forest' | 'ocean' | 'warm' | 'mint' | 'violet' | 'contrast';
export type OperationLog = { id: string; itemId: string; action: string; at: number };
export const themeNames: Array<[ThemeName, string]> = [
  ['blue', '蓝白'],
  ['system', '跟随系统'],
  ['forest', '森林绿'],
  ['ocean', '深海蓝'],
  ['warm', '暖棕'],
  ['mint', '薄荷绿'],
  ['violet', '紫罗兰'],
  ['contrast', '高对比'],
];
export const categoryColor = (category: string) =>
  ['#397049', '#277da1', '#a15c35', '#7a5aa6', '#b05b72', '#188977'][
    [...category].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 6
  ];

export function FormInput({
  label,
  value,
  onChange,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <label>
      {label}
      <input
        type={type}
        step={type === 'number' ? '0.01' : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
export function FileButton({
  label,
  accept,
  onChange,
}: {
  label: string;
  accept: string;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
}) {
  const { busy, run } = useAction();
  return (
    <label className="outline file-button">
      {label}
      <input
        type="file"
        accept={accept}
        disabled={busy}
        onChange={(event) => {
          void run(() => onChange(event));
        }}
      />
    </label>
  );
}
export function Card({
  title,
  value,
  icon,
}: {
  title: string;
  value: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="card">
      <div>
        <small>{title}</small>
        <b className={value.includes('-') || value.includes('−') ? 'loss' : undefined}>{value}</b>
      </div>
      <span>{icon}</span>
    </div>
  );
}
export function Title({ title, note }: { title: string; note: string }) {
  return (
    <div className="panel-title">
      <h2>{title}</h2>
      <span>{note}</span>
    </div>
  );
}
export function Empty({ text }: { text: string }) {
  return <div className="empty">{text}</div>;
}
